#!/usr/bin/env sh
set -eu
ROOT="$1"
TMP_ROOT="${TMPDIR:-/tmp}/dex2oat-diagnostic-test.$$"
trap 'rm -rf "$TMP_ROOT"' 0 HUP INT TERM
mkdir -p "$TMP_ROOT/core" "$TMP_ROOT/state" "$TMP_ROOT/rules"
cp "$ROOT/core/common.sh" "$ROOT/core/state-schema.sh" "$ROOT/core/state-store.sh" "$ROOT/core/state-migrate.sh" "$ROOT/core/state-summary.sh" "$ROOT/core/state.sh" "$ROOT/core/diagnostics.sh" "$TMP_ROOT/core/"
cp "$ROOT/rules/rule-props.pack" "$TMP_ROOT/rules/"
printf 'description=test\n' > "$TMP_ROOT/module.prop"
printf 'test.key=value\n' > "$TMP_ROOT/system.prop"
printf 'baseline\n' > "$TMP_ROOT/core/integrity-baseline.prop"
printf 'serial=secret\npath=/storage/emulated/0/private\n' > "$TMP_ROOT/state/health.log"
STATE_DIR="$TMP_ROOT/state"
STATE_FILE="$TMP_ROOT/state/state.prop"
MODDIR="$TMP_ROOT"
. "$TMP_ROOT/core/state.sh"
module_version() { printf v6.0; }
. "$TMP_ROOT/core/diagnostics.sh"
! diagnostic_run force
[ "$(state_get diagnostics.status)" = failed ]
[ "$(state_get diagnostics.checked_epoch)" = "" ]
for script in conflict-detect.sh health-check.sh integrity-check.sh; do
  printf '#!/usr/bin/env sh\nexit 0\n' > "$TMP_ROOT/core/$script"
done
diagnostic_run force
[ "$(state_get diagnostics.status)" = ok ]
[ -n "$(state_get diagnostics.input_hash)" ]
[ -n "$(state_get diagnostics.checked_epoch)" ]
EXPORT="$(diagnostic_export)"
grep -q 'serial=<已隐藏>' "$EXPORT"
! grep -q 'secret' "$EXPORT"
grep -q '<用户路径>' "$EXPORT"
printf 'diagnostic tests: ok\n'
