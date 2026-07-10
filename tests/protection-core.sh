#!/usr/bin/env sh
set -eu
ROOT="$1"
TMP_ROOT="${TMPDIR:-/tmp}/dex2oat-protection-test.$$"
trap 'rm -rf "$TMP_ROOT"' 0 HUP INT TERM
mkdir -p "$TMP_ROOT/core" "$TMP_ROOT/state"
cp "$ROOT/core/common.sh" "$ROOT/core/state-schema.sh" "$ROOT/core/state-store.sh" "$ROOT/core/state-migrate.sh" "$ROOT/core/state-summary.sh" "$ROOT/core/state.sh" "$ROOT/core/protection.sh" "$ROOT/core/snapshot.sh" "$TMP_ROOT/core/"
STATE_DIR="$TMP_ROOT/state"
STATE_FILE="$TMP_ROOT/state/state.prop"
MODDIR="$TMP_ROOT"
. "$TMP_ROOT/core/state.sh"
. "$TMP_ROOT/core/protection.sh"
. "$TMP_ROOT/core/snapshot.sh"
state_update "protection.boot_id=old" "protection.session_status=running" "protection.failure_count=2"
! protection_begin_session
[ "$(state_get protection.mode)" = on ]
protection_reset
protection_begin_session
protection_finish_session ok
[ "$(state_get protection.mode)" = off ]
[ "$(state_get protection.failure_count)" = 0 ]
printf 'test.key=one\n' > "$TMP_ROOT/system.prop"
snapshot_create "$TMP_ROOT/system.prop" test
printf 'test.key=two\n' > "$TMP_ROOT/system.prop"
snapshot_restore_latest "$TMP_ROOT/system.prop"
grep -q '^test.key=one$' "$TMP_ROOT/system.prop"
SNAPSHOT_FILE="$(state_get snapshot.last_file)"
printf 'bad line without equals\n' > "$SNAPSHOT_FILE"
printf 'test.key=three\n' > "$TMP_ROOT/system.prop"
! snapshot_restore_latest "$TMP_ROOT/system.prop"
for value in a b c d e; do
  printf 'test.key=%s\n' "$value" > "$TMP_ROOT/system.prop"
  snapshot_create "$TMP_ROOT/system.prop" "rotate-$value"
done
SNAPSHOT_COUNT="$(find "$STATE_DIR/snapshots" -name '*.prop' -type f | wc -l | tr -d ' ')"
[ "$SNAPSHOT_COUNT" -le 3 ]
printf 'protection tests: ok\n'
