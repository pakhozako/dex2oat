#!/usr/bin/env sh
set -eu
ROOT="$1"
TMP_ROOT="${TMPDIR:-/tmp}/dex2oat-rule-test.$$"
trap 'rm -rf "$TMP_ROOT"' 0 HUP INT TERM
mkdir -p "$TMP_ROOT"
RULES="$TMP_ROOT/rules.tsv"
sh "$ROOT/scripts/decode-rules.sh" "$ROOT/rules/rule-props.pack" "$RULES"
. "$ROOT/scripts/rule-validate.sh"
rule_validate_tsv "$RULES"
rule_validate_policy "$ROOT/rules/prop-policy.tsv"
cp "$RULES" "$TMP_ROOT/bad.tsv"
printf 'duplicate\tdup\tpm.dexopt.install\tfalse\teverything\tsafe\twrong_owner\towner\tdup\tbad duplicate\tmedium\teverything|verify\n' >> "$TMP_ROOT/bad.tsv"
! rule_validate_tsv "$TMP_ROOT/bad.tsv"
printf 'version=1\nseed=1\nlength=999999\nsha256=0000000000000000000000000000000000000000000000000000000000000000\ndata=\n00\n' > "$TMP_ROOT/bad.pack"
! sh "$ROOT/scripts/decode-rules.sh" "$TMP_ROOT/bad.pack" "$TMP_ROOT/out.tsv"
printf 'pm.dexopt.bg-dexopt=speed-profile\n' > "$TMP_ROOT/captured.prop"
sh "$ROOT/scripts/generate-props.sh" "$TMP_ROOT/captured.prop" "$RULES" "$TMP_ROOT/system.prop" "$TMP_ROOT/matched.prop" "$TMP_ROOT/report.txt" "$TMP_ROOT/source.prop" v6.0 "$TMP_ROOT/original.prop"
grep -q '^pm.dexopt.bg-dexopt=skip$' "$TMP_ROOT/matched.prop"
grep -q '^matched_total=1$' "$TMP_ROOT/report.txt"

cat > "$TMP_ROOT/default-rules.tsv" <<'EOF_RULES'
id	label	prop	defaultEnabled	defaultValue	risk	owner	ownerReason	explainTitle	explainReason	confidence	values
default-only	Default Only	dalvik.vm.test-default	true	false	safe	default-only	owner	default	default rule	medium	true|false
EOF_RULES
: > "$TMP_ROOT/empty-captured.prop"
DEX2OAT_PROP_POLICY_FILE="$ROOT/rules/prop-policy.tsv" sh "$ROOT/scripts/generate-props.sh" "$TMP_ROOT/empty-captured.prop" "$TMP_ROOT/default-rules.tsv" "$TMP_ROOT/default-system.prop" "$TMP_ROOT/default-matched.prop" "$TMP_ROOT/default-report.txt" "$TMP_ROOT/default-source.prop" v6.0 "$TMP_ROOT/original.prop"
grep -q '^dalvik.vm.test-default=false$' "$TMP_ROOT/default-system.prop"
grep -q '^dalvik.vm.test-default=false$' "$TMP_ROOT/default-matched.prop"
grep -q '^default_total=1$' "$TMP_ROOT/default-report.txt"
grep -q 'source=captured-default' "$TMP_ROOT/default-system.prop"
printf 'rule tests: ok\n'
