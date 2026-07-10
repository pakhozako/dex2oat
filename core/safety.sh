#!/system/bin/sh

DEX_SAFE_STATE_DIR=${DEX_SAFE_STATE_DIR:-${STATE_DIR:-/data/adb/dex2oat-lock}}

dex_safe_state_dir() {
  case "$DEX_SAFE_STATE_DIR" in
    /data/adb/dex2oat-lock) return 0 ;;
  esac
  return 1
}

dex_safe_remove_state_root() {
  DEX_SAFE_TARGET="$1"
  dex_safe_state_dir || return 1
  [ "$DEX_SAFE_TARGET" = "$DEX_SAFE_STATE_DIR" ] || return 1
  rm -rf "$DEX_SAFE_TARGET" 2>/dev/null
}

dex_safe_remove_state_tree() {
  DEX_SAFE_TARGET="$1"
  dex_safe_state_dir || return 1
  case "$DEX_SAFE_TARGET" in
    "$DEX_SAFE_STATE_DIR/backup"|"$DEX_SAFE_STATE_DIR/logs"|\
"$DEX_SAFE_STATE_DIR/snapshots"|"$DEX_SAFE_STATE_DIR/diagnostics"|"$DEX_SAFE_STATE_DIR/dry-run"|\
"$DEX_SAFE_STATE_DIR/.state.lock"|"$DEX_SAFE_STATE_DIR/.summary.lock"|\
"$DEX_SAFE_STATE_DIR/.service.lock"|"$DEX_SAFE_STATE_DIR/.runtime.lock"|\
"$DEX_SAFE_STATE_DIR/.action.lock"|"$DEX_SAFE_STATE_DIR/.health-history.lock")
      rm -rf "$DEX_SAFE_TARGET" 2>/dev/null
      ;;
    *)
      return 1
      ;;
  esac
}
