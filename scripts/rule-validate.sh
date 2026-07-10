#!/system/bin/sh

RULE_MAX_FILE_SIZE=${DEX2OAT_RULE_MAX_FILE_SIZE:-262144}
RULE_MAX_ROWS=${DEX2OAT_RULE_MAX_ROWS:-1024}
RULE_MAX_FIELD_LENGTH=${DEX2OAT_RULE_MAX_FIELD_LENGTH:-4096}
RULE_SCHEMA_HEADER='id	label	prop	defaultEnabled	defaultValue	risk	owner	ownerReason	explainTitle	explainReason	confidence	values'

rule_validate_tsv() {
  RULE_VALIDATE_FILE="$1"
  [ -s "$RULE_VALIDATE_FILE" ] && [ ! -L "$RULE_VALIDATE_FILE" ] || return 1
  RULE_VALIDATE_SIZE="$(wc -c < "$RULE_VALIDATE_FILE" 2>/dev/null | tr -d ' ')"
  [ "${RULE_VALIDATE_SIZE:-0}" -le "$RULE_MAX_FILE_SIZE" ] 2>/dev/null || return 2
  LC_ALL=C awk -F '\t' -v maxRows="$RULE_MAX_ROWS" -v maxField="$RULE_MAX_FIELD_LENGTH" '
    function valid_key(value) { return value ~ /^[A-Za-z0-9_.-]+$/ }
    function valid_id(value) { return value ~ /^[A-Za-z0-9_-]+$/ }
    NR == 1 {
      expected = "id\tlabel\tprop\tdefaultEnabled\tdefaultValue\trisk\towner\townerReason\texplainTitle\texplainReason\tconfidence\tvalues"
      if ($0 != expected || NF != 12) exit 10
      next
    }
    NR > maxRows + 1 { exit 11 }
    {
      if (NF != 12) exit 12
      for (field = 1; field <= NF; field++) if (length($field) > maxField || $field ~ /[[:cntrl:]]/) exit 13
      if (!valid_id($1) || !valid_key($3) || !valid_id($7)) exit 14
      if ($4 != "true" && $4 != "false") exit 15
      if ($6 != "safe" && $6 != "caution" && $6 != "aggressive") exit 16
      if ($11 != "low" && $11 != "medium" && $11 != "high") exit 17
      if (seenId[$1]++) exit 18
      if (!firstOwner[$3]) firstOwner[$3] = $1
      else if ($7 != firstOwner[$3]) exit 19
    }
    END { if (NR < 2) exit 20 }
  ' "$RULE_VALIDATE_FILE"
}

rule_validate_policy() {
  RULE_POLICY_FILE="$1"
  [ -s "$RULE_POLICY_FILE" ] && [ ! -L "$RULE_POLICY_FILE" ] || return 1
  RULE_POLICY_SIZE="$(wc -c < "$RULE_POLICY_FILE" 2>/dev/null | tr -d ' ')"
  [ "${RULE_POLICY_SIZE:-0}" -le 131072 ] 2>/dev/null || return 2
  LC_ALL=C awk -F '\t' '
    /^#/ || /^$/ { next }
    {
      if ($1 == "fallback" || $1 == "everything-compatible" || $1 == "background-default" || $1 == "force-default-when-captured") expected = 3
      else if ($1 == "evidence-safe" || $1 == "evidence-caution" || $1 == "evidence-aggressive") expected = 9
      else exit 10
      if (NF != expected) exit 11
      if ($2 != "prop" && $1 != "fallback") exit 12
      if ($1 == "fallback" && $2 !~ /^[A-Za-z0-9_-]+$/) exit 13
      if ($2 == "prop" && $3 !~ /^[A-Za-z0-9_.-]+(\*)?$/) exit 14
      if (index($3, "*") > 0 && $3 !~ /\.\*$/) exit 14
      for (field = 1; field <= NF; field++) if (length($field) > 4096 || index($field, "\r") > 0) exit 15
    }
  ' "$RULE_POLICY_FILE"
}
