#!/system/bin/sh

case "$0" in
  */*) SCRIPT_DIR=${0%/*} ;;
  *) SCRIPT_DIR=. ;;
esac
MODDIR="$(cd "$SCRIPT_DIR" 2>/dev/null && pwd)"
STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
MATCH_REPORT="$STATE_DIR/match-report.prop"
CONFLICT_REPORT="$STATE_DIR/conflict-report.txt"
RUNTIME_STATUS="$STATE_DIR/runtime-status.prop"
CONFIG_FILE="$MODDIR/system.prop"
OPERATION_LOCK="$STATE_DIR/.operation.lock"

[ -f "$MODDIR/core/common.sh" ] || exit 1
[ -f "$MODDIR/core/runtime.sh" ] || exit 1
[ -f "$MODDIR/core/rule-engine.sh" ] || exit 1
. "$MODDIR/core/common.sh"
. "$MODDIR/core/runtime.sh"
. "$MODDIR/core/rule-engine.sh"
[ -f "$MODDIR/core/input.sh" ] && . "$MODDIR/core/input.sh"

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

report_value() {
  REPORT_KEY="$1"
  REPORT_FILE="$2"
  REPORT_DEFAULT="${3:-0}"
  REPORT_RESULT="$(awk -F= -v key="$REPORT_KEY" '$1 == key { sub(/^[^=]*=/, ""); value=$0 } END { if (value != "") print value }' "$REPORT_FILE" 2>/dev/null)"
  [ -n "$REPORT_RESULT" ] || REPORT_RESULT="$REPORT_DEFAULT"
  printf '%s' "$REPORT_RESULT"
}

health_summary() {
  if ! dex_validate_prop_file "$CONFIG_FILE"; then
    printf '%s' "异常（配置无效）"
    return 0
  fi
  if [ ! -s "$MATCH_REPORT" ] || [ ! -s "$CONFLICT_REPORT" ]; then
    printf '%s' "待检查（缺少安装报告）"
    return 0
  fi
  case "$(report_value status "$RUNTIME_STATUS" pending)" in
    error) printf '%s' "异常（运行时应用失败）" ;;
    warning) printf '%s' "警告（运行时状态需要处理）" ;;
    pending) printf '%s' "待应用（等待系统启动）" ;;
    ok) printf '%s' "正常" ;;
    *) printf '%s' "待检查（运行时状态未知）" ;;
  esac
}

show_status() {
  action_print "Dex2oat Lock $(module_version)"
  action_print "规则: $(report_value status "$MATCH_REPORT" unavailable) / 解析 $(report_value resolved_total "$MATCH_REPORT") / 最终 $(report_value final_total "$MATCH_REPORT")"
  action_print "默认: $(report_value default_total "$MATCH_REPORT") / 忽略 $(report_value ignored_total "$MATCH_REPORT")"
  action_print "冲突: $(report_value conflict_total "$CONFLICT_REPORT") 项，全部跳过"
  action_print "运行: $(report_value status "$RUNTIME_STATUS" pending) / $(report_value reason "$RUNTIME_STATUS" waiting-for-boot)"
  action_print "应用: $(report_value applied_total "$RUNTIME_STATUS") / 未变化 $(report_value unchanged_total "$RUNTIME_STATUS") / 失败 $(report_value failed_total "$RUNTIME_STATUS")"
  action_print "健康: $(health_summary)"
  action_print "配置: $(report_value config_hash "$MATCH_REPORT" unavailable)"
}

show_conflicts() {
  CONFLICT_TOTAL="$(report_value conflict_total "$CONFLICT_REPORT")"
  action_print ""
  action_print "冲突属性: $CONFLICT_TOTAL"
  [ "${CONFLICT_TOTAL:-0}" -gt 0 ] 2>/dev/null || return 0
  awk -F= '/^item\.[0-9]+=/ { sub(/^[^=]*=/, ""); print }' "$CONFLICT_REPORT" 2>/dev/null |
    while IFS='|' read -r ITEM_KEY ITEM_MODULE ITEM_KIND ITEM_CURRENT ITEM_OTHER; do
      [ -n "$ITEM_KEY" ] || continue
      action_print "- $ITEM_KEY | $ITEM_MODULE | $ITEM_KIND"
      action_print "  本模块=$ITEM_CURRENT 其他模块=$ITEM_OTHER"
    done
}

action_lock_begin() {
  mkdir -p "$STATE_DIR" 2>/dev/null || return 1
  chmod 0700 "$STATE_DIR" 2>/dev/null || true
  dex_lock_acquire "$OPERATION_LOCK" 30 action.sh
}

action_lock_end() {
  dex_lock_release
  trap - HUP INT TERM
}

action_interrupted() {
  trap - HUP INT TERM
  dex_rule_cleanup
  dex_lock_release
  exit 1
}

preview_rules() {
  action_lock_begin || {
    action_print "另一个模块操作正在运行"
    return 1
  }
  trap 'action_interrupted' HUP INT TERM
  action_print "正在预览规则与冲突..."
  if ! dex_rule_build "$MODDIR" "$STATE_DIR" preview "$(module_version)"; then
    action_print "规则预览失败"
    action_lock_end
    return 1
  fi
  action_print "规则解析: ${DEX_RULE_RESOLVED_TOTAL:-0}"
  action_print "冲突跳过: ${DEX_RULE_CONFLICT_TOTAL:-0}"
  action_print "最终属性: ${DEX_RULE_FINAL_TOTAL:-0}"
  action_print "配置哈希: $DEX_RULE_CONFIG_HASH"
  if [ "${DEX_RULE_CONFLICT_TOTAL:-0}" -gt 0 ] 2>/dev/null; then
    awk -F= '/^item\.[0-9]+=/ { sub(/^[^=]*=/, ""); print "- " $0 }' "$DEX_RULE_CONFLICT_REPORT" 2>/dev/null
  fi
  dex_rule_cleanup
  action_lock_end
}

rematch_rules() {
  action_lock_begin || {
    action_print "另一个模块操作正在运行"
    return 1
  }
  trap 'action_interrupted' HUP INT TERM
  action_print "正在重新匹配规则..."
  if ! dex_rule_build "$MODDIR" "$STATE_DIR" commit "$(module_version)"; then
    action_print "重新匹配失败，现有配置未提交"
    action_lock_end
    return 1
  fi

  DEX_RUNTIME_PHASE=action-rematch
  DEX_RUNTIME_CONFIG_HASH="$DEX_RULE_CONFIG_HASH"
  DEX_RUNTIME_TOTAL="$DEX_RULE_FINAL_TOTAL"
  DEX_RUNTIME_APPLIED=0
  DEX_RUNTIME_UNCHANGED=0
  DEX_RUNTIME_MISMATCH=0
  DEX_RUNTIME_FAILED=0
  dex_runtime_write_status "$STATE_DIR" pending waiting-for-apply || {
    action_print "配置已生成，但运行状态写入失败"
    action_lock_end
    return 1
  }

  action_print "重新匹配完成: 解析=${DEX_RULE_RESOLVED_TOTAL:-0} 冲突=${DEX_RULE_CONFLICT_TOTAL:-0} 最终=${DEX_RULE_FINAL_TOTAL:-0}"
  action_lock_end
}

dex_runtime_log() {
  :
}

apply_current_config() {
  action_lock_begin || {
    action_print "另一个模块操作正在运行"
    return 1
  }
  trap 'action_interrupted' HUP INT TERM
  action_print "正在应用当前配置..."
  if dex_runtime_apply "$CONFIG_FILE" "$STATE_DIR" action; then
    action_print "应用完成: 写入=$DEX_RUNTIME_APPLIED 未变化=$DEX_RUNTIME_UNCHANGED"
    ACTION_APPLY_RESULT=0
  else
    action_print "应用异常: 不一致=$DEX_RUNTIME_MISMATCH 失败=$DEX_RUNTIME_FAILED"
    ACTION_APPLY_RESULT=1
  fi
  action_lock_end
  return "$ACTION_APPLY_RESULT"
}

prompt_yes() {
  command -v dex_wait_volume_key >/dev/null 2>&1 || return 2
  action_print ""
  action_print "$1"
  action_print "音量上: 是"
  action_print "音量下: 否"
  dex_wait_volume_key 20
}

interactive_menu() {
  show_status
  show_conflicts
  if prompt_yes "是否重新匹配规则？"; then
    rematch_rules || return 1
  fi
  if prompt_yes "是否立即应用当前配置？"; then
    apply_current_config || return 1
  fi
}

ACTION_COMMAND=${1:-menu}
case "$ACTION_COMMAND" in
  status) show_status ;;
  preview|check) preview_rules ;;
  rematch) rematch_rules ;;
  apply) apply_current_config ;;
  conflicts) show_conflicts ;;
  all) rematch_rules && apply_current_config && show_conflicts ;;
  menu) interactive_menu ;;
  *)
    action_print "用法: sh action.sh [status|preview|rematch|apply|conflicts|check|all]"
    exit 2
    ;;
esac
