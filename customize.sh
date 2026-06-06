#!/system/bin/sh

# Dex2oat Lock - Module Installer
# 仅在 ColorOS/OPlus 设备上生效

STATE_DIR=/data/adb/dex2oat-lock
BACKUP_DIR="$STATE_DIR/backup"
LOG_DIR="$STATE_DIR/logs"
INSTALL_LOG="$LOG_DIR/install.log"
FINAL_INSTALL_STATE=/data/adb/dex2oat-lock-install.prop
CONFIG_FILE="$STATE_DIR/config.json"
ORIGINAL_PROPS="$STATE_DIR/original-props.conf"
PROP_FILE="$MODPATH/system.prop"
INSTALL_STARTED=0
BACKUP_READY=0
STATE_CREATED=0

if ! command -v ui_print >/dev/null 2>&1; then
  ui_print() {
    printf '%s\n' "$*"
  }
fi

if ! command -v abort >/dev/null 2>&1; then
  abort() {
    ui_print "! $*"
    exit 1
  }
fi

if ! command -v set_perm >/dev/null 2>&1; then
  set_perm() {
    chown "$2:$3" "$1" 2>/dev/null
    chmod "$4" "$1" 2>/dev/null
  }
fi

log_install() {
  ui_print "$*"

  if [ "$INSTALL_STARTED" = "1" ]; then
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$INSTALL_LOG"
  fi
}

cleanup_partial_state() {
  if [ "$STATE_CREATED" = "1" ] && [ "$BACKUP_READY" != "1" ]; then
    rm -rf "$STATE_DIR"
  fi
}

write_install_state() {
  INSTALL_STATUS="$1"
  INSTALL_REASON="$2"
  NOW="$(date '+%s')"

  {
    printf 'status=%s\n' "$INSTALL_STATUS"
    [ -n "$INSTALL_REASON" ] && printf 'reason=%s\n' "$INSTALL_REASON"
    printf 'module_path=%s\n' "${MODPATH:-}"
    printf 'state_created=%s\n' "$STATE_CREATED"
    printf 'backup_ready=%s\n' "$BACKUP_READY"
    printf 'install_log=%s\n' "$INSTALL_LOG"
    printf 'updated_at=%s\n' "$NOW"
  } > "$FINAL_INSTALL_STATE" 2>/dev/null || true
  chmod 0600 "$FINAL_INSTALL_STATE" 2>/dev/null || true
}

fail_install() {
  log_install "! $*"
  write_install_state failed "$*"
  cleanup_partial_state
  abort "$*"
}

ui_print "- Installing Dex2oat Lock"
ui_print "- Checking device compatibility..."

if [ -z "$MODPATH" ]; then
  fail_install "MODPATH is not set. Install this zip from Magisk, KernelSU, or APatch manager."
fi

if [ ! -f "$PROP_FILE" ]; then
  fail_install "system.prop not found at $PROP_FILE"
fi

is_managed_prop() {
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

normalize_prop_line() {
  PROP_LINE="$(printf '%s' "$1" | tr -d '\r')"

  case "$PROP_LINE" in
    \#*)
      PROP_LINE="${PROP_LINE#\#}"
      ;;
  esac

  while :; do
    case "$PROP_LINE" in
      " "*)
        PROP_LINE="${PROP_LINE# }"
        ;;
      *)
        break
        ;;
    esac
  done

  printf '%s\n' "$PROP_LINE"
}

chmod_readable_tree() {
  TREE_PATH="$1"

  [ -d "$TREE_PATH" ] || return 0

  chmod 0755 "$TREE_PATH" || return 1
  find "$TREE_PATH" -type d -exec chmod 0755 {} \; 2>/dev/null || return 1
  find "$TREE_PATH" -type f -exec chmod 0644 {} \; 2>/dev/null || return 1
  return 0
}

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
    log_install "- Detected supported OPlus-family device"
    ;;
  *)
    log_install "! Unsupported device detected"
    log_install "! This module only works on ColorOS/OPlus devices"
    fail_install "Unsupported device"
    ;;
esac

log_install "- Initializing ColorOS configuration"

# 创建数据目录
mkdir -p "$BACKUP_DIR" || fail_install "Failed to create backup dir"
STATE_CREATED=1
mkdir -p "$LOG_DIR" || fail_install "Failed to create log dir"
INSTALL_STARTED=1
: > "$INSTALL_LOG"
log_install "- Installing Dex2oat Lock"
log_install "- Module path: $MODPATH"
log_install "- Device info: $DEVICE_INFO"

# 备份设备原始属性
if [ ! -f "$ORIGINAL_PROPS" ]; then
  : > "$ORIGINAL_PROPS" || fail_install "Failed to create original props backup"

  while IFS= read -r RAW_PROP_LINE; do
    PROP_LINE="$(normalize_prop_line "$RAW_PROP_LINE")"

    case "$PROP_LINE" in
      *=*)
        PROP_KEY="${PROP_LINE%%=*}"
        ;;
      *)
        continue
        ;;
    esac

    case "$PROP_KEY" in
      ""|\#*)
        continue
        ;;
    esac

    if is_managed_prop "$PROP_KEY" && ! grep -F -q "$PROP_KEY=" "$ORIGINAL_PROPS" && ! grep -F -q "@unset:$PROP_KEY" "$ORIGINAL_PROPS"; then
      CURRENT_VALUE="$(getprop "$PROP_KEY")"

      if [ -n "$CURRENT_VALUE" ]; then
        printf '%s=%s\n' "$PROP_KEY" "$CURRENT_VALUE" >> "$ORIGINAL_PROPS" || fail_install "Failed to write original props backup"
      else
        printf '@unset:%s\n' "$PROP_KEY" >> "$ORIGINAL_PROPS" || fail_install "Failed to write original props backup"
      fi
    fi
  done < "$PROP_FILE"
fi
BACKUP_READY=1

# 备份出厂配置
cp -af "$PROP_FILE" "$BACKUP_DIR/system.prop.factory" || fail_install "Failed to backup factory system.prop"

# 初始化 WebUI 配置
if [ ! -f "$CONFIG_FILE" ]; then
  cat > "$CONFIG_FILE" <<'EOF'
{
  "profile": "safe",
  "pendingReboot": false
}
EOF
  [ -f "$CONFIG_FILE" ] || fail_install "Failed to create WebUI config"
fi

touch "$LOG_DIR/apply.log" || fail_install "Failed to create apply log"

# 设置脚本权限（不包含 webroot，KernelSU 会自动处理）
chmod 0755 "$MODPATH" || fail_install "Failed to chmod module dir"
set_perm "$MODPATH/service.sh" 0 0 0755 || fail_install "Failed to set service.sh permission"
set_perm "$MODPATH/customize.sh" 0 0 0755 || fail_install "Failed to set customize.sh permission"
set_perm "$MODPATH/uninstall.sh" 0 0 0755 || fail_install "Failed to set uninstall.sh permission"
set_perm "$MODPATH/system.prop" 0 0 0644 || fail_install "Failed to set system.prop permission"
set_perm "$MODPATH/module.prop" 0 0 0644 || fail_install "Failed to set module.prop permission"
chmod_readable_tree "$MODPATH/webroot" || fail_install "Failed to set WebUI permissions"

# 设置数据目录权限
chmod 0700 "$STATE_DIR" || fail_install "Failed to chmod state dir"
chmod 0700 "$BACKUP_DIR" || fail_install "Failed to chmod backup dir"
chmod 0700 "$LOG_DIR" || fail_install "Failed to chmod log dir"
chmod 0600 "$CONFIG_FILE" || fail_install "Failed to chmod WebUI config"
chmod 0600 "$ORIGINAL_PROPS" || fail_install "Failed to chmod original props"
chmod 0600 "$INSTALL_LOG" || fail_install "Failed to chmod install log"

log_install "- Safe profile enabled by default"
log_install "- WebUI data directory: $STATE_DIR"
log_install "- Installation completed"
write_install_state ok installed
