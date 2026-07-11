#!/system/bin/sh

MODDIR="$1"
[ -n "$MODDIR" ] || MODDIR=${0%/*}/..

STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
MODULES_ROOT=${DEX2OAT_MODULES_ROOT:-/data/adb/modules}
REPORT_FILE="$STATE_DIR/conflict-report.txt"
STATE_FILE="$STATE_DIR/state.prop"
PROP_FILE="$MODDIR/system.prop"
TMP_FILE="$STATE_DIR/conflict-report.$$.items.tmp"
MANAGED_FILE="$STATE_DIR/conflict-managed.$$.tmp"
REPORT_TMP="$STATE_DIR/conflict-report.$$.tmp"
CONFLICT_TOTAL=0
SCAN_STATUS=ok
SCAN_REASON=passed
SCAN_MODULE_TOTAL=0

mkdir -p "$STATE_DIR" 2>/dev/null || true

cleanup_conflict_scan() {
  rm -f "$TMP_FILE" "$MANAGED_FILE" "$REPORT_TMP" 2>/dev/null || true
}
trap 'cleanup_conflict_scan' EXIT HUP INT TERM

if [ -f "$MODDIR/core/state.sh" ]; then
  . "$MODDIR/core/state.sh"
fi

: > "$TMP_FILE" 2>/dev/null || { SCAN_STATUS=error; SCAN_REASON=report-init-failed; }
: > "$MANAGED_FILE" 2>/dev/null || { SCAN_STATUS=error; SCAN_REASON=managed-init-failed; }

scan_prop_conflicts() {
  SCAN_OTHER_PROP="$1"
  SCAN_OTHER_MODULE="$2"
  awk -F= -v module="$SCAN_OTHER_MODULE" '
    function clean_key(value) {
      gsub(/\r/, "", value)
      sub(/^[[:space:]]*/, "", value)
      sub(/[[:space:]]*$/, "", value)
      return value
    }
    function clean_value(value) {
      gsub(/\r/, "", value)
      sub(/[[:space:]]*$/, "", value)
      return value
    }
    function line_value(line) {
      sub(/^[^=]*=/, "", line)
      return clean_value(line)
    }
    FNR == NR {
      if (index($0, "=") == 0) next
      key = clean_key($1)
      if (key == "" || substr(key, 1, 1) == "#") next
      managed[key] = line_value($0)
      next
    }
    {
      if (index($0, "=") == 0) next
      key = clean_key($1)
      if (key == "" || substr(key, 1, 1) == "#") next
      if (!(key in managed)) next
      other = line_value($0)
      kind = managed[key] == other ? "same" : "different"
      printf "%s conflict_with %s kind=%s current=%s other=%s\n", key, module, kind, managed[key], other
    }
  ' "$MANAGED_FILE" "$SCAN_OTHER_PROP"
}

if [ -s "$PROP_FILE" ]; then
  while IFS= read -r PROP_LINE || [ -n "$PROP_LINE" ]; do
    case "$PROP_LINE" in
      *=*) : ;;
      *) continue ;;
    esac
    PROP_KEY="${PROP_LINE%%=*}"
    PROP_VALUE="${PROP_LINE#*=}"
    PROP_KEY="$(printf '%s' "$PROP_KEY" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    case "$PROP_KEY" in
      ""|\#*) continue ;;
    esac
    PROP_VALUE="$(printf '%s' "$PROP_VALUE" | tr -d '\r' | sed 's/[[:space:]]*$//')"
    printf '%s=%s\n' "$PROP_KEY" "$PROP_VALUE" >> "$MANAGED_FILE" 2>/dev/null || true
  done < "$PROP_FILE"
fi

if [ -s "$MANAGED_FILE" ]; then
  for OTHER_PROP in "$MODULES_ROOT"/*/system.prop; do
    [ -f "$OTHER_PROP" ] || continue
    OTHER_MODDIR="${OTHER_PROP%/system.prop}"
    [ "$OTHER_MODDIR" = "$MODDIR" ] && continue
    OTHER_MODULE="${OTHER_MODDIR##*/}"
    [ "$OTHER_MODULE" = "dex2oat-lock" ] && continue
    [ -e "$OTHER_MODDIR/disable" ] && continue
    [ -e "$OTHER_MODDIR/remove" ] && continue

    SCAN_MODULE_TOTAL=$((SCAN_MODULE_TOTAL + 1))
    scan_prop_conflicts "$OTHER_PROP" "$OTHER_MODULE" >> "$TMP_FILE" 2>/dev/null || {
      SCAN_STATUS=error
      SCAN_REASON=scan-error
    }
  done
fi

if [ -s "$TMP_FILE" ]; then
  CONFLICT_TOTAL="$(wc -l < "$TMP_FILE" 2>/dev/null | tr -d ' ')"
  case "$CONFLICT_TOTAL" in ''|*[!0-9]*) CONFLICT_TOTAL=0 ;; esac
fi

if [ "$SCAN_STATUS" = "ok" ] && [ "${CONFLICT_TOTAL:-0}" -gt 0 ] 2>/dev/null; then
  SCAN_STATUS=warning
  SCAN_REASON=conflicts-found
fi

write_report() {
  {
    printf '[conflict]\n'
    printf 'checked_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
    printf 'scan_status=%s\n' "$SCAN_STATUS"
    printf 'reason=%s\n' "$SCAN_REASON"
    printf 'conflict_total=%s\n' "$CONFLICT_TOTAL"
    printf 'scanned_modules=%s\n' "$SCAN_MODULE_TOTAL"
    printf '[items]\n'
    cat "$TMP_FILE" 2>/dev/null
  } > "$REPORT_TMP" 2>/dev/null && mv -f "$REPORT_TMP" "$REPORT_FILE" 2>/dev/null
}

if ! write_report; then
  SCAN_STATUS=error
  SCAN_REASON=report-write-failed
  write_report || true
fi

cleanup_conflict_scan
trap - EXIT HUP INT TERM
chmod 0600 "$REPORT_FILE" 2>/dev/null || true
if command -v state_update >/dev/null 2>&1; then
  state_update \
    "conflict.status=$SCAN_STATUS" \
    "conflict.reason=$SCAN_REASON" \
    "conflict.total=$CONFLICT_TOTAL" \
    "conflict.scanned_modules=$SCAN_MODULE_TOTAL" \
    "conflict.checked_at=$(date '+%Y-%m-%d %H:%M:%S')" || true
  state_recompute_summary || true
fi
exit 0
