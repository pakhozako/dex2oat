#!/system/bin/sh

STATE_DIR=/data/adb/dex2oat-lock
BACKUP_DIR="$STATE_DIR/backup"
LOG_DIR="$STATE_DIR/logs"
CONFIG_FILE="$STATE_DIR/config.json"
ORIGINAL_PROPS="$STATE_DIR/original-props.conf"
PROP_FILE="$MODPATH/system.prop"

ui_print "- Installing Dex2oat Lock"
ui_print "- Checking device compatibility..."

# 检查设备是否为 ColorOS/OPlus
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
    ui_print "- Detected supported OPlus-family device"
    ;;
  *)
    ui_print "! Unsupported device detected"
    ui_print "! This module only works on ColorOS/OPlus devices"
    ui_print "! Aborting installation"
    abort "Unsupported device"
    ;;
esac

ui_print "- Initializing ColorOS configuration"

# 创建目录
mkdir -p "$BACKUP_DIR" || { ui_print "! Failed to create backup dir"; abort; }
mkdir -p "$LOG_DIR" || { ui_print "! Failed to create log dir"; abort; }

# 备份设备原始属性
if [ ! -f "$ORIGINAL_PROPS" ]; then
  : > "$ORIGINAL_PROPS"

  while IFS='=' read -r PROP_KEY PROP_VALUE; do
    case "$PROP_KEY" in
      ""|\#*)
        continue
        ;;
      persist.*|oplus.*|sys.*)
        CURRENT_VALUE="$(getprop "$PROP_KEY")"

        if [ -n "$CURRENT_VALUE" ]; then
          printf '%s=%s\n' "$PROP_KEY" "$CURRENT_VALUE" >> "$ORIGINAL_PROPS"
        else
          printf '@unset:%s\n' "$PROP_KEY" >> "$ORIGINAL_PROPS"
        fi
        ;;
    esac
  done < "$PROP_FILE"
fi

# 备份出厂配置
cp -af "$PROP_FILE" "$BACKUP_DIR/system.prop.factory"

# 初始化 WebUI 配置
if [ ! -f "$CONFIG_FILE" ]; then
  cat > "$CONFIG_FILE" <<'EOF'
{
  "profile": "safe",
  "pendingReboot": false
}
EOF
fi

touch "$LOG_DIR/apply.log"

# 设置权限
set_perm_recursive "$MODPATH" 0 0 0755 0644
set_perm "$MODPATH/service.sh" 0 0 0755
set_perm "$MODPATH/customize.sh" 0 0 0755
set_perm "$MODPATH/uninstall.sh" 0 0 0755

# 设置数据目录权限（仅在文件存在时）
[ -d "$STATE_DIR" ] && chmod 0700 "$STATE_DIR"
[ -d "$BACKUP_DIR" ] && chmod 0700 "$BACKUP_DIR"
[ -d "$LOG_DIR" ] && chmod 0700 "$LOG_DIR"
[ -f "$CONFIG_FILE" ] && chmod 0600 "$CONFIG_FILE"
[ -f "$ORIGINAL_PROPS" ] && chmod 0600 "$ORIGINAL_PROPS"

ui_print "- Safe profile enabled by default"
ui_print "- WebUI data directory: $STATE_DIR"
ui_print "- Installation completed"
