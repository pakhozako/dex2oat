#!/usr/bin/env sh
set -eu
ROOT="$1"
TMP_ROOT="${TMPDIR:-/tmp}/dex2oat-input-test.$$"
trap 'rm -rf "$TMP_ROOT"' 0 HUP INT TERM
mkdir -p "$TMP_ROOT"
DEX_INPUT_STATE_DIR="$TMP_ROOT"
. "$ROOT/core/input.sh"
dex_input_is_volume_up 'event0 KEY_VOLUMEUP DOWN'
dex_input_is_volume_up 'keycode 115 down'
dex_input_is_volume_down 'event0 KEY_VOLUMEDOWN DOWN'
dex_input_is_volume_down 'keycode 114 down'
! dex_input_is_volume_up 'KEY_VOLUMEDOWN DOWN'
! dex_input_is_volume_down 'KEY_VOLUMEUP DOWN'
printf 'input tests: ok\n'
