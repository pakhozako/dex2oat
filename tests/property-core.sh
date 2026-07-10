#!/usr/bin/env sh

set -u

TEST_DIR="${TMPDIR:-/tmp}/dex2oat-lock-test-$$"
PROP_STATE="$TEST_DIR/property-value"
mkdir -p "$TEST_DIR"
trap 'rm -rf "$TEST_DIR"' EXIT HUP INT TERM

getprop() {
  cat "$PROP_STATE" 2>/dev/null
}

setprop() {
  printf '%s' "$2" > "$PROP_STATE"
}

resetprop() {
  return 1
}

. "${1:-.}/core/common.sh"
. "${1:-.}/core/property.sh"

printf 'old' > "$PROP_STATE"
dex_apply_checked_prop test_key new
[ "$?" -eq 0 ] || exit 1
[ "$DEX_CHECKED_APPLY_TOOL" = "setprop-fallback" ] || exit 1
[ "$(cat "$PROP_STATE")" = "new" ] || exit 1

dex_apply_checked_prop test_key new
[ "$?" -eq 3 ] || exit 1

MATCHED_FILE="$TEST_DIR/matched.txt"
RULES_FILE="$TEST_DIR/rules.tsv"
printf 'test_key=new\n' > "$MATCHED_FILE"
dex_is_runtime_prop test_key "$MATCHED_FILE" "$RULES_FILE" strict || exit 1
dex_is_runtime_prop other_key "$TEST_DIR/missing" "$TEST_DIR/missing-rules" allow-empty || exit 1
if dex_is_runtime_prop other_key "$TEST_DIR/missing" "$TEST_DIR/missing-rules" strict; then
  exit 1
fi

printf 'property_core_ok\n'
