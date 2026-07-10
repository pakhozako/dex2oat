#!/usr/bin/env sh
set -eu

ROOT="$1"
TMP_ROOT="${TMPDIR:-/tmp}/dex2oat-action-test.$$"
trap 'rm -rf "$TMP_ROOT"' 0 HUP INT TERM
mkdir -p "$TMP_ROOT/tmp"
mkdir -p "$TMP_ROOT/state"
printf 'schema_version=60\nconfig.status=ok\n' > "$TMP_ROOT/state/state.prop"
STATE_BEFORE="$(cat "$TMP_ROOT/state/state.prop")"

STATE_DIR="$TMP_ROOT/state" TMPDIR="$TMP_ROOT/tmp" sh "$ROOT/action.sh" dry-run >/dev/null
[ "$(cat "$TMP_ROOT/state/state.prop")" = "$STATE_BEFORE" ]
[ ! -e "$TMP_ROOT/state/rule-props.tsv" ]
[ ! -e "$TMP_ROOT/state/system.prop.bak" ]
[ -f "$ROOT/system.prop" ]
find "$TMP_ROOT/tmp" -name report.txt -type f | grep -q .

printf 'action tests: ok\n'
