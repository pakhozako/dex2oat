#!/system/bin/sh

case "$0" in
  */*) SCRIPT_DIR=${0%/*} ;;
  *) SCRIPT_DIR=. ;;
esac
MODDIR="$(cd "$SCRIPT_DIR" 2>/dev/null && pwd)"
STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
OPERATION_LOCK="$STATE_DIR/.operation.lock"

[ -f "$MODDIR/core/common.sh" ] && . "$MODDIR/core/common.sh"

uninstall_print() {
  if command -v ui_print >/dev/null 2>&1; then
    ui_print "$@"
  else
    printf '%s\n' "$@"
  fi
}

stop_runtime_service() {
  command -v dex_lock_read >/dev/null 2>&1 || return 0
  dex_lock_read "$OPERATION_LOCK" || return 0
  [ "$DEX_LOCK_NAME" = service.sh ] || return 0
  [ "$DEX_LOCK_BOOT" = "$(dex_boot_id)" ] || return 0
  [ -d "/proc/$DEX_LOCK_PID" ] || return 0
  SERVICE_CMDLINE="$(tr '\000' ' ' < "/proc/$DEX_LOCK_PID/cmdline" 2>/dev/null)"
  case "$SERVICE_CMDLINE" in
    *service.sh*)
      kill "$DEX_LOCK_PID" 2>/dev/null || true
      ;;
  esac
}

cleanup_module_state() {
  [ -d "$STATE_DIR" ] || return 0
  case "$STATE_DIR" in
    /data/adb/dex2oat-lock)
      rm -rf "$STATE_DIR" 2>/dev/null
      ;;
    *)
      rm -f "$STATE_DIR/match-report.prop" "$STATE_DIR/conflict-report.txt" "$STATE_DIR/runtime-status.prop" "$STATE_DIR/install.log" "$STATE_DIR/service.log" 2>/dev/null || true
      command -v dex_lock_remove >/dev/null 2>&1 && dex_lock_remove "$OPERATION_LOCK" 2>/dev/null || true
      rmdir "$STATE_DIR" 2>/dev/null || true
      ;;
  esac
}

uninstall_print "- 正在卸载 Dex2oat Lock"
stop_runtime_service
cleanup_module_state
uninstall_print "- 模块状态已清理；卸载后 system.prop 将不再加载"
exit 0
