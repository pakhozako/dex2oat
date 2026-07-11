#!/system/bin/sh

MODDIR="$1"
CANDIDATE_FILE="$2"
FILTERED_FILE="$3"
REPORT_FILE="$4"

[ -n "$MODDIR" ] || exit 1
[ -f "$CANDIDATE_FILE" ] || exit 1
[ -n "$FILTERED_FILE" ] || exit 1
[ -n "$REPORT_FILE" ] || exit 1

MODULES_ROOT=${DEX2OAT_MODULES_ROOT:-/data/adb/modules}
WORK_DIR="${REPORT_FILE%/*}"
MANAGED_FILE="$WORK_DIR/conflict-managed.$$"
ITEMS_FILE="$WORK_DIR/conflict-items.$$"
KEYS_FILE="$WORK_DIR/conflict-keys.$$"
FILTERED_TMP="$FILTERED_FILE.tmp.$$"
REPORT_TMP="$REPORT_FILE.tmp.$$"
MODULE_ID="$(sed -n 's/^id=//p' "$MODDIR/module.prop" 2>/dev/null | head -n 1)"
[ -n "$MODULE_ID" ] || MODULE_ID=dex2oat-lock

cleanup_conflicts() {
  rm -f "$MANAGED_FILE" "$ITEMS_FILE" "$KEYS_FILE" "$FILTERED_TMP" "$REPORT_TMP" 2>/dev/null || true
}
trap 'cleanup_conflicts' EXIT HUP INT TERM

mkdir -p "$WORK_DIR" 2>/dev/null || exit 1
: > "$MANAGED_FILE" || exit 1
: > "$ITEMS_FILE" || exit 1

awk -F= '
  /^[[:space:]]*($|#)/ { next }
  index($0, "=") == 0 { next }
  {
    key = $1
    value = $0
    sub(/^[^=]*=/, "", value)
    sub(/\r$/, "", value)
    if (key ~ /^[A-Za-z0-9_.-]+$/) print key "=" value
  }
' "$CANDIDATE_FILE" > "$MANAGED_FILE" || exit 1

SCANNED_MODULES=0
if [ -s "$MANAGED_FILE" ] && [ -d "$MODULES_ROOT" ]; then
  for OTHER_PROP in "$MODULES_ROOT"/*/system.prop; do
    [ -f "$OTHER_PROP" ] || continue
    OTHER_MODDIR=${OTHER_PROP%/system.prop}
    OTHER_MODULE=${OTHER_MODDIR##*/}
    [ "$OTHER_MODDIR" = "$MODDIR" ] && continue
    [ "$OTHER_MODULE" = "$MODULE_ID" ] && continue
    [ -e "$OTHER_MODDIR/disable" ] && continue
    [ -e "$OTHER_MODDIR/remove" ] && continue
    [ -r "$OTHER_PROP" ] || exit 1

    OTHER_MODULE="$(printf '%s' "$OTHER_MODULE" | tr '|\r\n' '___')"
    SCANNED_MODULES=$((SCANNED_MODULES + 1))
    awk -F= -v module="$OTHER_MODULE" '
      FNR == NR {
        key = $1
        value = $0
        sub(/^[^=]*=/, "", value)
        managed[key] = value
        next
      }
      /^[[:space:]]*($|#)/ { next }
      index($0, "=") == 0 { next }
      {
        key = $1
        value = $0
        sub(/^[^=]*=/, "", value)
        sub(/\r$/, "", value)
        if (!(key in managed)) next
        kind = managed[key] == value ? "same" : "different"
        printf "%s\t%s\t%s\t%s\t%s\n", key, module, kind, managed[key], value
      }
    ' "$MANAGED_FILE" "$OTHER_PROP" >> "$ITEMS_FILE" || exit 1
  done
fi

if [ -s "$ITEMS_FILE" ]; then
  cut -f 1 "$ITEMS_FILE" | sort -u > "$KEYS_FILE" || exit 1
else
  : > "$KEYS_FILE" || exit 1
fi

awk -F= '
  FILENAME == ARGV[1] {
    blocked[$1] = 1
    next
  }
  /^[[:space:]]*($|#)/ {
    print
    next
  }
  {
    key = $1
    if (!(key in blocked)) print
  }
' "$KEYS_FILE" "$CANDIDATE_FILE" > "$FILTERED_TMP" || exit 1

CONFLICT_TOTAL="$(wc -l < "$KEYS_FILE" 2>/dev/null | tr -d ' ')"
ITEM_TOTAL="$(wc -l < "$ITEMS_FILE" 2>/dev/null | tr -d ' ')"
SAME_TOTAL="$(awk -F '\t' '$3 == "same" { count++ } END { print count + 0 }' "$ITEMS_FILE" 2>/dev/null)"
DIFFERENT_TOTAL="$(awk -F '\t' '$3 == "different" { count++ } END { print count + 0 }' "$ITEMS_FILE" 2>/dev/null)"
FINAL_TOTAL="$(awk -F= '/^[A-Za-z0-9_.-]+=/ { count++ } END { print count + 0 }' "$FILTERED_TMP" 2>/dev/null)"
SCAN_STATUS=ok
SCAN_REASON=no-conflicts
if [ "${CONFLICT_TOTAL:-0}" -gt 0 ] 2>/dev/null; then
  SCAN_STATUS=warning
  SCAN_REASON=conflicting-properties-skipped
fi

{
  printf 'checked_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  printf 'status=%s\n' "$SCAN_STATUS"
  printf 'reason=%s\n' "$SCAN_REASON"
  printf 'scanned_modules=%s\n' "$SCANNED_MODULES"
  printf 'conflict_total=%s\n' "${CONFLICT_TOTAL:-0}"
  printf 'item_total=%s\n' "${ITEM_TOTAL:-0}"
  printf 'same_total=%s\n' "${SAME_TOTAL:-0}"
  printf 'different_total=%s\n' "${DIFFERENT_TOTAL:-0}"
  printf 'final_total=%s\n' "${FINAL_TOTAL:-0}"
  ITEM_INDEX=0
  while IFS="$(printf '\t')" read -r ITEM_KEY ITEM_MODULE ITEM_KIND ITEM_CURRENT ITEM_OTHER || [ -n "$ITEM_KEY" ]; do
    [ -n "$ITEM_KEY" ] || continue
    ITEM_INDEX=$((ITEM_INDEX + 1))
    printf 'item.%s=%s|%s|%s|%s|%s\n' "$ITEM_INDEX" "$ITEM_KEY" "$ITEM_MODULE" "$ITEM_KIND" "$ITEM_CURRENT" "$ITEM_OTHER"
  done < "$ITEMS_FILE"
} > "$REPORT_TMP" || exit 1

mv -f "$FILTERED_TMP" "$FILTERED_FILE" || exit 1
mv -f "$REPORT_TMP" "$REPORT_FILE" || exit 1
chmod 0600 "$FILTERED_FILE" "$REPORT_FILE" 2>/dev/null || true
rm -f "$MANAGED_FILE" "$ITEMS_FILE" "$KEYS_FILE" 2>/dev/null || true
trap - EXIT HUP INT TERM
exit 0
