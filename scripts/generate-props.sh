#!/system/bin/sh

CAPTURED_FILE="$1"
OPTIONS_FILE="$2"
OUTPUT_FILE="$3"
MATCHED_FILE="$4"
REPORT_FILE="$5"
SOURCE_FILE="$6"
MODULE_VERSION="$7"
ORIGINAL_PROPS="$8"

[ -f "$OPTIONS_FILE" ] || exit 1
[ -n "$OUTPUT_FILE" ] || exit 1
[ -n "$MATCHED_FILE" ] || exit 1
[ -n "$REPORT_FILE" ] || exit 1
[ -n "$SOURCE_FILE" ] || exit 1

STATE_DIR="${REPORT_FILE%/*}"
VALUES_FILE="$STATE_DIR/captured-values.prop"
RULES_FILE="$STATE_DIR/rule-props.tsv"
TMP_OUTPUT="$OUTPUT_FILE.tmp"
TMP_MATCHED="$MATCHED_FILE.tmp"
TMP_REPORT="$REPORT_FILE.tmp"
TMP_SOURCE="$SOURCE_FILE.tmp"
GENERATED_AT="$(date '+%Y-%m-%d %H:%M:%S')"

mkdir -p "$STATE_DIR" 2>/dev/null || exit 1

: > "$VALUES_FILE" || exit 1
if [ -s "$CAPTURED_FILE" ]; then
  sed -n \
    -e 's/^\[\([^]]*\)\]: \[\(.*\)\]$/\1=\2/p' \
    -e 's/^\([^=#][^=]*\)=\(.*\)$/\1=\2/p' \
    "$CAPTURED_FILE" > "$VALUES_FILE" || exit 1
fi

awk '
  /"id"[[:space:]]*:/ {
    line=$0; sub(/^.*"id"[[:space:]]*:[[:space:]]*"/, "", line); sub(/".*$/, "", line); id=line
  }
  /"label"[[:space:]]*:/ {
    line=$0; sub(/^.*"label"[[:space:]]*:[[:space:]]*"/, "", line); sub(/".*$/, "", line); label=line
  }
  /"prop"[[:space:]]*:/ {
    line=$0; sub(/^.*"prop"[[:space:]]*:[[:space:]]*"/, "", line); sub(/".*$/, "", line); prop=line
  }
  /"defaultEnabled"[[:space:]]*:/ {
    enabled=($0 ~ /true/) ? "true" : "false"
  }
  /"defaultValue"[[:space:]]*:/ {
    line=$0; sub(/^.*"defaultValue"[[:space:]]*:[[:space:]]*"/, "", line); sub(/".*$/, "", line); value=line
    if (id != "" && prop != "") {
      gsub(/\|/, "/", label)
      print id "|" label "|" prop "|" enabled "|" value
    }
    id=""; label=""; prop=""; enabled="false"; value=""
  }
' "$OPTIONS_FILE" > "$RULES_FILE" || exit 1

[ -s "$RULES_FILE" ] || exit 1

CAPTURED_TOTAL=$(grep -c '=' "$VALUES_FILE" 2>/dev/null | tr -d ' ')
MATCHED_TOTAL=0
DEFAULT_TOTAL=0
DISABLED_TOTAL=0
SKIPPED_DUP_TOTAL=0
FALLBACK_TOTAL=0
UNMATCHED_TOTAL=0
MATCH_STATUS=ok
MATCH_REASON=matched
MATCH_CONFIDENCE=high
: > "$TMP_MATCHED" || exit 1
: > "$TMP_OUTPUT" || exit 1

{
  printf '# Dex2oat Lock generated system.prop\n'
  printf '# generated_at=%s\n' "$GENERATED_AT"
  printf '# mode=rule-driven\n'
  printf '# version=%s\n' "${MODULE_VERSION:-unknown}"
  printf '\n'
} >> "$TMP_OUTPUT"

SEEN_PROPS="$STATE_DIR/rule-seen-props.txt"
: > "$SEEN_PROPS" || exit 1

while IFS='|' read -r RULE_ID RULE_LABEL RULE_PROP RULE_ENABLED RULE_DEFAULT || [ -n "$RULE_PROP" ]; do
  [ -n "$RULE_PROP" ] || continue
  if grep -F -x -q "$RULE_PROP" "$SEEN_PROPS" 2>/dev/null; then
    SKIPPED_DUP_TOTAL=$((SKIPPED_DUP_TOTAL + 1))
    continue
  fi
  printf '%s\n' "$RULE_PROP" >> "$SEEN_PROPS"

  CAPTURED_LINE="$(grep -F -m 1 "$RULE_PROP=" "$VALUES_FILE" 2>/dev/null)"
  CAPTURED_VALUE="${CAPTURED_LINE#*=}"
  [ "$CAPTURED_LINE" = "$CAPTURED_VALUE" ] && CAPTURED_VALUE=""
  FINAL_VALUE="$RULE_DEFAULT"
  FINAL_SOURCE=default

  if [ -n "$CAPTURED_VALUE" ]; then
    case "$CAPTURED_VALUE" in *[!A-Za-z0-9_.,:/@%+*-]*)
      CAPTURED_VALUE=""
      ;;
    esac
  fi

  if [ -n "$CAPTURED_VALUE" ]; then
    FINAL_VALUE="$CAPTURED_VALUE"
    FINAL_SOURCE=captured
    MATCHED_TOTAL=$((MATCHED_TOTAL + 1))
  elif [ "$RULE_ENABLED" = "true" ]; then
    DEFAULT_TOTAL=$((DEFAULT_TOTAL + 1))
  else
    DISABLED_TOTAL=$((DISABLED_TOTAL + 1))
  fi

  printf '# %s\n' "${RULE_LABEL:-$RULE_ID}" >> "$TMP_OUTPUT"
  printf '# rule_id=%s source=%s default=%s\n' "$RULE_ID" "$FINAL_SOURCE" "$RULE_DEFAULT" >> "$TMP_OUTPUT"
  if [ "$RULE_ENABLED" = "true" ] || [ "$FINAL_SOURCE" = "captured" ]; then
    printf '# prop.action=enable prop.key=%s prop.value=%s\n' "$RULE_PROP" "$FINAL_VALUE" >> "$TMP_OUTPUT"
    printf '%s=%s\n\n' "$RULE_PROP" "$FINAL_VALUE" >> "$TMP_OUTPUT"
    printf '%s=%s\n' "$RULE_PROP" "$FINAL_VALUE" >> "$TMP_MATCHED"
  else
    printf '# prop.action=disable prop.key=%s prop.value=%s\n' "$RULE_PROP" "$FINAL_VALUE" >> "$TMP_OUTPUT"
    printf '# %s=%s\n\n' "$RULE_PROP" "$FINAL_VALUE" >> "$TMP_OUTPUT"
  fi
done < "$RULES_FILE"

[ -s "$TMP_OUTPUT" ] || exit 1

FALLBACK_TOTAL="$DEFAULT_TOTAL"
UNMATCHED_TOTAL="$DISABLED_TOTAL"
if [ "${CAPTURED_TOTAL:-0}" -eq 0 ] 2>/dev/null; then
  MATCH_STATUS=fallback
  MATCH_REASON=no-captured-props-safe-defaults
  MATCH_CONFIDENCE=low
elif [ "${MATCHED_TOTAL:-0}" -eq 0 ] 2>/dev/null; then
  MATCH_STATUS=fallback
  MATCH_REASON=no-managed-prop-hit-safe-defaults
  MATCH_CONFIDENCE=low
elif [ "${SKIPPED_DUP_TOTAL:-0}" -gt 0 ] 2>/dev/null; then
  MATCH_STATUS=ok
  MATCH_REASON=captured-values-used-duplicates-skipped
  MATCH_CONFIDENCE=high
elif [ "${MATCHED_TOTAL:-0}" -lt 3 ] 2>/dev/null && [ "${DEFAULT_TOTAL:-0}" -gt 0 ] 2>/dev/null; then
  MATCH_STATUS=partial
  MATCH_REASON=limited-captured-evidence-safe-defaults
  MATCH_CONFIDENCE=medium
elif [ "${DEFAULT_TOTAL:-0}" -gt 0 ] 2>/dev/null; then
  MATCH_STATUS=ok
  MATCH_REASON=captured-values-and-safe-defaults
  MATCH_CONFIDENCE=high
else
  MATCH_STATUS=ok
  MATCH_REASON=captured-values-used
  MATCH_CONFIDENCE=high
fi

{
  printf 'generated_at=%s\n' "$GENERATED_AT"
  printf 'mode=rule-driven\n'
  printf 'schema_version=32\n'
  printf 'status=%s\n' "$MATCH_STATUS"
  printf 'reason=%s\n' "$MATCH_REASON"
  printf 'confidence=%s\n' "$MATCH_CONFIDENCE"
  printf 'captured_total=%s\n' "${CAPTURED_TOTAL:-0}"
  printf 'matched_total=%s\n' "${MATCHED_TOTAL:-0}"
  printf 'default_total=%s\n' "${DEFAULT_TOTAL:-0}"
  printf 'disabled_total=%s\n' "${DISABLED_TOTAL:-0}"
  printf 'fallback_total=%s\n' "${FALLBACK_TOTAL:-0}"
  printf 'unmatched_total=%s\n' "${UNMATCHED_TOTAL:-0}"
  printf 'skipped_duplicate_total=%s\n' "${SKIPPED_DUP_TOTAL:-0}"
  printf 'generated_system_prop=%s\n' "$OUTPUT_FILE"
  printf '[diff]\n'
  while IFS='=' read -r DIFF_KEY DIFF_VALUE || [ -n "$DIFF_KEY" ]; do
    [ -z "$DIFF_KEY" ] && continue
    ORIGINAL_LINE=""
    [ -n "$ORIGINAL_PROPS" ] && [ -f "$ORIGINAL_PROPS" ] && ORIGINAL_LINE="$(grep -F -m 1 "$DIFF_KEY=" "$ORIGINAL_PROPS" 2>/dev/null)"
    if [ -n "$ORIGINAL_LINE" ]; then
      ORIGINAL_VALUE="${ORIGINAL_LINE#*=}"
    elif [ -n "$ORIGINAL_PROPS" ] && [ -f "$ORIGINAL_PROPS" ] && grep -F -x -q "@unset:$DIFF_KEY" "$ORIGINAL_PROPS" 2>/dev/null; then
      ORIGINAL_VALUE="<unset>"
    else
      ORIGINAL_VALUE="<unknown>"
    fi
    printf '%s: %s -> %s\n' "$DIFF_KEY" "$ORIGINAL_VALUE" "$DIFF_VALUE"
  done < "$TMP_MATCHED"
} > "$TMP_REPORT" || exit 1

{
  printf 'source=auto-rules\n'
  printf 'updated_at=%s\n' "$GENERATED_AT"
  printf 'version=%s\n' "${MODULE_VERSION:-unknown}"
  printf 'mode=rule-driven\n'
  printf 'status=%s\n' "$MATCH_STATUS"
  printf 'reason=%s\n' "$MATCH_REASON"
  printf 'confidence=%s\n' "$MATCH_CONFIDENCE"
  printf 'matched_total=%s\n' "${MATCHED_TOTAL:-0}"
  printf 'default_total=%s\n' "${DEFAULT_TOTAL:-0}"
} > "$TMP_SOURCE" || exit 1

mv -f "$TMP_OUTPUT" "$OUTPUT_FILE" || exit 1
mv -f "$TMP_MATCHED" "$MATCHED_FILE" || exit 1
mv -f "$TMP_REPORT" "$REPORT_FILE" || exit 1
mv -f "$TMP_SOURCE" "$SOURCE_FILE" || exit 1
chmod 0600 "$OUTPUT_FILE" "$MATCHED_FILE" "$REPORT_FILE" "$SOURCE_FILE" "$VALUES_FILE" "$RULES_FILE" "$SEEN_PROPS" 2>/dev/null || true

exit 0
