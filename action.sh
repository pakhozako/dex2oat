#!/system/bin/sh

MODDIR=${0%/*}
STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
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

[ -f "$MODDIR/core/common.sh" ] && . "$MODDIR/core/common.sh"
[ -f "$MODDIR/core/property.sh" ] && . "$MODDIR/core/property.sh"
[ -f "$MODDIR/core/input.sh" ] && . "$MODDIR/core/input.sh"
[ -f "$MODDIR/core/state.sh" ] && . "$MODDIR/core/state.sh"

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

log_action() {
  mkdir -p "$LOG_DIR" 2>/dev/null || true
  if command -v dex_rotate_log >/dev/null 2>&1; then
    dex_rotate_log "$ACTION_LOG" 262144
  fi
  printf '%s %s\n' "$(now_text)" "$*" >> "$ACTION_LOG" 2>/dev/null || true
}

state_value() {
  KEY="$1"
  if command -v state_get >/dev/null 2>&1; then
    state_get "$KEY"
  elif [ -f "$STATE_FILE" ]; then
    sed -n "s/^$KEY=//p" "$STATE_FILE" 2>/dev/null | tail -n 1
  fi
}

summary_value() {
  SUMMARY_KEY="$1"
  SUMMARY_FILE="$2"
  SUMMARY_DEFAULT="${3:-0}"
  SUMMARY_RESULT=""
  [ -s "$SUMMARY_FILE" ] && SUMMARY_RESULT="$(sed -n "s/^$SUMMARY_KEY=//p" "$SUMMARY_FILE" 2>/dev/null | head -n 1)"
  [ -n "$SUMMARY_RESULT" ] || SUMMARY_RESULT="$SUMMARY_DEFAULT"
  printf '%s' "$SUMMARY_RESULT"
}

show_status() {
  action_print "Dex2oat Lock $(module_version)"
  action_print "状态: $(state_value summary.status) $(state_value summary.message)"
  action_print "规则: 命中=$(summary_value matched_total "$MATCH_REPORT") 默认=$(summary_value default_total "$MATCH_REPORT") 未匹配=$(summary_value unmatched_total "$MATCH_REPORT")"
  action_print "配置: $(state_value config.source) $(state_value config.prop_count) 项属性"
  action_print "运行: $(state_value apply.status) $(state_value service.health)"
  action_print "健康: $(state_value health.status) $(state_value health.reason)"
  action_print "完整性: $(state_value integrity.status) $(state_value integrity.reason)"
  action_print "冲突: $(state_value conflict.status) $(state_value conflict.total) 项"
}

prompt_yes() {
  action_print ""
  action_print "$1"
  action_print "音量上：是"
  action_print "音量下：否"
  action_print "等待音量键输入..."
  dex_wait_volume_key 20
  PROMPT_KEY_STATUS=$?
  case "$PROMPT_KEY_STATUS" in
    0) action_print "已选择：是"; return 0 ;;
    1) action_print "已选择：否"; return 1 ;;
    *) action_print "未检测到音量键输入，已退出菜单"; return 2 ;;
  esac
}

prompt_action() {
  prompt_yes "$1"
  PROMPT_STATUS=$?
  case "$PROMPT_STATUS" in
    0) "$2" || true ;;
    1) : ;;
    *) return 2 ;;
  esac
  return 0
}

action_apply_prop() {
  PROP_KEY="$1"
  PROP_VALUE="$2"
  dex_apply_checked_prop "$PROP_KEY" "$PROP_VALUE"
  APPLY_STATUS=$?
  case "$APPLY_STATUS" in
    1)
      log_action "应用失败 key=$PROP_KEY 目标=$PROP_VALUE 旧值=$DEX_CHECKED_OLD_VALUE 新值=$DEX_CHECKED_NEW_VALUE 工具=$DEX_CHECKED_APPLY_TOOL code=$DEX_CHECKED_APPLY_CODE 原因=$DEX_CHECKED_FAILURE_REASON"
      ;;
    2)
      log_action "应用不一致 key=$PROP_KEY 目标=$PROP_VALUE 旧值=$DEX_CHECKED_OLD_VALUE 新值=$DEX_CHECKED_NEW_VALUE 工具=$DEX_CHECKED_APPLY_TOOL code=$DEX_CHECKED_APPLY_CODE"
      ;;
  esac
  return "$APPLY_STATUS"
}
apply_current_props() {
  mkdir -p "$STATE_DIR" "$LOG_DIR" 2>/dev/null || true
  dex_prepare_runtime_rules "$RULES_DECODE_SCRIPT" "$RULES_PACK_FILE" "$RULES_FILE" || log_action "手动应用时跳过规则准备"
  [ -s "$PROP_FILE" ] || {
    action_print "system.prop 缺失或为空"
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
  log_action "应用完成 总数=$TOTAL 已应用=$APPLIED 已匹配=$MATCHED 不一致=$MISMATCH 失败=$FAILED"
  action_print "应用完成：总数=$TOTAL 已应用=$APPLIED 已匹配=$MATCHED 不一致=$MISMATCH 失败=$FAILED"
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

rematch_rules() {
  mkdir -p "$STATE_DIR" "$LOG_DIR" 2>/dev/null || true
  MODULE_VERSION="$(module_version)"
  [ -n "$MODULE_VERSION" ] || MODULE_VERSION=unknown
  action_print "正在根据设备属性重新生成 system.prop..."
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
    action_print "规则包不可用"
    command -v state_update >/dev/null 2>&1 && state_update "match.status=failed" "match.reason=rules_decode_failed" "config.status=failed" "config.reason=rules_decode_failed" || true
    return 1
  }
  backup_original_props_if_missing
  sh "$MODDIR/scripts/capture-props.sh" "$CAPTURED_PROPS" "" "$RULES_FILE" || : > "$CAPTURED_PROPS"
  if ! sh "$MODDIR/scripts/generate-props.sh" "$CAPTURED_PROPS" "$RULES_FILE" "$PROP_FILE" "$MATCHED_PROPS" "$MATCH_REPORT" "$CONFIG_SOURCE_FILE" "$MODULE_VERSION" "$ORIGINAL_PROPS"; then
    action_print "规则匹配失败"
    command -v state_update >/dev/null 2>&1 && state_update "match.status=failed" "match.reason=action_generation_failed" "config.status=failed" "config.reason=action_generation_failed" || true
    log_action "重新匹配失败"
    return 1
  fi

  cp -af "$PROP_FILE" "$SYSTEM_PROP_BAK" 2>/dev/null || true
  chmod 0644 "$PROP_FILE" 2>/dev/null || true
  chmod 0600 "$SYSTEM_PROP_BAK" "$MATCHED_PROPS" "$MATCH_REPORT" "$CONFIG_SOURCE_FILE" 2>/dev/null || true
  dex_write_prop_lock_list "$PROP_FILE" "$PROP_LOCK_LIST" atomic-final || true
  rm -f "$RUNTIME_PROP_FILE" "$RUNTIME_PROP_HASH_FILE" 2>/dev/null || true

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
      "match.updated_at=$(now_text)" || true
    state_set_config_summary "$PROP_FILE" auto-rules action-rematch 2>/dev/null || true
    state_recompute_summary || true
  fi
  action_print "重新匹配完成：命中=$MATCHED_TOTAL"
  log_action "重新匹配完成 matched=$MATCHED_TOTAL"
}

refresh_diagnostics() {
  mkdir -p "$STATE_DIR" "$LOG_DIR" 2>/dev/null || true
  action_print "正在刷新诊断信息..."
  [ -f "$MODDIR/core/conflict-detect.sh" ] && sh "$MODDIR/core/conflict-detect.sh" "$MODDIR" 2>/dev/null || true
  [ -f "$MODDIR/core/health-check.sh" ] && sh "$MODDIR/core/health-check.sh" "$MODDIR" 2>/dev/null || true
  [ -f "$MODDIR/core/integrity-check.sh" ] && sh "$MODDIR/core/integrity-check.sh" "$MODDIR" 2>/dev/null || true
  command -v state_recompute_summary >/dev/null 2>&1 && state_recompute_summary || true
  log_action "诊断信息已刷新"
  action_print "诊断信息已刷新"
}

run_locked() {
  case "$1" in
    status|"")
      show_status
      ;;
    rematch)
      rematch_rules
      ;;
    apply)
      apply_current_props
      ;;
    diagnose|diagnostics)
      refresh_diagnostics
      ;;
    all)
      rematch_rules && apply_current_props
      refresh_diagnostics
      ;;
    menu)
      show_status
      prompt_action "是否重新匹配规则？" rematch_rules || return 2
      prompt_action "是否立即应用当前运行时属性？" apply_current_props || return 2
      prompt_action "是否刷新诊断信息？" refresh_diagnostics || return 2
      action_print "操作完成"
      ;;
    *)
      action_print "用法：sh action.sh [status|rematch|apply|diagnose|all]"
      return 2
      ;;
  esac
}

mkdir -p "$STATE_DIR" "$LOG_DIR" 2>/dev/null || true
ACTION_CMD="${1:-menu}"
if command -v dex_with_lock >/dev/null 2>&1; then
  dex_with_lock "$ACTION_LOCK_DIR" 60 run_locked "$ACTION_CMD"
else
  run_locked "$ACTION_CMD"
fi
