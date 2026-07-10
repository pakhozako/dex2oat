#!/usr/bin/env sh
set -eu

ROOT="$1"
TMP_ROOT="${TMPDIR:-/tmp}/dex2oat-conflict-test.$$"
trap 'rm -rf "$TMP_ROOT"' EXIT HUP INT TERM
STATE_DIR="$TMP_ROOT/state"
MODDIR="$TMP_ROOT/module"
MODULES_ROOT="$TMP_ROOT/modules"
mkdir -p "$STATE_DIR" "$MODDIR" "$MODULES_ROOT/disabled" "$MODULES_ROOT/removing" "$MODULES_ROOT/active"

printf 'dalvik.vm.test=one\n' > "$MODDIR/system.prop"
printf 'dalvik.vm.test=two\n' > "$MODULES_ROOT/disabled/system.prop"
printf 'dalvik.vm.test=three\n' > "$MODULES_ROOT/removing/system.prop"
printf 'other.key=value\n' > "$MODULES_ROOT/active/system.prop"
touch "$MODULES_ROOT/disabled/disable" "$MODULES_ROOT/removing/remove"

STATE_DIR="$STATE_DIR" DEX2OAT_MODULES_ROOT="$MODULES_ROOT" sh "$ROOT/core/conflict-detect.sh" "$MODDIR"
grep -q '^scan_status=ok$' "$STATE_DIR/conflict-report.txt"
grep -q '^conflict_total=0$' "$STATE_DIR/conflict-report.txt"
grep -q '^scanned_modules=1$' "$STATE_DIR/conflict-report.txt"
! grep -q 'disabled' "$STATE_DIR/conflict-report.txt"
! grep -q 'removing' "$STATE_DIR/conflict-report.txt"

mkdir -p "$MODULES_ROOT/conflicting"
printf 'dalvik.vm.test=four\n' > "$MODULES_ROOT/conflicting/system.prop"
STATE_DIR="$STATE_DIR" DEX2OAT_MODULES_ROOT="$MODULES_ROOT" sh "$ROOT/core/conflict-detect.sh" "$MODDIR"
grep -q '^scan_status=warning$' "$STATE_DIR/conflict-report.txt"
grep -q '^conflict_total=1$' "$STATE_DIR/conflict-report.txt"
grep -q 'dalvik.vm.test conflict_with conflicting' "$STATE_DIR/conflict-report.txt"

printf 'conflict tests: ok\n'
