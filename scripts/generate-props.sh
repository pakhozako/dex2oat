#!/system/bin/sh

CAPTURED_FILE="$1"
RULE_SOURCE="$2"
OUTPUT_FILE="$3"
MATCHED_FILE="$4"
REPORT_FILE="$5"
SOURCE_FILE="$6"
MODULE_VERSION="$7"
ORIGINAL_PROPS="$8"

[ -n "$OUTPUT_FILE" ] || exit 1
[ -n "$MATCHED_FILE" ] || exit 1
[ -n "$REPORT_FILE" ] || exit 1
[ -n "$SOURCE_FILE" ] || exit 1

STATE_DIR="${REPORT_FILE%/*}"
VALUES_FILE="$STATE_DIR/captured-values.prop"
RULES_FILE="$STATE_DIR/rule-props.tsv"
case "$RULE_SOURCE" in
  "")
    BUILT_RULES_FILE=""
    ;;
  rule-props.tsv|*/rule-props.tsv)
    BUILT_RULES_FILE="$RULE_SOURCE"
    ;;
  */) BUILT_RULES_FILE="${RULE_SOURCE%/}/rule-props.tsv" ;;
  *) BUILT_RULES_FILE="$RULE_SOURCE/rule-props.tsv" ;;
esac
TMP_OUTPUT="$OUTPUT_FILE.tmp"
TMP_MATCHED="$MATCHED_FILE.tmp"
TMP_REPORT="$REPORT_FILE.tmp"
TMP_SOURCE="$SOURCE_FILE.tmp"
GENERATED_AT="$(date '+%Y-%m-%d %H:%M:%S')"

mkdir -p "$STATE_DIR" 2>/dev/null || exit 1

is_valid_prop_key() {
  case "$1" in
    ""|*[!A-Za-z0-9_.-]*|.*|*.)
      return 1
      ;;
  esac

  case "$1" in
    *.*)
      return 0
      ;;
  esac

  return 1
}

is_valid_prop_value() {
  case "$1" in
    *[!A-Za-z0-9_.,:/@%+*-]*)
      return 1
      ;;
  esac

  return 0
}

is_value_allowed() {
  CHECK_VALUE="$1"
  CHECK_VALUES="$2"
  VALUES_REST="$CHECK_VALUES|"
  while [ -n "$VALUES_REST" ]; do
    ALLOWED_VALUE="${VALUES_REST%%|*}"
    if [ "$ALLOWED_VALUE" = "$CHECK_VALUE" ]; then
      return 0
    fi
    [ "$VALUES_REST" = "${VALUES_REST#*|}" ] && break
    VALUES_REST="${VALUES_REST#*|}"
  done
  return 1
}

is_everything_compatible_prop() {
  case "$1" in
    pm.dexopt.*|dalvik.vm.dex2oat-filter|dalvik.vm.dex2oat-very-large|dalvik.vm.systemuicompilerfilter)
      return 0
      ;;
  esac

  return 1
}

should_promote_to_everything() {
  case "$4" in
    safe|caution)
      ;;
    *)
      return 1
      ;;
  esac

  case "$1" in
    verify|speed-profile|speed)
      ;;
    *)
      return 1
      ;;
  esac

  is_everything_compatible_prop "$2" || return 1
  is_value_allowed "$1" "$3" || return 1
  is_value_allowed "everything" "$3" || return 1

  return 0
}

should_keep_background_default() {
  case "$1" in
    pm.dexopt.bg-dexopt|\
persist.sys.oplus.bgdex2oat_enabled|persist.oplus.ocompiler|oplus.opex.modulemerge|\
persist.device_config.runtime.dexopt.enabled|persist.device_config.runtime.bg_dexopt.enabled|\
persist.device_config.runtime.profile_merge|\
persist.device_config.runtime_native_boot.iorap_readahead_enable|\
persist.device_config.runtime_native_boot.iorap_perfetto_enable|\
persist.sys.app_dexfile_preload.enable|persist.sys.art_startup_class_preload.enable|\
persist.sys.precache.enable|dalvik.vm.enable_pr_dexopt|dalvik.vm.pr_dexopt_async_for_ota|\
dalvik.vm.bgdexopt.new-classes-percent|dalvik.vm.bgdexopt.new-methods-percent|\
sys.oplus.dalvik_sync_config|system_perf_init.bg-dex2oat-threads|\
dalvik.vm.background-dex2oat-threads|dalvik.vm.background-dex2oat-cpu-set|\
dalvik.vm.bg-dex2oat-threads)
      return 0
      ;;
  esac

  return 1
}

: > "$VALUES_FILE" || exit 1
if [ -s "$CAPTURED_FILE" ]; then
  awk '
    BEGIN { bom = sprintf("%c%c%c", 239, 187, 191) }
    NR == 1 { sub("^" bom, "") }
    {
      sub(/\r$/, "")
      line = $0
      if (line ~ /^\[[^]]*\]: \[.*\]$/) {
        sub(/^\[/, "", line)
        sub(/\]: \[/, "=", line)
        sub(/\]$/, "", line)
        print line
      } else if (line ~ /^[^=#][^=]*=/) {
        print line
      }
    }
  ' "$CAPTURED_FILE" > "$VALUES_FILE" || exit 1
fi

[ -s "$BUILT_RULES_FILE" ] || exit 1
cp "$BUILT_RULES_FILE" "$RULES_FILE" || exit 1

[ -s "$RULES_FILE" ] || exit 1

CAPTURED_TOTAL=$(grep -c '=' "$VALUES_FILE" 2>/dev/null | tr -d ' ')
MATCHED_TOTAL=0
DEFAULT_TOTAL=0
DISABLED_TOTAL=0
SKIPPED_DUP_TOTAL=0
FALLBACK_TOTAL=0
UNMATCHED_TOTAL=0
INVALID_TOTAL=0
BACKGROUND_DEFAULT_TOTAL=0
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

FIRST_RULE=1
while IFS="$(printf '\t')" read -r RULE_ID RULE_LABEL RULE_PROP RULE_ENABLED RULE_DEFAULT RULE_RISK RULE_OWNER RULE_OWNER_REASON RULE_EXPLAIN_TITLE RULE_EXPLAIN_REASON RULE_CONFIDENCE RULE_VALUES || [ -n "$RULE_PROP" ]; do
  if [ "$FIRST_RULE" = "1" ]; then
    FIRST_RULE=0
    [ "$RULE_ID" = "id" ] && continue
  fi
  [ -n "$RULE_PROP" ] || continue
  if ! is_valid_prop_key "$RULE_PROP"; then
    INVALID_TOTAL=$((INVALID_TOTAL + 1))
    continue
  fi
  [ "$RULE_OWNER" = "$RULE_ID" ] || {
    SKIPPED_DUP_TOTAL=$((SKIPPED_DUP_TOTAL + 1))
    continue
  }
  if grep -F -x -q "$RULE_PROP" "$SEEN_PROPS" 2>/dev/null; then
    SKIPPED_DUP_TOTAL=$((SKIPPED_DUP_TOTAL + 1))
    continue
  fi
  printf '%s\n' "$RULE_PROP" >> "$SEEN_PROPS"

  CAPTURED_LINE="$(awk -v key="$RULE_PROP" 'index($0, key "=") == 1 { print; exit }' "$VALUES_FILE" 2>/dev/null)"
  CAPTURED_VALUE="${CAPTURED_LINE#*=}"
  [ "$CAPTURED_LINE" = "$CAPTURED_VALUE" ] && CAPTURED_VALUE=""
  FINAL_VALUE="$RULE_DEFAULT"
  FINAL_SOURCE=default

  if [ -n "$CAPTURED_VALUE" ]; then
    if ! is_valid_prop_value "$CAPTURED_VALUE" || ! is_value_allowed "$CAPTURED_VALUE" "$RULE_VALUES"; then
      CAPTURED_VALUE=""
      INVALID_TOTAL=$((INVALID_TOTAL + 1))
    fi
  fi

  if [ -n "$CAPTURED_VALUE" ]; then
    if should_keep_background_default "$RULE_PROP"; then
      if [ -n "$RULE_DEFAULT" ]; then
        FINAL_VALUE="$RULE_DEFAULT"
        FINAL_SOURCE=captured-default
        BACKGROUND_DEFAULT_TOTAL=$((BACKGROUND_DEFAULT_TOTAL + 1))
      else
        FINAL_VALUE="$RULE_DEFAULT"
        FINAL_SOURCE=default
      fi
    elif should_promote_to_everything "$CAPTURED_VALUE" "$RULE_PROP" "$RULE_VALUES" "$RULE_RISK"; then
      FINAL_VALUE=everything
      FINAL_SOURCE=captured-promoted
    else
      FINAL_VALUE="$CAPTURED_VALUE"
      FINAL_SOURCE=captured
    fi
    MATCHED_TOTAL=$((MATCHED_TOTAL + 1))
  elif [ "$RULE_ENABLED" = "true" ]; then
    DEFAULT_TOTAL=$((DEFAULT_TOTAL + 1))
  else
    DISABLED_TOTAL=$((DISABLED_TOTAL + 1))
  fi

  printf '# %s\n' "${RULE_LABEL:-$RULE_ID}" >> "$TMP_OUTPUT"
  printf '# rule_id=%s owner=%s risk=%s source=%s default=%s confidence=%s\n' "$RULE_ID" "$RULE_OWNER" "$RULE_RISK" "$FINAL_SOURCE" "$RULE_DEFAULT" "${RULE_CONFIDENCE:-medium}" >> "$TMP_OUTPUT"
  [ -n "$RULE_EXPLAIN_REASON" ] && printf '# explain=%s\n' "$RULE_EXPLAIN_REASON" >> "$TMP_OUTPUT"
  if [ "$RULE_ENABLED" = "true" ] || [ "$FINAL_SOURCE" = "captured" ] || [ "$FINAL_SOURCE" = "captured-promoted" ] || [ "$FINAL_SOURCE" = "captured-default" ]; then
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
elif [ "${INVALID_TOTAL:-0}" -gt 0 ] 2>/dev/null; then
  MATCH_STATUS=partial
  MATCH_REASON=invalid-captured-values-ignored
  MATCH_CONFIDENCE=medium
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
  printf 'invalid_total=%s\n' "${INVALID_TOTAL:-0}"
  printf 'background_default_total=%s\n' "${BACKGROUND_DEFAULT_TOTAL:-0}"
  printf 'resolver=rule-props-tsv\n'
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
  printf 'background_default_total=%s\n' "${BACKGROUND_DEFAULT_TOTAL:-0}"
} > "$TMP_SOURCE" || exit 1

mv -f "$TMP_OUTPUT" "$OUTPUT_FILE" || exit 1
mv -f "$TMP_MATCHED" "$MATCHED_FILE" || exit 1
mv -f "$TMP_REPORT" "$REPORT_FILE" || exit 1
mv -f "$TMP_SOURCE" "$SOURCE_FILE" || exit 1
chmod 0600 "$OUTPUT_FILE" "$MATCHED_FILE" "$REPORT_FILE" "$SOURCE_FILE" "$VALUES_FILE" "$RULES_FILE" "$SEEN_PROPS" 2>/dev/null || true

exit 0
