#!/system/bin/sh

STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
INSTALL_LOG="$STATE_DIR/install.log"
RUNTIME_STATUS="$STATE_DIR/runtime-status.prop"
OPERATION_LOCK="$STATE_DIR/.operation.lock"
INSTALL_STARTED_AT="$(date '+%s' 2>/dev/null || printf '0')"

if ! command -v ui_print >/dev/null 2>&1; then
  ui_print() { printf '%s\n' "$*"; }
fi
if ! command -v abort >/dev/null 2>&1; then
  abort() { ui_print "! $*"; exit 1; }
fi
if ! command -v set_perm >/dev/null 2>&1; then
  set_perm() {
    chown "$2:$3" "$1" 2>/dev/null || return 1
    chmod "$4" "$1" 2>/dev/null
  }
fi

[ -n "$MODPATH" ] || abort "MODPATH 未设置"
[ -f "$MODPATH/core/common.sh" ] || abort "缺少 core/common.sh"
[ -f "$MODPATH/core/rule-engine.sh" ] || abort "缺少 core/rule-engine.sh"
. "$MODPATH/core/common.sh"
. "$MODPATH/core/rule-engine.sh"

MODULE_VERSION="$(sed -n 's/^version=//p' "$MODPATH/module.prop" 2>/dev/null | head -n 1)"
[ -n "$MODULE_VERSION" ] || MODULE_VERSION=unknown

install_log() {
  ui_print "$*"
  dex_rotate_log "$INSTALL_LOG" 131072 2>/dev/null || true
  printf '%s %s\n' "$(dex_now)" "$*" >> "$INSTALL_LOG" 2>/dev/null || true
}

install_stage() {
  ui_print "[$1/07] $2"
}

install_cleanup() {
  dex_rule_cleanup
  dex_lock_release
}

install_fail() {
  install_log "! Installation Failed: $*"
  install_cleanup
  trap - HUP INT TERM
  abort "$*"
}

install_interrupted() {
  trap - HUP INT TERM
  install_log "! Installation Failed: 安装被信号中断"
  install_cleanup
  exit 1
}

write_runtime_pending() {
  RUNTIME_TMP="$STATE_DIR/.runtime-status.new.$$"
  {
    printf 'updated_at=%s\n' "$(dex_now)"
    printf 'status=pending\n'
    printf 'reason=waiting-for-boot\n'
    printf 'phase=install\n'
    printf 'config_hash=%s\n' "$DEX_RULE_CONFIG_HASH"
    printf 'prop_total=%s\n' "$DEX_RULE_FINAL_TOTAL"
    printf 'applied_total=0\n'
    printf 'unchanged_total=0\n'
    printf 'mismatch_total=0\n'
    printf 'failed_total=0\n'
  } > "$RUNTIME_TMP" 2>/dev/null || return 1
  chmod 0600 "$RUNTIME_TMP" 2>/dev/null || true
  mv -f "$RUNTIME_TMP" "$RUNTIME_STATUS" 2>/dev/null || {
    rm -f "$RUNTIME_TMP" 2>/dev/null || true
    return 1
  }
}

install_stage 01 "初始化安装环境"
mkdir -p "$STATE_DIR" 2>/dev/null || abort "无法创建状态目录"
chmod 0700 "$STATE_DIR" 2>/dev/null || true
touch "$INSTALL_LOG" 2>/dev/null || abort "无法创建安装日志"
chmod 0600 "$INSTALL_LOG" 2>/dev/null || true

ui_print "========================================"
ui_print "Dex2oat Lock $MODULE_VERSION"
ui_print "规则驱动 ART / dexopt 调优"
PLATFORM_NAME="$(dex_detect_platform)"
[ "$PLATFORM_NAME" = Unknown ] || ui_print "Root: $PLATFORM_NAME $(dex_platform_version)"
ui_print "========================================"

install_stage 02 "检查必要文件与规则包"
dex_rule_preflight "$MODPATH" "$STATE_DIR" || install_fail "安装预检失败"

if ! dex_lock_acquire "$OPERATION_LOCK" 20 install; then
  install_fail "另一个模块操作正在运行"
fi
trap 'install_interrupted' HUP INT TERM

install_stage 03 "采集设备属性并匹配规则"
if ! dex_rule_build "$MODPATH" "$STATE_DIR" commit "$MODULE_VERSION"; then
  install_fail "规则匹配或配置生成失败"
fi

install_stage 04 "过滤冲突属性"
if [ "${DEX_RULE_CONFLICT_TOTAL:-0}" -gt 0 ] 2>/dev/null; then
  install_log "- 已跳过冲突属性: $DEX_RULE_CONFLICT_TOTAL"
else
  install_log "- 未发现属性冲突"
fi

install_stage 05 "验证最终 system.prop"
dex_validate_prop_file "$MODPATH/system.prop" || install_fail "最终 system.prop 校验失败"
[ "$(dex_hash_file "$MODPATH/system.prop" 2>/dev/null)" = "$DEX_RULE_CONFIG_HASH" ] || install_fail "最终 system.prop 哈希不一致"
write_runtime_pending || install_fail "无法写入运行状态"

install_stage 06 "设置模块权限"
chmod 0755 "$MODPATH" 2>/dev/null || install_fail "无法设置模块目录权限"
for EXECUTABLE_FILE in service.sh action.sh customize.sh uninstall.sh; do
  set_perm "$MODPATH/$EXECUTABLE_FILE" 0 0 0755 || install_fail "无法设置 $EXECUTABLE_FILE 权限"
done
set_perm "$MODPATH/system.prop" 0 0 0644 || install_fail "无法设置 system.prop 权限"
set_perm "$MODPATH/module.prop" 0 0 0644 || install_fail "无法设置 module.prop 权限"
for READABLE_DIR in core scripts rules; do
  [ -d "$MODPATH/$READABLE_DIR" ] || install_fail "缺少目录: $READABLE_DIR"
  chmod 0755 "$MODPATH/$READABLE_DIR" 2>/dev/null || install_fail "无法设置 $READABLE_DIR 目录权限"
  find "$MODPATH/$READABLE_DIR" -type f -exec chmod 0644 {} \; 2>/dev/null || install_fail "无法设置 $READABLE_DIR 文件权限"
done
chmod 0700 "$STATE_DIR" 2>/dev/null || true
chmod 0600 "$STATE_DIR/match-report.prop" "$STATE_DIR/conflict-report.txt" "$RUNTIME_STATUS" "$INSTALL_LOG" 2>/dev/null || true

INSTALL_FINISHED_AT="$(date '+%s' 2>/dev/null || printf '0')"
INSTALL_SECONDS=0
case "$INSTALL_STARTED_AT:$INSTALL_FINISHED_AT" in
  *[!0-9:]*|:*) : ;;
  *) INSTALL_SECONDS=$((INSTALL_FINISHED_AT - INSTALL_STARTED_AT)) ;;
esac

install_stage 07 "安装完成"
install_log "- 规则解析: ${DEX_RULE_RESOLVED_TOTAL:-0}"
install_log "- 冲突跳过: ${DEX_RULE_CONFLICT_TOTAL:-0}"
install_log "- 最终属性: ${DEX_RULE_FINAL_TOTAL:-0}"
install_log "- 配置哈希: $DEX_RULE_CONFIG_HASH"
install_log "- 安装耗时: ${INSTALL_SECONDS}s"

install_cleanup
trap - HUP INT TERM
exit 0
