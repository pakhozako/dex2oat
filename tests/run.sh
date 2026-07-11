#!/usr/bin/env bash

set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
PASS_TOTAL=0

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT HUP INT TERM

pass() {
  PASS_TOTAL=$((PASS_TOTAL + 1))
  printf 'PASS %02d - %s\n' "$PASS_TOTAL" "$1"
}

fail() {
  printf 'FAIL - %s\n' "$1" >&2
  exit 1
}

assert_file_contains() {
  grep -F -x -q "$2" "$1" || fail "$3"
}

assert_file_excludes_key() {
  ! grep -q "^$2=" "$1" || fail "$3"
}

create_android_mocks() {
  MOCK_BIN="$1"
  mkdir -p "$MOCK_BIN"
  cat > "$MOCK_BIN/getprop" <<'EOF'
#!/bin/sh
STORE=${DEX_TEST_PROP_STORE:?}
if [ "$#" -eq 0 ]; then
  awk -F= '{ key=$1; value=$0; sub(/^[^=]*=/, "", value); printf "[%s]: [%s]\n", key, value }' "$STORE"
else
  awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$STORE"
fi
EOF
  cat > "$MOCK_BIN/setprop" <<'EOF'
#!/bin/sh
STORE=${DEX_TEST_PROP_STORE:?}
WRITE_LOG=${DEX_TEST_WRITE_LOG:?}
KEY=$1
VALUE=$2
TMP="$STORE.tmp.$$"
awk -F= -v key="$KEY" -v value="$VALUE" '
  $1 == key { print key "=" value; found=1; next }
  { print }
  END { if (!found) print key "=" value }
' "$STORE" > "$TMP" || exit 1
mv -f "$TMP" "$STORE" || exit 1
printf '%s=%s\n' "$KEY" "$VALUE" >> "$WRITE_LOG"
EOF
  cat > "$MOCK_BIN/chown" <<'EOF'
#!/bin/sh
exit 0
EOF
  chmod 0755 "$MOCK_BIN/getprop" "$MOCK_BIN/setprop" "$MOCK_BIN/chown"
}

copy_module() {
  DEST=$1
  mkdir -p "$DEST/META-INF/com/google/android" "$DEST/core" "$DEST/rules" "$DEST/scripts"
  cp "$ROOT/META-INF/com/google/android/update-binary" "$ROOT/META-INF/com/google/android/updater-script" "$DEST/META-INF/com/google/android/"
  cp "$ROOT/action.sh" "$ROOT/customize.sh" "$ROOT/module.prop" "$ROOT/service.sh" "$ROOT/skip_mount" "$ROOT/system.prop" "$ROOT/uninstall.sh" "$DEST/"
  cp "$ROOT/core/common.sh" "$ROOT/core/conflict-detect.sh" "$ROOT/core/input.sh" "$ROOT/core/rule-engine.sh" "$ROOT/core/runtime.sh" "$DEST/core/"
  cp "$ROOT/rules/prop-policy.tsv" "$ROOT/rules/rule-props.pack" "$DEST/rules/"
  cp "$ROOT/scripts/capture-props.sh" "$ROOT/scripts/decode-rules.sh" "$ROOT/scripts/generate-props.sh" "$DEST/scripts/"
}

command -v dash >/dev/null 2>&1 || fail "dash is required"
command -v busybox >/dev/null 2>&1 || fail "busybox is required"
BUSYBOX_APPLETS="$TEST_ROOT/busybox-applets"
mkdir -p "$BUSYBOX_APPLETS"
ln -s "$(command -v busybox)" "$BUSYBOX_APPLETS/awk"
PATH="$BUSYBOX_APPLETS:$PATH"
export PATH
for SCRIPT in "$ROOT/META-INF/com/google/android/update-binary" "$ROOT"/*.sh "$ROOT"/core/*.sh "$ROOT"/scripts/*.sh; do
  bash -n "$SCRIPT" || fail "bash syntax: $SCRIPT"
  dash -n "$SCRIPT" || fail "dash syntax: $SCRIPT"
  busybox ash -n "$SCRIPT" || fail "ash syntax: $SCRIPT"
done
pass "scripts parse in bash, dash and BusyBox ash; fixtures use BusyBox awk"

RULE_TEST="$TEST_ROOT/rules"
mkdir -p "$RULE_TEST"
sh "$ROOT/scripts/decode-rules.sh" "$ROOT/rules/rule-props.pack" "$RULE_TEST/rules.tsv" || fail "official rule pack decode"
sh "$ROOT/scripts/generate-props.sh" --validate "$RULE_TEST/rules.tsv" || fail "official rule schema"
{
  printf 'id\tlabel\tprop\tdefaultEnabled\tdefaultValue\trisk\towner\townerReason\texplainTitle\texplainReason\tconfidence\tvalues\n'
  printf 'test_default\tTest default\ttest.default\ttrue\ton\tsafe\ttest_default\towner\tTest default\tdefault fixture\tmedium\toff|on\n'
} > "$RULE_TEST/default.tsv"
: > "$RULE_TEST/captured.prop"
DEX2OAT_PROP_POLICY_FILE="$ROOT/rules/prop-policy.tsv" sh "$ROOT/scripts/generate-props.sh" "$RULE_TEST/captured.prop" "$RULE_TEST/default.tsv" "$RULE_TEST/system.prop" "$RULE_TEST/report.prop" v6.0 || fail "default rule generation"
assert_file_contains "$RULE_TEST/system.prop" 'test.default=on' "default-enabled rule was not emitted"
assert_file_contains "$RULE_TEST/report.prop" 'rule_total=1' "BusyBox awk rule count is incorrect"
[ ! -e "$ROOT/0" ] || fail "BusyBox awk created a redirection artifact"
pass "default-enabled rules emit their defined value without a captured device value"

awk '
  /^sha256=/ && !changed {
    first=substr($0, 8, 1)
    replacement=first == "0" ? "1" : "0"
    print "sha256=" replacement substr($0, 9)
    changed=1
    next
  }
  { print }
' "$ROOT/rules/rule-props.pack" > "$RULE_TEST/corrupt.pack"
if sh "$ROOT/scripts/decode-rules.sh" "$RULE_TEST/corrupt.pack" "$RULE_TEST/corrupt.tsv"; then
  fail "corrupt rule pack was accepted"
fi
pass "rule-pack SHA256 mismatch is rejected"

CONFLICT_TEST="$TEST_ROOT/conflicts"
mkdir -p "$CONFLICT_TEST/modules/same" "$CONFLICT_TEST/modules/different" "$CONFLICT_TEST/modules/disabled" "$CONFLICT_TEST/module"
printf 'id=dex2oat-lock\n' > "$CONFLICT_TEST/module/module.prop"
printf '# candidate\na.b=one\nc.d=two\ne.f=three\n' > "$CONFLICT_TEST/candidate.prop"
printf 'a.b=one\n' > "$CONFLICT_TEST/modules/same/system.prop"
printf 'c.d=other\n' > "$CONFLICT_TEST/modules/different/system.prop"
printf 'e.f=other\n' > "$CONFLICT_TEST/modules/disabled/system.prop"
: > "$CONFLICT_TEST/modules/disabled/disable"
DEX2OAT_MODULES_ROOT="$CONFLICT_TEST/modules" sh "$ROOT/core/conflict-detect.sh" "$CONFLICT_TEST/module" "$CONFLICT_TEST/candidate.prop" "$CONFLICT_TEST/filtered.prop" "$CONFLICT_TEST/report.prop" || fail "conflict scan"
assert_file_excludes_key "$CONFLICT_TEST/filtered.prop" a.b "same-value conflict remained in final config"
assert_file_excludes_key "$CONFLICT_TEST/filtered.prop" c.d "different-value conflict remained in final config"
assert_file_contains "$CONFLICT_TEST/filtered.prop" 'e.f=three' "disabled module caused a conflict"
assert_file_contains "$CONFLICT_TEST/report.prop" 'conflict_total=2' "unexpected conflict count"
assert_file_contains "$CONFLICT_TEST/report.prop" 'same_total=1' "same-value conflict was not reported"
assert_file_contains "$CONFLICT_TEST/report.prop" 'different_total=1' "different-value conflict was not reported"
pass "same-value and different-value conflicts are both skipped; disabled modules are ignored"

MOCK_BIN="$TEST_ROOT/android-bin"
PROP_STORE="$TEST_ROOT/properties.db"
WRITE_LOG="$TEST_ROOT/property-writes.log"
create_android_mocks "$MOCK_BIN"
printf 'sys.boot_completed=1\ntest.prop=old\nsame.prop=keep\n' > "$PROP_STORE"
: > "$WRITE_LOG"
RUNTIME_TEST="$TEST_ROOT/runtime"
mkdir -p "$RUNTIME_TEST/state"
printf '# runtime fixture\ntest.prop=new\nsame.prop=keep\n' > "$RUNTIME_TEST/system.prop"
DEX_TEST_PROP_STORE="$PROP_STORE" DEX_TEST_WRITE_LOG="$WRITE_LOG" PATH="$MOCK_BIN:$PATH" ROOT="$ROOT" CONFIG="$RUNTIME_TEST/system.prop" STATE="$RUNTIME_TEST/state" sh -c '. "$ROOT/core/common.sh"; . "$ROOT/core/runtime.sh"; dex_runtime_apply "$CONFIG" "$STATE" test'
assert_file_contains "$PROP_STORE" 'test.prop=new' "changed property was not applied"
[ "$(wc -l < "$WRITE_LOG" | tr -d ' ')" = 1 ] || fail "unchanged property was written during first apply"
assert_file_contains "$RUNTIME_TEST/state/runtime-status.prop" 'applied_total=1' "first apply count"
assert_file_contains "$RUNTIME_TEST/state/runtime-status.prop" 'unchanged_total=1' "first unchanged count"
DEX_TEST_PROP_STORE="$PROP_STORE" DEX_TEST_WRITE_LOG="$WRITE_LOG" PATH="$MOCK_BIN:$PATH" ROOT="$ROOT" CONFIG="$RUNTIME_TEST/system.prop" STATE="$RUNTIME_TEST/state" sh -c '. "$ROOT/core/common.sh"; . "$ROOT/core/runtime.sh"; dex_runtime_apply "$CONFIG" "$STATE" test'
[ "$(wc -l < "$WRITE_LOG" | tr -d ' ')" = 1 ] || fail "second apply rewrote matching values"
assert_file_contains "$RUNTIME_TEST/state/runtime-status.prop" 'applied_total=0' "second apply wrote a property"
assert_file_contains "$RUNTIME_TEST/state/runtime-status.prop" 'unchanged_total=2' "second unchanged count"
assert_file_contains "$RUNTIME_TEST/state/runtime-status.prop" 'reason=already-matched' "second apply status"
pass "runtime apply writes changed values once and never rewrites matching values"

INSTALL_TEST="$TEST_ROOT/install"
MODULE_DIR="$INSTALL_TEST/module"
STATE_DIR="$INSTALL_TEST/state"
MODULES_DIR="$INSTALL_TEST/modules"
mkdir -p "$MODULES_DIR"
copy_module "$MODULE_DIR"
DEX_TEST_PROP_STORE="$PROP_STORE" DEX_TEST_WRITE_LOG="$WRITE_LOG" DEX2OAT_MODULES_ROOT="$MODULES_DIR" PATH="$MOCK_BIN:$PATH" MODPATH="$MODULE_DIR" STATE_DIR="$STATE_DIR" KSU=1 KSU_VER=test sh "$MODULE_DIR/customize.sh" > "$INSTALL_TEST/fresh.log" || fail "fresh install"
[ -s "$MODULE_DIR/system.prop" ] || fail "fresh install system.prop"
[ -s "$STATE_DIR/match-report.prop" ] || fail "fresh install match report"
[ -s "$STATE_DIR/conflict-report.txt" ] || fail "fresh install conflict report"
[ -s "$STATE_DIR/runtime-status.prop" ] || fail "fresh install runtime status"
[ ! -e "$STATE_DIR/original-props.conf" ] || fail "original properties were backed up"
[ ! -e "$STATE_DIR/.operation.lock" ] || fail "install lock was not released"
pass "fresh install generates and validates the minimal state set"

printf 'keep\n' > "$STATE_DIR/update-marker"
DEX_TEST_PROP_STORE="$PROP_STORE" DEX_TEST_WRITE_LOG="$WRITE_LOG" DEX2OAT_MODULES_ROOT="$MODULES_DIR" PATH="$MOCK_BIN:$PATH" MODPATH="$MODULE_DIR" STATE_DIR="$STATE_DIR" KSU=1 KSU_VER=test sh "$MODULE_DIR/customize.sh" > "$INSTALL_TEST/update.log" || fail "update install"
[ -f "$STATE_DIR/update-marker" ] || fail "update install deleted existing state"
[ ! -e "$STATE_DIR/.operation.lock" ] || fail "update lock was not released"
pass "update install does not pre-delete module state"

GOOD_CONFIG_HASH="$(sha256sum "$MODULE_DIR/system.prop" | awk '{print $1}')"
cp "$MODULE_DIR/rules/rule-props.pack" "$INSTALL_TEST/good.pack"
awk '
  /^sha256=/ && !changed { print "sha256=0" substr($0, 9); changed=1; next }
  { print }
' "$INSTALL_TEST/good.pack" > "$MODULE_DIR/rules/rule-props.pack"
if DEX_TEST_PROP_STORE="$PROP_STORE" DEX_TEST_WRITE_LOG="$WRITE_LOG" DEX2OAT_MODULES_ROOT="$MODULES_DIR" PATH="$MOCK_BIN:$PATH" MODPATH="$MODULE_DIR" STATE_DIR="$STATE_DIR" KSU=1 KSU_VER=test sh "$MODULE_DIR/customize.sh" > "$INSTALL_TEST/failed-update.log" 2>&1; then
  fail "install accepted a corrupt rule pack"
fi
[ "$(sha256sum "$MODULE_DIR/system.prop" | awk '{print $1}')" = "$GOOD_CONFIG_HASH" ] || fail "failed update replaced the valid configuration"
[ ! -e "$STATE_DIR/.operation.lock" ] || fail "failed update left the operation lock"
cp "$INSTALL_TEST/good.pack" "$MODULE_DIR/rules/rule-props.pack"
pass "failed generation preserves the prior valid config and releases the lock"

CONFIG_HASH_BEFORE="$(sha256sum "$MODULE_DIR/system.prop" | awk '{print $1}')"
MATCH_HASH_BEFORE="$(sha256sum "$STATE_DIR/match-report.prop" | awk '{print $1}')"
CONFLICT_HASH_BEFORE="$(sha256sum "$STATE_DIR/conflict-report.txt" | awk '{print $1}')"
RUNTIME_HASH_BEFORE="$(sha256sum "$STATE_DIR/runtime-status.prop" | awk '{print $1}')"
(cd "$MODULE_DIR" && DEX_TEST_PROP_STORE="$PROP_STORE" DEX_TEST_WRITE_LOG="$WRITE_LOG" DEX2OAT_MODULES_ROOT="$MODULES_DIR" PATH="$MOCK_BIN:$PATH" STATE_DIR="$STATE_DIR" sh action.sh preview > "$INSTALL_TEST/preview.log") || fail "action preview"
[ "$(sha256sum "$MODULE_DIR/system.prop" | awk '{print $1}')" = "$CONFIG_HASH_BEFORE" ] || fail "preview changed system.prop"
[ "$(sha256sum "$STATE_DIR/match-report.prop" | awk '{print $1}')" = "$MATCH_HASH_BEFORE" ] || fail "preview changed match report"
[ "$(sha256sum "$STATE_DIR/conflict-report.txt" | awk '{print $1}')" = "$CONFLICT_HASH_BEFORE" ] || fail "preview changed conflict report"
[ "$(sha256sum "$STATE_DIR/runtime-status.prop" | awk '{print $1}')" = "$RUNTIME_HASH_BEFORE" ] || fail "preview changed runtime status"
[ -z "$(find "$STATE_DIR" -maxdepth 1 -name '.rule-work.*' -print -quit)" ] || fail "preview left temporary work"
pass "Action preview is read-only for persistent configuration and reports"

(cd "$MODULE_DIR" && STATE_DIR="$STATE_DIR" sh action.sh status > "$INSTALL_TEST/status.log") || fail "relative action invocation"
grep -F -q 'Dex2oat Lock v6.0' "$INSTALL_TEST/status.log" || fail "relative action version"
grep -F -q '健康:' "$INSTALL_TEST/status.log" || fail "action health summary"
pass "Action status works through a relative invocation and exposes the minimal summaries"

printf '# service fixture\ntest.prop=service-target\nsame.prop=keep\n' > "$MODULE_DIR/system.prop"
WRITES_BEFORE="$(wc -l < "$WRITE_LOG" | tr -d ' ')"
DEX_TEST_PROP_STORE="$PROP_STORE" DEX_TEST_WRITE_LOG="$WRITE_LOG" PATH="$MOCK_BIN:$PATH" STATE_DIR="$STATE_DIR" DEX2OAT_BOOT_WAIT_SECONDS=1 sh "$MODULE_DIR/service.sh" || fail "first service apply"
WRITES_AFTER_FIRST="$(wc -l < "$WRITE_LOG" | tr -d ' ')"
[ "$WRITES_AFTER_FIRST" -eq $((WRITES_BEFORE + 1)) ] || fail "first service apply write count"
DEX_TEST_PROP_STORE="$PROP_STORE" DEX_TEST_WRITE_LOG="$WRITE_LOG" PATH="$MOCK_BIN:$PATH" STATE_DIR="$STATE_DIR" DEX2OAT_BOOT_WAIT_SECONDS=1 sh "$MODULE_DIR/service.sh" || fail "second service apply"
[ "$(wc -l < "$WRITE_LOG" | tr -d ' ')" = "$WRITES_AFTER_FIRST" ] || fail "second service apply rewrote matching values"
assert_file_contains "$STATE_DIR/runtime-status.prop" 'applied_total=0' "second service applied count"
assert_file_contains "$STATE_DIR/runtime-status.prop" 'unchanged_total=2' "second service unchanged count"
pass "service applies differences once and performs zero writes on the matching second run"

rm -f "$STATE_DIR/update-marker"
WRITES_BEFORE_UNINSTALL="$(wc -l < "$WRITE_LOG" | tr -d ' ')"
DEX_TEST_PROP_STORE="$PROP_STORE" DEX_TEST_WRITE_LOG="$WRITE_LOG" PATH="$MOCK_BIN:$PATH" STATE_DIR="$STATE_DIR" sh "$MODULE_DIR/uninstall.sh" > "$INSTALL_TEST/uninstall.log" || fail "uninstall"
[ ! -e "$STATE_DIR/match-report.prop" ] || fail "uninstall match report cleanup"
[ ! -e "$STATE_DIR/conflict-report.txt" ] || fail "uninstall conflict report cleanup"
[ ! -e "$STATE_DIR/runtime-status.prop" ] || fail "uninstall runtime status cleanup"
[ ! -e "$STATE_DIR/install.log" ] || fail "uninstall install log cleanup"
[ ! -e "$STATE_DIR/service.log" ] || fail "uninstall service log cleanup"
[ "$(wc -l < "$WRITE_LOG" | tr -d ' ')" = "$WRITES_BEFORE_UNINSTALL" ] || fail "uninstall wrote runtime properties"
pass "uninstall removes minimal state without backing up or rewriting properties"

printf '\nAll %s tests passed.\n' "$PASS_TOTAL"
