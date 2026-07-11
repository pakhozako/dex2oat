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

service_log() {
  command -v dex_rotate_log >/dev/null 2>&1 && dex_rotate_log "$LOG_FILE" 262144
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE" 2>/dev/null
}

service_lock_now() {
  date '+%s' 2>/dev/null || printf '0\n'
}

service_lock_age() {
  [ -f "$SERVICE_LOCK_DIR/created_at" ] || { printf '0\n'; return 0; }
  LOCK_CREATED="$(cat "$SERVICE_LOCK_DIR/created_at" 2>/dev/null)"
  LOCK_NOW="$(service_lock_now)"
  case "$LOCK_CREATED:$LOCK_NOW" in
    *[!0-9:]*|:*) printf '0\n' ;;
    *) printf '%s\n' $((LOCK_NOW - LOCK_CREATED)) ;;
  esac
}

service_lock_pid_alive() {
  [ -f "$SERVICE_LOCK_DIR/pid" ] || return 1
  LOCK_PID="$(cat "$SERVICE_LOCK_DIR/pid" 2>/dev/null)"
  case "$LOCK_PID" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ -d "/proc/$LOCK_PID" ]
}

release_service_lock() {
  if [ -f "$SERVICE_LOCK_DIR/pid" ] && [ "$(cat "$SERVICE_LOCK_DIR/pid" 2>/dev/null)" = "$$" ]; then
    rm -f "$SERVICE_LOCK_DIR/pid" "$SERVICE_LOCK_DIR/created_at" 2>/dev/null || true
    rmdir "$SERVICE_LOCK_DIR" 2>/dev/null || true
  fi
}

service_on_exit() {
  EXIT_CODE=$?
  if [ "${SERVICE_FINALIZED:-0}" != "1" ] && [ "${SERVICE_ALLOW_RUNNING_EXIT:-0}" != "1" ]; then
    if command -v write_service_state >/dev/null 2>&1; then
      if [ "$EXIT_CODE" -eq 0 ] 2>/dev/null; then
        write_service_state settled "${APPLY_PHASE:-interrupted}" runtime_service_completed
      else
        TOTAL_FAILED_COUNT=$((${TOTAL_FAILED_COUNT:-0} + 1))
        write_service_state error "${APPLY_PHASE:-interrupted}" runtime_service_interrupted
      fi
    elif command -v state_update >/dev/null 2>&1; then
      state_update \
        "service.status=error" \
        "service.health=problem" \
        "service.reason=runtime_service_interrupted" \
        "service.updated_at=$(date '+%Y-%m-%d %H:%M:%S')" \
        "service.updated_epoch=$(date '+%s' 2>/dev/null || printf '0')" \
        "apply.status=error" \
        "apply.reason=runtime_service_interrupted" \
        "apply.updated_at=$(date '+%Y-%m-%d %H:%M:%S')" \
        "apply.updated_epoch=$(date '+%s' 2>/dev/null || printf '0')" || true
      command -v state_recompute_summary >/dev/null 2>&1 && state_recompute_summary || true
    fi
  fi
  release_service_lock
  exit "$EXIT_CODE"
}

acquire_service_lock() {
  mkdir -p "$STATE_DIR" 2>/dev/null || true
  LOCK_WAIT=0
  while ! mkdir "$SERVICE_LOCK_DIR" 2>/dev/null; do
    if ! service_lock_pid_alive; then
      service_log "清理陈旧服务锁：原进程已不存在"
      dex_safe_remove_state_tree "$SERVICE_LOCK_DIR" || true
      continue
    fi
    LOCK_AGE="$(service_lock_age)"
    if [ "${LOCK_AGE:-0}" -gt "$SERVICE_LOCK_STALE_SECONDS" ] 2>/dev/null; then
      service_log "清理陈旧服务锁：age=${LOCK_AGE}s"
      dex_safe_remove_state_tree "$SERVICE_LOCK_DIR" || true
      continue
    fi
    if [ "$LOCK_WAIT" -ge "$SERVICE_LOCK_TIMEOUT" ] 2>/dev/null; then
      service_log "已有服务实例正在运行，跳过重复启动"
      exit 0
    fi
    sleep 1
    LOCK_WAIT=$((LOCK_WAIT + 1))
  done
  printf '%s\n' "$$" > "$SERVICE_LOCK_DIR/pid" 2>/dev/null || true
  service_lock_now > "$SERVICE_LOCK_DIR/created_at" 2>/dev/null || true
  trap 'service_on_exit' EXIT HUP INT TERM
}

acquire_service_lock

restore_system_prop_from_backup_locked() {
  [ -s "$SYSTEM_PROP_BAK" ] || return 1
  cp -af "$SYSTEM_PROP_BAK" "$PROP_FILE" 2>/dev/null || return 1
  chmod 0644 "$PROP_FILE" 2>/dev/null || true
  return 0
}

restore_system_prop_from_backup() {
  dex_with_runtime_lock "$RUNTIME_LOCK_DIR" 20 restore_system_prop_from_backup_locked
}

write_service_state() {
  STATE_STATUS="$1"
  STATE_PHASE="$2"
  STATE_REASON="$3"
  BOOT_ID="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)"
  STATE_NOW_TEXT="$(date '+%Y-%m-%d %H:%M:%S')"
  STATE_NOW_EPOCH="$(date '+%s' 2>/dev/null || printf '0')"
  STATE_HEALTH="ok"
  APPLY_STATUS="ok"

  case "$STATE_STATUS" in
    error) STATE_HEALTH="problem"; APPLY_STATUS="error" ;;
    skipped) STATE_HEALTH="skipped"; APPLY_STATUS="pending" ;;
    running) STATE_HEALTH="running"; APPLY_STATUS="running" ;;
    settled)
      if [ "${TOTAL_FAILED_COUNT:-0}" -gt 0 ] 2>/dev/null; then
        STATE_HEALTH="problem"
        APPLY_STATUS="error"
      elif [ "${TOTAL_MISMATCH_COUNT:-0}" -gt 0 ] 2>/dev/null; then
        STATE_HEALTH="warning"
        APPLY_STATUS="warning"
      fi
      ;;
    *)
      if [ "${TOTAL_FAILED_COUNT:-0}" -gt 0 ] 2>/dev/null; then
        STATE_HEALTH="problem"
        APPLY_STATUS="error"
      elif [ "${TOTAL_MISMATCH_COUNT:-0}" -gt 0 ] 2>/dev/null; then
        STATE_HEALTH="warning"
        APPLY_STATUS="warning"
      fi
      ;;
  esac

  APPLY_REASON="$STATE_REASON"
  if [ -z "$APPLY_REASON" ]; then
    case "$APPLY_STATUS" in
      error) APPLY_REASON="runtime-apply-failed" ;;
      warning) APPLY_REASON="runtime-apply-mismatch" ;;
      running) APPLY_REASON="runtime-apply-running" ;;
      pending) APPLY_REASON="runtime-apply-pending" ;;
      *) APPLY_REASON="runtime-apply-ok" ;;
    esac
  fi

  case "$STATE_STATUS" in
    error|settled|skipped)
      SERVICE_FINALIZED=1
      ;;
  esac

  mkdir -p "$STATE_DIR" 2>/dev/null || true
  {
    printf 'status=%s\n' "$STATE_STATUS"
    printf 'phase=%s\n' "$STATE_PHASE"
    printf 'health=%s\n' "$STATE_HEALTH"
    [ -n "$STATE_REASON" ] && printf 'reason=%s\n' "$STATE_REASON"
    printf 'phase_total=%s\n' "${PHASE_PROP_COUNT:-0}"
    printf 'phase_applied=%s\n' "${PHASE_APPLIED_COUNT:-0}"
    printf 'phase_matched=%s\n' "${PHASE_MATCHED_COUNT:-0}"
    printf 'phase_mismatch=%s\n' "${PHASE_MISMATCH_COUNT:-0}"
    printf 'phase_failed=%s\n' "${PHASE_FAILED_COUNT:-0}"
    printf 'prop_total=%s\n' "${TOTAL_PROP_COUNT:-0}"
    printf 'applied_total=%s\n' "${TOTAL_APPLIED_COUNT:-0}"
    printf 'matched_total=%s\n' "${TOTAL_MATCHED_COUNT:-0}"
    printf 'mismatch_total=%s\n' "${TOTAL_MISMATCH_COUNT:-0}"
    printf 'failed_total=%s\n' "${TOTAL_FAILED_COUNT:-0}"
    printf 'updated_at=%s\n' "$STATE_NOW_TEXT"
    printf 'updated_epoch=%s\n' "$STATE_NOW_EPOCH"
    [ "$STATE_STATUS" = "settled" ] && printf 'settled_at=%s\n' "$STATE_NOW_TEXT"
    [ "$STATE_STATUS" = "settled" ] && printf 'settled_epoch=%s\n' "$STATE_NOW_EPOCH"
    [ -n "$BOOT_ID" ] && printf 'boot_id=%s\n' "$BOOT_ID"
  } > "$SERVICE_STATE" 2>/dev/null || true
  chmod 0600 "$SERVICE_STATE" 2>/dev/null || true
  if command -v state_update >/dev/null 2>&1; then
    state_update \
      "service.status=$STATE_STATUS" \
      "service.phase=$STATE_PHASE" \
      "service.health=$STATE_HEALTH" \
      "service.reason=$STATE_REASON" \
      "service.prop_total=${TOTAL_PROP_COUNT:-0}" \
      "service.applied_total=${TOTAL_APPLIED_COUNT:-0}" \
      "service.matched_total=${TOTAL_MATCHED_COUNT:-0}" \
      "service.mismatch_total=${TOTAL_MISMATCH_COUNT:-0}" \
      "service.failed_total=${TOTAL_FAILED_COUNT:-0}" \
      "service.updated_at=$STATE_NOW_TEXT" \
      "service.updated_epoch=$STATE_NOW_EPOCH" \
      "service.settled_at=$([ "$STATE_STATUS" = "settled" ] && printf '%s' "$STATE_NOW_TEXT")" \
      "service.settled_epoch=$([ "$STATE_STATUS" = "settled" ] && printf '%s' "$STATE_NOW_EPOCH")" \
      "service.boot_id=$BOOT_ID" \
      "apply.status=$APPLY_STATUS" \
      "apply.reason=$APPLY_REASON" \
      "apply.phase=$STATE_PHASE" \
      "apply.prop_total=${TOTAL_PROP_COUNT:-0}" \
      "apply.applied_total=${TOTAL_APPLIED_COUNT:-0}" \
      "apply.matched_total=${TOTAL_MATCHED_COUNT:-0}" \
      "apply.mismatch_total=${TOTAL_MISMATCH_COUNT:-0}" \
      "apply.failed_total=${TOTAL_FAILED_COUNT:-0}" \
      "apply.last_status=$APPLY_STATUS" \
      "apply.last_reason=$APPLY_REASON" \
      "apply.last_phase=$STATE_PHASE" \
      "apply.last_updated_at=$STATE_NOW_TEXT" \
      "apply.last_updated_epoch=$STATE_NOW_EPOCH" \
      "apply.updated_at=$STATE_NOW_TEXT" \
      "apply.updated_epoch=$STATE_NOW_EPOCH" || true
    state_recompute_summary || true
  fi
}

service_apply_prop() {
  PROP_KEY="$1"
  PROP_VALUE="$2"
  dex_apply_checked_prop "$PROP_KEY" "$PROP_VALUE"
  APPLY_STATUS=$?
  case "$APPLY_STATUS" in
    0)
      service_log "已应用: phase=$APPLY_PHASE key=$PROP_KEY 目标=$PROP_VALUE 旧值=$DEX_CHECKED_OLD_VALUE 新值=$DEX_CHECKED_NEW_VALUE 工具=$DEX_CHECKED_APPLY_TOOL code=$DEX_CHECKED_APPLY_CODE"
      ;;
    1)
      service_log "应用失败: phase=$APPLY_PHASE key=$PROP_KEY 目标=$PROP_VALUE 旧值=$DEX_CHECKED_OLD_VALUE 新值=$DEX_CHECKED_NEW_VALUE 工具=$DEX_CHECKED_APPLY_TOOL code=$DEX_CHECKED_APPLY_CODE helper=$DEX_CHECKED_FAILURE_REASON"
      ;;
    2)
      service_log "应用不一致: phase=$APPLY_PHASE key=$PROP_KEY 目标=$PROP_VALUE 旧值=$DEX_CHECKED_OLD_VALUE 新值=$DEX_CHECKED_NEW_VALUE 工具=$DEX_CHECKED_APPLY_TOOL code=$DEX_CHECKED_APPLY_CODE"
      ;;
    3)
      service_log "已匹配: phase=$APPLY_PHASE key=$PROP_KEY 目标=$PROP_VALUE 旧值=$DEX_CHECKED_OLD_VALUE 新值=$DEX_CHECKED_NEW_VALUE 工具=$DEX_CHECKED_APPLY_TOOL code=$DEX_CHECKED_APPLY_CODE"
      ;;
  esac
  return "$APPLY_STATUS"
}
stop_service_if_running() {
  SERVICE_NAME="$1"
  SVC_RUNTIME_STATE="$(getprop "init.svc.$SERVICE_NAME")"

  if [ "$SVC_RUNTIME_STATE" = "running" ]; then
    stop "$SERVICE_NAME"
    if [ $? -eq 0 ]; then
      service_log "已停止服务: $SERVICE_NAME"
    else
      service_log "停止服务失败: $SERVICE_NAME"
    fi
  else
    service_log "服务已处于非运行状态: $SERVICE_NAME ($SVC_RUNTIME_STATE)"
  fi
}

prepare_runtime_prop_file() {
  PROP_HASH="$(dex_hash_file "$PROP_FILE" 2>/dev/null)"
  OLD_HASH="$(cat "$RUNTIME_PROP_HASH_FILE" 2>/dev/null)"
  if [ -s "$RUNTIME_PROP_FILE" ] && [ -n "$PROP_HASH" ] && [ "$PROP_HASH" = "$OLD_HASH" ]; then
    return 0
  fi
  : > "$RUNTIME_PROP_FILE" 2>/dev/null || return 0
  [ -s "$PROP_FILE" ] || return 0
  while IFS='=' read -r PROP_KEY PROP_VALUE || [ -n "$PROP_KEY" ]; do
    PROP_KEY="$(printf '%s' "$PROP_KEY" | tr -d '\r' | sed 's/[[:space:]]*$//')"
    case "$PROP_KEY" in
      ""|\#*)
        continue
        ;;
    esac
    dex_is_runtime_prop "$PROP_KEY" "$MATCHED_PROPS" "$RULES_FILE" strict || continue
    PROP_VALUE="$(printf '%s' "$PROP_VALUE" | tr -d '\r')"
    printf '%s=%s\n' "$PROP_KEY" "$PROP_VALUE" >> "$RUNTIME_PROP_FILE" 2>/dev/null || true
  done < "$PROP_FILE"
  printf '%s\n' "$PROP_HASH" > "$RUNTIME_PROP_HASH_FILE" 2>/dev/null || true
  chmod 0600 "$RUNTIME_PROP_FILE" "$RUNTIME_PROP_HASH_FILE" 2>/dev/null || true
}

# 等待 Android 完成启动。
apply_runtime_props() {
  APPLY_PHASE="$1"
  prepare_runtime_prop_file
  write_service_state running "$APPLY_PHASE"
  PHASE_PROP_COUNT=0
  PHASE_APPLIED_COUNT=0
  PHASE_MATCHED_COUNT=0
  PHASE_MISMATCH_COUNT=0
  PHASE_FAILED_COUNT=0
  service_log "开始运行时属性应用: phase=$APPLY_PHASE"

  while IFS='=' read -r PROP_KEY PROP_VALUE; do
    PROP_KEY="$(printf '%s' "$PROP_KEY" | tr -d '\r' | sed 's/[[:space:]]*$//')"
    PROP_VALUE="$(printf '%s' "$PROP_VALUE" | tr -d '\r')"

    case "$PROP_KEY" in
      ""|\#*)
        continue
        ;;
    esac

    if dex_is_runtime_prop "$PROP_KEY" "$MATCHED_PROPS" "$RULES_FILE" strict; then
      service_apply_prop "$PROP_KEY" "$PROP_VALUE"
      APPLY_STATUS=$?
      PHASE_PROP_COUNT=$((PHASE_PROP_COUNT + 1))
      TOTAL_PROP_COUNT=$((TOTAL_PROP_COUNT + 1))

      case "$APPLY_STATUS" in
        0)
          PHASE_APPLIED_COUNT=$((PHASE_APPLIED_COUNT + 1))
          TOTAL_APPLIED_COUNT=$((TOTAL_APPLIED_COUNT + 1))
          ;;
        2)
          PHASE_MISMATCH_COUNT=$((PHASE_MISMATCH_COUNT + 1))
          TOTAL_MISMATCH_COUNT=$((TOTAL_MISMATCH_COUNT + 1))
          ;;
        3)
          PHASE_MATCHED_COUNT=$((PHASE_MATCHED_COUNT + 1))
          TOTAL_MATCHED_COUNT=$((TOTAL_MATCHED_COUNT + 1))
          ;;
        *)
          PHASE_FAILED_COUNT=$((PHASE_FAILED_COUNT + 1))
          TOTAL_FAILED_COUNT=$((TOTAL_FAILED_COUNT + 1))
          ;;
      esac
    fi
  done < "$RUNTIME_PROP_FILE"

  service_log "运行时属性应用完成: phase=$APPLY_PHASE 总数=$PHASE_PROP_COUNT 已应用=$PHASE_APPLIED_COUNT 已匹配=$PHASE_MATCHED_COUNT 不一致=$PHASE_MISMATCH_COUNT 失败=$PHASE_FAILED_COUNT"
  write_service_state running "$APPLY_PHASE"
}

# 记录 Root 管理器信息，仅用于日志和诊断。
if command -v dex_platform_info >/dev/null 2>&1; then
  service_log "运行环境: $(dex_platform_info)"
  service_log "属性写入命令: $(dex_prop_command 2>/dev/null || printf 'setprop')"
fi

service_log "等待系统启动完成..."
write_service_state running boot-wait boot_wait
BOOT_WAIT=0
while [ "$(getprop sys.boot_completed)" != "1" ] && [ "$BOOT_WAIT" -lt 120 ]; do
  sleep 5
  BOOT_WAIT=$((BOOT_WAIT + 1))
done

if [ "$(getprop sys.boot_completed)" != "1" ]; then
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
service_log "运行时属性应用结束: 总数=$TOTAL_PROP_COUNT 已应用=$TOTAL_APPLIED_COUNT 已匹配=$TOTAL_MATCHED_COUNT 不一致=$TOTAL_MISMATCH_COUNT 失败=$TOTAL_FAILED_COUNT"
