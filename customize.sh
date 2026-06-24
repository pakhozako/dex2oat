#!/system/bin/sh

STATE_DIR=/data/adb/dex2oat-lock
BACKUP_DIR="$STATE_DIR/backup"
LOG_DIR="$STATE_DIR/logs"
INSTALL_LOG="$STATE_DIR/install.log"
FINAL_INSTALL_STATE=/data/adb/dex2oat-lock-install.prop
CONFIG_FILE="$STATE_DIR/config.json"
CONFIG_SOURCE_FILE="$STATE_DIR/config-source.prop"
ORIGINAL_PROPS="$STATE_DIR/original-props.conf"
PROP_LOCK_LIST="$STATE_DIR/prop-lock.list"
PROP_FILE="$MODPATH/system.prop"
SYSTEM_PROP_BAK="$STATE_DIR/system.prop.bak"
DEVICE_FILE="$STATE_DIR/device.prop"
CAPTURED_PROPS="$STATE_DIR/captured-props.txt"
MATCHED_PROPS="$STATE_DIR/matched-props.txt"
MATCH_REPORT="$STATE_DIR/match-report.txt"
CAPTURE_EXPORT=/storage/emulated/0/Download/dex2oat-captured-props.txt
INSTALL_STARTED=0
BACKUP_READY=0
STATE_CREATED=0
INSTALL_SOURCE=template
MATCHED_TOTAL=0

if ! command -v ui_print >/dev/null 2>&1; then
  ui_print() { printf '%s\n' "$*"; }
fi

if ! command -v abort >/dev/null 2>&1; then
  abort() { ui_print "! $*"; exit 1; }
fi

if ! command -v set_perm >/dev/null 2>&1; then
  set_perm() { chown "$2:$3" "$1" 2>/dev/null; chmod "$4" "$1" 2>/dev/null; }
fi

rotate_log() {
  LOG_PATH="$1"
  MAX_SIZE="${2:-131072}"
  [ -f "$LOG_PATH" ] || return 0
  LOG_SIZE="$(wc -c < "$LOG_PATH" 2>/dev/null | tr -d ' ')"
  [ "${LOG_SIZE:-0}" -gt "$MAX_SIZE" ] || return 0
  mv -f "$LOG_PATH" "$LOG_PATH.1" 2>/dev/null || true
  : > "$LOG_PATH" 2>/dev/null || true
  chmod 0600 "$LOG_PATH" 2>/dev/null || true
}

log_install() {
  ui_print "$*"
  if [ "$INSTALL_STARTED" = "1" ]; then
    rotate_log "$INSTALL_LOG"
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$INSTALL_LOG"
  fi
}

write_install_state() {
  INSTALL_STATUS="$1"
  INSTALL_REASON="$2"
  {
    printf 'status=%s\n' "$INSTALL_STATUS"
    [ -n "$INSTALL_REASON" ] && printf 'reason=%s\n' "$INSTALL_REASON"
    printf 'module_path=%s\n' "${MODPATH:-}"
    printf 'vendor=%s\n' "${DEVICE_VENDOR:-unknown}"
    printf 'source=%s\n' "${INSTALL_SOURCE:-unknown}"
    printf 'matched_total=%s\n' "${MATCHED_TOTAL:-0}"
    printf 'version=%s\n' "${MODULE_VERSION:-unknown}"
    printf 'updated_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  } > "$FINAL_INSTALL_STATE" 2>/dev/null || true
  chmod 0600 "$FINAL_INSTALL_STATE" 2>/dev/null || true
}

cleanup_partial_state() {
  if [ "$STATE_CREATED" = "1" ] && [ "$BACKUP_READY" != "1" ]; then
    rm -rf "$STATE_DIR"
  fi
}

fail_install() {
  log_install "! $*"
  write_install_state failed "$*"
  cleanup_partial_state
  abort "$*"
}

chooseport() {
  DELAY="${1:-3}"
  EVENT_FILE="${TMPDIR:-/dev}/dex2oat-events"
  while :; do
    : > "$EVENT_FILE" 2>/dev/null || true
    if command -v timeout >/dev/null 2>&1; then
      timeout "$DELAY" /system/bin/getevent -lqc 1 > "$EVENT_FILE" 2>&1 &
    else
      /system/bin/getevent -lqc 1 > "$EVENT_FILE" 2>&1 &
    fi
    sleep 0.5
    grep -q 'KEY_VOLUMEUP *DOWN' "$EVENT_FILE" 2>/dev/null && return 0
    grep -q 'KEY_VOLUMEDOWN *DOWN' "$EVENT_FILE" 2>/dev/null && return 1
  done
}

chooseport_once() {
  DELAY="${1:-10}"
  EVENT_FILE="${TMPDIR:-/dev}/dex2oat-events"
  if command -v timeout >/dev/null 2>&1; then
    : > "$EVENT_FILE" 2>/dev/null || true
    timeout "$DELAY" /system/bin/getevent -lqc 1 > "$EVENT_FILE" 2>&1
    grep -q 'KEY_VOLUMEUP *DOWN' "$EVENT_FILE" 2>/dev/null && return 0
    grep -q 'KEY_VOLUMEDOWN *DOWN' "$EVENT_FILE" 2>/dev/null && return 1
    return 2
  fi

  WAITED=0
  while [ "$WAITED" -lt "$DELAY" ]; do
    : > "$EVENT_FILE" 2>/dev/null || true
    /system/bin/getevent -lqc 1 > "$EVENT_FILE" 2>&1 &
    GETEVENT_PID=$!
    sleep 1
    WAITED=$((WAITED + 1))
    kill "$GETEVENT_PID" 2>/dev/null || true
    grep -q 'KEY_VOLUMEUP *DOWN' "$EVENT_FILE" 2>/dev/null && return 0
    grep -q 'KEY_VOLUMEDOWN *DOWN' "$EVENT_FILE" 2>/dev/null && return 1
  done
  return 2
}

show_prompt() {
  ui_print " "
  ui_print "║  $1"
  ui_print "║"
  ui_print "║  音量上键: 是"
  ui_print "║  音量下键: 否"
  ui_print "╚══════════════════════════════════════"
  chooseport
  return $?
}

show_prompt_timeout_no() {
  ui_print " "
  ui_print "║  $1"
  ui_print "║"
  ui_print "║  音量上键: 是"
  ui_print "║  音量下键: 否"
  ui_print "║  无响应: 默认否"
  ui_print "╚══════════════════════════════════════"
  chooseport_once 10
  [ "$?" = "0" ] && return 0
  return 1
}

chmod_readable_tree() {
  TREE_PATH="$1"
  [ -d "$TREE_PATH" ] || return 0
  chmod 0755 "$TREE_PATH" || return 1
  find "$TREE_PATH" -type d -exec chmod 0755 {} \; 2>/dev/null || return 1
  find "$TREE_PATH" -type f -exec chmod 0644 {} \; 2>/dev/null || return 1
  return 0
}

is_managed_prop() {
  case "$1" in
    pm.dexopt.*|persist.sys.oplus.*|persist.sys.feature.compile.*|persist.device_config.runtime_native.*|persist.device_config.runtime_native_boot.*|persist.device_config.runtime.*|persist.dalvik.vm.dex2oat-threads|persist.miui.*|persist.oplus.*|persist.sys.app_dexfile_preload.enable|persist.sys.art_startup_class_preload.enable|persist.sys.dexpreload.*|persist.sys.precache.enable|dalvik.vm.*|system_perf_init.*|ro.vendor.dex2oat*|oplus.*|sys.oplus.*|sys.heap.*|sys.furtherHeapEnlarge.optimize.enable|sys.gcsupression.optimize.enable)
      return 0 ;;
  esac
  return 1
}

normalize_prop_line() {
  PROP_LINE="$(printf '%s' "$1" | tr -d '\r')"
  case "$PROP_LINE" in \#*) PROP_LINE="${PROP_LINE#\#}" ;; esac
  while :; do
    case "$PROP_LINE" in " "*) PROP_LINE="${PROP_LINE# }" ;; *) break ;; esac
  done
  printf '%s\n' "$PROP_LINE"
}

write_device_prop() {
  {
    printf 'ro.product.model=%s\n' "$(getprop ro.product.model)"
    printf 'ro.product.manufacturer=%s\n' "$(getprop ro.product.manufacturer)"
    printf 'ro.build.version.release=%s\n' "$(getprop ro.build.version.release)"
    printf 'ro.build.version.sdk=%s\n' "$(getprop ro.build.version.sdk)"
    printf 'vendor=%s\n' "$DEVICE_VENDOR"
    printf 'detected_vendor=%s\n' "$DEVICE_VENDOR"
    printf 'detected_source=%s\n' "${DEVICE_DETECT_SOURCE:-unknown}"
    printf 'detected_value=%s\n' "${DEVICE_DETECT_VALUE:-}"
    printf 'label=%s\n' "$DEVICE_LABEL"
  } > "$DEVICE_FILE" 2>/dev/null || fail_install "Failed to write device.prop"
}

map_vendor() {
  DETECT_SOURCE="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$DETECT_SOURCE" in
    *coloros*|*oplus*|*oppo*|*oneplus*|*realme*) DEVICE_VENDOR=oplus; DEVICE_LABEL="OPlus-family" ;;
    *xiaomi*|*redmi*|*poco*|*miui*|*hyperos*) DEVICE_VENDOR=miui; DEVICE_LABEL="MIUI-family" ;;
    *samsung*) DEVICE_VENDOR=samsung; DEVICE_LABEL="Samsung" ;;
    *google*|*pixel*) DEVICE_VENDOR=pixel; DEVICE_LABEL="Pixel" ;;
    *meizu*) DEVICE_VENDOR=meizu; DEVICE_LABEL="Meizu" ;;
    *redmagic*|*nubia*) DEVICE_VENDOR=redmagic; DEVICE_LABEL="RedMagic" ;;
    *) return 1 ;;
  esac
  return 0
}

detect_vendor() {
  DEVICE_VENDOR=generic
  DEVICE_LABEL="Generic"
  DEVICE_DETECT_SOURCE=generic
  DEVICE_DETECT_VALUE=""

  DETECT_VALUE="$(getprop ro.product.manufacturer)"
  if map_vendor "$DETECT_VALUE"; then
    DEVICE_DETECT_SOURCE=ro.product.manufacturer
    DEVICE_DETECT_VALUE="$DETECT_VALUE"
  else
    DETECT_VALUE="$(getprop ro.product.brand)"
    if map_vendor "$DETECT_VALUE"; then
      DEVICE_DETECT_SOURCE=ro.product.brand
      DEVICE_DETECT_VALUE="$DETECT_VALUE"
    else
      DETECT_VALUE="$(getprop ro.product.system.manufacturer)"
      if map_vendor "$DETECT_VALUE"; then
        DEVICE_DETECT_SOURCE=ro.product.system.manufacturer
        DEVICE_DETECT_VALUE="$DETECT_VALUE"
      fi
    fi
  fi

  VENDOR_PROP_TEMPLATE="$MODPATH/vendor/$DEVICE_VENDOR.prop"
  if [ ! -f "$VENDOR_PROP_TEMPLATE" ]; then
    if [ -f "$MODPATH/props/$DEVICE_VENDOR.prop" ]; then
      VENDOR_PROP_TEMPLATE="$MODPATH/props/$DEVICE_VENDOR.prop"
    else
      DEVICE_VENDOR=generic
      DEVICE_LABEL="Generic"
      DEVICE_DETECT_SOURCE=template-fallback
      VENDOR_PROP_TEMPLATE="$MODPATH/vendor/generic.prop"
    fi
  fi
}

options_file_for_vendor() {
  case "$1" in
    xiaomi|miui) printf '%s\n' "$MODPATH/webroot/data/options-xiaomi.json" ;;
    samsung) printf '%s\n' "$MODPATH/webroot/data/options-samsung.json" ;;
    pixel) printf '%s\n' "$MODPATH/webroot/data/options-pixel.json" ;;
    meizu|redmagic|generic) printf '%s\n' "$MODPATH/webroot/data/options-generic.json" ;;
    *) printf '%s\n' "$MODPATH/webroot/data/options.json" ;;
  esac
}

write_config_source() {
  SOURCE_MODE="$1"
  SOURCE_REASON="$2"
  {
    printf 'source=%s\n' "$SOURCE_MODE"
    printf 'vendor=%s\n' "$DEVICE_VENDOR"
    printf 'version=%s\n' "$MODULE_VERSION"
    printf 'matched_total=%s\n' "${MATCHED_TOTAL:-0}"
    [ -n "$SOURCE_REASON" ] && printf 'reason=%s\n' "$SOURCE_REASON"
    printf 'updated_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  } > "$CONFIG_SOURCE_FILE" 2>/dev/null || true
  chmod 0600 "$CONFIG_SOURCE_FILE" 2>/dev/null || true
}

append_install_log() {
  {
    printf '%s\n' '--- install ---'
    printf 'time=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
    printf 'vendor=%s\n' "${DEVICE_VENDOR:-unknown}"
    printf 'source=%s\n' "${INSTALL_SOURCE:-unknown}"
    printf 'matched_total=%s\n' "${MATCHED_TOTAL:-0}"
    printf 'version=%s\n' "${MODULE_VERSION:-unknown}"
  } >> "$INSTALL_LOG" 2>/dev/null || true
}

backup_original_props() {
  : > "$ORIGINAL_PROPS" || fail_install "Failed to create original-props.conf"
  while IFS= read -r RAW_PROP_LINE; do
    PROP_LINE="$(normalize_prop_line "$RAW_PROP_LINE")"
    case "$PROP_LINE" in *=*) PROP_KEY="${PROP_LINE%%=*}" ;; *) continue ;; esac
    [ -z "$PROP_KEY" ] && continue
    if is_managed_prop "$PROP_KEY" && ! grep -F -q "$PROP_KEY=" "$ORIGINAL_PROPS" && ! grep -F -q "@unset:$PROP_KEY" "$ORIGINAL_PROPS"; then
      CURRENT_VALUE="$(getprop "$PROP_KEY")"
      if [ -n "$CURRENT_VALUE" ]; then
        printf '%s=%s\n' "$PROP_KEY" "$CURRENT_VALUE" >> "$ORIGINAL_PROPS" || fail_install "Failed to write original prop backup"
      else
        printf '@unset:%s\n' "$PROP_KEY" >> "$ORIGINAL_PROPS" || fail_install "Failed to write original prop backup"
      fi
    fi
  done < "$VENDOR_PROP_TEMPLATE"
}

use_vendor_template() {
  REASON="$1"
  cp -af "$VENDOR_PROP_TEMPLATE" "$PROP_FILE" || fail_install "Failed to copy vendor template"
  INSTALL_SOURCE="$2"
  [ -n "$INSTALL_SOURCE" ] || INSTALL_SOURCE=template
  MATCHED_TOTAL=0
  write_config_source "$INSTALL_SOURCE" "$REASON"
}

run_dex2oat_match() {
  CAPTURE_SCRIPT="$MODPATH/scripts/capture-props.sh"
  MATCH_SCRIPT="$MODPATH/scripts/match-props.sh"
  OPTIONS_FILE="$(options_file_for_vendor "$DEVICE_VENDOR")"

  [ -f "$CAPTURE_SCRIPT" ] || return 10
  [ -f "$MATCH_SCRIPT" ] || return 11
  chmod 0755 "$CAPTURE_SCRIPT" "$MATCH_SCRIPT" 2>/dev/null || true

  sh "$CAPTURE_SCRIPT" "$CAPTURED_PROPS" "$CAPTURE_EXPORT" || return 12
  sh "$MATCH_SCRIPT" "$CAPTURED_PROPS" "$OPTIONS_FILE" "$VENDOR_PROP_TEMPLATE" "$PROP_FILE" "$MATCHED_PROPS" "$MATCH_REPORT" "$CONFIG_SOURCE_FILE" "$DEVICE_VENDOR" "$MODULE_VERSION" "$ORIGINAL_PROPS" || return $?

  MATCHED_TOTAL="$(sed -n 's/^matched_total=//p' "$MATCH_REPORT" 2>/dev/null | head -n 1)"
  [ -n "$MATCHED_TOTAL" ] || MATCHED_TOTAL=0
  INSTALL_SOURCE=dex2oat-match
  return 0
}

init_webui_config() {
  if [ ! -f "$CONFIG_FILE" ]; then
    cat > "$CONFIG_FILE" <<'EOF'
{
  "profile": "safe",
  "pendingReboot": false
}
EOF
  fi
  [ -f "$CONFIG_FILE" ] || fail_install "Failed to create WebUI config"
}

write_prop_lock_list() {
  : > "$PROP_LOCK_LIST" 2>/dev/null || return 0
  while IFS='=' read -r PROP_KEY PROP_VALUE; do
    PROP_KEY="$(printf '%s' "$PROP_KEY" | tr -d '\r' | sed 's/[[:space:]]*$//')"
    PROP_VALUE="$(printf '%s' "$PROP_VALUE" | tr -d '\r')"
    case "$PROP_KEY" in
      ""|\#*) continue ;;
    esac
    printf '%s=%s\n' "$PROP_KEY" "$PROP_VALUE" >> "$PROP_LOCK_LIST" 2>/dev/null || true
  done < "$PROP_FILE"
}

ui_print "- Installing Dex2oat Lock"

[ -n "$MODPATH" ] || fail_install "MODPATH is not set"
[ -f "$PROP_FILE" ] || fail_install "system.prop not found at $PROP_FILE"

MODULE_VERSION="$(sed -n 's/^version=//p' "$MODPATH/module.prop" 2>/dev/null | head -n 1)"
[ -n "$MODULE_VERSION" ] || MODULE_VERSION=unknown

mkdir -p "$STATE_DIR" "$BACKUP_DIR" "$LOG_DIR" || fail_install "Failed to create state dirs"
STATE_CREATED=1
INSTALL_STARTED=1
touch "$INSTALL_LOG" || fail_install "Failed to create install.log"

detect_vendor
[ -f "$VENDOR_PROP_TEMPLATE" ] || VENDOR_PROP_TEMPLATE="$MODPATH/vendor/generic.prop"
[ -f "$VENDOR_PROP_TEMPLATE" ] || fail_install "generic.prop not found"

write_device_prop
backup_original_props
BACKUP_READY=1

EXISTING_SOURCE="$(sed -n 's/^source=//p' "$CONFIG_SOURCE_FILE" 2>/dev/null | head -n 1)"
SKIP_CONFIG_GENERATION=0
if [ "$EXISTING_SOURCE" = "webui-custom" ] && [ -s "$PROP_FILE" ]; then
  if ! show_prompt_timeout_no "检测到 WebUI 自定义配置，是否覆盖并重新匹配？"; then
    INSTALL_SOURCE=webui-custom
    MATCHED_TOTAL="$(sed -n 's/^matched_total=//p' "$CONFIG_SOURCE_FILE" 2>/dev/null | head -n 1)"
    [ -n "$MATCHED_TOTAL" ] || MATCHED_TOTAL=0
    write_config_source webui-custom preserved
    SKIP_CONFIG_GENERATION=1
  fi
fi

if [ "$SKIP_CONFIG_GENERATION" != "1" ]; then
  if show_prompt "是否执行 dex2oat 属性抓取并自动匹配配置？"; then
    if run_dex2oat_match; then
      write_config_source dex2oat-match matched
    else
      MATCH_STATUS=$?
      use_vendor_template "match_failed_$MATCH_STATUS" template-fallback
    fi
  else
    use_vendor_template user_skipped template
  fi
fi

write_prop_lock_list
cp -af "$PROP_FILE" "$BACKUP_DIR/system.prop.factory" 2>/dev/null || true
cp -af "$PROP_FILE" "$SYSTEM_PROP_BAK" 2>/dev/null || true
init_webui_config
touch "$STATE_DIR/service.log" 2>/dev/null || true
append_install_log

if [ -f "$MODPATH/core/conflict-detect.sh" ]; then
  sh "$MODPATH/core/conflict-detect.sh" "$MODPATH" 2>/dev/null || true
fi

chmod 0755 "$MODPATH" || fail_install "Failed to chmod module dir"
set_perm "$MODPATH/service.sh" 0 0 0755 || fail_install "Failed to chmod service.sh"
set_perm "$MODPATH/customize.sh" 0 0 0755 || fail_install "Failed to chmod customize.sh"
set_perm "$MODPATH/uninstall.sh" 0 0 0755 || fail_install "Failed to chmod uninstall.sh"
set_perm "$MODPATH/system.prop" 0 0 0644 || fail_install "Failed to chmod system.prop"
set_perm "$MODPATH/module.prop" 0 0 0644 || fail_install "Failed to chmod module.prop"
chmod_readable_tree "$MODPATH/props" || fail_install "Failed to chmod props"
chmod_readable_tree "$MODPATH/vendor" || fail_install "Failed to chmod vendor"
chmod_readable_tree "$MODPATH/scripts" || fail_install "Failed to chmod scripts"
chmod_readable_tree "$MODPATH/core" || fail_install "Failed to chmod core"

chmod 0700 "$STATE_DIR" "$BACKUP_DIR" "$LOG_DIR" 2>/dev/null || true
chmod 0600 "$CONFIG_FILE" "$CONFIG_SOURCE_FILE" "$DEVICE_FILE" "$ORIGINAL_PROPS" "$SYSTEM_PROP_BAK" "$INSTALL_LOG" "$CAPTURED_PROPS" "$MATCHED_PROPS" "$MATCH_REPORT" "$PROP_LOCK_LIST" 2>/dev/null || true

log_install "- Installation completed: vendor=$DEVICE_VENDOR source=$INSTALL_SOURCE matched=$MATCHED_TOTAL version=$MODULE_VERSION"
write_install_state ok installed
