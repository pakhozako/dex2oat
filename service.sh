#!/system/bin/sh

MODDIR=${0%/*}
STATE_DIR=/data/adb/dex2oat-lock
LOG_DIR="$STATE_DIR/logs"
LOG_FILE="$LOG_DIR/apply.log"
SERVICE_STATE="$STATE_DIR/service-state.prop"
FALLBACK_LOG=/data/adb/dex2oat-lock-apply.log
PROP_FILE="$MODDIR/system.prop"

if ! mkdir -p "$LOG_DIR" 2>/dev/null; then
  LOG_FILE="$FALLBACK_LOG"
fi

log_msg() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE" 2>/dev/null
}

write_service_state() {
  STATE_STATUS="$1"
  STATE_PHASE="$2"
  STATE_REASON="$3"
  BOOT_ID="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)"
  NOW="$(date '+%s')"
  STATE_HEALTH="ok"

  case "$STATE_STATUS" in
    error)
      STATE_HEALTH="problem"
      ;;
    skipped)
      STATE_HEALTH="skipped"
      ;;
    running)
      STATE_HEALTH="running"
      ;;
    *)
      if [ "${TOTAL_FAILED_COUNT:-0}" -gt 0 ] || [ "${TOTAL_MISMATCH_COUNT:-0}" -gt 0 ]; then
        STATE_HEALTH="problem"
      fi
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
    printf 'updated_at=%s\n' "$NOW"
    [ "$STATE_STATUS" = "settled" ] && printf 'settled_at=%s\n' "$NOW"
    [ -n "$BOOT_ID" ] && printf 'boot_id=%s\n' "$BOOT_ID"
  } > "$SERVICE_STATE" 2>/dev/null || true
  chmod 0600 "$SERVICE_STATE" 2>/dev/null || true
}

apply_prop() {
  PROP_KEY="$1"
  PROP_VALUE="$2"
  OLD_VALUE="$(getprop "$PROP_KEY")"
  APPLY_TOOL="setprop"

  if command -v resetprop >/dev/null 2>&1; then
    APPLY_TOOL="resetprop"
    resetprop -n "$PROP_KEY" "$PROP_VALUE"
  else
    setprop "$PROP_KEY" "$PROP_VALUE"
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
    pm.dexopt.*|\
    persist.sys.oplus.*|\
    persist.sys.feature.compile.*|\
    persist.device_config.runtime_native.*|\
    persist.device_config.runtime_native_boot.*|\
    persist.device_config.runtime.*|\
    persist.dalvik.vm.dex2oat-threads|\
    persist.oplus.*|\
    dalvik.vm.dex2oat-minidebuginfo|\
    dalvik.vm.minidebuginfo|\
    dalvik.vm.dex2oat-filter|\
    dalvik.vm.dex2oat-very-large|\
    dalvik.vm.dex2oat-resolve-startup-strings|\
    dalvik.vm.dex2oat-cpu-set|\
    dalvik.vm.boot-dex2oat-cpu-set|\
    dalvik.vm.background-dex2oat-cpu-set|\
    dalvik.vm.image-dex2oat-cpu-set|\
    dalvik.vm.dex2oat-Xms|\
    dalvik.vm.dex2oat-Xmx|\
    dalvik.vm.bg-dex2oat-threads|\
    dalvik.vm.image-dex2oat-threads|\
    dalvik.vm.boot-dex2oat-threads|\
    dalvik.vm.useartservice|\
    dalvik.vm.usejit|\
    dalvik.vm.enable_pr_dexopt|\
    dalvik.vm.pr_dexopt_async_for_ota|\
    dalvik.vm.dexopt.secondary|\
    dalvik.vm.dexopt.thermal-cutoff|\
    dalvik.vm.madvise.artfile.size|\
    dalvik.vm.madvise.odexfile.size|\
    dalvik.vm.madvise.vdexfile.size|\
    dalvik.vm.bgdexopt.*|\
    dalvik.vm.background-dex2oat-threads|\
    dalvik.vm.jitmaxsize|\
    dalvik.vm.ps-min-save-period-ms|\
    dalvik.vm.ps-min-first-save-ms|\
    system_perf_init.*|\
    ro.vendor.dex2oat*|\
    oplus.*|\
    sys.oplus.*|\
    sys.heap.*|\
    sys.furtherHeapEnlarge.optimize.enable|\
    sys.gcsupression.optimize.enable)
      return 0
      ;;
  esac

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

# 等待 Android 完成启动
apply_runtime_props() {
  APPLY_PHASE="$1"
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
  done < "$PROP_FILE"

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

sleep 10
log_msg "Boot completed, checking device..."

DEVICE_INFO="$(
  printf '%s %s %s %s' \
    "$(getprop ro.build.version.oplusrom)" \
    "$(getprop ro.oplus.version)" \
    "$(getprop ro.product.brand)" \
    "$(getprop ro.product.manufacturer)" |
    tr '[:upper:]' '[:lower:]'
)"

case "$DEVICE_INFO" in
  *coloros*|*oplus*|*oppo*|*oneplus*|*realme*)
    log_msg "Detected supported OPlus-family device: $DEVICE_INFO"
    ;;
  *)
    log_msg "Unsupported device: $DEVICE_INFO. Runtime properties were not applied."
    write_service_state skipped unsupported-device unsupported_device
    exit 0
    ;;
esac

# 检查配置文件是否存在
if [ ! -f "$PROP_FILE" ]; then
  log_msg "Error: system.prop not found at $PROP_FILE"
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

sleep 45
apply_runtime_props recheck

sleep 75
apply_runtime_props settled

write_service_state settled settled
log_msg "Runtime property apply completed. Total: $TOTAL_PROP_COUNT applied=$TOTAL_APPLIED_COUNT matched=$TOTAL_MATCHED_COUNT mismatch=$TOTAL_MISMATCH_COUNT failed=$TOTAL_FAILED_COUNT"
