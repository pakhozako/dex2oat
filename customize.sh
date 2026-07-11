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
INTEGRITY_BASELINE_FILE="$MODPATH/core/integrity-baseline.prop"
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

log_install() {
  ui_print "$*"
  if [ "$INSTALL_STARTED" = "1" ]; then
    command -v dex_rotate_log >/dev/null 2>&1 && dex_rotate_log "$INSTALL_LOG" 131072
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$INSTALL_LOG" 2>/dev/null || true
  fi
}

install_stage_label() {
  case "$1" in
    init) printf '初始化' ;;
    environment) printf '环境' ;;
    prepare) printf '准备' ;;
    device) printf '设备' ;;
    backup) printf '备份' ;;
    capture) printf '采集' ;;
    match) printf '匹配' ;;
    system_prop) printf '属性' ;;
    lock) printf '锁定' ;;
    conflict) printf '冲突' ;;
    health) printf '健康' ;;
    integrity) printf '校验' ;;
    permissions) printf '权限' ;;
    state) printf '状态' ;;
    complete) printf '完成' ;;
    failed) printf '失败' ;;
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

install_banner() {
  ui_print " "
  ui_print "========================================"
  ui_print "Dex2oat Lock ${MODULE_VERSION:-unknown}"
  ui_print "规则驱动 ART / dexopt 调优"
  if command -v dex_detect_platform >/dev/null 2>&1; then
    ui_print "运行环境: $(dex_detect_platform) $(dex_platform_version)"
  fi
  ui_print "Root 管理器: Magisk / KernelSU / APatch"
  ui_print "========================================"
}

install_progress() {
  INSTALL_PROGRESS_PERCENT="$1"
  INSTALL_PROGRESS_STAGE="$2"
  INSTALL_PROGRESS_MESSAGE="$3"
  INSTALL_PROGRESS_STATUS="${4:-running}"
  INSTALL_PROGRESS_LABEL="$(install_stage_label "$INSTALL_PROGRESS_STAGE")"
  INSTALL_PROGRESS_INDEX="$(install_stage_index "$INSTALL_PROGRESS_STAGE")"
  case "$INSTALL_PROGRESS_STATUS" in
    running) INSTALL_PROGRESS_MARK="..." ;;
    failed) INSTALL_PROGRESS_MARK="失败" ;;
    *) INSTALL_PROGRESS_MARK="完成" ;;
  esac
  ui_print "[${INSTALL_PROGRESS_INDEX}/${INSTALL_TOTAL_STAGES}] ${INSTALL_PROGRESS_PERCENT}% ${INSTALL_PROGRESS_LABEL} ${INSTALL_PROGRESS_MARK} ${INSTALL_PROGRESS_MESSAGE}"
  if [ "$INSTALL_STARTED" = "1" ]; then
    command -v dex_rotate_log >/dev/null 2>&1 && dex_rotate_log "$INSTALL_LOG" 131072
    printf '%s [%s%%] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$INSTALL_PROGRESS_PERCENT" "$INSTALL_PROGRESS_MESSAGE" >> "$INSTALL_LOG" 2>/dev/null || true
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
    [ -n "$INSTALL_BOOT_ID" ] && printf 'boot_id=%s\n' "$INSTALL_BOOT_ID"
    printf 'check_mode=%s\n' "${INSTALL_CHECK_MODE:-full}"
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
      "install.boot_id=$INSTALL_BOOT_ID" \
      "install.check_mode=${INSTALL_CHECK_MODE:-full}" \
      "install.updated_at=$(date '+%Y-%m-%d %H:%M:%S')" || true
  fi
  command -v state_set_lifecycle >/dev/null 2>&1 && state_set_lifecycle "$INSTALL_STATUS" install "$INSTALL_REASON" || true
}

cleanup_partial_state() {
  if [ "$STATE_CREATED" = "1" ] && [ "$BACKUP_READY" != "1" ]; then
    case "$STATE_DIR" in
      /data/adb/dex2oat-lock) dex_safe_remove_state_root "$STATE_DIR" || true ;;
      *) log_install "! 拒绝清理非安全状态目录: $STATE_DIR" ;;
    esac
  fi
}

fail_install() {
  log_install "! $*"
  install_progress "${INSTALL_PROGRESS_PERCENT:-0}" failed "$*" failed
  write_install_state failed "$*"
  cleanup_partial_state
  abort "$*"
}

chmod_readable_tree() {
  TREE_PATH="$1"
  [ -d "$TREE_PATH" ] || return 0
  chmod 0755 "$TREE_PATH" || return 1
  find "$TREE_PATH" -type d -exec chmod 0755 {} \; 2>/dev/null || return 1
  find "$TREE_PATH" -type f -exec chmod 0644 {} \; 2>/dev/null || return 1
  return 0
}

install_preflight() {
  for REQUIRED_FILE in \
    "$RULES_PACK_FILE" \
    "$RULES_DECODE_SCRIPT" \
    "$MODPATH/scripts/capture-props.sh" \
    "$MODPATH/scripts/generate-props.sh" \
    "$MODPATH/core/common.sh" \
    "$MODPATH/core/property.sh" \
    "$INTEGRITY_BASELINE_FILE"; do
    [ -s "$REQUIRED_FILE" ] || fail_install "安装预检失败，必要文件缺失: $REQUIRED_FILE"
  done

  [ -d "$STATE_DIR" ] && [ -w "$STATE_DIR" ] || fail_install "安装预检失败，状态目录不可写: $STATE_DIR"
  PREFLIGHT_FILE="$STATE_DIR/.install-preflight.$$"
  : > "$PREFLIGHT_FILE" 2>/dev/null || fail_install "安装预检失败，状态目录写入不可用"
  rm -f "$PREFLIGHT_FILE" 2>/dev/null || fail_install "安装预检失败，状态目录清理不可用"

  while IFS='=' read -r BASELINE_PATH BASELINE_HASH || [ -n "$BASELINE_PATH" ]; do
    BASELINE_PATH="$(printf '%s' "$BASELINE_PATH" | tr -d '\r')"
    BASELINE_HASH="$(printf '%s' "$BASELINE_HASH" | tr -d '\r')"
    case "$BASELINE_PATH" in
      ""|\#*) continue ;;
      /*|../*|*/../*|*/..|*\\*) fail_install "安装预检失败，完整性基线路径非法: $BASELINE_PATH" ;;
    esac
    case "$BASELINE_HASH" in ""|*[!0-9A-Fa-f]*) fail_install "安装预检失败，完整性基线哈希无效: $BASELINE_PATH" ;; esac
    [ "${#BASELINE_HASH}" -eq 64 ] 2>/dev/null || fail_install "安装预检失败，完整性基线哈希长度无效: $BASELINE_PATH"
    [ -s "$MODPATH/$BASELINE_PATH" ] || fail_install "安装预检失败，关键文件缺失: $BASELINE_PATH"
    if command -v sha256sum >/dev/null 2>&1 && [ "$BASELINE_PATH" != "module.prop" ]; then
      PREFLIGHT_HASH="$(dex_hash_file "$MODPATH/$BASELINE_PATH" 2>/dev/null)"
      [ "$PREFLIGHT_HASH" = "$BASELINE_HASH" ] || fail_install "安装预检失败，关键文件校验不通过: $BASELINE_PATH"
    fi
  done < "$INTEGRITY_BASELINE_FILE"

  dex_prepare_runtime_rules "$RULES_DECODE_SCRIPT" "$RULES_PACK_FILE" "$RULES_FILE" || fail_install "安装预检失败，规则包不可用"
}

is_managed_prop() {
  dex_valid_prop_key "$1"
}

write_device_prop() {
  {
    printf 'ro.product.model=%s\n' "$(getprop ro.product.model)"
    printf 'ro.product.manufacturer=%s\n' "$(getprop ro.product.manufacturer)"
    printf 'ro.product.brand=%s\n' "$(getprop ro.product.brand)"
    printf 'ro.build.version.release=%s\n' "$(getprop ro.build.version.release)"
    printf 'ro.build.version.sdk=%s\n' "$(getprop ro.build.version.sdk)"
    printf 'schema=rule-driven\n'
    if command -v dex_detect_platform >/dev/null 2>&1; then
      printf 'root.platform=%s\n' "$(dex_detect_platform)"
      printf 'root.version=%s\n' "$(dex_platform_version)"
      printf 'root.version_code=%s\n' "$(dex_platform_version_code)"
      if [ -n "$KSU_RUNTIME_MODE" ]; then
        printf 'root.runtime_mode=%s\n' "$KSU_RUNTIME_MODE"
      fi
      if [ -n "$KSU_KERNEL_VER_CODE" ]; then
        printf 'root.kernel_version_code=%s\n' "$KSU_KERNEL_VER_CODE"
      fi
    fi
    :
  } > "$DEVICE_FILE" 2>/dev/null || fail_install "写入 device.prop 失败"

  if command -v state_update >/dev/null 2>&1; then
    state_update \
      "device.model=$(getprop ro.product.model)" \
      "device.manufacturer=$(getprop ro.product.manufacturer)" \
      "device.brand=$(getprop ro.product.brand)" \
      "device.android=$(getprop ro.build.version.release)" \
      "device.sdk=$(getprop ro.build.version.sdk)" \
      "device.root_platform=$(dex_detect_platform 2>/dev/null || printf 'unknown')" \
      "device.root_version=$(dex_platform_version 2>/dev/null || printf 'unknown')" \
      "device.root_version_code=$(dex_platform_version_code 2>/dev/null || printf '0')" || true
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
  command -v state_set_config_summary >/dev/null 2>&1 && state_set_config_summary "$PROP_FILE" "$SOURCE_MODE" "$SOURCE_REASON" || true
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
  : > "$ORIGINAL_PROPS" || fail_install "创建 original-props.conf 失败"
  awk -F "$(printf '\t')" 'NR > 1 && $3 != "" { print $3 }' "$RULES_FILE" 2>/dev/null | sort -u | while IFS= read -r PROP_KEY; do
    [ -z "$PROP_KEY" ] && continue
    if is_managed_prop "$PROP_KEY" && ! grep -F -q "$PROP_KEY=" "$ORIGINAL_PROPS" && ! grep -F -q "@unset:$PROP_KEY" "$ORIGINAL_PROPS"; then
      CURRENT_VALUE="$(getprop "$PROP_KEY")"
      if [ -n "$CURRENT_VALUE" ]; then
        printf '%s=%s\n' "$PROP_KEY" "$CURRENT_VALUE" >> "$ORIGINAL_PROPS" || fail_install "写入原始属性备份失败"
      else
        printf '@unset:%s\n' "$PROP_KEY" >> "$ORIGINAL_PROPS" || fail_install "写入原始属性备份失败"
      fi
    fi
  done
  chmod 0600 "$ORIGINAL_PROPS" 2>/dev/null || true
}

run_dex2oat_match() {
  CAPTURE_SCRIPT="$MODPATH/scripts/capture-props.sh"
  GENERATE_SCRIPT="$MODPATH/scripts/generate-props.sh"

  install_progress 30 capture "正在采集设备 ART/dexopt 属性" running
  command -v state_update >/dev/null 2>&1 && state_update "match.status=pending" "match.mode=rule-driven" "match.reason=capturing" || true
  [ -f "$CAPTURE_SCRIPT" ] || return 10
  [ -f "$GENERATE_SCRIPT" ] || return 11
  chmod 0755 "$CAPTURE_SCRIPT" "$GENERATE_SCRIPT" 2>/dev/null || true

  sh "$CAPTURE_SCRIPT" "$CAPTURED_PROPS" "" "$RULES_FILE" || : > "$CAPTURED_PROPS"
  install_progress 42 match "正在匹配规则并生成 system.prop" running
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
}

MODULE_VERSION="$(sed -n 's/^version=//p' "$MODPATH/module.prop" 2>/dev/null | head -n 1)"
[ -n "$MODULE_VERSION" ] || MODULE_VERSION=unknown

install_banner
ui_print "- 正在安装模块并生成规则驱动的 system.prop"
install_progress 1 init "正在初始化安装流程" running

[ -d "$STATE_DIR" ] && STATE_DIR_PREEXISTED=1 || STATE_DIR_PREEXISTED=0
mkdir -p "$STATE_DIR" "$BACKUP_DIR" "$LOG_DIR" || fail_install "创建状态目录失败"
[ "$STATE_DIR_PREEXISTED" = "1" ] || STATE_CREATED=1
INSTALL_STARTED=1
touch "$INSTALL_LOG" || fail_install "创建 install.log 失败"
rm -f /storage/emulated/0/Download/dex2oat-captured-props.txt 2>/dev/null || true

install_progress 8 environment "正在读取模块环境" running
install_preflight
command -v state_update >/dev/null 2>&1 && state_update \
  "integrity.status=pending" \
  "integrity.reason=install-integrity-check-pending" \
  "integrity.checked_total=0" \
  "integrity.missing_total=0" \
  "integrity.blocking_missing_total=0" \
  "integrity.changed_total=0" \
  "integrity.runtime_missing_total=0" \
  "integrity.runtime_warning_total=0" \
  "integrity.baseline_refresh_supported=no" \
  "integrity.updated_at=$(date '+%Y-%m-%d %H:%M:%S')" || true
command -v state_recompute_summary >/dev/null 2>&1 && state_recompute_summary || true
command -v state_set_lifecycle >/dev/null 2>&1 && state_set_lifecycle running install starting || true
install_progress 14 prepare "正在准备状态目录和安装日志" running

write_device_prop
install_progress 22 device "正在记录设备属性摘要" running
backup_original_props
install_progress 26 backup "正在备份原始属性状态" running
BACKUP_READY=1

if run_dex2oat_match; then
  write_config_source auto-rules matched
  install_progress 55 system_prop "正在写入 system.prop 和匹配摘要" running
else
  MATCH_STATUS=$?
  command -v state_update >/dev/null 2>&1 && state_update "match.status=failed" "match.reason=install_generation_failed_$MATCH_STATUS" "config.status=failed" "config.reason=rule-driven generation failed: $MATCH_STATUS" || true
  command -v state_recompute_summary >/dev/null 2>&1 && state_recompute_summary || true
  fail_install "规则驱动生成失败: $MATCH_STATUS"
fi

dex_write_prop_lock_list "$PROP_FILE" "$PROP_LOCK_LIST" direct
install_progress 64 lock "正在生成运行时属性锁" running
cp -af "$PROP_FILE" "$BACKUP_DIR/system.prop.factory" 2>/dev/null || true
cp -af "$PROP_FILE" "$SYSTEM_PROP_BAK" 2>/dev/null || true
touch "$STATE_DIR/service.log" 2>/dev/null || true
append_install_log
INSTALL_CHECK_PIDS=""

if [ -f "$MODPATH/core/conflict-detect.sh" ]; then
  install_progress 74 conflict "正在扫描模块属性冲突" running
  (
    if DEX2OAT_DEFER_SUMMARY_RECOMPUTE=1 sh "$MODPATH/core/conflict-detect.sh" "$MODPATH"; then
      log_install "- 冲突检测完成"
    else
      CONFLICT_CHECK_STATUS=$?
      log_install "- 冲突检测失败: $CONFLICT_CHECK_STATUS"
      {
        printf '[conflict]\n'
        printf 'checked_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
        printf 'scan_status=warning\n'
        printf 'conflict_total=0\n'
        printf 'reason=install-conflict-scan-failed\n'
        printf '[items]\n'
      } > "$STATE_DIR/conflict-report.txt" 2>/dev/null || true
      command -v state_update >/dev/null 2>&1 && state_update \
        "conflict.status=warning" \
        "conflict.reason=install-conflict-scan-failed" \
        "conflict.checked_at=$(date '+%Y-%m-%d %H:%M:%S')" || true
      command -v state_recompute_summary >/dev/null 2>&1 && state_recompute_summary || true
    fi
  ) &
  INSTALL_CHECK_PIDS="$INSTALL_CHECK_PIDS $!"
fi

if [ -f "$MODPATH/core/health-check.sh" ]; then
  install_progress 84 health "正在生成健康摘要" running
  DEX2OAT_DEFER_SUMMARY_RECOMPUTE=1 sh "$MODPATH/core/health-check.sh" "$MODPATH" 2>/dev/null &
  INSTALL_CHECK_PIDS="$INSTALL_CHECK_PIDS $!"
fi

if [ -f "$MODPATH/core/integrity-check.sh" ]; then
  install_progress 88 integrity "正在检查模块完整性" running
  DEX2OAT_DEFER_SUMMARY_RECOMPUTE=1 sh "$MODPATH/core/integrity-check.sh" "$MODPATH" 2>/dev/null &
  INSTALL_CHECK_PIDS="$INSTALL_CHECK_PIDS $!"
fi

for INSTALL_CHECK_PID in $INSTALL_CHECK_PIDS; do
  wait "$INSTALL_CHECK_PID" 2>/dev/null || true
done
command -v state_recompute_summary >/dev/null 2>&1 && state_recompute_summary || true
log_install "- 安装检查完成: mode=${INSTALL_CHECK_MODE:-full}"

chmod 0755 "$MODPATH" || fail_install "设置模块目录权限失败"
set_perm "$MODPATH/service.sh" 0 0 0755 || fail_install "设置 service.sh 权限失败"
set_perm "$MODPATH/action.sh" 0 0 0755 || fail_install "设置 action.sh 权限失败"
set_perm "$MODPATH/customize.sh" 0 0 0755 || fail_install "设置 customize.sh 权限失败"
set_perm "$MODPATH/uninstall.sh" 0 0 0755 || fail_install "设置 uninstall.sh 权限失败"
set_perm "$MODPATH/system.prop" 0 0 0644 || fail_install "设置 system.prop 权限失败"
set_perm "$MODPATH/module.prop" 0 0 0644 || fail_install "设置 module.prop 权限失败"
chmod_readable_tree "$MODPATH/scripts" || fail_install "设置 scripts 权限失败"
chmod_readable_tree "$MODPATH/core" || fail_install "设置 core 权限失败"
chmod_readable_tree "$MODPATH/rules" || fail_install "设置 rules 权限失败"
install_progress 92 permissions "正在设置模块文件权限" running

chmod 0700 "$STATE_DIR" "$BACKUP_DIR" "$LOG_DIR" 2>/dev/null || true
chmod 0600 "$CONFIG_SOURCE_FILE" "$DEVICE_FILE" "$ORIGINAL_PROPS" "$SYSTEM_PROP_BAK" "$INSTALL_LOG" "$CAPTURED_PROPS" "$MATCHED_PROPS" "$MATCH_REPORT" "$PROP_LOCK_LIST" "$STATE_FILE" 2>/dev/null || true

log_install "- 安装完成: 来源=$INSTALL_SOURCE 命中=$MATCHED_TOTAL 版本=$MODULE_VERSION"
install_progress 96 state "正在写入最终安装状态" running
write_install_state done installed
install_progress 100 complete "安装完成" ok
