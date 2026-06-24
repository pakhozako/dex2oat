#!/system/bin/sh

MODDIR="$1"
[ -n "$MODDIR" ] || MODDIR=${0%/*}/..

STATE_DIR=/data/adb/dex2oat-lock
REPORT_FILE="$STATE_DIR/conflict-report.txt"
PROP_FILE="$MODDIR/system.prop"
TMP_FILE="$STATE_DIR/conflict-report.tmp"
CONFLICT_TOTAL=0
SCAN_STATUS=ok

mkdir -p "$STATE_DIR" 2>/dev/null || true
: > "$TMP_FILE" 2>/dev/null || SCAN_STATUS=error

has_prop_in_module() {
  SEARCH_KEY="$1"
  SEARCH_VALUE="$2"
  SEARCH_FILE="$3"
  while IFS='=' read -r OTHER_KEY OTHER_VALUE; do
    OTHER_KEY="$(printf '%s' "$OTHER_KEY" | tr -d '\r' | sed 's/[[:space:]]*$//')"
    case "$OTHER_KEY" in
      ""|\#*) continue ;;
    esac
    if [ "$OTHER_KEY" = "$SEARCH_KEY" ]; then
      if [ "$OTHER_VALUE" = "$SEARCH_VALUE" ]; then
        printf 'same\n'
      else
        printf 'different %s\n' "$OTHER_VALUE"
      fi
      return 0
    fi
  done < "$SEARCH_FILE"
  return 1
}

if [ -s "$PROP_FILE" ]; then
  while IFS='=' read -r PROP_KEY PROP_VALUE; do
    PROP_KEY="$(printf '%s' "$PROP_KEY" | tr -d '\r' | sed 's/[[:space:]]*$//')"
    case "$PROP_KEY" in
      ""|\#*) continue ;;
    esac

    for OTHER_PROP in /data/adb/modules/*/system.prop; do
      [ -f "$OTHER_PROP" ] || continue
      OTHER_MODDIR="${OTHER_PROP%/system.prop}"
      [ "$OTHER_MODDIR" = "$MODDIR" ] && continue
      OTHER_MODULE="${OTHER_MODDIR##*/}"
      [ "$OTHER_MODULE" = "dex2oat-lock" ] && continue
      CONFLICT_RESULT="$(has_prop_in_module "$PROP_KEY" "$PROP_VALUE" "$OTHER_PROP")"
      if [ -n "$CONFLICT_RESULT" ]; then
        CONFLICT_KIND="${CONFLICT_RESULT%% *}"
        OTHER_VALUE="${CONFLICT_RESULT#different }"
        [ "$CONFLICT_KIND" = "$OTHER_VALUE" ] && OTHER_VALUE="$PROP_VALUE"
        printf '%s conflict_with %s kind=%s current=%s other=%s\n' "$PROP_KEY" "$OTHER_MODULE" "$CONFLICT_KIND" "$PROP_VALUE" "$OTHER_VALUE" >> "$TMP_FILE" 2>/dev/null || true
        CONFLICT_TOTAL=$((CONFLICT_TOTAL + 1))
      fi
    done
  done < "$PROP_FILE"
fi

{
  printf '[conflict]\n'
  printf 'checked_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  printf 'scan_status=%s\n' "$SCAN_STATUS"
  printf 'conflict_total=%s\n' "$CONFLICT_TOTAL"
  printf '[items]\n'
  cat "$TMP_FILE" 2>/dev/null
} > "$REPORT_FILE" 2>/dev/null || true

rm -f "$TMP_FILE" 2>/dev/null || true
chmod 0600 "$REPORT_FILE" 2>/dev/null || true
exit 0
