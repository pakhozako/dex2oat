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
CAPTURED_PROPS="$STATE_DIR/captured-props.txt"
MATCHED_PROPS="$STATE_DIR/matched-props.txt"
MATCH_REPORT="$STATE_DIR/match-report.txt"
PROP_LOCK_LIST="$STATE_DIR/prop-lock.list"
CONFIG_SOURCE_FILE="$STATE_DIR/config-source.prop"
TRIGGER_REMATCH="$STATE_DIR/trigger-rematch"
PROTECTED_RULES_FILE="$MODDIR/webroot/data/rule-props.pack"
RULES_FILE="$STATE_DIR/rule-props.tsv"
RULES_DECODE_SCRIPT="$MODDIR/scripts/decode-rules.sh"
SERVICE_LOCK_DIR="$STATE_DIR/.service.lock"
CONFIG_LOCK_DIR="$STATE_DIR/.config.lock"
SERVICE_LOCK_TIMEOUT=20
SERVICE_LOCK_STALE_SECONDS=7200
SERVICE_BOOT_POST_DELAY=${DEX2OAT_BOOT_POST_DELAY:-3}
SERVICE_RUNTIME_SETTLE_WAIT=${DEX2OAT_RUNTIME_SETTLE_WAIT:-8}
SERVICE_RUNTIME_FINAL_WAIT=${DEX2OAT_RUNTIME_FINAL_WAIT:-12}

if [ -f "$MODDIR/core/state.sh" ]; then
  . "$MODDIR/core/state.sh"
fi
if [ -f "$MODDIR/core/common.sh" ]; then
  . "$MODDIR/core/common.sh"
fi

if ! mkdir -p "$LOG_DIR" 2>/dev/null; then
  LOG_FILE="$FALLBACK_LOG"
fi

rotate_log() {
  LOG_PATH="$1"
  MAX_SIZE="${2:-262144}"
  [ -f "$LOG_PATH" ] || return 0
  LOG_SIZE="$(wc -c < "$LOG_PATH" 2>/dev/null | tr -d ' ')"
  [ "${LOG_SIZE:-0}" -gt "$MAX_SIZE" ] || return 0
  mv -f "$LOG_PATH" "$LOG_PATH.1" 2>/dev/null || true
  : > "$LOG_PATH" 2>/dev/null || true
  chmod 0600 "$LOG_PATH" 2>/dev/null || true
}

log_msg() {
  rotate_log "$LOG_FILE"
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE" 2>/dev/null
}

prepare_runtime_rules() {
  [ -f "$RULES_DECODE_SCRIPT" ] || return 1
  [ -s "$PROTECTED_RULES_FILE" ] || return 1
  chmod 0755 "$RULES_DECODE_SCRIPT" 2>/dev/null || true
  sh "$RULES_DECODE_SCRIPT" "$PROTECTED_RULES_FILE" "$RULES_FILE" || return 1
  [ -s "$RULES_FILE" ] || return 1
  chmod 0600 "$RULES_FILE" 2>/dev/null || true
  return 0
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

acquire_service_lock() {
  mkdir -p "$STATE_DIR" 2>/dev/null || true
  LOCK_WAIT=0
  while ! mkdir "$SERVICE_LOCK_DIR" 2>/dev/null; do
    if ! service_lock_pid_alive; then
      log_msg "Removing stale service lock because owner pid is gone"
      rm -rf "$SERVICE_LOCK_DIR" 2>/dev/null || true
      continue
    fi
    LOCK_AGE="$(service_lock_age)"
    if [ "${LOCK_AGE:-0}" -gt "$SERVICE_LOCK_STALE_SECONDS" ] 2>/dev/null; then
      log_msg "Removing stale service lock age=${LOCK_AGE}s"
      rm -rf "$SERVICE_LOCK_DIR" 2>/dev/null || true
      continue
    fi
    if [ "$LOCK_WAIT" -ge "$SERVICE_LOCK_TIMEOUT" ] 2>/dev/null; then
      log_msg "Another service instance is running; skip duplicate invocation"
      exit 0
    fi
    sleep 1
    LOCK_WAIT=$((LOCK_WAIT + 1))
  done
  printf '%s\n' "$$" > "$SERVICE_LOCK_DIR/pid" 2>/dev/null || true
  service_lock_now > "$SERVICE_LOCK_DIR/created_at" 2>/dev/null || true
  trap 'release_service_lock' EXIT HUP INT TERM
}

acquire_service_lock

with_config_lock() {
  if command -v dex_with_lock >/dev/null 2>&1; then
    dex_with_lock "$CONFIG_LOCK_DIR" 20 "$@"
  else
    "$@"
  fi
}

restore_system_prop_from_backup_locked() {
  [ -s "$SYSTEM_PROP_BAK" ] || return 1
  cp -af "$SYSTEM_PROP_BAK" "$PROP_FILE" 2>/dev/null || return 1
  chmod 0644 "$PROP_FILE" 2>/dev/null || true
  return 0
}

restore_system_prop_from_backup() {
  with_config_lock restore_system_prop_from_backup_locked
}

write_prop_lock_list_locked() {
  [ -s "$PROP_FILE" ] || return 1
  : > "$PROP_LOCK_LIST" 2>/dev/null || return 1
  while IFS='=' read -r PROP_KEY PROP_VALUE; do
    PROP_KEY="$(printf '%s' "$PROP_KEY" | tr -d '\r' | sed 's/[[:space:]]*$//')"
    PROP_VALUE="$(printf '%s' "$PROP_VALUE" | tr -d '\r')"
    case "$PROP_KEY" in
      ""|\#*) continue ;;
    esac
    printf '%s=%s\n' "$PROP_KEY" "$PROP_VALUE" >> "$PROP_LOCK_LIST" 2>/dev/null || true
  done < "$PROP_FILE"
  chmod 0600 "$PROP_LOCK_LIST" 2>/dev/null || true
}

write_prop_lock_list() {
  with_config_lock write_prop_lock_list_locked
}

write_service_state() {
  STATE_STATUS="$1"
  STATE_PHASE="$2"
  STATE_REASON="$3"
  BOOT_ID="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)"
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
    printf 'updated_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
    [ "$STATE_STATUS" = "settled" ] && printf 'settled_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
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
      "service.updated_at=$(date '+%Y-%m-%d %H:%M:%S')" \
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
      "apply.last_updated_at=$(date '+%Y-%m-%d %H:%M:%S')" \
      "apply.updated_at=$(date '+%Y-%m-%d %H:%M:%S')" || true
    state_recompute_summary || true
  fi
}

run_trigger_rematch_locked() {
  [ -f "$TRIGGER_REMATCH" ] || return 0

  GENERATE_SCRIPT="$MODDIR/scripts/generate-props.sh"
  MODULE_VERSION="$(sed -n 's/^version=//p' "$MODDIR/module.prop" 2>/dev/null | head -n 1)"

  log_msg "Trigger rematch detected: rule-driven version=$MODULE_VERSION"
  if ! prepare_runtime_rules; then
    command -v state_update >/dev/null 2>&1 && state_update "match.status=failed" "match.reason=rules_decode_failed" "match.updated_at=$(date '+%Y-%m-%d %H:%M:%S')" || true
    command -v state_recompute_summary >/dev/null 2>&1 && state_recompute_summary || true
    log_msg "Trigger rematch failed; protected rules unavailable"
    rm -f "$TRIGGER_REMATCH" 2>/dev/null
    return 0
  fi
  sh "$MODDIR/scripts/capture-props.sh" "$CAPTURED_PROPS" "" "$RULES_FILE" || : > "$CAPTURED_PROPS"
  if sh "$GENERATE_SCRIPT" "$CAPTURED_PROPS" "$RULES_FILE" "$PROP_FILE" "$MATCHED_PROPS" "$MATCH_REPORT" "$CONFIG_SOURCE_FILE" "$MODULE_VERSION" "$ORIGINAL_PROPS"; then
    cp -af "$PROP_FILE" "$SYSTEM_PROP_BAK" 2>/dev/null || true
    chmod 0600 "$SYSTEM_PROP_BAK" 2>/dev/null || true
    rm -f "$RUNTIME_PROP_FILE" "$RUNTIME_PROP_HASH_FILE" 2>/dev/null || true
    write_prop_lock_list_locked || true
    command -v state_set_config_summary >/dev/null 2>&1 && state_set_config_summary "$PROP_FILE" auto-rules rematch || true
    command -v state_update >/dev/null 2>&1 && state_update \
      "match.status=$(sed -n 's/^status=//p' "$MATCH_REPORT" 2>/dev/null | head -n 1)" \
      "match.mode=rule-driven" \
      "match.reason=$(sed -n 's/^reason=//p' "$MATCH_REPORT" 2>/dev/null | head -n 1)" \
      "match.confidence=$(sed -n 's/^confidence=//p' "$MATCH_REPORT" 2>/dev/null | head -n 1)" \
      "match.matched_total=$(sed -n 's/^matched_total=//p' "$MATCH_REPORT" 2>/dev/null | head -n 1)" \
      "match.captured_total=$(sed -n 's/^captured_total=//p' "$MATCH_REPORT" 2>/dev/null | head -n 1)" \
      "match.default_total=$(sed -n 's/^default_total=//p' "$MATCH_REPORT" 2>/dev/null | head -n 1)" \
      "match.fallback_total=$(sed -n 's/^fallback_total=//p' "$MATCH_REPORT" 2>/dev/null | head -n 1)" \
      "match.unmatched_total=$(sed -n 's/^unmatched_total=//p' "$MATCH_REPORT" 2>/dev/null | head -n 1)" \
      "match.updated_at=$(date '+%Y-%m-%d %H:%M:%S')" || true
    command -v state_recompute_summary >/dev/null 2>&1 && state_recompute_summary || true
    [ -f "$MODDIR/core/conflict-detect.sh" ] && sh "$MODDIR/core/conflict-detect.sh" "$MODDIR" 2>/dev/null || true
    log_msg "Trigger rematch completed"
  else
    command -v state_update >/dev/null 2>&1 && state_update "match.status=failed" "match.reason=rematch_failed" "match.updated_at=$(date '+%Y-%m-%d %H:%M:%S')" || true
    command -v state_recompute_summary >/dev/null 2>&1 && state_recompute_summary || true
    log_msg "Trigger rematch failed; keeping current system.prop"
  fi
  rm -f "$TRIGGER_REMATCH" 2>/dev/null
}

run_trigger_rematch() {
  [ -f "$TRIGGER_REMATCH" ] || return 0
  if ! with_config_lock run_trigger_rematch_locked; then
    log_msg "Trigger rematch skipped or failed while waiting for config lock"
  fi
}

apply_prop() {
  PROP_KEY="$1"
  PROP_VALUE="$2"
  OLD_VALUE="$(getprop "$PROP_KEY")"
  APPLY_TOOL="setprop"

  if command -v resetprop >/dev/null 2>&1; then
    APPLY_TOOL="resetprop"
    resetprop -n "$PROP_KEY" "$PROP_VALUE" 2>/dev/null || {
      APPLY_TOOL="setprop-fallback"
      setprop "$PROP_KEY" "$PROP_VALUE" 2>/dev/null
    }
  else
    setprop "$PROP_KEY" "$PROP_VALUE" 2>/dev/null
  fi

  APPLY_CODE=$?
  NEW_VALUE="$(getprop "$PROP_KEY")"

  if [ "$APPLY_CODE" -ne 0 ]; then
    log_msg "Failed: phase=$APPLY_PHASE key=$PROP_KEY desired=$PROP_VALUE old=$OLD_VALUE new=$NEW_VALUE tool=$APPLY_TOOL code=$APPLY_CODE"
    return 1
  fi

  if [ "$NEW_VALUE" = "$PROP_VALUE" ]; then
    if [ "$OLD_VALUE" = "$PROP_VALUE" ]; then
      log_msg "Matched: phase=$APPLY_PHASE key=$PROP_KEY desired=$PROP_VALUE old=$OLD_VALUE new=$NEW_VALUE tool=$APPLY_TOOL code=$APPLY_CODE"
      return 3
    fi

    log_msg "Applied: phase=$APPLY_PHASE key=$PROP_KEY desired=$PROP_VALUE old=$OLD_VALUE new=$NEW_VALUE tool=$APPLY_TOOL code=$APPLY_CODE"
    return 0
  fi

  log_msg "Mismatch: phase=$APPLY_PHASE key=$PROP_KEY desired=$PROP_VALUE old=$OLD_VALUE new=$NEW_VALUE tool=$APPLY_TOOL code=$APPLY_CODE"
  return 2
}

is_runtime_prop() {
  case "$1" in
    ""|*[!A-Za-z0-9_.-]*|.*|*.) return 1 ;;
  esac

  if [ -s "$MATCHED_PROPS" ] && grep -F -q "$1=" "$MATCHED_PROPS" 2>/dev/null; then
    return 0
  fi
  if [ -s "$RULES_FILE" ] && awk -F "$(printf '\t')" -v key="$1" 'NR > 1 && $3 == key { found = 1; exit } END { exit found ? 0 : 1 }' "$RULES_FILE" 2>/dev/null; then
    return 0
  fi
  return 1
}

stop_service_if_running() {
  SERVICE_NAME="$1"
  SERVICE_STATE="$(getprop "init.svc.$SERVICE_NAME")"

  if [ "$SERVICE_STATE" = "running" ]; then
    stop "$SERVICE_NAME"
    if [ $? -eq 0 ]; then
      log_msg "Stopped service: $SERVICE_NAME"
    else
      log_msg "Failed to stop service: $SERVICE_NAME"
    fi
  else
    log_msg "Service already not running: $SERVICE_NAME ($SERVICE_STATE)"
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
    is_runtime_prop "$PROP_KEY" || continue
    PROP_VALUE="$(printf '%s' "$PROP_VALUE" | tr -d '\r')"
    printf '%s=%s\n' "$PROP_KEY" "$PROP_VALUE" >> "$RUNTIME_PROP_FILE" 2>/dev/null || true
  done < "$PROP_FILE"
  printf '%s\n' "$PROP_HASH" > "$RUNTIME_PROP_HASH_FILE" 2>/dev/null || true
  chmod 0600 "$RUNTIME_PROP_FILE" "$RUNTIME_PROP_HASH_FILE" 2>/dev/null || true
}

# 等待 Android 完成启动
apply_runtime_props() {
  APPLY_PHASE="$1"
  prepare_runtime_prop_file
  write_service_state running "$APPLY_PHASE"
  PHASE_PROP_COUNT=0
  PHASE_APPLIED_COUNT=0
  PHASE_MATCHED_COUNT=0
  PHASE_MISMATCH_COUNT=0
  PHASE_FAILED_COUNT=0
  log_msg "Runtime property apply pass started: phase=$APPLY_PHASE"

  while IFS='=' read -r PROP_KEY PROP_VALUE; do
    PROP_KEY="$(printf '%s' "$PROP_KEY" | tr -d '\r' | sed 's/[[:space:]]*$//')"
    PROP_VALUE="$(printf '%s' "$PROP_VALUE" | tr -d '\r')"

    case "$PROP_KEY" in
      ""|\#*)
        continue
        ;;
    esac

    if is_runtime_prop "$PROP_KEY"; then
      apply_prop "$PROP_KEY" "$PROP_VALUE"
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

  log_msg "Runtime property apply pass completed: phase=$APPLY_PHASE total=$PHASE_PROP_COUNT applied=$PHASE_APPLIED_COUNT matched=$PHASE_MATCHED_COUNT mismatch=$PHASE_MISMATCH_COUNT failed=$PHASE_FAILED_COUNT"
  write_service_state running "$APPLY_PHASE"
}

log_msg "Waiting for boot completed..."
write_service_state running boot-wait boot_wait
BOOT_WAIT=0
while [ "$(getprop sys.boot_completed)" != "1" ] && [ "$BOOT_WAIT" -lt 120 ]; do
  sleep 5
  BOOT_WAIT=$((BOOT_WAIT + 1))
done

if [ "$(getprop sys.boot_completed)" != "1" ]; then
  log_msg "Boot wait timed out after 600s, continuing anyway"
fi

BOOT_POST_WAIT=0
while [ "$BOOT_POST_WAIT" -lt "$SERVICE_BOOT_POST_DELAY" ]; do
  sleep 1
  BOOT_POST_WAIT=$((BOOT_POST_WAIT + 1))
done
log_msg "Boot completed, checking rule-driven state..."
run_trigger_rematch

if [ -f "$MODDIR/core/prop-lock.sh" ]; then
  sh "$MODDIR/core/prop-lock.sh" "$MODDIR" 2>/dev/null || true
fi

# 检查配置文件是否存在且非空，丢失时从 system.prop.bak 恢复
if [ ! -s "$PROP_FILE" ]; then
  log_msg "Warning: system.prop missing or empty at $PROP_FILE, trying restore from system.prop.bak"
  if restore_system_prop_from_backup; then
    log_msg "Restored system.prop from $SYSTEM_PROP_BAK"
  else
    log_msg "Error: system.prop restore failed"
    TOTAL_FAILED_COUNT=$((TOTAL_FAILED_COUNT + 1))
    write_service_state error missing-system-prop system_prop_missing
    exit 1
  fi
fi

if [ ! -s "$PROP_FILE" ]; then
  log_msg "Error: system.prop still missing or empty after restore"
  TOTAL_FAILED_COUNT=$((TOTAL_FAILED_COUNT + 1))
  write_service_state error missing-system-prop system_prop_missing
  exit 1
fi

# 补设被系统覆盖的运行时属性
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
  RUNTIME_FINAL_WAIT=0
  while [ "$RUNTIME_FINAL_WAIT" -lt "$SERVICE_RUNTIME_FINAL_WAIT" ]; do
    sleep 1
    RUNTIME_FINAL_WAIT=$((RUNTIME_FINAL_WAIT + 1))
  done
  apply_runtime_props settled
fi

write_service_state settled settled
log_msg "Runtime property apply completed. Total: $TOTAL_PROP_COUNT applied=$TOTAL_APPLIED_COUNT matched=$TOTAL_MATCHED_COUNT mismatch=$TOTAL_MISMATCH_COUNT failed=$TOTAL_FAILED_COUNT"
