#!/system/bin/sh

STATE_DIR=/data/adb/dex2oat-lock
BACKUP_DIR="$STATE_DIR/backup"
LOG_DIR="$STATE_DIR/logs"
INSTALL_LOG="$STATE_DIR/install.log"
FINAL_INSTALL_STATE=/data/adb/dex2oat-lock-install.prop
INSTALL_PROGRESS_FILE="$STATE_DIR/install-progress.prop"
CONFIG_FILE="$STATE_DIR/config.json"
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
RULES_FILE="$MODPATH/webroot/data/rule-props.tsv"
INSTALL_STARTED=0
BACKUP_READY=0
STATE_CREATED=0
INSTALL_SOURCE=auto-rules
MATCHED_TOTAL=0
INSTALL_PROGRESS_PERCENT=0
INSTALL_PROGRESS_STAGE=init
INSTALL_TOTAL_STAGES=15

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

install_progress_bar() {
  BAR_PERCENT="$1"
  case "$BAR_PERCENT" in ''|*[!0-9]*) BAR_PERCENT=0 ;; esac
  [ "$BAR_PERCENT" -lt 0 ] 2>/dev/null && BAR_PERCENT=0
  [ "$BAR_PERCENT" -gt 100 ] 2>/dev/null && BAR_PERCENT=100
  BAR_FILLED=$((BAR_PERCENT / 4))
  BAR_INDEX=0
  BAR_TEXT=""
  while [ "$BAR_INDEX" -lt 25 ]; do
    if [ "$BAR_INDEX" -lt "$BAR_FILLED" ]; then
      BAR_TEXT="${BAR_TEXT}▰"
    else
      BAR_TEXT="${BAR_TEXT}▱"
    fi
    BAR_INDEX=$((BAR_INDEX + 1))
  done
  printf '%s' "$BAR_TEXT"
}

install_stage_label() {
  case "$1" in
    init) printf 'INIT' ;;
    environment) printf 'ENV' ;;
    prepare) printf 'PREP' ;;
    device) printf 'DEVICE' ;;
    backup) printf 'BACKUP' ;;
    capture) printf 'CAPTURE' ;;
    match) printf 'MATCH' ;;
    system_prop) printf 'PROP' ;;
    lock) printf 'LOCK' ;;
    conflict) printf 'CONFLICT' ;;
    health) printf 'HEALTH' ;;
    integrity) printf 'CHECK' ;;
    permissions) printf 'PERM' ;;
    state) printf 'STATE' ;;
    complete) printf 'DONE' ;;
    failed) printf 'FAIL' ;;
    *) printf '%s' "$1" | tr '[:lower:]' '[:upper:]' ;;
  esac
}

install_stage_index() {
  case "$1" in
    init) printf '01' ;;
    environment) printf '02' ;;
    prepare) printf '03' ;;
    device) printf '04' ;;
    backup) printf '05' ;;
    capture) printf '06' ;;
    match) printf '07' ;;
    system_prop) printf '08' ;;
    lock) printf '09' ;;
    conflict) printf '10' ;;
    health) printf '11' ;;
    integrity) printf '12' ;;
    permissions) printf '13' ;;
    state) printf '14' ;;
    complete) printf '15' ;;
    failed) printf '!!' ;;
    *) printf '--' ;;
  esac
}

install_stage_title() {
  case "$1" in
    init) printf '初始化安装上下文' ;;
    environment) printf '读取模块环境' ;;
    prepare) printf '准备数据目录' ;;
    device) printf '记录设备摘要' ;;
    backup) printf '备份原始属性' ;;
    capture) printf '抓取运行时属性' ;;
    match) printf '生成规则配置' ;;
    system_prop) printf '同步 system.prop' ;;
    lock) printf '生成锁定快照' ;;
    conflict) printf '冲突检测' ;;
    health) printf '健康摘要' ;;
    integrity) printf '完整性校验' ;;
    permissions) printf '权限整理' ;;
    state) printf '写入最终状态' ;;
    complete) printf '安装完成' ;;
    failed) printf '安装失败' ;;
    *) printf '%s' "$1" ;;
  esac
}

install_stage_detail() {
  case "$1" in
    init) printf '建立安装上下文，准备状态写入' ;;
    environment) printf '读取模块版本、Root 环境和安装路径' ;;
    prepare) printf '创建日志、备份和状态目录' ;;
    device) printf '记录设备型号、系统版本和 Root 框架' ;;
    backup) printf '备份当前 system.prop 与原始属性状态' ;;
    capture) printf '抓取 ART / dexopt / runtime 相关属性' ;;
    match) printf '读取规则表，匹配当前设备' ;;
    system_prop) printf '写入 system.prop，并生成匹配摘要' ;;
    lock) printf '生成运行时锁定快照，便于开机校验' ;;
    conflict) printf '扫描可能冲突的模块和属性写入' ;;
    health) printf '初始化健康检查摘要，供 WebUI 展示' ;;
    integrity) printf '校验核心脚本和受保护 WebUI 资源' ;;
    permissions) printf '设置脚本、WebUI 和状态文件权限' ;;
    state) printf '写入最终安装状态和 WebUI 进度' ;;
    complete) printf '可以重启后进入 WebUI 查看运行状态' ;;
    failed) printf '已写入失败状态，可查看日志定位原因' ;;
    *) printf '%s' "$1" ;;
  esac
}

install_stage_wait_hint() {
  case "$1" in
    capture) printf '读取设备属性，低端设备可能需要几秒' ;;
    match) printf '匹配规则并生成输出' ;;
    conflict) printf '扫描其它模块，最多等待 8 秒' ;;
    health) printf '汇总健康状态，稍后写入 WebUI 首页' ;;
    integrity) printf '核对核心文件和受保护 WebUI' ;;
    permissions) printf '整理权限，避免 WebUI 或脚本不可读' ;;
    *) printf '阶段处理中，请保持安装窗口打开' ;;
  esac
}

install_spinner_frame() {
  SPINNER_STEP="$1"
  case "$SPINNER_STEP" in ''|*[!0-9]*) SPINNER_STEP=0 ;; esac
  case $((SPINNER_STEP % 4)) in
    0) printf '◐' ;;
    1) printf '◓' ;;
    2) printf '◑' ;;
    *) printf '◒' ;;
  esac
}

install_motion_line() {
  install_spinner_frame "$INSTALL_PROGRESS_PERCENT"
}

install_progress_flow() {
  FLOW_PERCENT="$1"
  FLOW_STATUS="$2"
  case "$FLOW_PERCENT" in ''|*[!0-9]*) FLOW_PERCENT=0 ;; esac
  [ "$FLOW_PERCENT" -lt 0 ] 2>/dev/null && FLOW_PERCENT=0
  [ "$FLOW_PERCENT" -gt 100 ] 2>/dev/null && FLOW_PERCENT=100
  FLOW_ACTIVE=$((FLOW_PERCENT / 8))
  [ "$FLOW_ACTIVE" -gt 12 ] 2>/dev/null && FLOW_ACTIVE=12
  FLOW_INDEX=0
  FLOW_TEXT=""
  while [ "$FLOW_INDEX" -lt 13 ]; do
    if [ "$FLOW_STATUS" = "failed" ]; then
      if [ "$FLOW_INDEX" -lt "$FLOW_ACTIVE" ]; then
        FLOW_TEXT="${FLOW_TEXT}◆"
      elif [ "$FLOW_INDEX" -eq "$FLOW_ACTIVE" ] 2>/dev/null; then
        FLOW_TEXT="${FLOW_TEXT}×"
      else
        FLOW_TEXT="${FLOW_TEXT}·"
      fi
    elif [ "$FLOW_STATUS" = "running" ]; then
      if [ "$FLOW_INDEX" -lt "$FLOW_ACTIVE" ]; then
        FLOW_TEXT="${FLOW_TEXT}◆"
      elif [ "$FLOW_INDEX" -eq "$FLOW_ACTIVE" ] 2>/dev/null; then
        FLOW_TEXT="${FLOW_TEXT}◉"
      else
        FLOW_TEXT="${FLOW_TEXT}·"
      fi
    else
      if [ "$FLOW_INDEX" -le "$FLOW_ACTIVE" ] 2>/dev/null; then
        FLOW_TEXT="${FLOW_TEXT}◆"
      else
        FLOW_TEXT="${FLOW_TEXT}·"
      fi
    fi
    FLOW_INDEX=$((FLOW_INDEX + 1))
  done
  printf '%s' "$FLOW_TEXT"
}

install_banner() {
  ui_print " " 
  ui_print "╭──────────────────────────────────────╮"
  ui_print "│ Dex2oat Lock ${MODULE_VERSION:-v3.6}"
  ui_print "│ Rule-driven ART / dexopt tuning"
  ui_print "│ Protected WebUI + unified state"
  ui_print "╰──────────────────────────────────────╯"
}

install_purpose_prompt() {
  ui_print " "
  ui_print "╭─ 模块作用"
  ui_print "│ 根据设备属性生成 ART / dexopt 配置。"
  ui_print "│ 目标是减少后台编译负载，并统一展示运行状态。"
  ui_print "│ 安装后重启生效，可在模块 WebUI 查看和调整配置。"
  ui_print "│"
  ui_print "│ 确认是否安装：音量上继续，音量下取消。"
  ui_print "╰─ 无响应将默认继续安装"
  chooseport_once 8
  [ "$?" = "1" ] && return 1
  return 0
}

install_progress() {
  INSTALL_PROGRESS_PERCENT="$1"
  INSTALL_PROGRESS_STAGE="$2"
  INSTALL_PROGRESS_MESSAGE="$3"
  INSTALL_PROGRESS_STATUS="${4:-running}"
  INSTALL_PROGRESS_BAR="$(install_progress_bar "$INSTALL_PROGRESS_PERCENT")"
  INSTALL_PROGRESS_LABEL="$(install_stage_label "$INSTALL_PROGRESS_STAGE")"
  INSTALL_PROGRESS_INDEX="$(install_stage_index "$INSTALL_PROGRESS_STAGE")"
  INSTALL_PROGRESS_TITLE="$(install_stage_title "$INSTALL_PROGRESS_STAGE")"
  INSTALL_PROGRESS_DETAIL="$(install_stage_detail "$INSTALL_PROGRESS_STAGE")"
  INSTALL_PROGRESS_FLOW="$(install_progress_flow "$INSTALL_PROGRESS_PERCENT" "$INSTALL_PROGRESS_STATUS")"
  if [ "$INSTALL_PROGRESS_STATUS" = "running" ]; then
    INSTALL_PROGRESS_MARK="$(install_motion_line)"
    INSTALL_PROGRESS_HINT="$(install_stage_wait_hint "$INSTALL_PROGRESS_STAGE")"
  elif [ "$INSTALL_PROGRESS_STATUS" = "failed" ]; then
    INSTALL_PROGRESS_MARK="✕"
    INSTALL_PROGRESS_HINT="$INSTALL_PROGRESS_DETAIL"
  else
    INSTALL_PROGRESS_MARK="✓"
    INSTALL_PROGRESS_HINT="$INSTALL_PROGRESS_DETAIL"
  fi
  ui_print " " 
  ui_print "╭─ ${INSTALL_PROGRESS_INDEX}/${INSTALL_TOTAL_STAGES}  $INSTALL_PROGRESS_TITLE"
  ui_print "│ ${INSTALL_PROGRESS_MARK} $INSTALL_PROGRESS_MESSAGE"
  ui_print "│ ${INSTALL_PROGRESS_BAR}  ${INSTALL_PROGRESS_PERCENT}% · ${INSTALL_PROGRESS_LABEL}"
  ui_print "│ flow ${INSTALL_PROGRESS_FLOW}"
  ui_print "╰─ $INSTALL_PROGRESS_HINT"
  if [ "$INSTALL_STARTED" = "1" ]; then
    rotate_log "$INSTALL_LOG"
    printf '%s [%s%%] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$INSTALL_PROGRESS_PERCENT" "$INSTALL_PROGRESS_MESSAGE" >> "$INSTALL_LOG"
  fi
  if command -v state_set_install_progress >/dev/null 2>&1; then
    state_set_install_progress "$INSTALL_PROGRESS_PERCENT" "$INSTALL_PROGRESS_STAGE" "$INSTALL_PROGRESS_STATUS" "$INSTALL_PROGRESS_MESSAGE" || true
  else
    mkdir -p "$STATE_DIR" 2>/dev/null || true
    {
      printf 'status=%s\n' "$INSTALL_PROGRESS_STATUS"
      printf 'percent=%s\n' "$INSTALL_PROGRESS_PERCENT"
      printf 'progress=%s\n' "$INSTALL_PROGRESS_PERCENT"
      printf 'stage=%s\n' "$INSTALL_PROGRESS_STAGE"
      printf 'step=%s\n' "$INSTALL_PROGRESS_STAGE"
      printf 'message=%s\n' "$INSTALL_PROGRESS_MESSAGE"
      printf 'updated_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
    } > "$INSTALL_PROGRESS_FILE" 2>/dev/null || true
    chmod 0600 "$INSTALL_PROGRESS_FILE" 2>/dev/null || true
  fi
}

run_optional_install_check() {
  CHECK_NAME="$1"
  CHECK_TIMEOUT="$2"
  shift 2
  [ -n "$CHECK_TIMEOUT" ] || CHECK_TIMEOUT=8
  CHECK_STATUS_FILE="$STATE_DIR/.${CHECK_NAME}-status.$$"
  rm -f "$CHECK_STATUS_FILE" 2>/dev/null || true
  ( "$@" >/dev/null 2>&1; printf '%s\n' "$?" > "$CHECK_STATUS_FILE" 2>/dev/null ) &
  CHECK_PID=$!
  CHECK_ELAPSED=0
  while [ ! -f "$CHECK_STATUS_FILE" ]; do
    if [ "$CHECK_ELAPSED" -ge "$CHECK_TIMEOUT" ] 2>/dev/null; then
      kill "$CHECK_PID" 2>/dev/null || true
      sleep 1
      kill -9 "$CHECK_PID" 2>/dev/null || true
      wait "$CHECK_PID" 2>/dev/null || true
      rm -f "$CHECK_STATUS_FILE" 2>/dev/null || true
      log_install "- Optional install check timed out: $CHECK_NAME after ${CHECK_TIMEOUT}s"
      return 124
    fi
    if [ "$CHECK_ELAPSED" -gt 0 ] && [ $((CHECK_ELAPSED % 3)) -eq 0 ] 2>/dev/null; then
      CHECK_LEFT=$((CHECK_TIMEOUT - CHECK_ELAPSED))
      [ "$CHECK_LEFT" -lt 0 ] 2>/dev/null && CHECK_LEFT=0
      CHECK_MARK="$(install_spinner_frame "$CHECK_ELAPSED")"
      ui_print "  ${CHECK_MARK} $CHECK_NAME ${CHECK_ELAPSED}s/${CHECK_TIMEOUT}s，剩余约 ${CHECK_LEFT}s"
    fi
    sleep 1
    CHECK_ELAPSED=$((CHECK_ELAPSED + 1))
  done
  wait "$CHECK_PID" 2>/dev/null || true
  CHECK_RESULT="$(cat "$CHECK_STATUS_FILE" 2>/dev/null)"
  rm -f "$CHECK_STATUS_FILE" 2>/dev/null || true
  case "$CHECK_RESULT" in ''|*[!0-9]*) CHECK_RESULT=1 ;; esac
  return "$CHECK_RESULT"
}

write_install_state() {
  INSTALL_STATUS="$1"
  INSTALL_REASON="$2"
  {
    printf 'status=%s\n' "$INSTALL_STATUS"
    [ -n "$INSTALL_REASON" ] && printf 'reason=%s\n' "$INSTALL_REASON"
    printf 'module_path=%s\n' "${MODPATH:-}"
    printf 'source=%s\n' "${INSTALL_SOURCE:-unknown}"
    printf 'matched_total=%s\n' "${MATCHED_TOTAL:-0}"
    printf 'version=%s\n' "${MODULE_VERSION:-unknown}"
    printf 'updated_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  } > "$FINAL_INSTALL_STATE" 2>/dev/null || true
  chmod 0600 "$FINAL_INSTALL_STATE" 2>/dev/null || true
  if command -v state_update >/dev/null 2>&1; then
    state_update \
      "install.status=$INSTALL_STATUS" \
      "install.reason=$INSTALL_REASON" \
      "install.source=${INSTALL_SOURCE:-unknown}" \
      "install.matched_total=${MATCHED_TOTAL:-0}" \
      "install.version=${MODULE_VERSION:-unknown}" \
      "install.updated_at=$(date '+%Y-%m-%d %H:%M:%S')" || true
  fi
  if command -v state_set_lifecycle >/dev/null 2>&1; then
    state_set_lifecycle "$INSTALL_STATUS" install "$INSTALL_REASON" || true
  fi
}

cleanup_partial_state() {
  if [ "$STATE_CREATED" = "1" ] && [ "$BACKUP_READY" != "1" ]; then
    rm -rf "$STATE_DIR"
  fi
}

fail_install() {
  log_install "! $*"
  install_progress "${INSTALL_PROGRESS_PERCENT:-0}" failed "$*" failed
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
    sleep 0.1
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
    printf 'ro.product.brand=%s\n' "$(getprop ro.product.brand)"
    printf 'ro.build.version.release=%s\n' "$(getprop ro.build.version.release)"
    printf 'ro.build.version.sdk=%s\n' "$(getprop ro.build.version.sdk)"
    printf 'schema=rule-driven\n'
  } > "$DEVICE_FILE" 2>/dev/null || fail_install "Failed to write device.prop"
  if command -v state_update >/dev/null 2>&1; then
    state_update \
      "device.model=$(getprop ro.product.model)" \
      "device.manufacturer=$(getprop ro.product.manufacturer)" \
      "device.brand=$(getprop ro.product.brand)" \
      "device.android=$(getprop ro.build.version.release)" \
      "device.sdk=$(getprop ro.build.version.sdk)" || true
  fi
}

write_config_source() {
  SOURCE_MODE="$1"
  SOURCE_REASON="$2"
  {
    printf 'source=%s\n' "$SOURCE_MODE"
    printf 'version=%s\n' "$MODULE_VERSION"
    printf 'matched_total=%s\n' "${MATCHED_TOTAL:-0}"
    [ -n "$SOURCE_REASON" ] && printf 'reason=%s\n' "$SOURCE_REASON"
    printf 'updated_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  } > "$CONFIG_SOURCE_FILE" 2>/dev/null || true
  chmod 0600 "$CONFIG_SOURCE_FILE" 2>/dev/null || true
  if command -v state_set_config_summary >/dev/null 2>&1; then
    state_set_config_summary "$PROP_FILE" "$SOURCE_MODE" "$SOURCE_REASON" || true
  fi
}

append_install_log() {
  {
    printf '%s\n' '--- install ---'
    printf 'time=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
    printf 'source=%s\n' "${INSTALL_SOURCE:-unknown}"
    printf 'matched_total=%s\n' "${MATCHED_TOTAL:-0}"
    printf 'version=%s\n' "${MODULE_VERSION:-unknown}"
  } >> "$INSTALL_LOG" 2>/dev/null || true
}

backup_original_props() {
  : > "$ORIGINAL_PROPS" || fail_install "Failed to create original-props.conf"
  awk -F "$(printf '\t')" 'NR > 1 && $3 != "" { print $3 }' "$RULES_FILE" 2>/dev/null | sort -u | while IFS= read -r PROP_KEY; do
    [ -z "$PROP_KEY" ] && continue
    if is_managed_prop "$PROP_KEY" && ! grep -F -q "$PROP_KEY=" "$ORIGINAL_PROPS" && ! grep -F -q "@unset:$PROP_KEY" "$ORIGINAL_PROPS"; then
      CURRENT_VALUE="$(getprop "$PROP_KEY")"
      if [ -n "$CURRENT_VALUE" ]; then
        printf '%s=%s\n' "$PROP_KEY" "$CURRENT_VALUE" >> "$ORIGINAL_PROPS" || fail_install "Failed to write original prop backup"
      else
        printf '@unset:%s\n' "$PROP_KEY" >> "$ORIGINAL_PROPS" || fail_install "Failed to write original prop backup"
      fi
    fi
  done
}

run_dex2oat_match() {
  CAPTURE_SCRIPT="$MODPATH/scripts/capture-props.sh"
  GENERATE_SCRIPT="$MODPATH/scripts/generate-props.sh"

  install_progress 30 capture "抓取设备 ART/dex2oat 属性" running
  command -v state_update >/dev/null 2>&1 && state_update "match.status=pending" "match.mode=rule-driven" "match.reason=capturing" || true
  [ -f "$CAPTURE_SCRIPT" ] || return 10
  [ -f "$GENERATE_SCRIPT" ] || return 11
  chmod 0755 "$CAPTURE_SCRIPT" "$GENERATE_SCRIPT" 2>/dev/null || true

  sh "$CAPTURE_SCRIPT" "$CAPTURED_PROPS" "" || : > "$CAPTURED_PROPS"
  install_progress 42 match "规则匹配并生成配置" running
  command -v state_update >/dev/null 2>&1 && state_update "config.status=pending" "config.reason=generating-system-prop" || true
  sh "$GENERATE_SCRIPT" "$CAPTURED_PROPS" "$RULES_FILE" "$PROP_FILE" "$MATCHED_PROPS" "$MATCH_REPORT" "$CONFIG_SOURCE_FILE" "$MODULE_VERSION" "$ORIGINAL_PROPS" || return $?

  MATCHED_TOTAL="$(sed -n 's/^matched_total=//p' "$MATCH_REPORT" 2>/dev/null | head -n 1)"
  [ -n "$MATCHED_TOTAL" ] || MATCHED_TOTAL=0
  if command -v state_update >/dev/null 2>&1; then
    state_update \
      "match.status=$(sed -n 's/^status=//p' "$MATCH_REPORT" 2>/dev/null | head -n 1)" \
      "match.mode=rule-driven" \
      "match.reason=$(sed -n 's/^reason=//p' "$MATCH_REPORT" 2>/dev/null | head -n 1)" \
      "match.confidence=$(sed -n 's/^confidence=//p' "$MATCH_REPORT" 2>/dev/null | head -n 1)" \
      "match.matched_total=$MATCHED_TOTAL" \
      "match.captured_total=$(sed -n 's/^captured_total=//p' "$MATCH_REPORT" 2>/dev/null | head -n 1)" \
      "match.default_total=$(sed -n 's/^default_total=//p' "$MATCH_REPORT" 2>/dev/null | head -n 1)" \
      "match.fallback_total=$(sed -n 's/^fallback_total=//p' "$MATCH_REPORT" 2>/dev/null | head -n 1)" \
      "match.unmatched_total=$(sed -n 's/^unmatched_total=//p' "$MATCH_REPORT" 2>/dev/null | head -n 1)" \
      "match.updated_at=$(date '+%Y-%m-%d %H:%M:%S')" || true
    state_recompute_summary || true
  fi
  INSTALL_SOURCE=auto-rules
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

[ -n "$MODPATH" ] || fail_install "MODPATH is not set"
[ -f "$PROP_FILE" ] || fail_install "system.prop not found at $PROP_FILE"

MODULE_VERSION="$(sed -n 's/^version=//p' "$MODPATH/module.prop" 2>/dev/null | head -n 1)"
[ -n "$MODULE_VERSION" ] || MODULE_VERSION=unknown

install_banner
install_purpose_prompt || abort "Installation cancelled by user"
install_progress 1 init "初始化安装流程" running

if [ -f "$MODPATH/core/state.sh" ]; then
  . "$MODPATH/core/state.sh"
fi
install_progress 8 environment "读取模块环境与版本信息" running

mkdir -p "$STATE_DIR" "$BACKUP_DIR" "$LOG_DIR" || fail_install "Failed to create state dirs"
STATE_CREATED=1
INSTALL_STARTED=1
touch "$INSTALL_LOG" || fail_install "Failed to create install.log"
rm -f /storage/emulated/0/Download/dex2oat-captured-props.txt 2>/dev/null || true
[ -f "$RULES_FILE" ] || fail_install "rule-props.tsv not found"
command -v state_update >/dev/null 2>&1 && state_update \
  "integrity.status=pending" \
  "integrity.reason=install-integrity-check-pending" \
  "integrity.checked_total=0" \
  "integrity.missing_total=0" \
  "integrity.blocking_missing_total=0" \
  "integrity.changed_total=0" \
  "integrity.runtime_missing_total=0" \
  "integrity.runtime_warning_total=0" \
  "integrity.baseline_refreshed=no" \
  "integrity.updated_at=$(date '+%Y-%m-%d %H:%M:%S')" || true
command -v state_recompute_summary >/dev/null 2>&1 && state_recompute_summary || true
state_set_lifecycle running install starting 2>/dev/null || true
install_progress 14 prepare "准备状态目录与安装日志" running

write_device_prop
install_progress 22 device "记录设备属性摘要" running
backup_original_props
install_progress 26 backup "备份原始属性状态" running
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
    install_progress 55 system_prop "保留 WebUI 自定义 system.prop" running
  fi
fi

if [ "$SKIP_CONFIG_GENERATION" != "1" ]; then
  if run_dex2oat_match; then
    write_config_source auto-rules matched
    install_progress 55 system_prop "写入 system.prop 与匹配摘要" running
  else
    MATCH_STATUS=$?
    command -v state_update >/dev/null 2>&1 && state_update "match.status=failed" "match.reason=install_generation_failed_$MATCH_STATUS" "config.status=failed" "config.reason=rule-driven generation failed: $MATCH_STATUS" || true
    command -v state_recompute_summary >/dev/null 2>&1 && state_recompute_summary || true
    fail_install "rule-driven generation failed: $MATCH_STATUS"
  fi
fi

write_prop_lock_list
install_progress 64 lock "生成运行时锁定快照" running
cp -af "$PROP_FILE" "$BACKUP_DIR/system.prop.factory" 2>/dev/null || true
cp -af "$PROP_FILE" "$SYSTEM_PROP_BAK" 2>/dev/null || true
init_webui_config
touch "$STATE_DIR/service.log" 2>/dev/null || true
append_install_log

if [ -f "$MODPATH/core/conflict-detect.sh" ]; then
  install_progress 74 conflict "执行冲突检测" running
  if run_optional_install_check conflict 8 sh "$MODPATH/core/conflict-detect.sh" "$MODPATH"; then
    log_install "- Conflict detection completed"
  else
    CONFLICT_CHECK_STATUS=$?
    log_install "- Conflict detection skipped or timed out: $CONFLICT_CHECK_STATUS"
    {
      printf '[conflict]\n'
      printf 'checked_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
      printf 'scan_status=warning\n'
      printf 'conflict_total=0\n'
      printf 'reason=install-conflict-scan-timeout\n'
      printf '[items]\n'
    } > "$STATE_DIR/conflict-report.txt" 2>/dev/null || true
    command -v state_update >/dev/null 2>&1 && state_update \
      "conflict.status=warning" \
      "conflict.reason=install-conflict-scan-timeout" \
      "conflict.total=0" \
      "conflict.checked_at=$(date '+%Y-%m-%d %H:%M:%S')" || true
    command -v state_recompute_summary >/dev/null 2>&1 && state_recompute_summary || true
  fi
fi

if [ -f "$MODPATH/core/health-check.sh" ]; then
  install_progress 84 health "初始化健康检查" running
  sh "$MODPATH/core/health-check.sh" "$MODPATH" 2>/dev/null || true
fi

if [ -f "$MODPATH/core/integrity-check.sh" ]; then
  install_progress 88 integrity "执行完整性校验" running
  sh "$MODPATH/core/integrity-check.sh" "$MODPATH" 2>/dev/null || true
fi

chmod 0755 "$MODPATH" || fail_install "Failed to chmod module dir"
set_perm "$MODPATH/service.sh" 0 0 0755 || fail_install "Failed to chmod service.sh"
set_perm "$MODPATH/customize.sh" 0 0 0755 || fail_install "Failed to chmod customize.sh"
set_perm "$MODPATH/uninstall.sh" 0 0 0755 || fail_install "Failed to chmod uninstall.sh"
set_perm "$MODPATH/system.prop" 0 0 0644 || fail_install "Failed to chmod system.prop"
set_perm "$MODPATH/module.prop" 0 0 0644 || fail_install "Failed to chmod module.prop"
chmod_readable_tree "$MODPATH/scripts" || fail_install "Failed to chmod scripts"
chmod_readable_tree "$MODPATH/core" || fail_install "Failed to chmod core"
install_progress 92 permissions "设置模块文件权限" running

chmod 0700 "$STATE_DIR" "$BACKUP_DIR" "$LOG_DIR" 2>/dev/null || true
chmod 0600 "$CONFIG_FILE" "$CONFIG_SOURCE_FILE" "$DEVICE_FILE" "$ORIGINAL_PROPS" "$SYSTEM_PROP_BAK" "$INSTALL_LOG" "$CAPTURED_PROPS" "$MATCHED_PROPS" "$MATCH_REPORT" "$PROP_LOCK_LIST" "$STATE_FILE" 2>/dev/null || true

log_install "- Installation completed: source=$INSTALL_SOURCE matched=$MATCHED_TOTAL version=$MODULE_VERSION"
install_progress 96 state "写入最终状态摘要" running
write_install_state done installed
install_progress 100 complete "安装完成" ok
