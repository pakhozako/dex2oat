#!/system/bin/sh

state_health_warning_is_actionable() {
  case "$(state_get health.status)" in
    warning|warn) : ;;
    *) return 1 ;;
  esac
  case "$(state_get health.reason)" in
    files-or-runtime-props-warning|runtime-props-not-yet-applied) return 1 ;;
  esac
  return 0
}


state_attention_reset() {
  STATE_ATTENTION_INDEX=0
  STATE_ATTENTION_ALERT_INDEX=0
  STATE_ATTENTION_TMP="$STATE_DIR/state-attention.$$.tmp"
  : > "$STATE_ATTENTION_TMP" 2>/dev/null || return 1
}

state_attention_add() {
  LEVEL="$1"
  SOURCE="$2"
  MESSAGE="$3"
  [ -n "$MESSAGE" ] || return 0
  STATE_ATTENTION_INDEX=$((STATE_ATTENTION_INDEX + 1))
  case "$LEVEL" in
    info|note|debug) : ;;
    *) STATE_ATTENTION_ALERT_INDEX=$((STATE_ATTENTION_ALERT_INDEX + 1)) ;;
  esac
  {
    printf 'summary.attention.%s=%s|%s|%s\n' "$STATE_ATTENTION_INDEX" "$LEVEL" "$SOURCE" "$MESSAGE"
    printf 'summary.attention.%s.level=%s\n' "$STATE_ATTENTION_INDEX" "$LEVEL"
    printf 'summary.attention.%s.source=%s\n' "$STATE_ATTENTION_INDEX" "$SOURCE"
    printf 'summary.attention.%s.message=%s\n' "$STATE_ATTENTION_INDEX" "$MESSAGE"
  } >> "$STATE_ATTENTION_TMP" 2>/dev/null || true
}

state_collect_attention() {
  state_attention_reset || return 1

  MATCH_STATUS="$(state_get match.status)"
  CONFIG_STATUS="$(state_get config.status)"
  APPLY_STATUS="$(state_get apply.status)"
  SERVICE_STATUS="$(state_get service.status)"
  SERVICE_HEALTH="$(state_get service.health)"
  HEALTH_STATUS="$(state_get health.status)"
  CONFLICT_STATUS="$(state_get conflict.status)"
  INTEGRITY_STATUS="$(state_get integrity.status)"
  INSTALL_STATUS="$(state_get install.status)"
  LIFECYCLE_STATUS="$(state_get lifecycle.status)"
  RESTORE_STATUS="$(state_get restore.status)"
  CONFLICT_TOTAL="$(state_num conflict.total)"
  APPLY_FAILED="$(state_num apply.failed_total)"
  APPLY_MISMATCH="$(state_num apply.mismatch_total)"
  SERVICE_FAILED="$(state_num service.failed_total)"
  SERVICE_MISMATCH="$(state_num service.mismatch_total)"
  INTEGRITY_MISSING="$(state_num integrity.missing_total)"
  INTEGRITY_CHANGED="$(state_num integrity.changed_total)"
  INTEGRITY_BLOCKING_MISSING="$(state_num integrity.blocking_missing_total)"
  INTEGRITY_BLOCKING_CHANGED="$(state_num integrity.blocking_changed_total)"
  MATCH_RUNNING_STALE=0
  APPLY_RUNNING_STALE=0
  [ "$MATCH_STATUS" = "running" ] && state_epoch_stale match.updated_epoch "$STATE_MATCH_RUNNING_STALE_SECONDS" && MATCH_RUNNING_STALE=1
  [ "$APPLY_STATUS" = "running" ] && state_epoch_stale apply.updated_epoch "$STATE_APPLY_RUNNING_STALE_SECONDS" && APPLY_RUNNING_STALE=1

  case "$INSTALL_STATUS" in
    failed) state_attention_add error install "安装失败: $(state_get install.reason)" ;;
    running) state_attention_add info install "安装进行中: $(state_get install.stage) $(state_get install.percent)%" ;;
    warning) state_attention_add warning install "安装警告: $(state_get install.reason)" ;;
  esac
  case "$LIFECYCLE_STATUS" in
    failed) state_attention_add error lifecycle "生命周期失败: $(state_get lifecycle.reason)" ;;
    recovery) state_attention_add warning lifecycle "生命周期恢复: $(state_get lifecycle.reason)" ;;
  esac
  case "$MATCH_STATUS" in
    error|failed) state_attention_add error match "规则匹配失败: $(state_get match.reason)" ;;
    running) [ "$MATCH_RUNNING_STALE" = "1" ] && state_attention_add warning match "规则匹配状态已过期" ;;
    warning) state_attention_add warning match "规则匹配警告: $(state_get match.reason)" ;;
  esac
  case "$CONFIG_STATUS" in
    error|failed) state_attention_add error config "配置生成失败: $(state_get config.reason)" ;;
    warning) state_attention_add warning config "配置警告: $(state_get config.reason)" ;;
  esac
  case "$APPLY_STATUS" in
    error) state_attention_add error apply "运行时属性应用失败: ${APPLY_FAILED:-0} 项" ;;
    warning) state_attention_add warning apply "运行时属性应用不一致: ${APPLY_MISMATCH:-0} 项" ;;
    pending) state_attention_add info apply "等待下次启动时应用运行时属性" ;;
    running)
      if [ "$APPLY_RUNNING_STALE" = "1" ]; then
        state_attention_add warning apply "运行时属性应用状态已过期"
      else
        state_attention_add info apply "正在同步运行时属性"
      fi
      ;;
  esac

  if [ "$SERVICE_STATUS" = "error" ]; then
    state_attention_add error service "服务错误: $(state_get service.reason)"
  elif [ "$SERVICE_STATUS" = "settled" ] && [ "${SERVICE_FAILED:-0}" -gt 0 ] 2>/dev/null; then
    state_attention_add error service "服务应用失败属性: ${SERVICE_FAILED:-0} 项"
  elif [ "$SERVICE_STATUS" = "settled" ] && [ "${SERVICE_MISMATCH:-0}" -gt 0 ] 2>/dev/null; then
    state_attention_add warning service "服务属性不一致: ${SERVICE_MISMATCH:-0} 项"
  elif [ "$SERVICE_HEALTH" = "problem" ] && [ "${SERVICE_FAILED:-0}" -gt 0 ] 2>/dev/null; then
    state_attention_add error service "服务应用失败属性: ${SERVICE_FAILED:-0} 项"
  elif [ "$SERVICE_HEALTH" = "warning" ] && [ "${SERVICE_MISMATCH:-0}" -gt 0 ] 2>/dev/null; then
    state_attention_add info service "服务属性不一致详情: ${SERVICE_MISMATCH:-0} 项"
  fi

  case "$HEALTH_STATUS" in
    error) state_attention_add error health "健康检查失败: $(state_get health.reason)" ;;
    warning|warn)
      case "$(state_get health.reason)" in
        files-or-runtime-props-warning|runtime-props-not-yet-applied) : ;;
        *) state_attention_add warning health "健康检查警告: $(state_get health.reason)" ;;
      esac
      ;;
  esac
  [ "$(state_get health.auto_fixed)" = "yes" ] && state_attention_add info health "健康检查已修复运行时文件"

  if [ "$CONFLICT_STATUS" = "error" ]; then
    state_attention_add error conflict "冲突扫描失败: $(state_get conflict.reason)"
  elif [ "$CONFLICT_STATUS" = "warning" ] || [ "${CONFLICT_TOTAL:-0}" -gt 0 ] 2>/dev/null; then
    state_attention_add warning conflict "检测到 ${CONFLICT_TOTAL:-0} 项模块属性冲突"
  fi

  case "$INTEGRITY_STATUS" in
    error) state_attention_add error integrity "完整性检查失败: $(state_get integrity.reason)" ;;
    missing)
      if [ "${INTEGRITY_BLOCKING_MISSING:-0}" -gt 0 ] 2>/dev/null; then
        state_attention_add warning integrity "完整性检查缺少关键文件: ${INTEGRITY_BLOCKING_MISSING:-0} 项"
      else
        state_attention_add info integrity "完整性检查缺少非关键文件: ${INTEGRITY_MISSING:-0} 项"
      fi
      ;;
    changed)
      if [ "${INTEGRITY_BLOCKING_CHANGED:-0}" -gt 0 ] 2>/dev/null; then
        state_attention_add warning integrity "完整性检查发现关键文件变化: ${INTEGRITY_BLOCKING_CHANGED:-0} 项"
      else
        state_attention_add info integrity "完整性检查发现非关键文件变化: ${INTEGRITY_CHANGED:-0} 项"
      fi
      ;;
    warning|warn) state_attention_add info integrity "完整性检查警告: $(state_get integrity.reason)" ;;
  esac

  case "$RESTORE_STATUS" in
    restored|recovered) state_attention_add info restore "运行时恢复: $(state_get restore.reason)" ;;
    recovery) state_attention_add info restore "恢复流程进行中: $(state_get restore.reason)" ;;
    failed) state_attention_add error restore "恢复失败: $(state_get restore.reason)" ;;
  esac

  printf '%s\n' "$STATE_ATTENTION_INDEX"
}

state_summary_reason() {
  REASON=""
  for STATE_REASON_ITEM in \
    "conflict:$(state_get conflict.status)" \
    "install:$(state_get install.status)" \
    "lifecycle:$(state_get lifecycle.status)" \
    "match:$(state_get match.status)" \
    "config:$(state_get config.status)" \
    "apply:$(state_get apply.status)" \
    "service:$(state_get service.status)" \
    "integrity:$(state_get integrity.status)" \
    "health:$(state_get health.status)" \
    "restore:$(state_get restore.status)"; do
    STATE_REASON_NAME="${STATE_REASON_ITEM%%:*}"
    STATE_REASON_STATUS="${STATE_REASON_ITEM#*:}"
    case "$STATE_REASON_STATUS" in
      error|failed) REASON="${REASON:+$REASON / }$STATE_REASON_NAME 失败" ;;
      warning|warn|missing|changed) REASON="${REASON:+$REASON / }$STATE_REASON_NAME 警告" ;;
      running) REASON="${REASON:+$REASON / }$STATE_REASON_NAME 运行中" ;;
      pending|recovery) REASON="${REASON:+$REASON / }$STATE_REASON_NAME $STATE_REASON_STATUS" ;;
    esac
  done
  [ "$(state_num apply.failed_total)" -gt 0 ] 2>/dev/null && REASON="${REASON:+$REASON / }apply 失败"
  [ "$(state_num service.failed_total)" -gt 0 ] 2>/dev/null && REASON="${REASON:+$REASON / }service 失败"
  [ "$(state_num apply.mismatch_total)" -gt 0 ] 2>/dev/null && REASON="${REASON:+$REASON / }apply 警告"
  [ "$(state_num service.mismatch_total)" -gt 0 ] 2>/dev/null && REASON="${REASON:+$REASON / }service 警告"
  [ -n "$REASON" ] || REASON=正常
  printf '%s\n' "$REASON"
}

state_write_module_summary() {
  MODULE_PROP_TARGET="$(state_module_prop_file)"
  [ -n "$MODULE_PROP_TARGET" ] || return 0
  [ -f "$MODULE_PROP_TARGET" ] || return 0

  SUMMARY_STATUS_VALUE="$(state_get summary.status)"
  SUMMARY_REASON_VALUE="$(state_summary_reason)"
  case "$SUMMARY_STATUS_VALUE" in
    error) DESCRIPTION_VALUE="$STATE_BASE_DESCRIPTION | 状态=错误 ($SUMMARY_REASON_VALUE)" ;;
    running) DESCRIPTION_VALUE="$STATE_BASE_DESCRIPTION | 状态=运行中 ($SUMMARY_REASON_VALUE)" ;;
    pending) DESCRIPTION_VALUE="$STATE_BASE_DESCRIPTION | 状态=等待中 ($SUMMARY_REASON_VALUE)" ;;
    recovery) DESCRIPTION_VALUE="$STATE_BASE_DESCRIPTION | 状态=恢复中 ($SUMMARY_REASON_VALUE)" ;;
    warning) DESCRIPTION_VALUE="$STATE_BASE_DESCRIPTION | 状态=警告 ($SUMMARY_REASON_VALUE)" ;;
    *) DESCRIPTION_VALUE="$STATE_BASE_DESCRIPTION | 状态=正常" ;;
  esac

  CURRENT_DESCRIPTION="$(sed -n 's/^description=//p' "$MODULE_PROP_TARGET" 2>/dev/null | head -n 1)"
  [ "$CURRENT_DESCRIPTION" = "$DESCRIPTION_VALUE" ] && return 0

  TMP_MODULE_PROP="$MODULE_PROP_TARGET.tmp"
  DESCRIPTION_WRITTEN=0
  : > "$TMP_MODULE_PROP" 2>/dev/null || return 1
  while IFS= read -r MODULE_LINE || [ -n "$MODULE_LINE" ]; do
    case "$MODULE_LINE" in
      description=*)
        printf 'description=%s\n' "$DESCRIPTION_VALUE" >> "$TMP_MODULE_PROP" || return 1
        DESCRIPTION_WRITTEN=1
        ;;
      *)
        printf '%s\n' "$MODULE_LINE" >> "$TMP_MODULE_PROP" || return 1
        ;;
    esac
  done < "$MODULE_PROP_TARGET"
  [ "$DESCRIPTION_WRITTEN" = "1" ] || printf 'description=%s\n' "$DESCRIPTION_VALUE" >> "$TMP_MODULE_PROP"
  mv -f "$TMP_MODULE_PROP" "$MODULE_PROP_TARGET" 2>/dev/null || return 1
  chmod 0644 "$MODULE_PROP_TARGET" 2>/dev/null || true
}

state_recompute_summary_locked() {
  [ "${DEX2OAT_DEFER_SUMMARY_RECOMPUTE:-0}" = "1" ] && return 0
  mkdir -p "$STATE_DIR" 2>/dev/null || return 0
  [ -f "$STATE_FILE" ] || return 0

  state_clear_attention_keys
  STATE_ATTENTION_TMP="$STATE_DIR/state-attention.$$.tmp"
  ATTENTION_TOTAL="$(state_collect_attention)"
  ALERT_TOTAL=0
  if [ -s "$STATE_ATTENTION_TMP" ]; then
    ALERT_TOTAL="$(awk -F= '/^summary\.attention\.[0-9]+\.level=/ { if ($2 !~ /^(info|note|debug)$/) count++ } END { print count + 0 }' "$STATE_ATTENTION_TMP" 2>/dev/null)"
  fi

  SUMMARY_STATUS=ok
  SUMMARY_TITLE="状态正常"
  SUMMARY_MESSAGE="运行时配置正常"

  MATCH_STATUS="$(state_get match.status)"
  CONFIG_STATUS="$(state_get config.status)"
  APPLY_STATUS="$(state_get apply.status)"
  SERVICE_STATUS="$(state_get service.status)"
  SERVICE_HEALTH="$(state_get service.health)"
  HEALTH_STATUS="$(state_get health.status)"
  CONFLICT_STATUS="$(state_get conflict.status)"
  INTEGRITY_STATUS="$(state_get integrity.status)"
  INSTALL_STATUS="$(state_get install.status)"
  LIFECYCLE_STATUS="$(state_get lifecycle.status)"
  RESTORE_STATUS="$(state_get restore.status)"
  APPLY_FAILED="$(state_num apply.failed_total)"
  APPLY_MISMATCH="$(state_num apply.mismatch_total)"
  SERVICE_FAILED="$(state_num service.failed_total)"
  SERVICE_MISMATCH="$(state_num service.mismatch_total)"
  CONFLICT_TOTAL="$(state_num conflict.total)"
  INTEGRITY_BLOCKING_MISSING="$(state_num integrity.blocking_missing_total)"
  INTEGRITY_BLOCKING_CHANGED="$(state_num integrity.blocking_changed_total)"
  MATCH_RUNNING_STALE=0
  APPLY_RUNNING_STALE=0
  [ "$MATCH_STATUS" = "running" ] && state_epoch_stale match.updated_epoch "$STATE_MATCH_RUNNING_STALE_SECONDS" && MATCH_RUNNING_STALE=1
  [ "$APPLY_STATUS" = "running" ] && state_epoch_stale apply.updated_epoch "$STATE_APPLY_RUNNING_STALE_SECONDS" && APPLY_RUNNING_STALE=1

  if [ "$INSTALL_STATUS" = "failed" ] || [ "$LIFECYCLE_STATUS" = "failed" ] || [ "$RESTORE_STATUS" = "failed" ] || [ "$SERVICE_STATUS" = "error" ] || [ "$APPLY_STATUS" = "error" ] || [ "$INTEGRITY_STATUS" = "error" ] || [ "$CONFIG_STATUS" = "error" ] || [ "$CONFIG_STATUS" = "failed" ] || [ "$MATCH_STATUS" = "error" ] || [ "$MATCH_STATUS" = "failed" ] || [ "$CONFLICT_STATUS" = "error" ] || [ "${SERVICE_FAILED:-0}" -gt 0 ] 2>/dev/null || [ "${APPLY_FAILED:-0}" -gt 0 ] 2>/dev/null; then
    SUMMARY_STATUS=error
    SUMMARY_TITLE="需要处理"
    SUMMARY_MESSAGE="一个或多个模块检查失败"
  elif [ "$MATCH_STATUS" = "running" ] && [ "$MATCH_RUNNING_STALE" = "1" ]; then
    SUMMARY_STATUS=warning
    SUMMARY_TITLE="规则匹配过期"
    SUMMARY_MESSAGE="规则匹配状态近期未更新"
  elif [ "$APPLY_STATUS" = "running" ] && [ "$APPLY_RUNNING_STALE" = "1" ]; then
    SUMMARY_STATUS=warning
    SUMMARY_TITLE="应用状态过期"
    SUMMARY_MESSAGE="运行时属性应用近期未更新"
  elif [ "$MATCH_STATUS" = "running" ]; then
    SUMMARY_STATUS=running
    SUMMARY_TITLE="正在匹配规则"
    SUMMARY_MESSAGE="正在采集并匹配规则"
  elif [ "$APPLY_STATUS" = "running" ] || [ "$INSTALL_STATUS" = "running" ] || [ "$LIFECYCLE_STATUS" = "running" ] || [ "$CONFIG_STATUS" = "running" ]; then
    SUMMARY_STATUS=running
    SUMMARY_TITLE="处理中"
    SUMMARY_MESSAGE="模块运行时任务正在进行"
  elif [ "$APPLY_STATUS" = "pending" ]; then
    SUMMARY_STATUS=pending
    SUMMARY_TITLE="等待应用"
    SUMMARY_MESSAGE="运行时属性将在下次启动时应用"
  elif [ "$RESTORE_STATUS" = "recovery" ]; then
    SUMMARY_STATUS=recovery
    SUMMARY_TITLE="恢复中"
    SUMMARY_MESSAGE="正在恢复运行时文件"
  elif [ "$CONFLICT_STATUS" = "warning" ] || [ "${CONFLICT_TOTAL:-0}" -gt 0 ] 2>/dev/null; then
    SUMMARY_STATUS=warning
    SUMMARY_TITLE="属性冲突"
    SUMMARY_MESSAGE="其他模块可能正在管理相同属性"
  elif [ "$APPLY_STATUS" = "warning" ] || [ "$SERVICE_HEALTH" = "warning" ] || [ "$SERVICE_HEALTH" = "warn" ] || state_health_warning_is_actionable || [ "${SERVICE_MISMATCH:-0}" -gt 0 ] 2>/dev/null || [ "${APPLY_MISMATCH:-0}" -gt 0 ] 2>/dev/null; then
    SUMMARY_STATUS=warning
    SUMMARY_TITLE="运行时警告"
    SUMMARY_MESSAGE="部分运行时属性存在不一致"
  elif [ "${ALERT_TOTAL:-0}" -gt 0 ] 2>/dev/null; then
    SUMMARY_STATUS=warning
    SUMMARY_TITLE="诊断警告"
    SUMMARY_MESSAGE="诊断信息已记录可检查的细节"
  elif [ "$INTEGRITY_STATUS" = "missing" ] && [ "${INTEGRITY_BLOCKING_MISSING:-0}" -gt 0 ] 2>/dev/null; then
    SUMMARY_STATUS=warning
    SUMMARY_TITLE="关键文件缺失"
    SUMMARY_MESSAGE="完整性检查发现模块文件缺失"
  elif [ "$INTEGRITY_STATUS" = "changed" ] && [ "${INTEGRITY_BLOCKING_CHANGED:-0}" -gt 0 ] 2>/dev/null; then
    SUMMARY_STATUS=warning
    SUMMARY_TITLE="关键文件变化"
    SUMMARY_MESSAGE="完整性检查发现模块文件变化"
  fi

  state_transaction_begin || return 1
  state_transaction_set "schema_version=$STATE_SCHEMA_VERSION" || { state_transaction_abort; return 1; }
  state_transaction_set "summary.status=$SUMMARY_STATUS" || { state_transaction_abort; return 1; }
  state_transaction_set "summary.title=$SUMMARY_TITLE" || { state_transaction_abort; return 1; }
  state_transaction_set "summary.message=$SUMMARY_MESSAGE" || { state_transaction_abort; return 1; }
  state_transaction_set "summary.attention_total=${ATTENTION_TOTAL:-0}" || { state_transaction_abort; return 1; }
  state_transaction_set "summary.attention_alert_total=${ALERT_TOTAL:-0}" || { state_transaction_abort; return 1; }
  state_transaction_set "summary.updated_at=$(state_now)" || { state_transaction_abort; return 1; }
  if [ -s "$STATE_ATTENTION_TMP" ]; then
    while IFS= read -r ATTENTION_LINE || [ -n "$ATTENTION_LINE" ]; do
      [ -n "$ATTENTION_LINE" ] && state_transaction_set "$ATTENTION_LINE" || true
    done < "$STATE_ATTENTION_TMP"
  fi
  state_transaction_commit || return 1
  rm -f "$STATE_ATTENTION_TMP" 2>/dev/null || true
  state_write_module_summary || true
}

state_recompute_summary() {
  [ "${DEX2OAT_DEFER_SUMMARY_RECOMPUTE:-0}" = "1" ] && return 0
  if command -v dex_with_lock >/dev/null 2>&1; then
    dex_with_lock "$STATE_DIR/.summary.lock" 30 state_recompute_summary_locked
  else
    state_recompute_summary_locked
  fi
}

