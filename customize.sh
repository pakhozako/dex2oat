#!/system/bin/sh

STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
BACKUP_DIR="$STATE_DIR/backup"
LOG_DIR="$STATE_DIR/logs"
INSTALL_LOG="$STATE_DIR/install.log"
FINAL_INSTALL_STATE="$STATE_DIR/install-state.prop"
INSTALL_PROGRESS_FILE="$STATE_DIR/install-progress.prop"
CONFIG_SOURCE_FILE="$STATE_DIR/config-source.prop"
ORIGINAL_PROPS="$STATE_DIR/original-props.conf"
PROP_LOCK_LIST="$STATE_DIR/prop-lock.list"
STATE_FILE="$STATE_DIR/state.prop"
PROP_FILE="$MODPATH/system.prop"
SYSTEM_PROP_BAK="$STATE_DIR/system.prop.bak"
DEVICE_FILE="$STATE_DIR/device.prop"
CAPTURED_PROPS="$STATE_DIR/captured-props.txt"
MATCHED_PROPS="$STATE_DIR/matched-props.txt"
MATCH_REPORT="$STATE_DIR/match-report.txt"
RULES_PACK_FILE="$MODPATH/rules/rule-props.pack"
RULES_FILE="$STATE_DIR/rule-props.tsv"
RULES_DECODE_SCRIPT="$MODPATH/scripts/decode-rules.sh"
INSTALL_STARTED=0
BACKUP_READY=0
STATE_CREATED=0
INSTALL_SOURCE=auto-rules
MATCHED_TOTAL=0
INSTALL_PROGRESS_PERCENT=0
INSTALL_PROGRESS_STAGE=init
INSTALL_TOTAL_STAGES=15
INSTALL_BOOT_ID="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)"
INSTALL_CHECK_MODE=full

if ! command -v ui_print >/dev/null 2>&1; then
  ui_print() { printf '%s\n' "$*"; }
fi

if ! command -v abort >/dev/null 2>&1; then
  abort() { ui_print "! $*"; exit 1; }
fi

if ! command -v set_perm >/dev/null 2>&1; then
  set_perm() { chown "$2:$3" "$1" 2>/dev/null; chmod "$4" "$1" 2>/dev/null; }
fi

[ -n "$MODPATH" ] || abort "MODPATH 未设置"
[ -f "$PROP_FILE" ] || abort "未找到 system.prop: $PROP_FILE"

[ -f "$MODPATH/core/common.sh" ] && . "$MODPATH/core/common.sh"
[ -f "$MODPATH/core/property.sh" ] && . "$MODPATH/core/property.sh"
[ -f "$MODPATH/core/safety.sh" ] && . "$MODPATH/core/safety.sh"
[ -f "$MODPATH/core/state.sh" ] && . "$MODPATH/core/state.sh"


[ -f "$MODPATH/core/install-flow.sh" ] || abort "未找到安装流程"
. "$MODPATH/core/install-flow.sh"
install_flow_main
