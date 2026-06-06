#!/system/bin/sh

MODDIR=${0%/*}
STATE_DIR=/data/adb/dex2oat-lock
LOG_DIR="$STATE_DIR/logs"
LOG_FILE="$LOG_DIR/apply.log"
PROP_FILE="$MODDIR/system.prop"

mkdir -p "$LOG_DIR"

log_msg() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"
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
    persist.dalvik.vm.dex2oat-threads|\
    dalvik.vm.dex2oat-minidebuginfo|\
    dalvik.vm.minidebuginfo|\
    dalvik.vm.dex2oat-filter|\
    dalvik.vm.dex2oat-very-large|\
    dalvik.vm.dex2oat-resolve-startup-strings|\
    dalvik.vm.useartservice|\
    dalvik.vm.usejit|\
    dalvik.vm.enable_pr_dexopt|\
    dalvik.vm.pr_dexopt_async_for_ota|\
    dalvik.vm.dexopt.secondary|\
    dalvik.vm.dexopt.thermal-cutoff|\
    dalvik.vm.madvise.artfile.size|\
    dalvik.vm.bgdexopt.*|\
    dalvik.vm.background-dex2oat-threads|\
    dalvik.vm.jitmaxsize|\
    dalvik.vm.ps-min-save-period-ms|\
    system_perf_init.*|\
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
}

log_msg "Waiting for boot completed..."
while [ "$(getprop sys.boot_completed)" != "1" ]; do
  sleep 5
done

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
    exit 0
    ;;
esac

# 检查配置文件是否存在
if [ ! -f "$PROP_FILE" ]; then
  log_msg "Error: system.prop not found at $PROP_FILE"
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

log_msg "Runtime property apply completed. Total: $TOTAL_PROP_COUNT applied=$TOTAL_APPLIED_COUNT matched=$TOTAL_MATCHED_COUNT mismatch=$TOTAL_MISMATCH_COUNT failed=$TOTAL_FAILED_COUNT"
