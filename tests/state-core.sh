#!/usr/bin/env sh
set -eu
ROOT="$1"
TMP_ROOT="${TMPDIR:-/tmp}/dex2oat-state-test.$$"
trap 'rm -rf "$TMP_ROOT"' 0 HUP INT TERM
mkdir -p "$TMP_ROOT/core" "$TMP_ROOT/state"
cp "$ROOT/core/common.sh" "$ROOT/core/state-schema.sh" "$ROOT/core/state-store.sh" "$ROOT/core/state-migrate.sh" "$ROOT/core/state-summary.sh" "$ROOT/core/state.sh" "$TMP_ROOT/core/"
STATE_DIR="$TMP_ROOT/state"
STATE_FILE="$TMP_ROOT/state/state.prop"
MODDIR="$TMP_ROOT"
. "$TMP_ROOT/core/state.sh"
state_update "module_version=v6.0" "install.status=running"
[ "$(state_get module_version)" = "v6.0" ]
state_transaction_begin
state_transaction_set "install.status=done"
state_transaction_set "install.percent=100"
state_transaction_commit
[ "$(state_get install.status)" = "done" ]
[ "$(state_get install.percent)" = "100" ]
! state_update "unknown.key=rejected"
! state_update "install.status=$(printf 'bad\nvalue')"
! state_update "install.status=definitely-invalid"
! state_update "install.percent=abc"
! state_update "install.percent=101"
mkdir -p "$TMP_ROOT/state"
if ln -s "$TMP_ROOT/target" "$TMP_ROOT/state/symlink.prop" 2>/dev/null; then
  STATE_FILE="$TMP_ROOT/state/symlink.prop"
  ! state_update "install.status=blocked"
  STATE_FILE="$TMP_ROOT/state/state.prop"
fi
printf 'schema_version=33\ninstall.status=ok\n' > "$STATE_FILE"
state_migrate
[ "$(state_get schema_version)" = "60" ]
[ -f "$STATE_DIR/state.pre-schema-33.prop" ]
printf 'schema_version=999\ninstall.status=ok\n' > "$STATE_FILE"
! state_migrate
printf 'schema_version=60\ninstall.status=ok\ninstall.status=done\n' > "$STATE_FILE"
! state_schema_file_valid "$STATE_FILE"
printf 'state tests: ok\n'
