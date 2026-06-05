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

  if command -v resetprop >/dev/null 2>&1; then
    resetprop -n "$PROP_KEY" "$PROP_VALUE"
  else
    setprop "$PROP_KEY" "$PROP_VALUE"
  fi

  if [ $? -eq 0 ]; then
    log_msg "Applied: $PROP_KEY=$PROP_VALUE"
  else
    log_msg "Failed: $PROP_KEY=$PROP_VALUE"
  fi
}

# 等待 Android 完成启动
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
PROP_COUNT=0
while IFS='=' read -r PROP_KEY PROP_VALUE; do
  case "$PROP_KEY" in
    ""|\#*)
      continue
      ;;
    persist.sys.oplus.*|\
    persist.sys.feature.compile.*|\
    persist.device_config.runtime_native.*|\
    persist.device_config.runtime_native_boot.*|\
    oplus.*|\
    sys.oplus.*|\
    sys.heap.*)
      apply_prop "$PROP_KEY" "$PROP_VALUE"
      PROP_COUNT=$((PROP_COUNT + 1))
      ;;
  esac
done < "$PROP_FILE"

log_msg "Runtime property apply completed. Total: $PROP_COUNT properties applied."
