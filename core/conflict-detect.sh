#!/system/bin/sh

MODDIR="$1"
[ -n "$MODDIR" ] || MODDIR=${0%/*}/..

STATE_DIR=/data/adb/dex2oat-lock
REPORT_FILE="$STATE_DIR/conflict-report.txt"
STATE_FILE="$STATE_DIR/state.prop"
PROP_FILE="$MODDIR/system.prop"
TMP_FILE="$STATE_DIR/conflict-report.tmp"
MANAGED_FILE="$STATE_DIR/conflict-managed.tmp"
CONFLICT_TOTAL=0
SCAN_STATUS=ok
SCAN_REASON=passed
SCAN_MODULE_TOTAL=0
SCAN_SKIPPED_TOTAL=0
MAX_MODULES=${DEX2OAT_CONFLICT_MAX_MODULES:-160}
MAX_LINES_PER_FILE=${DEX2OAT_CONFLICT_MAX_LINES:-240}

mkdir -p "$STATE_DIR" 2>/dev/null || true

if [ -f "$MODDIR/core/state.sh" ]; then
  . "$MODDIR/core/state.sh"
fi

: > "$TMP_FILE" 2>/dev/null || SCAN_STATUS=error
: > "$MANAGED_FILE" 2>/dev/null || SCAN_STATUS=error

normalize_key() {
  printf '%s' "$1" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

normalize_value() {
  printf '%s' "$1" | tr -d '\r' | sed 's/[[:space:]]*$//'
}

find_managed_line() {
  awk -F= -v key="$1" '$1 == key { print; exit }' "$MANAGED_FILE" 2>/dev/null
}

write_warning() {
  SCAN_STATUS=warning
  SCAN_REASON="$1"
}

if [ -s "$PROP_FILE" ]; then
  while IFS='=' read -r PROP_KEY PROP_VALUE || [ -n "$PROP_KEY" ]; do
    PROP_KEY="$(normalize_key "$PROP_KEY")"
    case "$PROP_KEY" in
      ""|\#*) continue ;;
    esac
    PROP_VALUE="$(normalize_value "$PROP_VALUE")"
    printf '%s=%s\n' "$PROP_KEY" "$PROP_VALUE" >> "$MANAGED_FILE" 2>/dev/null || true
  done < "$PROP_FILE"
fi

if [ -s "$MANAGED_FILE" ]; then
  for OTHER_PROP in /data/adb/modules/*/system.prop; do
    [ -f "$OTHER_PROP" ] || continue
    OTHER_MODDIR="${OTHER_PROP%/system.prop}"
    [ "$OTHER_MODDIR" = "$MODDIR" ] && continue
    OTHER_MODULE="${OTHER_MODDIR##*/}"
    [ "$OTHER_MODULE" = "dex2oat-lock" ] && continue

    SCAN_MODULE_TOTAL=$((SCAN_MODULE_TOTAL + 1))
    if [ "$SCAN_MODULE_TOTAL" -gt "$MAX_MODULES" ] 2>/dev/null; then
      write_warning module-scan-limit
      break
    fi

    LINE_TOTAL=0
    while IFS='=' read -r OTHER_KEY OTHER_VALUE || [ -n "$OTHER_KEY" ]; do
      LINE_TOTAL=$((LINE_TOTAL + 1))
      if [ "$LINE_TOTAL" -gt "$MAX_LINES_PER_FILE" ] 2>/dev/null; then
        SCAN_SKIPPED_TOTAL=$((SCAN_SKIPPED_TOTAL + 1))
        write_warning module-line-limit
        break
      fi

      OTHER_KEY="$(normalize_key "$OTHER_KEY")"
      case "$OTHER_KEY" in
        ""|\#*) continue ;;
      esac

      MANAGED_LINE="$(find_managed_line "$OTHER_KEY")"
      [ -n "$MANAGED_LINE" ] || continue

      MANAGED_VALUE="${MANAGED_LINE#*=}"
      OTHER_VALUE="$(normalize_value "$OTHER_VALUE")"
      if [ "$MANAGED_VALUE" = "$OTHER_VALUE" ]; then
        CONFLICT_KIND=same
      else
        CONFLICT_KIND=different
      fi
      printf '%s conflict_with %s kind=%s current=%s other=%s\n' "$OTHER_KEY" "$OTHER_MODULE" "$CONFLICT_KIND" "$MANAGED_VALUE" "$OTHER_VALUE" >> "$TMP_FILE" 2>/dev/null || true
      CONFLICT_TOTAL=$((CONFLICT_TOTAL + 1))
    done < "$OTHER_PROP"
  done
fi

if [ "$SCAN_STATUS" = "ok" ] && [ "${CONFLICT_TOTAL:-0}" -gt 0 ] 2>/dev/null; then
  SCAN_STATUS=warning
  SCAN_REASON=conflicts-found
fi

{
  printf '[conflict]\n'
  printf 'checked_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  printf 'scan_status=%s\n' "$SCAN_STATUS"
  printf 'reason=%s\n' "$SCAN_REASON"
  printf 'conflict_total=%s\n' "$CONFLICT_TOTAL"
  printf 'scanned_modules=%s\n' "$SCAN_MODULE_TOTAL"
  printf 'skipped_files=%s\n' "$SCAN_SKIPPED_TOTAL"
  printf '[items]\n'
  cat "$TMP_FILE" 2>/dev/null
} > "$REPORT_FILE" 2>/dev/null || true

rm -f "$TMP_FILE" "$MANAGED_FILE" 2>/dev/null || true
chmod 0600 "$REPORT_FILE" 2>/dev/null || true
if command -v state_update >/dev/null 2>&1; then
  state_update \
    "conflict.status=$SCAN_STATUS" \
    "conflict.reason=$SCAN_REASON" \
    "conflict.total=$CONFLICT_TOTAL" \
    "conflict.scanned_modules=$SCAN_MODULE_TOTAL" \
    "conflict.skipped_files=$SCAN_SKIPPED_TOTAL" \
    "conflict.checked_at=$(date '+%Y-%m-%d %H:%M:%S')" || true
  state_recompute_summary || true
fi
exit 0
