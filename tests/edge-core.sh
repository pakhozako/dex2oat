#!/usr/bin/env sh
set -eu
ROOT="$1"
TMP_ROOT="${TMPDIR:-/tmp}/dex2oat-edge-test.$$"
trap 'rm -rf "$TMP_ROOT"' 0 HUP INT TERM
mkdir -p "$TMP_ROOT/core" "$TMP_ROOT/state"
cp "$ROOT/core/common.sh" "$ROOT/core/state-schema.sh" "$ROOT/core/state-store.sh" "$ROOT/core/state-migrate.sh" "$ROOT/core/state-summary.sh" "$ROOT/core/state.sh" "$TMP_ROOT/core/"
STATE_DIR="$TMP_ROOT/state"
STATE_FILE="$TMP_ROOT/state/state.prop"
MODDIR="$TMP_ROOT"
. "$TMP_ROOT/core/state.sh"
LONG=$(awk 'BEGIN { for(i=0;i<5000;i++) printf "x" }')
! state_update "install.message=$LONG"
printf 'bad line without equals\n' > "$STATE_FILE"
! state_schema_file_valid "$STATE_FILE"
rm -f "$STATE_FILE"
state_update "install.status=ok"
mkdir "$STATE_DIR/.state.lock"
printf '999999\n' > "$STATE_DIR/.state.lock/pid"
printf '0\n' > "$STATE_DIR/.state.lock/created_at"
printf 'old-boot\n' > "$STATE_DIR/.state.lock/boot_id"
state_update "install.status=recovered"
[ "$(state_get install.status)" = recovered ]
printf 'edge tests: ok\n'
