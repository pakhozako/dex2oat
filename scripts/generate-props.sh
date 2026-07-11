#!/system/bin/sh

validate_rule_schema() {
  VALIDATE_RULES_FILE="$1"
  [ -s "$VALIDATE_RULES_FILE" ] || return 1
  awk -F '\t' '
    function fail(message, line) {
      printf "rule-schema: line=%d %s\n", line, message > "/dev/stderr"
      invalid = 1
    }
    function list_contains(list, value, count, item, idx) {
      count = split(list, item, /\|/)
      for (idx = 1; idx <= count; idx++) {
        if (item[idx] == value) return 1
      }
      return 0
    }
    NR == 1 {
      sub(/\r$/, "", $12)
      if (NF != 12 ||
          $1 != "id" ||
          $2 != "label" ||
          $3 != "prop" ||
          $4 != "defaultEnabled" ||
          $5 != "defaultValue" ||
          $6 != "risk" ||
          $7 != "owner" ||
          $8 != "ownerReason" ||
          $9 != "explainTitle" ||
          $10 != "explainReason" ||
          $11 != "confidence" ||
          $12 != "values") {
        fail("invalid-header", NR)
      }
      next
    }
    {
      sub(/\r$/, "", $12)
      if (NF != 12) {
        fail("invalid-field-count", NR)
        next
      }
      id = $1
      prop = $3
      enabled = $4
      default_value = $5
      risk = $6
      owner = $7
      confidence = $11
      values = $12

      if (id !~ /^[A-Za-z0-9_.-]+$/ || length(id) > 128) fail("invalid-id", NR)
      if (seen_id[id]++) fail("duplicate-id", NR)
      if (prop !~ /^[A-Za-z0-9_.-]+$/ || prop !~ /\./ || prop ~ /^\./ || prop ~ /\.$/ || length(prop) > 128) fail("invalid-prop", NR)
      if (enabled !~ /^(true|false)$/) fail("invalid-default-enabled", NR)
      if (risk !~ /^(safe|caution|aggressive)$/) fail("invalid-risk", NR)
      if (owner !~ /^[A-Za-z0-9_.-]+$/ || length(owner) > 128) fail("invalid-owner", NR)
      if (confidence !~ /^(high|medium|low)$/) fail("invalid-confidence", NR)
      if (length($2) > 512 || length($8) > 512 || length($9) > 512 || length($10) > 2048 || length(values) > 2048) fail("field-too-long", NR)
      if (default_value ~ /[^-A-Za-z0-9_.,:\/@%+*]/ || length(default_value) > 256) fail("invalid-default-value", NR)
      if (default_value != "" && !list_contains(values, default_value)) fail("default-not-allowed", NR)

      value_count = split(values, value_items, /\|/)
      for (value_idx = 1; value_idx <= value_count; value_idx++) {
        if (value_items[value_idx] ~ /[^-A-Za-z0-9_.,:\/@%+*]/ || length(value_items[value_idx]) > 256) {
          fail("invalid-allowed-value", NR)
        }
      }

      row_count++
      row_id[row_count] = id
      row_prop[row_count] = prop
      row_owner[row_count] = owner
      id_prop[id] = prop
      if (!(prop in prop_owner)) {
        prop_owner[prop] = owner
      } else if (prop_owner[prop] != owner) {
        fail("duplicate-owner-mismatch", NR)
      }
      if (id == owner) owner_rows[prop]++
    }
    END {
      if (NR < 2) fail("no-rules", NR)
      for (idx = 1; idx <= row_count; idx++) {
        owner = row_owner[idx]
        prop = row_prop[idx]
        if (!(owner in id_prop) || id_prop[owner] != prop) {
          fail("owner-target-invalid", idx + 1)
        }
      }
      for (prop in prop_owner) {
        if (owner_rows[prop] != 1) fail("owner-row-count-invalid", 0)
      }
      exit invalid ? 1 : 0
    }
  ' "$VALIDATE_RULES_FILE"
}

if [ "$1" = "--validate" ]; then
  validate_rule_schema "$2"
  exit $?
fi

CAPTURED_FILE="$1"
RULES_FILE="$2"
OUTPUT_FILE="$3"
REPORT_FILE="$4"
MODULE_VERSION="$5"

[ -n "$CAPTURED_FILE" ] || exit 1
[ -n "$RULES_FILE" ] || exit 1
[ -n "$OUTPUT_FILE" ] || exit 1
[ -n "$REPORT_FILE" ] || exit 1

validate_rule_schema "$RULES_FILE" || exit 1

WORK_DIR="${REPORT_FILE%/*}"
VALUES_FILE="$WORK_DIR/captured-values.$$"
SEEN_PROPS="$WORK_DIR/seen-props.$$"
ITEMS_FILE="$WORK_DIR/match-items.$$"
TMP_OUTPUT="$OUTPUT_FILE.tmp.$$"
TMP_REPORT="$REPORT_FILE.tmp.$$"
SCRIPT_DIR=${0%/*}
case "$SCRIPT_DIR" in
  */scripts) MODULE_DIR=${SCRIPT_DIR%/scripts} ;;
  scripts) MODULE_DIR=. ;;
  *) MODULE_DIR=${SCRIPT_DIR%/*} ;;
esac
PROP_POLICY_FILE=${DEX2OAT_PROP_POLICY_FILE:-$MODULE_DIR/rules/prop-policy.tsv}
TAB_CHAR="$(printf '\t')"

cleanup_generate_props() {
  rm -f "$VALUES_FILE" "$SEEN_PROPS" "$ITEMS_FILE" "$TMP_OUTPUT" "$TMP_REPORT" 2>/dev/null || true
}
trap 'cleanup_generate_props' EXIT HUP INT TERM

is_valid_prop_value() {
  case "$1" in
    *[!A-Za-z0-9_.,:/@%+*-]*) return 1 ;;
  esac
  return 0
}

is_value_allowed() {
  CHECK_VALUE="$1"
  CHECK_VALUES="$2"
  VALUES_REST="$CHECK_VALUES|"
  while [ -n "$VALUES_REST" ]; do
    ALLOWED_VALUE=${VALUES_REST%%|*}
    [ "$ALLOWED_VALUE" = "$CHECK_VALUE" ] && return 0
    [ "$VALUES_REST" = "${VALUES_REST#*|}" ] && break
    VALUES_REST=${VALUES_REST#*|}
  done
  return 1
}

policy_prop_matches() {
  POLICY_SECTION="$1"
  POLICY_PROP="$2"
  [ -s "$PROP_POLICY_FILE" ] || return 1
  while IFS="$TAB_CHAR" read -r POLICY_ROW_SECTION POLICY_KEY POLICY_VALUE POLICY_REST || [ -n "$POLICY_ROW_SECTION" ]; do
    case "$POLICY_ROW_SECTION" in ""|\#*) continue ;; esac
    [ "$POLICY_ROW_SECTION" = "$POLICY_SECTION" ] || continue
    [ "$POLICY_KEY" = "prop" ] || continue
    [ -n "$POLICY_VALUE" ] || continue
    case "$POLICY_PROP" in
      $POLICY_VALUE) return 0 ;;
    esac
  done < "$PROP_POLICY_FILE"
  return 1
}

policy_fallback_value() {
  FALLBACK_TYPE="$1"
  FALLBACK_DEFAULT="$2"
  [ -s "$PROP_POLICY_FILE" ] || { printf '%s\n' "$FALLBACK_DEFAULT"; return 0; }
  while IFS="$TAB_CHAR" read -r POLICY_ROW_SECTION POLICY_KEY POLICY_VALUE POLICY_REST || [ -n "$POLICY_ROW_SECTION" ]; do
    case "$POLICY_ROW_SECTION" in ""|\#*) continue ;; esac
    [ "$POLICY_ROW_SECTION" = "fallback" ] || continue
    [ "$POLICY_KEY" = "$FALLBACK_TYPE" ] || continue
    printf '%s\n' "$POLICY_VALUE"
    return 0
  done < "$PROP_POLICY_FILE"
  printf '%s\n' "$FALLBACK_DEFAULT"
}

fallback_default_for_rule() {
  FALLBACK_RULE_DEFAULT="$1"
  FALLBACK_RULE_VALUES="$2"
  if is_value_allowed false "$FALLBACK_RULE_VALUES" && is_value_allowed true "$FALLBACK_RULE_VALUES"; then
    policy_fallback_value boolean false
  elif is_value_allowed everything "$FALLBACK_RULE_VALUES"; then
    policy_fallback_value dexoptEnum everything
  elif is_value_allowed 9999 "$FALLBACK_RULE_VALUES"; then
    policy_fallback_value limit 9999
  elif is_value_allowed 0 "$FALLBACK_RULE_VALUES"; then
    policy_fallback_value count 0
  elif is_value_allowed all "$FALLBACK_RULE_VALUES"; then
    policy_fallback_value enum all
  else
    printf '%s\n' "$FALLBACK_RULE_DEFAULT"
  fi
}

should_promote_to_everything() {
  case "$4" in safe|caution) : ;; *) return 1 ;; esac
  case "$1" in verify|speed-profile|speed) : ;; *) return 1 ;; esac
  policy_prop_matches everything-compatible "$2" || return 1
  is_value_allowed everything "$3"
}

: > "$VALUES_FILE" || exit 1
if [ -f "$CAPTURED_FILE" ]; then
  awk '
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

: > "$SEEN_PROPS" || exit 1
: > "$ITEMS_FILE" || exit 1
: > "$TMP_OUTPUT" || exit 1
{
  printf '# Dex2oat Lock generated system.prop\n'
  printf '# version=%s\n' "${MODULE_VERSION:-unknown}"
  printf '\n'
} >> "$TMP_OUTPUT"

RULE_TOTAL="$(awk 'END { print (NR > 0 ? NR - 1 : 0) }' "$RULES_FILE" 2>/dev/null)"
CAPTURED_TOTAL="$(grep -c '=' "$VALUES_FILE" 2>/dev/null | tr -d ' ')"
RESOLVED_TOTAL=0
DEFAULT_TOTAL=0
DISABLED_TOTAL=0
INVALID_TOTAL=0
SKIPPED_DUPLICATE_TOTAL=0
ITEM_TOTAL=0
RULE_FIELD_SEP="$(printf '\034')"

while IFS="$RULE_FIELD_SEP" read -r RULE_ID RULE_LABEL RULE_PROP RULE_ENABLED RULE_DEFAULT RULE_RISK RULE_OWNER RULE_OWNER_REASON RULE_EXPLAIN_TITLE RULE_EXPLAIN_REASON RULE_CONFIDENCE RULE_VALUES || [ -n "$RULE_PROP" ]; do
  [ "$RULE_ID" = id ] && continue
  [ -n "$RULE_PROP" ] || continue
  [ "$RULE_OWNER" = "$RULE_ID" ] || {
    SKIPPED_DUPLICATE_TOTAL=$((SKIPPED_DUPLICATE_TOTAL + 1))
    continue
  }
  if grep -F -x -q "$RULE_PROP" "$SEEN_PROPS" 2>/dev/null; then
    SKIPPED_DUPLICATE_TOTAL=$((SKIPPED_DUPLICATE_TOTAL + 1))
    continue
  fi
  printf '%s\n' "$RULE_PROP" >> "$SEEN_PROPS" || exit 1

  CAPTURED_LINE="$(awk -v key="$RULE_PROP" 'index($0, key "=") == 1 { print; exit }' "$VALUES_FILE" 2>/dev/null)"
  CAPTURED_VALUE=${CAPTURED_LINE#*=}
  [ "$CAPTURED_LINE" = "$CAPTURED_VALUE" ] && CAPTURED_VALUE=""
  FINAL_VALUE=""
  FINAL_SOURCE=""

  if [ -n "$CAPTURED_VALUE" ]; then
    if ! is_valid_prop_value "$CAPTURED_VALUE" || ! is_value_allowed "$CAPTURED_VALUE" "$RULE_VALUES"; then
      INVALID_TOTAL=$((INVALID_TOTAL + 1))
      CAPTURED_VALUE=""
    fi
  fi

  if [ -n "$CAPTURED_VALUE" ]; then
    if policy_prop_matches background-default "$RULE_PROP" && [ -n "$RULE_DEFAULT" ]; then
      FINAL_VALUE="$RULE_DEFAULT"
      FINAL_SOURCE=captured-default
    elif should_promote_to_everything "$CAPTURED_VALUE" "$RULE_PROP" "$RULE_VALUES" "$RULE_RISK"; then
      FINAL_VALUE=everything
      FINAL_SOURCE=captured-promoted
    elif policy_prop_matches force-default-when-captured "$RULE_PROP" && [ -n "$RULE_DEFAULT" ]; then
      FINAL_VALUE="$RULE_DEFAULT"
      FINAL_SOURCE=captured-default
    else
      FINAL_VALUE="$CAPTURED_VALUE"
      FINAL_SOURCE=captured
    fi
  elif [ "$RULE_ENABLED" = true ]; then
    FINAL_VALUE="$RULE_DEFAULT"
    [ -n "$FINAL_VALUE" ] || FINAL_VALUE="$(fallback_default_for_rule "$RULE_DEFAULT" "$RULE_VALUES")"
    FINAL_SOURCE=captured-default
    DEFAULT_TOTAL=$((DEFAULT_TOTAL + 1))
  else
    DISABLED_TOTAL=$((DISABLED_TOTAL + 1))
  fi

  [ -n "$FINAL_SOURCE" ] || continue
  if ! is_valid_prop_value "$FINAL_VALUE" || ! is_value_allowed "$FINAL_VALUE" "$RULE_VALUES"; then
    INVALID_TOTAL=$((INVALID_TOTAL + 1))
    continue
  fi

  printf '%s=%s\n' "$RULE_PROP" "$FINAL_VALUE" >> "$TMP_OUTPUT" || exit 1
  ITEM_TOTAL=$((ITEM_TOTAL + 1))
  printf 'item.%s=%s|%s|%s|%s\n' "$ITEM_TOTAL" "$RULE_PROP" "$FINAL_VALUE" "$FINAL_SOURCE" "$RULE_ID" >> "$ITEMS_FILE" || exit 1
  RESOLVED_TOTAL=$((RESOLVED_TOTAL + 1))
done <<EOF
$(awk -v sep="$RULE_FIELD_SEP" '
  BEGIN { FS = "\t" }
  {
    for (field = 1; field <= 12; field++) {
      value = $field
      sub(/\r$/, "", value)
      gsub(sep, " ", value)
      printf "%s%s", value, field < 12 ? sep : "\n"
    }
  }
' "$RULES_FILE" 2>/dev/null)
EOF

MATCH_STATUS=ok
MATCH_REASON=resolved
if [ "$RESOLVED_TOTAL" -eq 0 ] 2>/dev/null; then
  MATCH_STATUS=warning
  MATCH_REASON=no-properties-resolved
elif [ "$INVALID_TOTAL" -gt 0 ] 2>/dev/null; then
  MATCH_STATUS=warning
  MATCH_REASON=invalid-values-skipped
elif [ "$CAPTURED_TOTAL" -eq 0 ] 2>/dev/null; then
  MATCH_STATUS=warning
  MATCH_REASON=defaults-only
fi

IGNORED_TOTAL=$((RULE_TOTAL - RESOLVED_TOTAL))
[ "$IGNORED_TOTAL" -ge 0 ] 2>/dev/null || IGNORED_TOTAL=0
{
  printf 'version=%s\n' "${MODULE_VERSION:-unknown}"
  printf 'generated_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  printf 'status=%s\n' "$MATCH_STATUS"
  printf 'reason=%s\n' "$MATCH_REASON"
  printf 'rule_total=%s\n' "${RULE_TOTAL:-0}"
  printf 'captured_total=%s\n' "${CAPTURED_TOTAL:-0}"
  printf 'resolved_total=%s\n' "$RESOLVED_TOTAL"
  printf 'default_total=%s\n' "$DEFAULT_TOTAL"
  printf 'ignored_total=%s\n' "$IGNORED_TOTAL"
  printf 'disabled_total=%s\n' "$DISABLED_TOTAL"
  printf 'invalid_total=%s\n' "$INVALID_TOTAL"
  printf 'duplicate_total=%s\n' "$SKIPPED_DUPLICATE_TOTAL"
  printf 'item_total=%s\n' "$ITEM_TOTAL"
  cat "$ITEMS_FILE"
} > "$TMP_REPORT" || exit 1

awk -F= '
  /^[[:space:]]*($|#)/ { next }
  {
    key = $1
    value = $0
    sub(/^[^=]*=/, "", value)
    if (key !~ /^[A-Za-z0-9_.-]+$/ || key !~ /\./ || key ~ /^\./ || key ~ /\.$/) invalid = 1
    if (value ~ /[^-A-Za-z0-9_.,:\/@%+*]/) invalid = 1
    if (seen[key]++) invalid = 1
  }
  END { exit invalid ? 1 : 0 }
' "$TMP_OUTPUT" || exit 1

mv -f "$TMP_OUTPUT" "$OUTPUT_FILE" || exit 1
mv -f "$TMP_REPORT" "$REPORT_FILE" || exit 1
chmod 0600 "$OUTPUT_FILE" "$REPORT_FILE" 2>/dev/null || true
rm -f "$VALUES_FILE" "$SEEN_PROPS" "$ITEMS_FILE" 2>/dev/null || true
trap - EXIT HUP INT TERM
exit 0
