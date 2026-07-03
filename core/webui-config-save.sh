#!/system/bin/sh

MODDIR="$1"
STAGE_DIR="$2"
[ -n "$MODDIR" ] || MODDIR=${0%/*}/..

STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
CONFIG_FILE="$STATE_DIR/config.json"
CONFIG_LOCK_DIR="$STATE_DIR/.config.lock"

[ -f "$MODDIR/core/common.sh" ] && . "$MODDIR/core/common.sh"

fail() {
  printf 'error=%s\n' "$1" >&2
  exit 1
}

validate_stage() {
  case "$STAGE_DIR" in
    "$STATE_DIR"/stage-*) ;;
    *) fail "invalid-stage-path" ;;
  esac
  [ -s "$STAGE_DIR/config.json" ] || fail "missing-staged-config"
  grep -q '[{}]' "$STAGE_DIR/config.json" 2>/dev/null || fail "invalid-config-json"
  grep -q '"items"[[:space:]]*:' "$STAGE_DIR/config.json" 2>/dev/null || fail "invalid-config-items"
  grep -q -E '"riskMode"[[:space:]]*:[[:space:]]*"(safe|caution|aggressive)"' "$STAGE_DIR/config.json" 2>/dev/null || fail "invalid-config-risk-mode"
}

apply_config_locked() {
  mkdir -p "$STATE_DIR" 2>/dev/null || fail "create-state-dir"
  validate_stage

  TMP_FILE="$CONFIG_FILE.tmp.$$"
  cp -af "$STAGE_DIR/config.json" "$TMP_FILE" 2>/dev/null || {
    rm -f "$TMP_FILE" 2>/dev/null || true
    fail "copy-config"
  }
  sync "$TMP_FILE" 2>/dev/null || sync 2>/dev/null || true
  mv -f "$TMP_FILE" "$CONFIG_FILE" 2>/dev/null || {
    rm -f "$TMP_FILE" 2>/dev/null || true
    fail "replace-config"
  }
  chmod 0600 "$CONFIG_FILE" 2>/dev/null || true
}

mkdir -p "$STATE_DIR" 2>/dev/null || fail "create-state-dir"
if command -v dex_with_lock >/dev/null 2>&1; then
  dex_with_lock "$CONFIG_LOCK_DIR" 20 apply_config_locked
else
  apply_config_locked
fi
