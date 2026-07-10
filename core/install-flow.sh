#!/system/bin/sh

log_install() {
  ui_print "$*"
  if [ "$INSTALL_STARTED" = "1" ]; then
    command -v dex_rotate_log >/dev/null 2>&1 && dex_rotate_log "$INSTALL_LOG" 131072
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$INSTALL_LOG" 2>/dev/null || true
  fi
}

install_log_file() {
  [ "$INSTALL_STARTED" = "1" ] || return 0
  command -v dex_rotate_log >/dev/null 2>&1 && dex_rotate_log "$INSTALL_LOG" 131072
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$INSTALL_LOG" 2>/dev/null || true
}

install_line() {
  ui_print "================================================"
}

install_kv() {
  INSTALL_KV_VALUE="$2"
  case "$INSTALL_KV_VALUE" in ""|unknown) return 0 ;; esac
  ui_print "$(printf '%-20s: %s' "$1" "$INSTALL_KV_VALUE")"
}

install_report_value() {
  INSTALL_REPORT_KEY="$1"
  INSTALL_REPORT_FILE="$2"
  [ -f "$INSTALL_REPORT_FILE" ] || return 0
  sed -n "s/^$INSTALL_REPORT_KEY=//p" "$INSTALL_REPORT_FILE" 2>/dev/null | head -n 1
}

install_prop_count() {
  [ -f "$1" ] || { printf '0\n'; return 0; }
  awk -F= 'index($0,"=")>0 { key=$1; gsub(/\r/,"",key); sub(/^[[:space:]]*/,"",key); sub(/[[:space:]]*$/,"",key); if(key != "" && substr(key,1,1) != "#") count++ } END { print count + 0 }' "$1" 2>/dev/null
}

install_stage_label() {
  case "$1" in
    init) printf '初始化' ;;
    environment) printf '环境检测' ;;
    prepare) printf '状态目录' ;;
    device) printf '设备' ;;
    backup) printf '原始备份' ;;
    capture) printf '属性采集' ;;
    match) printf '规则匹配' ;;
    system_prop) printf '配置生成' ;;
    lock) printf 'Property Lock' ;;
    conflict) printf '冲突检测' ;;
    health) printf '健康检查' ;;
    integrity) printf '完整性检查' ;;
    permissions) printf '权限设置' ;;
    state) printf '状态提交' ;;
    complete) printf '完成' ;;
    failed) printf '失败' ;;
    *) printf '%s' "$1" | tr '[:lower:]' '[:upper:]' ;;
  esac
}

install_stage_message() {
  case "$1" in
    init) printf '准备安装环境' ;;
    environment) printf '识别 Root Framework' ;;
    prepare) printf '创建运行目录' ;;
    device) printf '读取设备属性' ;;
    backup) printf '备份运行状态' ;;
    capture) printf '采集 ART / dexopt' ;;
    match) printf '生成 system.prop' ;;
    system_prop) printf '写入最终配置' ;;
    lock) printf '生成属性锁' ;;
    conflict) printf '扫描模块冲突' ;;
    health) printf '生成健康状态' ;;
    integrity) printf '校验模块完整性' ;;
    permissions) printf '修正权限' ;;
    state) printf '提交安装事务' ;;
    complete) printf '安装完成' ;;
    failed) printf '%s' "$2" ;;
    *) printf '%s' "$2" ;;
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
  INSTALL_PLATFORM=""
  INSTALL_PLATFORM_VERSION=""
  if command -v dex_detect_platform >/dev/null 2>&1; then
    INSTALL_PLATFORM="$(dex_detect_platform 2>/dev/null)"
    INSTALL_PLATFORM_VERSION="$(dex_platform_version 2>/dev/null)"
  fi
  INSTALL_ROOT_MANAGER="$INSTALL_PLATFORM"
  [ -n "$INSTALL_PLATFORM_VERSION" ] && [ "$INSTALL_PLATFORM_VERSION" != unknown ] && INSTALL_ROOT_MANAGER="$INSTALL_ROOT_MANAGER $INSTALL_PLATFORM_VERSION"
  INSTALL_ANDROID="$(getprop ro.build.version.release 2>/dev/null)"
  INSTALL_ARCH="$(getprop ro.product.cpu.abi 2>/dev/null)"
  INSTALL_DEVICE="$(getprop ro.product.model 2>/dev/null)"
  ui_print " "
  install_line
  ui_print "dex2oat-lock ${MODULE_VERSION:-unknown}"
  ui_print "Rule-based ART / dexopt Optimization"
  install_line
  install_kv "Root Manager" "$INSTALL_ROOT_MANAGER"
  install_kv "Android" "$INSTALL_ANDROID"
  install_kv "Architecture" "$INSTALL_ARCH"
  install_kv "Device" "$INSTALL_DEVICE"
  install_kv "Rule Pack" "$MODULE_VERSION"
  install_line
}

install_progress() {
  INSTALL_PROGRESS_PERCENT="$1"
  INSTALL_PROGRESS_STAGE="$2"
  INSTALL_PROGRESS_MESSAGE="$(install_stage_message "$INSTALL_PROGRESS_STAGE" "$3")"
  INSTALL_PROGRESS_STATUS="${4:-running}"
  INSTALL_PROGRESS_LABEL="$(install_stage_label "$INSTALL_PROGRESS_STAGE")"
  INSTALL_PROGRESS_INDEX="$(install_stage_index "$INSTALL_PROGRESS_STAGE")"
  INSTALL_PROGRESS_PAD=" "
  [ "$INSTALL_PROGRESS_PERCENT" -lt 10 ] 2>/dev/null && INSTALL_PROGRESS_PAD="  "
  ui_print ""
  ui_print "[${INSTALL_PROGRESS_INDEX}/${INSTALL_TOTAL_STAGES}]${INSTALL_PROGRESS_PAD}${INSTALL_PROGRESS_PERCENT}%"
  ui_print "$INSTALL_PROGRESS_LABEL"
  ui_print "$INSTALL_PROGRESS_MESSAGE"
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

write_agreement_state() {
  [ "${DEX2OAT_AGREEMENT_ACCEPTED:-}" = "yes" ] || return 0
  AGREEMENT_FILE="$STATE_DIR/agreement.prop"
  AGREEMENT_ACCEPTED_AT="${DEX2OAT_AGREEMENT_ACCEPTED_AT:-$(date '+%Y-%m-%d %H:%M:%S')}"
  {
    printf 'agreement.version=%s\n' "${DEX2OAT_AGREEMENT_VERSION:-1}"
    printf 'agreement.accepted=%s\n' "$DEX2OAT_AGREEMENT_ACCEPTED"
    printf 'agreement.accepted_at=%s\n' "$AGREEMENT_ACCEPTED_AT"
  } > "$AGREEMENT_FILE" 2>/dev/null || return 0
  chmod 0600 "$AGREEMENT_FILE" 2>/dev/null || true
  command -v state_update >/dev/null 2>&1 && state_update \
    "agreement.version=${DEX2OAT_AGREEMENT_VERSION:-1}" \
    "agreement.accepted=$DEX2OAT_AGREEMENT_ACCEPTED" \
    "agreement.accepted_at=$AGREEMENT_ACCEPTED_AT" || true
}

install_rule_summary() {
  MATCHED_TOTAL="$(install_report_value matched_total "$MATCH_REPORT")"
  RULES_IGNORED="$(install_report_value unmatched_total "$MATCH_REPORT")"
  GENERATED_PROPS="$(install_prop_count "$PROP_FILE")"
  [ -n "$MATCHED_TOTAL" ] || MATCHED_TOTAL=0
  [ -n "$RULES_IGNORED" ] || RULES_IGNORED=0
  [ -n "$GENERATED_PROPS" ] || GENERATED_PROPS=0
  ui_print ""
  ui_print "Rules Matched        : $MATCHED_TOTAL"
  ui_print "Rules Ignored        : $RULES_IGNORED"
  ui_print "Properties           : $GENERATED_PROPS"
}

install_check_value() {
  install_report_value "$1" "$2"
}

install_check_grade() {
  CHECK_TYPE="$1"
  CHECK_STATUS="${2:-}"
  CHECK_REASON="${3:-}"
  CHECK_VALUE_A="${4:-0}"
  CHECK_VALUE_B="${5:-0}"

  case "$CHECK_TYPE" in
    conflict)
      if [ "$CHECK_STATUS" = ok ] && [ "${CHECK_VALUE_A:-0}" = 0 ] 2>/dev/null; then
        printf 'PASS'
      else
        printf 'WARN'
      fi
      ;;
    health)
      case "$CHECK_STATUS" in
        ok) printf 'PASS' ;;
        error) printf 'FAIL' ;;
        *) printf 'WARN' ;;
      esac
      ;;
    integrity)
      case "$CHECK_REASON" in
        baseline-missing|baseline-invalid|hash-tool-unavailable)
          printf 'FAIL'
          return 0
          ;;
        runtime-evidence-not-ready|runtime-structure-warning)
          printf 'WARN'
          return 0
          ;;
      esac
      case "$CHECK_STATUS" in
        ok)
          printf 'PASS'
          ;;
        error)
          printf 'FAIL'
          ;;
        missing|changed)
          if [ "${CHECK_VALUE_A:-0}" -gt 0 ] 2>/dev/null || [ "${CHECK_VALUE_B:-0}" -gt 0 ] 2>/dev/null; then
            printf 'FAIL'
          else
            printf 'WARN'
          fi
          ;;
        *)
          printf 'WARN'
          ;;
      esac
      ;;
    *)
      printf 'WARN'
      ;;
  esac
}

install_record_check_grade() {
  CHECK_LABEL="$1"
  CHECK_GRADE="$2"
  CHECK_REASON="$3"
  [ "$CHECK_GRADE" = FAIL ] || return 0
  [ -n "$CHECK_REASON" ] || CHECK_REASON=unknown
  if [ -n "${INSTALL_CHECK_BLOCKING_REASON:-}" ]; then
    INSTALL_CHECK_BLOCKING_REASON="$INSTALL_CHECK_BLOCKING_REASON; $CHECK_LABEL: $CHECK_REASON"
  else
    INSTALL_CHECK_BLOCKING_REASON="$CHECK_LABEL: $CHECK_REASON"
  fi
}

install_check_summary() {
  INSTALL_CHECK_BLOCKING_REASON=""

  CONFLICT_STATUS="$(install_check_value scan_status "$STATE_DIR/conflict-report.txt")"
  CONFLICT_REASON="$(install_check_value reason "$STATE_DIR/conflict-report.txt")"
  CONFLICT_TOTAL="$(install_check_value conflict_total "$STATE_DIR/conflict-report.txt")"
  [ -n "$CONFLICT_STATUS" ] || CONFLICT_STATUS="$(state_get conflict.status 2>/dev/null)"
  [ -n "$CONFLICT_REASON" ] || CONFLICT_REASON="$(state_get conflict.reason 2>/dev/null)"
  [ -n "$CONFLICT_TOTAL" ] || CONFLICT_TOTAL="$(state_get conflict.total 2>/dev/null)"
  CONFLICT_GRADE="$(install_check_grade conflict "$CONFLICT_STATUS" "$CONFLICT_REASON" "${CONFLICT_TOTAL:-0}")"
  install_record_check_grade "conflict" "$CONFLICT_GRADE" "$CONFLICT_REASON"
  if [ "$CONFLICT_GRADE" = PASS ]; then
    ui_print "✓ No Module Conflict"
  else
    [ -n "$CONFLICT_REASON" ] || CONFLICT_REASON=unknown
    ui_print "⚠ Conflict Detected"
    ui_print "原因: $CONFLICT_REASON"
  fi

  HEALTH_STATUS="$(install_check_value status "$STATE_DIR/health.log")"
  HEALTH_REASON="$(install_check_value reason "$STATE_DIR/health.log")"
  [ -n "$HEALTH_STATUS" ] || HEALTH_STATUS="$(state_get health.status 2>/dev/null)"
  [ -n "$HEALTH_REASON" ] || HEALTH_REASON="$(state_get health.reason 2>/dev/null)"
  HEALTH_GRADE="$(install_check_grade health "$HEALTH_STATUS" "$HEALTH_REASON")"
  install_record_check_grade "health" "$HEALTH_GRADE" "$HEALTH_REASON"
  if [ "$HEALTH_GRADE" = PASS ]; then
    ui_print "✓ Health Check Passed"
  else
    [ -n "$HEALTH_REASON" ] || HEALTH_REASON=unknown
    ui_print "⚠ Health Check Failed"
    ui_print "原因: $HEALTH_REASON"
  fi

  INTEGRITY_STATUS="$(install_check_value status "$STATE_DIR/integrity-report.txt")"
  INTEGRITY_REASON="$(install_check_value reason "$STATE_DIR/integrity-report.txt")"
  INTEGRITY_BLOCKING_MISSING="$(install_check_value blocking_missing_total "$STATE_DIR/integrity-report.txt")"
  INTEGRITY_BLOCKING_CHANGED="$(install_check_value blocking_changed_total "$STATE_DIR/integrity-report.txt")"
  [ -n "$INTEGRITY_STATUS" ] || INTEGRITY_STATUS="$(state_get integrity.status 2>/dev/null)"
  [ -n "$INTEGRITY_REASON" ] || INTEGRITY_REASON="$(state_get integrity.reason 2>/dev/null)"
  [ -n "$INTEGRITY_BLOCKING_MISSING" ] || INTEGRITY_BLOCKING_MISSING="$(state_get integrity.blocking_missing_total 2>/dev/null)"
  [ -n "$INTEGRITY_BLOCKING_CHANGED" ] || INTEGRITY_BLOCKING_CHANGED="$(state_get integrity.blocking_changed_total 2>/dev/null)"
  INTEGRITY_GRADE="$(install_check_grade integrity "$INTEGRITY_STATUS" "$INTEGRITY_REASON" "${INTEGRITY_BLOCKING_MISSING:-0}" "${INTEGRITY_BLOCKING_CHANGED:-0}")"
  install_record_check_grade "integrity" "$INTEGRITY_GRADE" "$INTEGRITY_REASON"
  if [ "$INTEGRITY_GRADE" = PASS ]; then
    ui_print "✓ Integrity Verified"
  else
    [ -n "$INTEGRITY_REASON" ] || INTEGRITY_REASON=unknown
    ui_print "⚠ Integrity Verification Failed"
    ui_print "原因: $INTEGRITY_REASON"
  fi

  PROP_LOCK_STATUS="${INSTALL_PROP_LOCK_STATUS:-}"
  PROP_LOCK_REASON="${INSTALL_PROP_LOCK_REASON:-}"
  [ -n "$PROP_LOCK_STATUS" ] || PROP_LOCK_STATUS="$(state_get prop_lock.status 2>/dev/null)"
  [ -n "$PROP_LOCK_REASON" ] || PROP_LOCK_REASON="$(state_get prop_lock.reason 2>/dev/null)"
  if [ "$PROP_LOCK_STATUS" = warning ]; then
    ui_print "⚠ Property Lock Warning"
    ui_print "原因: 部分属性锁定列表写入失败"
  fi
}

install_snapshot_status() {
  if [ -d "$STATE_DIR/snapshots" ]; then
    SNAPSHOT_COUNT="$(find "$STATE_DIR/snapshots" -name '*.prop' -type f 2>/dev/null | wc -l | tr -d ' ')"
  else
    SNAPSHOT_COUNT=0
  fi
  [ "${SNAPSHOT_COUNT:-0}" -gt 0 ] 2>/dev/null && printf 'Enabled (%s)' "$SNAPSHOT_COUNT" || printf 'Enabled'
}

install_elapsed_seconds() {
  INSTALL_END_EPOCH="$(date '+%s' 2>/dev/null || printf 0)"
  INSTALL_ELAPSED=$((INSTALL_END_EPOCH - INSTALL_START_EPOCH))
  [ "$INSTALL_ELAPSED" -ge 0 ] 2>/dev/null || INSTALL_ELAPSED=0
  printf '%ss' "$INSTALL_ELAPSED"
}

install_completion_summary() {
  GENERATED_PROPS="$(install_prop_count "$PROP_FILE")"
  [ -n "$MATCHED_TOTAL" ] || MATCHED_TOTAL=0
  install_line
  ui_print "✓ Installation Completed"
  install_kv "Version" "$MODULE_VERSION"
  install_kv "Rule Pack" "$MODULE_VERSION"
  install_kv "Matched Rules" "$MATCHED_TOTAL"
  install_kv "Generated Properties" "$GENERATED_PROPS"
  install_kv "Snapshots" "$(install_snapshot_status)"
  install_kv "Install Time" "$(install_elapsed_seconds)"
  install_kv "Status" "Success"
  install_kv "Configuration Source" "${INSTALL_SOURCE:-auto-rules}"
  install_kv "State Schema" "$(state_get schema_version 2>/dev/null)"
  install_kv "Transaction" "Committed"
  install_kv "Health" "$(state_get health.status 2>/dev/null)"
  install_kv "Integrity" "$(state_get integrity.status 2>/dev/null)"
  install_line
}

cleanup_partial_state() {
  if [ "$STATE_CREATED" = "1" ] && [ "$BACKUP_READY" != "1" ]; then
    case "$STATE_DIR" in
      /data/adb/dex2oat-lock) dex_safe_remove_state_root "$STATE_DIR" || true ;;
      *) log_install "! 拒绝清理非安全状态目录: $STATE_DIR" ;;
    esac
  fi
}

install_transaction_marker() {
  INSTALL_COMMIT_FILE="$STATE_DIR/install.commit"
  INSTALL_COMMIT_TMP="$INSTALL_COMMIT_FILE.tmp.$$"
  install_commit_prerequisites || return 1
  {
    printf 'version=%s\n' "${MODULE_VERSION:-unknown}"
    printf 'module_path=%s\n' "${MODPATH:-}"
    printf 'committed_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
    printf 'boot_id=%s\n' "$INSTALL_BOOT_ID"
  } > "$INSTALL_COMMIT_TMP" || return 1
  mv -f "$INSTALL_COMMIT_TMP" "$INSTALL_COMMIT_FILE" || return 1
  chmod 0600 "$INSTALL_COMMIT_FILE" 2>/dev/null || true
}

install_commit_prerequisites() {
  [ -n "$MODPATH" ] && [ -d "$MODPATH" ] && [ ! -L "$MODPATH" ] || return 1
  for INSTALL_REQUIRED in module.prop customize.sh service.sh action.sh uninstall.sh system.prop core/state.sh core/integrity-check.sh; do
    [ -f "$MODPATH/$INSTALL_REQUIRED" ] && [ ! -L "$MODPATH/$INSTALL_REQUIRED" ] || return 1
  done
  [ -x "$MODPATH/service.sh" ] || return 1
  [ -x "$MODPATH/action.sh" ] || return 1
  [ -x "$MODPATH/customize.sh" ] || return 1
  [ -x "$MODPATH/uninstall.sh" ] || return 1
}

fail_install() {
  rm -f "$STATE_DIR/install.commit" 2>/dev/null || true
  ui_print ""
  ui_print "❌ Installation Failed"
  ui_print "原因: $*"
  ui_print "建议: 请重新安装模块；如仍失败，请通过 Action 导出诊断包后反馈。"
  install_log_file "ERROR $*"
  install_progress "${INSTALL_PROGRESS_PERCENT:-0}" failed "$*" failed
  write_install_state failed "$*"
  cleanup_partial_state
  abort "Installation Failed"
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
  dex_valid_prop_key "$1"
}

write_device_prop() {
  DEVICE_MODEL="$(getprop ro.product.model 2>/dev/null)"
  DEVICE_MANUFACTURER="$(getprop ro.product.manufacturer 2>/dev/null)"
  DEVICE_BRAND="$(getprop ro.product.brand 2>/dev/null)"
  DEVICE_ANDROID="$(getprop ro.build.version.release 2>/dev/null)"
  DEVICE_SDK="$(getprop ro.build.version.sdk 2>/dev/null)"
  DEVICE_ROOT_PLATFORM="$(dex_detect_platform 2>/dev/null || printf 'unknown')"
  DEVICE_ROOT_VERSION="$(dex_platform_version 2>/dev/null || printf 'unknown')"
  DEVICE_ROOT_VERSION_CODE="$(dex_platform_version_code 2>/dev/null || printf '0')"
  {
    printf 'ro.product.model=%s\n' "$DEVICE_MODEL"
    printf 'ro.product.manufacturer=%s\n' "$DEVICE_MANUFACTURER"
    printf 'ro.product.brand=%s\n' "$DEVICE_BRAND"
    printf 'ro.build.version.release=%s\n' "$DEVICE_ANDROID"
    printf 'ro.build.version.sdk=%s\n' "$DEVICE_SDK"
    printf 'schema=rule-driven\n'
    printf 'root.platform=%s\n' "$DEVICE_ROOT_PLATFORM"
    printf 'root.version=%s\n' "$DEVICE_ROOT_VERSION"
    printf 'root.version_code=%s\n' "$DEVICE_ROOT_VERSION_CODE"
    [ -n "$KSU_RUNTIME_MODE" ] && printf 'root.runtime_mode=%s\n' "$KSU_RUNTIME_MODE"
    [ -n "$KSU_KERNEL_VER_CODE" ] && printf 'root.kernel_version_code=%s\n' "$KSU_KERNEL_VER_CODE"
  } > "$DEVICE_FILE" 2>/dev/null || fail_install "写入 device.prop 失败"

  state_update \
    "device.model=$DEVICE_MODEL" \
    "device.manufacturer=$DEVICE_MANUFACTURER" \
    "device.brand=$DEVICE_BRAND" \
    "device.android=$DEVICE_ANDROID" \
    "device.sdk=$DEVICE_SDK" \
    "device.root_platform=$DEVICE_ROOT_PLATFORM" \
    "device.root_version=$DEVICE_ROOT_VERSION" \
    "device.root_version_code=$DEVICE_ROOT_VERSION_CODE" || fail_install "写入设备状态失败"
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

install_flow_main() {
  INSTALL_START_EPOCH="$(date '+%s' 2>/dev/null || printf 0)"
  MODULE_VERSION="$(sed -n 's/^version=//p' "$MODPATH/module.prop" 2>/dev/null | head -n 1)"
  [ -n "$MODULE_VERSION" ] || MODULE_VERSION=unknown
  
  install_banner
  install_progress 1 init "准备安装环境" running
  
  mkdir -p "$STATE_DIR" "$BACKUP_DIR" "$LOG_DIR" || fail_install "创建状态目录失败"
  STATE_CREATED=1
  INSTALL_STARTED=1
  touch "$INSTALL_LOG" || fail_install "创建 install.log 失败"
  write_agreement_state
  rm -f /storage/emulated/0/Download/dex2oat-captured-props.txt 2>/dev/null || true
  
  install_progress 8 environment "识别 Root Framework" running
  dex_prepare_runtime_rules "$RULES_DECODE_SCRIPT" "$RULES_PACK_FILE" "$RULES_FILE" || fail_install "规则包不可用"
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
  install_progress 14 prepare "创建运行目录" running
  
  write_device_prop
  install_progress 22 device "读取设备属性" running
  backup_original_props
  install_progress 26 backup "备份运行状态" running
  BACKUP_READY=1
  
  if run_dex2oat_match; then
    write_config_source auto-rules matched
    install_progress 55 system_prop "写入最终配置" running
    install_rule_summary
  else
    MATCH_STATUS=$?
    command -v state_update >/dev/null 2>&1 && state_update "match.status=failed" "match.reason=install_generation_failed_$MATCH_STATUS" "config.status=failed" "config.reason=rule-driven generation failed: $MATCH_STATUS" || true
    command -v state_recompute_summary >/dev/null 2>&1 && state_recompute_summary || true
    fail_install "规则驱动生成失败: $MATCH_STATUS"
  fi
  
  if dex_write_prop_lock_list "$PROP_FILE" "$PROP_LOCK_LIST" direct; then
    INSTALL_PROP_LOCK_STATUS=ok
    INSTALL_PROP_LOCK_REASON=passed
    command -v state_update >/dev/null 2>&1 && state_update \
      "prop_lock.status=ok" \
      "prop_lock.reason=passed" \
      "prop_lock.updated_at=$(date '+%Y-%m-%d %H:%M:%S')" || true
  else
    INSTALL_PROP_LOCK_STATUS=warning
    INSTALL_PROP_LOCK_REASON=prop-lock-write-failed
    install_log_file "WARNING prop-lock list generation failed"
    command -v state_update >/dev/null 2>&1 && state_update \
      "prop_lock.status=warning" \
      "prop_lock.reason=prop-lock-write-failed" \
      "prop_lock.updated_at=$(date '+%Y-%m-%d %H:%M:%S')" || true
  fi
  install_progress 64 lock "生成属性锁" running
  cp -af "$PROP_FILE" "$BACKUP_DIR/system.prop.factory" 2>/dev/null || fail_install "备份 factory system.prop 失败"
  cp -af "$PROP_FILE" "$SYSTEM_PROP_BAK" 2>/dev/null || fail_install "备份 system.prop 失败"
  touch "$STATE_DIR/service.log" 2>/dev/null || true
  append_install_log
  INSTALL_CHECK_PIDS=""
  
  if [ -f "$MODPATH/core/conflict-detect.sh" ]; then
    install_progress 74 conflict "正在扫描模块属性冲突" running
    (
      if DEX2OAT_DEFER_SUMMARY_RECOMPUTE=1 sh "$MODPATH/core/conflict-detect.sh" "$MODPATH"; then
        install_log_file "SUCCESS conflict scan completed"
      else
        CONFLICT_CHECK_STATUS=$?
        install_log_file "WARNING conflict scan failed status=$CONFLICT_CHECK_STATUS"
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
    install_progress 84 health "生成健康状态" running
    DEX2OAT_DEFER_SUMMARY_RECOMPUTE=1 sh "$MODPATH/core/health-check.sh" "$MODPATH" 2>/dev/null &
    INSTALL_CHECK_PIDS="$INSTALL_CHECK_PIDS $!"
  fi
  
  if [ -f "$MODPATH/core/integrity-check.sh" ]; then
    install_progress 88 integrity "校验模块完整性" running
    DEX2OAT_DEFER_SUMMARY_RECOMPUTE=1 sh "$MODPATH/core/integrity-check.sh" "$MODPATH" 2>/dev/null &
    INSTALL_CHECK_PIDS="$INSTALL_CHECK_PIDS $!"
  fi
  
  for INSTALL_CHECK_PID in $INSTALL_CHECK_PIDS; do
    wait "$INSTALL_CHECK_PID" 2>/dev/null || true
  done
  command -v state_recompute_summary >/dev/null 2>&1 && state_recompute_summary || true
  install_check_summary
  if [ -n "${INSTALL_CHECK_BLOCKING_REASON:-}" ]; then
    fail_install "安装检查未通过: $INSTALL_CHECK_BLOCKING_REASON"
  fi
  install_log_file "INFO install checks completed mode=${INSTALL_CHECK_MODE:-full}"
  
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
  install_progress 92 permissions "修正权限" running
  
  chmod 0700 "$STATE_DIR" "$BACKUP_DIR" "$LOG_DIR" 2>/dev/null || true
  chmod 0600 "$CONFIG_SOURCE_FILE" "$DEVICE_FILE" "$ORIGINAL_PROPS" "$SYSTEM_PROP_BAK" "$INSTALL_LOG" "$CAPTURED_PROPS" "$MATCHED_PROPS" "$MATCH_REPORT" "$PROP_LOCK_LIST" "$STATE_FILE" 2>/dev/null || true
  
  install_log_file "SUCCESS install completed source=$INSTALL_SOURCE matched=$MATCHED_TOTAL version=$MODULE_VERSION"
  install_progress 96 state "提交安装事务" running
  write_install_state done installed
  install_transaction_marker || fail_install "写入安装提交标记失败"
  install_progress 100 complete "安装完成" ok
  install_completion_summary
  
}
