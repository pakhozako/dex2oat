#!/system/bin/sh

case "$0" in
  */*) MODDIR=${0%/*} ;;
  *) MODDIR=. ;;
esac
STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
BACKUP_DIR="$STATE_DIR/backup"
LOG_DIR="$STATE_DIR/logs"
ACTION_LOG="$LOG_DIR/action.log"
STATE_FILE="$STATE_DIR/state.prop"
PROP_FILE="$MODDIR/system.prop"
SYSTEM_PROP_BAK="$STATE_DIR/system.prop.bak"
ORIGINAL_PROPS="$STATE_DIR/original-props.conf"
CAPTURED_PROPS="$STATE_DIR/captured-props.txt"
MATCHED_PROPS="$STATE_DIR/matched-props.txt"
MATCH_REPORT="$STATE_DIR/match-report.txt"
CONFIG_SOURCE_FILE="$STATE_DIR/config-source.prop"
PROP_LOCK_LIST="$STATE_DIR/prop-lock.list"
RULES_PACK_FILE="$MODDIR/rules/rule-props.pack"
RULES_FILE="$STATE_DIR/rule-props.tsv"
RULES_DECODE_SCRIPT="$MODDIR/scripts/decode-rules.sh"
RUNTIME_PROP_FILE="$STATE_DIR/runtime-props.tmp"
RUNTIME_PROP_HASH_FILE="$STATE_DIR/runtime-props.hash"
ACTION_LOCK_DIR="$STATE_DIR/.action.lock"
DEBUG_FILE="$STATE_DIR/debug.prop"
ACTION_CMD="${1:-menu}"

[ -f "$MODDIR/core/common.sh" ] && . "$MODDIR/core/common.sh"
[ -f "$MODDIR/core/property.sh" ] && . "$MODDIR/core/property.sh"
[ -f "$MODDIR/core/input.sh" ] && . "$MODDIR/core/input.sh"
case "$ACTION_CMD" in
  dry-run|preview) ;;
  *) [ -f "$MODDIR/core/state.sh" ] && . "$MODDIR/core/state.sh" ;;
esac

case "$ACTION_CMD" in
  dry-run|preview) ;;
  *)
    [ -f "$MODDIR/core/diagnostics.sh" ] && . "$MODDIR/core/diagnostics.sh"
    [ -f "$MODDIR/core/snapshot.sh" ] && . "$MODDIR/core/snapshot.sh"
    [ -f "$MODDIR/core/protection.sh" ] && . "$MODDIR/core/protection.sh"
    ;;
esac

action_print() {
  if command -v ui_print >/dev/null 2>&1; then
    ui_print "$@"
  else
    printf '%s\n' "$@"
  fi
}

module_version() {
  sed -n 's/^version=//p' "$MODDIR/module.prop" 2>/dev/null | head -n 1
}

now_text() {
  if command -v dex_now >/dev/null 2>&1; then
    dex_now
  else
    date '+%Y-%m-%d %H:%M:%S'
  fi
}

action_debug_enabled() {
  [ "${DEX2OAT_DEBUG:-}" = "1" ] && return 0
  [ -f "$DEBUG_FILE" ] && grep -q '^debug.enabled=yes$' "$DEBUG_FILE" 2>/dev/null
}

log_action_level() {
  ACTION_LOG_LEVEL="$1"
  shift
  mkdir -p "$LOG_DIR" 2>/dev/null || true
  if command -v dex_rotate_log >/dev/null 2>&1; then
    dex_rotate_log "$ACTION_LOG" 262144
  fi
  printf '%s [%s] %s\n' "$(now_text)" "$ACTION_LOG_LEVEL" "$*" >> "$ACTION_LOG" 2>/dev/null || true
}

log_action() {
  log_action_level INFO "$@"
}

action_emit() {
  ACTION_LEVEL="$1"
  ACTION_ICON="$2"
  shift 2
  [ "$ACTION_LEVEL" = DEBUG ] && ! action_debug_enabled && return 0
  action_print "$ACTION_ICON [$ACTION_LEVEL] $*"
  log_action_level "$ACTION_LEVEL" "$*"
}

action_info() { action_emit INFO "•" "$@"; }
action_success() { action_emit SUCCESS "✓" "$@"; }
action_warning() { action_emit WARNING "⚠" "$@"; }
action_error() { action_emit ERROR "❌" "$@"; }

action_line() {
  action_print "================================================"
}

action_title() {
  action_print ""
  action_line
  action_print "$1"
  action_line
}

action_kv() {
  ACTION_KV_VALUE="$2"
  [ -n "$ACTION_KV_VALUE" ] || ACTION_KV_VALUE="-"
  action_print "$(printf '%-22s: %s' "$1" "$ACTION_KV_VALUE")"
}

file_value() {
  FILE_VALUE_KEY="$1"
  FILE_VALUE_PATH="$2"
  [ -f "$FILE_VALUE_PATH" ] || return 0
  sed -n "s/^$FILE_VALUE_KEY=//p" "$FILE_VALUE_PATH" 2>/dev/null | tail -n 1
}

state_value() {
  KEY="$1"
  if command -v state_get >/dev/null 2>&1; then
    state_get "$KEY"
  elif [ -f "$STATE_FILE" ]; then
    sed -n "s/^$KEY=//p" "$STATE_FILE" 2>/dev/null | tail -n 1
  fi
}

prop_count() {
  [ -f "$1" ] || { printf '0\n'; return 0; }
  awk -F= 'index($0,"=")>0 { key=$1; gsub(/\r/,"",key); sub(/^[[:space:]]*/,"",key); sub(/[[:space:]]*$/,"",key); if(key != "" && substr(key,1,1) != "#") count++ } END { print count + 0 }' "$1" 2>/dev/null
}

file_size() {
  [ -f "$1" ] || { printf '0\n'; return 0; }
  wc -c < "$1" 2>/dev/null | tr -d ' '
}

show_status() {
  action_title "dex2oat-lock 操作面板"
  action_kv "版本" "$(module_version)"
  action_kv "汇总" "$(state_value summary.status)"
  action_kv "原因" "$(state_value summary.message)"
  action_kv "匹配" "$(state_value match.status) $(state_value match.reason)"
  action_kv "配置" "$(state_value config.source) $(state_value config.prop_count) 项属性"
  action_kv "应用" "$(state_value apply.status) $(state_value apply.reason)"
  action_kv "服务" "$(state_value service.status) $(state_value service.health)"
  action_kv "健康" "$(state_value health.status) $(state_value health.reason)"
  action_kv "完整性" "$(state_value integrity.status) $(state_value integrity.reason)"
  action_kv "system.prop" "$PROP_FILE"
  action_kv "状态目录" "$STATE_DIR"
}

action_apply_prop() {
  PROP_KEY="$1"
  PROP_VALUE="$2"
  dex_apply_checked_prop "$PROP_KEY" "$PROP_VALUE"
  APPLY_STATUS=$?
  case "$APPLY_STATUS" in
    1)
      log_action_level ERROR "应用失败 key=$PROP_KEY 目标=$PROP_VALUE 旧值=$DEX_CHECKED_OLD_VALUE 新值=$DEX_CHECKED_NEW_VALUE 工具=$DEX_CHECKED_APPLY_TOOL code=$DEX_CHECKED_APPLY_CODE 原因=$DEX_CHECKED_FAILURE_REASON"
      ;;
    2)
      log_action_level WARNING "应用不一致 key=$PROP_KEY 目标=$PROP_VALUE 旧值=$DEX_CHECKED_OLD_VALUE 新值=$DEX_CHECKED_NEW_VALUE 工具=$DEX_CHECKED_APPLY_TOOL code=$DEX_CHECKED_APPLY_CODE"
      ;;
  esac
  return "$APPLY_STATUS"
}

apply_current_props() {
  mkdir -p "$STATE_DIR" "$LOG_DIR" 2>/dev/null || true
  dex_prepare_runtime_rules "$RULES_DECODE_SCRIPT" "$RULES_PACK_FILE" "$RULES_FILE" || log_action_level WARNING "手动应用时跳过规则准备"
  [ -s "$PROP_FILE" ] || {
    action_error "system.prop 缺失或为空"
    return 1
  }

  TOTAL=0
  APPLIED=0
  MATCHED=0
  MISMATCH=0
  FAILED=0
  while IFS='=' read -r PROP_KEY PROP_VALUE || [ -n "$PROP_KEY" ]; do
    PROP_KEY="$(printf '%s' "$PROP_KEY" | tr -d '\r' | sed 's/[[:space:]]*$//')"
    PROP_VALUE="$(printf '%s' "$PROP_VALUE" | tr -d '\r')"
    case "$PROP_KEY" in
      ""|\#*) continue ;;
    esac
    dex_is_runtime_prop "$PROP_KEY" "$MATCHED_PROPS" "$RULES_FILE" allow-empty || continue
    TOTAL=$((TOTAL + 1))
    action_apply_prop "$PROP_KEY" "$PROP_VALUE"
    case "$?" in
      0) APPLIED=$((APPLIED + 1)) ;;
      2) MISMATCH=$((MISMATCH + 1)) ;;
      3) MATCHED=$((MATCHED + 1)) ;;
      *) FAILED=$((FAILED + 1)) ;;
    esac
  done < "$PROP_FILE"

  APPLY_STATUS=ok
  APPLY_REASON=action-apply-ok
  [ "$MISMATCH" -gt 0 ] 2>/dev/null && { APPLY_STATUS=warning; APPLY_REASON=action-apply-mismatch; }
  [ "$FAILED" -gt 0 ] 2>/dev/null && { APPLY_STATUS=error; APPLY_REASON=action-apply-failed; }
  if command -v state_update >/dev/null 2>&1; then
    state_update \
      "apply.status=$APPLY_STATUS" \
      "apply.reason=$APPLY_REASON" \
      "apply.prop_total=$TOTAL" \
      "apply.applied_total=$APPLIED" \
      "apply.matched_total=$MATCHED" \
      "apply.mismatch_total=$MISMATCH" \
      "apply.failed_total=$FAILED" \
      "apply.updated_at=$(now_text)" || true
    state_recompute_summary || true
  fi
  log_action_level SUCCESS "应用完成 总数=$TOTAL 已应用=$APPLIED 已匹配=$MATCHED 不一致=$MISMATCH 失败=$FAILED"
  action_success "应用完成：总数=$TOTAL 已应用=$APPLIED 已匹配=$MATCHED 不一致=$MISMATCH 失败=$FAILED"
  [ "$FAILED" -eq 0 ] 2>/dev/null
}

backup_original_props_if_missing() {
  [ -s "$ORIGINAL_PROPS" ] && return 0
  [ -s "$RULES_FILE" ] || return 0
  : > "$ORIGINAL_PROPS" 2>/dev/null || return 0
  awk -F "$(printf '\t')" 'NR > 1 && $3 != "" { print $3 }' "$RULES_FILE" 2>/dev/null | sort -u | while IFS= read -r PROP_KEY; do
    dex_valid_prop_key "$PROP_KEY" || continue
    CURRENT_VALUE="$(getprop "$PROP_KEY")"
    if [ -n "$CURRENT_VALUE" ]; then
      printf '%s=%s\n' "$PROP_KEY" "$CURRENT_VALUE" >> "$ORIGINAL_PROPS" 2>/dev/null || true
    else
      printf '@unset:%s\n' "$PROP_KEY" >> "$ORIGINAL_PROPS" 2>/dev/null || true
    fi
  done
  chmod 0600 "$ORIGINAL_PROPS" 2>/dev/null || true
}

cleanup_old_dry_runs() {
  DRY_BASE="$1"
  case "$DRY_BASE" in
    /data/local/tmp|/tmp|/dev)
      for OLD_DRY_DIR in "$DRY_BASE"/dex2oat-lock-dry-run.*; do
        [ -d "$OLD_DRY_DIR" ] || continue
        rm -rf "$OLD_DRY_DIR" 2>/dev/null || true
      done
      ;;
  esac
}

dry_run_rules() {
  DRY_BASE="${TMPDIR:-/data/local/tmp}"
  cleanup_old_dry_runs "$DRY_BASE"
  DRY_DIR="$DRY_BASE/dex2oat-lock-dry-run.$$"
  DRY_RULES="$DRY_DIR/rule-props.tsv"
  mkdir -p "$DRY_DIR" || return 1
  chmod 0700 "$DRY_DIR" 2>/dev/null || true
  dex_prepare_runtime_rules "$RULES_DECODE_SCRIPT" "$RULES_PACK_FILE" "$DRY_RULES" || return 1
  sh "$MODDIR/scripts/capture-props.sh" "$DRY_DIR/captured.prop" "" "$DRY_RULES" || : > "$DRY_DIR/captured.prop"
  sh "$MODDIR/scripts/generate-props.sh" "$DRY_DIR/captured.prop" "$DRY_RULES" "$DRY_DIR/system.prop" "$DRY_DIR/matched.prop" "$DRY_DIR/report.txt" "$DRY_DIR/source.prop" "$(module_version)" "$ORIGINAL_PROPS" || return 1
  chmod 0600 "$DRY_DIR"/* 2>/dev/null || true
  action_success "只读规则预演完成"
  action_kv "报告" "$DRY_DIR/report.txt"
}

refresh_diagnostics() {
  mkdir -p "$STATE_DIR" "$LOG_DIR" 2>/dev/null || true
  action_info "刷新诊断信息"
  if diagnostic_run force; then
    log_action_level SUCCESS "诊断信息已刷新"
    action_success "诊断信息已刷新"
  else
    log_action_level ERROR "诊断刷新失败"
    action_error "诊断刷新失败，请查看状态摘要"
    return 1
  fi
}

export_diagnostics() {
  diagnostic_run scheduled || true
  EXPORT_PATH="$(diagnostic_export)" || { action_error "诊断包导出失败"; return 1; }
  action_success "诊断包已导出"
  action_kv "路径" "$EXPORT_PATH"
}

rollback_snapshot() {
  snapshot_restore_latest "$PROP_FILE" || { action_warning "没有可用快照"; return 1; }
  cp -af "$PROP_FILE" "$SYSTEM_PROP_BAK" 2>/dev/null || { action_error "更新 system.prop 备份失败"; return 1; }
  dex_write_prop_lock_list "$PROP_FILE" "$PROP_LOCK_LIST" atomic-final || { action_error "更新属性锁失败"; return 1; }
  action_success "已恢复最近配置快照"
}

rematch_rules() {
  snapshot_create "$PROP_FILE" action-rematch-before 2>/dev/null || true
  mkdir -p "$STATE_DIR" "$LOG_DIR" 2>/dev/null || true
  MODULE_VERSION="$(module_version)"
  [ -n "$MODULE_VERSION" ] || MODULE_VERSION=unknown
  action_info "根据设备属性重新生成 system.prop"
  log_action "重新匹配开始 version=$MODULE_VERSION"
  if command -v state_update >/dev/null 2>&1; then
    state_update \
      "match.status=running" \
      "match.reason=action-rematch" \
      "match.updated_at=$(now_text)" \
      "config.status=running" \
      "config.reason=action-rematch" || true
  fi

  dex_prepare_runtime_rules "$RULES_DECODE_SCRIPT" "$RULES_PACK_FILE" "$RULES_FILE" || {
    action_error "规则包不可用"
    command -v state_update >/dev/null 2>&1 && state_update "match.status=failed" "match.reason=rules_decode_failed" "config.status=failed" "config.reason=rules_decode_failed" || true
    return 1
  }
  backup_original_props_if_missing
  sh "$MODDIR/scripts/capture-props.sh" "$CAPTURED_PROPS" "" "$RULES_FILE" || : > "$CAPTURED_PROPS"
  if ! sh "$MODDIR/scripts/generate-props.sh" "$CAPTURED_PROPS" "$RULES_FILE" "$PROP_FILE" "$MATCHED_PROPS" "$MATCH_REPORT" "$CONFIG_SOURCE_FILE" "$MODULE_VERSION" "$ORIGINAL_PROPS"; then
    action_error "规则匹配失败"
    command -v state_update >/dev/null 2>&1 && state_update "match.status=failed" "match.reason=action_generation_failed" "config.status=failed" "config.reason=action_generation_failed" || true
    log_action_level ERROR "重新匹配失败"
    return 1
  fi

  cp -af "$PROP_FILE" "$SYSTEM_PROP_BAK" 2>/dev/null || { action_error "更新 system.prop 备份失败"; return 1; }
  chmod 0644 "$PROP_FILE" 2>/dev/null || true
  chmod 0600 "$SYSTEM_PROP_BAK" "$MATCHED_PROPS" "$MATCH_REPORT" "$CONFIG_SOURCE_FILE" 2>/dev/null || true
  dex_write_prop_lock_list "$PROP_FILE" "$PROP_LOCK_LIST" atomic-final || true
  rm -f "$RUNTIME_PROP_FILE" "$RUNTIME_PROP_HASH_FILE" 2>/dev/null || true

  MATCHED_TOTAL="$(file_value matched_total "$MATCH_REPORT")"
  [ -n "$MATCHED_TOTAL" ] || MATCHED_TOTAL=0
  if command -v state_update >/dev/null 2>&1; then
    state_update \
      "match.status=$(file_value status "$MATCH_REPORT")" \
      "match.mode=rule-driven" \
      "match.reason=$(file_value reason "$MATCH_REPORT")" \
      "match.confidence=$(file_value confidence "$MATCH_REPORT")" \
      "match.matched_total=$MATCHED_TOTAL" \
      "match.captured_total=$(file_value captured_total "$MATCH_REPORT")" \
      "match.default_total=$(file_value default_total "$MATCH_REPORT")" \
      "match.fallback_total=$(file_value fallback_total "$MATCH_REPORT")" \
      "match.unmatched_total=$(file_value unmatched_total "$MATCH_REPORT")" \
      "match.updated_at=$(now_text)" || true
    state_set_config_summary "$PROP_FILE" auto-rules action-rematch 2>/dev/null || true
    state_recompute_summary || true
  fi
  action_success "重新匹配完成：命中=$MATCHED_TOTAL，属性=$(prop_count "$PROP_FILE")"
  log_action_level SUCCESS "重新匹配完成 matched=$MATCHED_TOTAL"
}

show_rule_statistics() {
  action_title "当前规则统计"
  action_kv "状态" "$(file_value status "$MATCH_REPORT")"
  action_kv "原因" "$(file_value reason "$MATCH_REPORT")"
  action_kv "置信度" "$(file_value confidence "$MATCH_REPORT")"
  action_kv "采集属性" "$(file_value captured_total "$MATCH_REPORT")"
  action_kv "命中规则" "$(file_value matched_total "$MATCH_REPORT")"
  action_kv "默认规则" "$(file_value default_total "$MATCH_REPORT")"
  action_kv "忽略规则" "$(file_value unmatched_total "$MATCH_REPORT")"
  action_kv "重复跳过" "$(file_value skipped_duplicate_total "$MATCH_REPORT")"
  action_kv "非法输入" "$(file_value invalid_total "$MATCH_REPORT")"
}

show_config_summary() {
  action_title "当前配置摘要"
  action_kv "配置来源" "$(file_value source "$CONFIG_SOURCE_FILE")"
  action_kv "配置状态" "$(file_value status "$CONFIG_SOURCE_FILE")"
  action_kv "生成时间" "$(file_value updated_at "$CONFIG_SOURCE_FILE")"
  action_kv "属性数量" "$(prop_count "$PROP_FILE")"
  action_kv "配置 Hash" "$(dex_hash_file "$PROP_FILE")"
  action_kv "system.prop" "$PROP_FILE"
  action_kv "属性锁" "$PROP_LOCK_LIST"
}

show_health_report() {
  action_title "健康报告"
  action_kv "状态" "$(file_value status "$STATE_DIR/health.log")"
  action_kv "原因" "$(file_value reason "$STATE_DIR/health.log")"
  action_kv "文件状态" "$(file_value files_ok "$STATE_DIR/health.log")"
  action_kv "属性状态" "$(file_value props_ok "$STATE_DIR/health.log")"
  action_kv "自动修复" "$(file_value auto_fixed "$STATE_DIR/health.log")"
  action_kv "检查时间" "$(file_value checked_at "$STATE_DIR/health.log")"
}

show_integrity_report() {
  action_title "完整性报告"
  action_kv "状态" "$(file_value status "$STATE_DIR/integrity-report.txt")"
  action_kv "原因" "$(file_value reason "$STATE_DIR/integrity-report.txt")"
  action_kv "基线版本" "$(file_value baseline_version "$STATE_DIR/integrity-report.txt")"
  action_kv "检查文件" "$(file_value checked_total "$STATE_DIR/integrity-report.txt")"
  action_kv "缺失文件" "$(file_value missing_total "$STATE_DIR/integrity-report.txt")"
  action_kv "变更文件" "$(file_value changed_total "$STATE_DIR/integrity-report.txt")"
  action_kv "运行时警告" "$(file_value runtime_warning_total "$STATE_DIR/integrity-report.txt")"
}

show_conflict_report() {
  action_title "冲突检测结果"
  action_kv "状态" "$(file_value scan_status "$STATE_DIR/conflict-report.txt")"
  action_kv "原因" "$(file_value reason "$STATE_DIR/conflict-report.txt")"
  action_kv "冲突数量" "$(file_value conflict_total "$STATE_DIR/conflict-report.txt")"
  action_kv "扫描模块" "$(file_value scanned_modules "$STATE_DIR/conflict-report.txt")"
  action_kv "报告" "$STATE_DIR/conflict-report.txt"
}

show_snapshots() {
  SNAPSHOT_DIR="${SNAPSHOT_DIR:-$STATE_DIR/snapshots}"
  action_title "最近快照"
  action_kv "状态" "$(state_value snapshot.status)"
  action_kv "最近文件" "$(state_value snapshot.last_file)"
  action_kv "Hash" "$(state_value snapshot.hash)"
  action_kv "大小" "$(state_value snapshot.size)"
  action_kv "原因" "$(state_value snapshot.reason)"
  if [ -d "$SNAPSHOT_DIR" ]; then
    action_kv "快照数量" "$(find "$SNAPSHOT_DIR" -name '*.prop' -type f 2>/dev/null | wc -l | tr -d ' ')"
  fi
}

show_install_info() {
  action_title "安装信息"
  action_kv "版本" "$(file_value version "$STATE_DIR/install-state.prop")"
  action_kv "状态" "$(file_value status "$STATE_DIR/install-state.prop")"
  action_kv "来源" "$(file_value source "$STATE_DIR/install-state.prop")"
  action_kv "命中规则" "$(file_value matched_total "$STATE_DIR/install-state.prop")"
  action_kv "检查模式" "$(file_value check_mode "$STATE_DIR/install-state.prop")"
  action_kv "更新时间" "$(file_value updated_at "$STATE_DIR/install-state.prop")"
  action_kv "协议版本" "$(file_value agreement.version "$STATE_DIR/agreement.prop")"
  action_kv "协议确认" "$(file_value agreement.accepted "$STATE_DIR/agreement.prop")"
}

show_runtime_info() {
  action_title "运行信息"
  action_kv "应用状态" "$(state_value apply.status)"
  action_kv "应用原因" "$(state_value apply.reason)"
  action_kv "应用总数" "$(state_value apply.prop_total)"
  action_kv "已应用" "$(state_value apply.applied_total)"
  action_kv "服务状态" "$(state_value service.status)"
  action_kv "服务健康" "$(state_value service.health)"
  action_kv "失败次数" "$(state_value protection.failure_count)"
  action_kv "保护模式" "$(state_value protection.mode)"
}

show_state_info() {
  action_title "State 信息"
  action_kv "Schema" "$(state_value schema_version)"
  action_kv "模块版本" "$(state_value module_version)"
  action_kv "生命周期" "$(state_value lifecycle.status) $(state_value lifecycle.phase)"
  action_kv "摘要状态" "$(state_value summary.status)"
  action_kv "摘要原因" "$(state_value summary.message)"
  action_kv "状态文件" "$STATE_FILE"
  action_kv "状态大小" "$(file_size "$STATE_FILE")"
}

show_rule_pack_info() {
  action_title "Rule Pack 信息"
  action_kv "模块版本" "$(module_version)"
  action_kv "规则包" "$RULES_PACK_FILE"
  action_kv "规则包大小" "$(file_size "$RULES_PACK_FILE")"
  action_kv "规则包 Hash" "$(dex_hash_file "$RULES_PACK_FILE")"
  action_kv "规则版本" "$(file_value version "$RULES_PACK_FILE")"
  action_kv "规则长度" "$(file_value length "$RULES_PACK_FILE")"
  action_kv "TSV 文件" "$RULES_FILE"
}

rerun_health_check() {
  sh "$MODDIR/core/health-check.sh" "$MODDIR" 2>/dev/null || { action_warning "健康检查完成但存在警告"; return 1; }
  action_success "健康检查已重新执行"
}

rerun_integrity_check() {
  sh "$MODDIR/core/integrity-check.sh" "$MODDIR" 2>/dev/null || { action_warning "完整性检查完成但未通过"; return 1; }
  action_success "完整性检查已重新执行"
}

rerun_conflict_scan() {
  sh "$MODDIR/core/conflict-detect.sh" "$MODDIR" 2>/dev/null || { action_warning "冲突扫描完成但存在警告"; return 1; }
  action_success "模块冲突已重新扫描"
}

rebuild_property_lock() {
  dex_write_prop_lock_list "$PROP_FILE" "$PROP_LOCK_LIST" atomic-final || { action_error "重建 Property Lock 失败"; return 1; }
  action_success "Property Lock 已重建"
}

rebuild_state_summary() {
  state_recompute_summary || { action_error "重建状态摘要失败"; return 1; }
  action_success "状态摘要已重建"
}

clean_diagnostic_cache() {
  DIAGNOSTIC_DIR="${DIAGNOSTIC_DIR:-$STATE_DIR/diagnostics}"
  case "$DIAGNOSTIC_DIR" in "$STATE_DIR"/diagnostics) rm -f "$DIAGNOSTIC_DIR"/dex2oat-lock-diagnostic-*.txt 2>/dev/null || true ;; *) return 1 ;; esac
  action_success "诊断缓存已清理"
}

clean_snapshots() {
  SNAPSHOT_DIR="${SNAPSHOT_DIR:-$STATE_DIR/snapshots}"
  case "$SNAPSHOT_DIR" in "$STATE_DIR"/snapshots)
    rm -f "$SNAPSHOT_DIR"/*.prop "$SNAPSHOT_DIR/index.tsv" 2>/dev/null || true
    command -v state_update >/dev/null 2>&1 && state_update "snapshot.status=reset" "snapshot.reason=action-clean" "snapshot.updated_at=$(now_text)" || true
    ;;
    *) return 1 ;;
  esac
  action_success "历史快照已清理"
}

clean_runtime_logs() {
  case "$STATE_DIR" in
    /data/adb/dex2oat-lock|*/state|*/dex2oat-lock)
      rm -f "$STATE_DIR/install.log" "$STATE_DIR/service.log" "$STATE_DIR/health-history.tsv" "$LOG_DIR"/*.log "$LOG_DIR"/*.log.1 2>/dev/null || true
      ;;
    *) return 1 ;;
  esac
  action_success "运行日志已清理"
}

restore_default_config() {
  [ -s "$BACKUP_DIR/system.prop.factory" ] || { action_warning "默认配置备份不存在"; return 1; }
  snapshot_create "$PROP_FILE" action-restore-default-before 2>/dev/null || true
  cp -af "$BACKUP_DIR/system.prop.factory" "$PROP_FILE" 2>/dev/null || { action_error "恢复默认配置失败"; return 1; }
  chmod 0644 "$PROP_FILE" 2>/dev/null || true
  cp -af "$PROP_FILE" "$SYSTEM_PROP_BAK" 2>/dev/null || true
  dex_write_prop_lock_list "$PROP_FILE" "$PROP_LOCK_LIST" atomic-final || true
  command -v state_set_config_summary >/dev/null 2>&1 && state_set_config_summary "$PROP_FILE" factory action-restore-default || true
  action_success "默认配置已恢复"
}

debug_mode_on() {
  mkdir -p "$STATE_DIR" 2>/dev/null || true
  { printf 'debug.enabled=yes\n'; printf 'debug.updated_at=%s\n' "$(now_text)"; } > "$DEBUG_FILE" 2>/dev/null || return 1
  chmod 0600 "$DEBUG_FILE" 2>/dev/null || true
  action_success "调试模式已打开"
}

debug_mode_off() {
  mkdir -p "$STATE_DIR" 2>/dev/null || true
  { printf 'debug.enabled=no\n'; printf 'debug.updated_at=%s\n' "$(now_text)"; } > "$DEBUG_FILE" 2>/dev/null || return 1
  chmod 0600 "$DEBUG_FILE" 2>/dev/null || true
  action_success "调试模式已关闭"
}

show_menu_overview() {
  action_title "Action 菜单"
  action_print "音量 +：执行当前项目"
  action_print "音量 -：跳过并查看下一项"
  action_print ""
  action_print "01 重新匹配规则"
  action_print "02 立即应用当前运行时属性"
  action_print "03 只读规则预演（Dry-run）"
  action_print "04 刷新诊断信息"
  action_print "05 导出诊断包"
  action_print "06 回滚最近配置快照"
  action_print "07 重置运行保护状态"
  action_print "08 查看当前规则统计"
  action_print "09 查看当前配置摘要"
  action_print "10 查看当前状态"
  action_print "11 查看健康报告"
  action_print "12 查看完整性报告"
  action_print "13 查看冲突检测结果"
  action_print "14 查看最近快照"
  action_print "15 查看安装信息"
  action_print "16 查看运行信息"
  action_print "17 查看 State 信息"
  action_print "18 查看 Rule Pack 信息"
  action_print "19 重新执行健康检查"
  action_print "20 重新执行完整性检查"
  action_print "21 重新扫描模块冲突"
  action_print "22 重新生成 system.prop"
  action_print "23 重建 Property Lock"
  action_print "24 重建状态摘要"
  action_print "25 清理诊断缓存"
  action_print "26 清理历史快照"
  action_print "27 清理运行日志"
  action_print "28 恢复默认配置"
  action_print "29 打开调试模式"
  action_print "30 关闭调试模式"
  action_print "31 退出"
}

menu_item() {
  MENU_INDEX="$1"
  MENU_TOTAL="$2"
  MENU_LABEL="$3"
  MENU_COMMAND="$4"
  action_print ""
  action_print "[$MENU_INDEX/$MENU_TOTAL] $MENU_LABEL"
  action_print "音量 +：执行    音量 -：跳过"
  dex_wait_volume_key 20
  MENU_KEY_STATUS=$?
  case "$MENU_KEY_STATUS" in
    0)
      [ "$MENU_COMMAND" = exit-menu ] && { action_success "已退出"; return 3; }
      "$MENU_COMMAND" || true
      return 0
      ;;
    1)
      return 0
      ;;
    *)
      action_warning "未检测到音量键输入，已退出菜单"
      return 3
      ;;
  esac
}

run_menu() {
  show_status
  show_menu_overview
  MENU_TOTAL=31
  menu_item 01 "$MENU_TOTAL" "重新匹配规则" rematch_rules || return 0
  menu_item 02 "$MENU_TOTAL" "立即应用当前运行时属性" apply_current_props || return 0
  menu_item 03 "$MENU_TOTAL" "只读规则预演（Dry-run）" dry_run_rules || return 0
  menu_item 04 "$MENU_TOTAL" "刷新诊断信息" refresh_diagnostics || return 0
  menu_item 05 "$MENU_TOTAL" "导出诊断包" export_diagnostics || return 0
  menu_item 06 "$MENU_TOTAL" "回滚最近配置快照" rollback_snapshot || return 0
  menu_item 07 "$MENU_TOTAL" "重置运行保护状态" protection_reset_action || return 0
  menu_item 08 "$MENU_TOTAL" "查看当前规则统计" show_rule_statistics || return 0
  menu_item 09 "$MENU_TOTAL" "查看当前配置摘要" show_config_summary || return 0
  menu_item 10 "$MENU_TOTAL" "查看当前状态" show_status || return 0
  menu_item 11 "$MENU_TOTAL" "查看健康报告" show_health_report || return 0
  menu_item 12 "$MENU_TOTAL" "查看完整性报告" show_integrity_report || return 0
  menu_item 13 "$MENU_TOTAL" "查看冲突检测结果" show_conflict_report || return 0
  menu_item 14 "$MENU_TOTAL" "查看最近快照" show_snapshots || return 0
  menu_item 15 "$MENU_TOTAL" "查看安装信息" show_install_info || return 0
  menu_item 16 "$MENU_TOTAL" "查看运行信息" show_runtime_info || return 0
  menu_item 17 "$MENU_TOTAL" "查看 State 信息" show_state_info || return 0
  menu_item 18 "$MENU_TOTAL" "查看 Rule Pack 信息" show_rule_pack_info || return 0
  menu_item 19 "$MENU_TOTAL" "重新执行健康检查" rerun_health_check || return 0
  menu_item 20 "$MENU_TOTAL" "重新执行完整性检查" rerun_integrity_check || return 0
  menu_item 21 "$MENU_TOTAL" "重新扫描模块冲突" rerun_conflict_scan || return 0
  menu_item 22 "$MENU_TOTAL" "重新生成 system.prop" rematch_rules || return 0
  menu_item 23 "$MENU_TOTAL" "重建 Property Lock" rebuild_property_lock || return 0
  menu_item 24 "$MENU_TOTAL" "重建状态摘要" rebuild_state_summary || return 0
  menu_item 25 "$MENU_TOTAL" "清理诊断缓存" clean_diagnostic_cache || return 0
  menu_item 26 "$MENU_TOTAL" "清理历史快照" clean_snapshots || return 0
  menu_item 27 "$MENU_TOTAL" "清理运行日志" clean_runtime_logs || return 0
  menu_item 28 "$MENU_TOTAL" "恢复默认配置" restore_default_config || return 0
  menu_item 29 "$MENU_TOTAL" "打开调试模式" debug_mode_on || return 0
  menu_item 30 "$MENU_TOTAL" "关闭调试模式" debug_mode_off || return 0
  menu_item 31 "$MENU_TOTAL" "退出" exit-menu || return 0
  action_success "操作完成"
}

protection_reset_action() {
  protection_reset && action_success "运行保护状态已重置"
}

usage() {
  action_print "用法：sh action.sh [status|menu|rematch|apply|diagnose|export|dry-run|rollback|protection-reset|rule-stats|config-summary|health-report|integrity-report|conflict-report|snapshots|install-info|runtime-info|state-info|rule-pack-info|health-check|integrity-check|conflict-scan|regenerate-prop|rebuild-lock|rebuild-state-summary|clean-diagnostics|clean-snapshots|clean-logs|restore-default|debug-on|debug-off|all]"
}

run_locked() {
  case "$1" in
    status|"") show_status ;;
    rematch) rematch_rules ;;
    apply) apply_current_props ;;
    diagnose|diagnostics) refresh_diagnostics ;;
    export|diagnostic-export) export_diagnostics ;;
    dry-run|preview) dry_run_rules ;;
    rollback) rollback_snapshot ;;
    protection-reset) protection_reset_action ;;
    rule-stats) show_rule_statistics ;;
    config-summary) show_config_summary ;;
    health-report) show_health_report ;;
    integrity-report) show_integrity_report ;;
    conflict-report) show_conflict_report ;;
    snapshots|snapshot-list) show_snapshots ;;
    install-info) show_install_info ;;
    runtime-info) show_runtime_info ;;
    state-info) show_state_info ;;
    rule-pack-info) show_rule_pack_info ;;
    health-check) rerun_health_check ;;
    integrity-check) rerun_integrity_check ;;
    conflict-scan) rerun_conflict_scan ;;
    regenerate-prop) rematch_rules ;;
    rebuild-lock) rebuild_property_lock ;;
    rebuild-state-summary) rebuild_state_summary ;;
    clean-diagnostics) clean_diagnostic_cache ;;
    clean-snapshots) clean_snapshots ;;
    clean-logs) clean_runtime_logs ;;
    restore-default) restore_default_config ;;
    debug-on) debug_mode_on ;;
    debug-off) debug_mode_off ;;
    all)
      rematch_rules && apply_current_props
      refresh_diagnostics
      ;;
    menu) run_menu ;;
    *) usage; return 2 ;;
  esac
}

case "$ACTION_CMD" in
  dry-run|preview)
    run_locked "$ACTION_CMD"
    exit $?
    ;;
esac
mkdir -p "$STATE_DIR" "$LOG_DIR" 2>/dev/null || true
if command -v dex_with_lock >/dev/null 2>&1; then
  dex_with_lock "$ACTION_LOCK_DIR" 60 run_locked "$ACTION_CMD"
else
  run_locked "$ACTION_CMD"
fi
