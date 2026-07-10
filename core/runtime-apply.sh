#!/system/bin/sh

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
