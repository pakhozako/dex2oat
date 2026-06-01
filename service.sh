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

  log_msg "Applied: $PROP_KEY=$PROP_VALUE"
}

# 等待 Android 完成启动
while [ "$(getprop sys.boot_completed)" != "1" ]; do
  sleep 5
done

sleep 10

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
    log_msg "Detected supported OPlus-family device."
    ;;
  *)
    log_msg "Unsupported device. Runtime properties were not applied."
    exit 0
    ;;
esac

# 补设被系统覆盖的运行时属性
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
      ;;
  esac
done < "$PROP_FILE"

log_msg "Runtime property apply completed."