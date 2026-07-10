#!/system/bin/sh

MODDIR=${0%/*}
STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
LOG_DIR="$STATE_DIR/logs"
LOG_FILE="$STATE_DIR/service.log"
SERVICE_STATE="$STATE_DIR/service-state.prop"
STATE_FILE="$STATE_DIR/state.prop"
FALLBACK_LOG=/data/adb/dex2oat-lock-service.log
PROP_FILE="$MODDIR/system.prop"
RUNTIME_PROP_FILE="$STATE_DIR/runtime-props.tmp"
RUNTIME_PROP_HASH_FILE="$STATE_DIR/runtime-props.hash"
ORIGINAL_PROPS="$STATE_DIR/original-props.conf"
SYSTEM_PROP_BAK="$STATE_DIR/system.prop.bak"
MATCHED_PROPS="$STATE_DIR/matched-props.txt"
PROP_LOCK_LIST="$STATE_DIR/prop-lock.list"
RULES_PACK_FILE="$MODDIR/rules/rule-props.pack"
RULES_FILE="$STATE_DIR/rule-props.tsv"
RULES_DECODE_SCRIPT="$MODDIR/scripts/decode-rules.sh"
SERVICE_LOCK_DIR="$STATE_DIR/.service.lock"
RUNTIME_LOCK_DIR="$STATE_DIR/.runtime.lock"
SERVICE_LOCK_TIMEOUT=20
SERVICE_LOCK_STALE_SECONDS=7200
SERVICE_BOOT_POST_DELAY=${DEX2OAT_BOOT_POST_DELAY:-3}
SERVICE_RUNTIME_SETTLE_WAIT=${DEX2OAT_RUNTIME_SETTLE_WAIT:-10}
SERVICE_RUNTIME_FINAL_WAIT=${DEX2OAT_RUNTIME_FINAL_WAIT:-12}
SERVICE_FINALIZED=0
SERVICE_ALLOW_RUNNING_EXIT=0

if [ -f "$MODDIR/core/state.sh" ]; then
  . "$MODDIR/core/state.sh"
fi
if [ -f "$MODDIR/core/common.sh" ]; then
  . "$MODDIR/core/common.sh"
fi
if [ -f "$MODDIR/core/property.sh" ]; then
  . "$MODDIR/core/property.sh"
fi
if [ -f "$MODDIR/core/safety.sh" ]; then
  . "$MODDIR/core/safety.sh"
fi

if ! mkdir -p "$LOG_DIR" 2>/dev/null; then
  LOG_FILE="$FALLBACK_LOG"
fi


. "$MODDIR/core/boot-flow.sh" || exit 1
. "$MODDIR/core/runtime-apply.sh" || exit 1
. "$MODDIR/core/protection.sh" || exit 1
. "$MODDIR/core/diagnostics.sh" || exit 1

boot_flow_main() {
  acquire_service_lock
  if ! protection_begin_session; then
    service_log "已进入运行保护模式，本次跳过运行时属性写入"
    write_service_state skipped protection protection_mode
    SERVICE_FINALIZED=1
    return 0
  fi
  # 记录 Root 管理器信息，仅用于日志和诊断。
  if command -v dex_platform_info >/dev/null 2>&1; then
    service_log "运行环境: $(dex_platform_info)"
    service_log "属性写入命令: $(dex_prop_command 2>/dev/null || printf 'setprop')"
  fi
  
  service_log "等待系统启动完成..."
  write_service_state running boot-wait boot_wait
  BOOT_WAIT=0
  BOOT_COMPLETED="$(getprop sys.boot_completed)"
  while [ "$BOOT_COMPLETED" != "1" ] && [ "$BOOT_WAIT" -lt 120 ]; do
    sleep 5
    BOOT_WAIT=$((BOOT_WAIT + 1))
    BOOT_COMPLETED="$(getprop sys.boot_completed)"
  done
  
  if [ "$BOOT_COMPLETED" != "1" ]; then
    service_log "等待系统启动超时 600 秒，继续执行"
  fi
  
  BOOT_POST_WAIT=0
  while [ "$BOOT_POST_WAIT" -lt "$SERVICE_BOOT_POST_DELAY" ]; do
    sleep 1
    BOOT_POST_WAIT=$((BOOT_POST_WAIT + 1))
  done
  service_log "系统启动完成，准备规则驱动状态..."
  if ! dex_prepare_runtime_rules "$RULES_DECODE_SCRIPT" "$RULES_PACK_FILE" "$RULES_FILE"; then
    service_log "警告: 规则包不可用，继续使用现有匹配属性"
  fi
  
  if [ -f "$MODDIR/core/prop-lock.sh" ]; then
    sh "$MODDIR/core/prop-lock.sh" "$MODDIR" 2>/dev/null || true
  fi
  
  # 当模块内 system.prop 缺失或为空时，从备份恢复。
  if [ ! -s "$PROP_FILE" ]; then
    service_log "警告: $PROP_FILE 缺失或为空，尝试从 system.prop.bak 恢复"
    if restore_system_prop_from_backup; then
      service_log "已从 $SYSTEM_PROP_BAK 恢复 system.prop"
    else
      service_log "错误: system.prop 恢复失败"
      TOTAL_FAILED_COUNT=$((TOTAL_FAILED_COUNT + 1))
      write_service_state error missing-system-prop system_prop_missing
      exit 1
    fi
  fi
  
  if [ ! -s "$PROP_FILE" ]; then
    service_log "错误: 恢复后 system.prop 仍缺失或为空"
    TOTAL_FAILED_COUNT=$((TOTAL_FAILED_COUNT + 1))
    write_service_state error missing-system-prop system_prop_missing
    exit 1
  fi
  
  # 重新应用可能被系统覆盖的运行时属性。
  TOTAL_PROP_COUNT=0
  TOTAL_APPLIED_COUNT=0
  TOTAL_MATCHED_COUNT=0
  TOTAL_MISMATCH_COUNT=0
  TOTAL_FAILED_COUNT=0
  apply_runtime_props initial
  
  if [ "$(getprop dalvik.vm.useartservice)" = "false" ]; then
    stop_service_if_running artd
    stop_service_if_running art_boot
  fi
  
  if [ "${TOTAL_MISMATCH_COUNT:-0}" -gt 0 ] 2>/dev/null || [ "${TOTAL_FAILED_COUNT:-0}" -gt 0 ] 2>/dev/null; then
    RUNTIME_RECHECK_WAIT=0
    while [ "$RUNTIME_RECHECK_WAIT" -lt "$SERVICE_RUNTIME_SETTLE_WAIT" ]; do
      sleep 1
      RUNTIME_RECHECK_WAIT=$((RUNTIME_RECHECK_WAIT + 1))
    done
    apply_runtime_props recheck
  fi
  
  if [ "${TOTAL_MISMATCH_COUNT:-0}" -gt 0 ] 2>/dev/null || [ "${TOTAL_FAILED_COUNT:-0}" -gt 0 ] 2>/dev/null; then
    # KernelSU 可能出现属性延迟稳定，这里只保留等待逻辑，不做专用安装分支。
    if [ -n "$KSU" ]; then
      service_log "KernelSU 属性稳定可能延迟，继续等待后复查"
      service_log "KernelSU 不需要独立安装器，也不需要 /system 挂载支持"
    fi
  
    RUNTIME_FINAL_WAIT=0
    while [ "$RUNTIME_FINAL_WAIT" -lt "$SERVICE_RUNTIME_FINAL_WAIT" ]; do
      sleep 1
      RUNTIME_FINAL_WAIT=$((RUNTIME_FINAL_WAIT + 1))
    done
    apply_runtime_props settled
  fi
  
  write_service_state settled settled
  if [ "${TOTAL_FAILED_COUNT:-0}" -gt 0 ] 2>/dev/null; then protection_finish_session failed; else protection_finish_session ok; fi
  diagnostic_run scheduled || true
  service_log "运行时属性应用结束: 总数=$TOTAL_PROP_COUNT 已应用=$TOTAL_APPLIED_COUNT 已匹配=$TOTAL_MATCHED_COUNT 不一致=$TOTAL_MISMATCH_COUNT 失败=$TOTAL_FAILED_COUNT"
  
}

boot_flow_main
