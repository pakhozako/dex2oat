#!/system/bin/sh

service_log() {
  command -v dex_rotate_log >/dev/null 2>&1 && dex_rotate_log "$LOG_FILE" 262144
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE" 2>/dev/null
}

release_service_lock() {
  dex_release_named_lock "$SERVICE_LOCK_DIR" service
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
  if ! dex_acquire_lock "$SERVICE_LOCK_DIR" "$SERVICE_LOCK_TIMEOUT" service; then
    service_log "已有服务实例正在运行，跳过重复启动"
    exit 0
  fi
  trap 'service_on_exit' EXIT HUP INT TERM
}
