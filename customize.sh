#!/system/bin/sh

STATE_DIR=/data/adb/dex2oat-lock
BACKUP_DIR="$STATE_DIR/backup"
LOG_DIR="$STATE_DIR/logs"
CONFIG_FILE="$STATE_DIR/config.json"
ORIGINAL_PROPS="$STATE_DIR/original-props.conf"
PROP_FILE="$MODPATH/system.prop"

ui_print "- Installing Dex2oat Lock"
ui_print "- Initializing ColorOS configuration"

mkdir -p "$BACKUP_DIR"
mkdir -p "$LOG_DIR"

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

set_perm_recursive "$MODPATH" 0 0 0755 0644
set_perm "$MODPATH/service.sh" 0 0 0755
set_perm "$MODPATH/customize.sh" 0 0 0755
set_perm "$MODPATH/uninstall.sh" 0 0 0755

chmod 0700 "$STATE_DIR"
chmod 0700 "$BACKUP_DIR"
chmod 0700 "$LOG_DIR"
chmod 0600 "$CONFIG_FILE"
chmod 0600 "$ORIGINAL_PROPS"

ui_print "- Safe profile enabled by default"
ui_print "- WebUI data directory: $STATE_DIR"
ui_print "- Installation completed"