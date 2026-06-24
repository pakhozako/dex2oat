#!/system/bin/sh

STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
STATE_FILE=${STATE_FILE:-$STATE_DIR/state.prop}

state_now() {
  date '+%Y-%m-%d %H:%M:%S'
}

state_hash_file() {
  HASH_TARGET="$1"
  [ -s "$HASH_TARGET" ] || { printf 'missing\n'; return 0; }
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$HASH_TARGET" 2>/dev/null | awk '{print $1}'
  elif command -v md5sum >/dev/null 2>&1; then
    md5sum "$HASH_TARGET" 2>/dev/null | awk '{print $1}'
  else
    wc -c < "$HASH_TARGET" 2>/dev/null | tr -d ' '
  fi
}

state_count_props() {
  COUNT_TARGET="$1"
  [ -s "$COUNT_TARGET" ] || { printf '0\n'; return 0; }
  grep -E '^[A-Za-z0-9_.-]+=' "$COUNT_TARGET" 2>/dev/null | wc -l | tr -d ' '
}

state_update() {
  mkdir -p "$STATE_DIR" 2>/dev/null || return 1
  TMP_STATE="$STATE_FILE.tmp"
  : > "$TMP_STATE" 2>/dev/null || return 1

  if [ -f "$STATE_FILE" ]; then
    while IFS= read -r STATE_LINE || [ -n "$STATE_LINE" ]; do
      STATE_KEY="${STATE_LINE%%=*}"
      [ -n "$STATE_KEY" ] || continue
      SKIP_STATE_KEY=0
      for STATE_PAIR in "$@"; do
        [ "${STATE_PAIR%%=*}" = "$STATE_KEY" ] && SKIP_STATE_KEY=1 && break
      done
      [ "$SKIP_STATE_KEY" = "1" ] || printf '%s\n' "$STATE_LINE" >> "$TMP_STATE"
    done < "$STATE_FILE"
  fi

  for STATE_PAIR in "$@"; do
    printf '%s\n' "$STATE_PAIR" >> "$TMP_STATE"
  done
  mv -f "$TMP_STATE" "$STATE_FILE" 2>/dev/null || return 1
  chmod 0600 "$STATE_FILE" 2>/dev/null || true
}

state_get() {
  STATE_LOOKUP_KEY="$1"
  sed -n "s/^$STATE_LOOKUP_KEY=//p" "$STATE_FILE" 2>/dev/null | tail -n 1
}

state_problem_list() {
  PROBLEM_INDEX=0
  PROBLEM_TMP="$STATE_DIR/state-problems.tmp"
  : > "$PROBLEM_TMP" 2>/dev/null || return 1

  add_problem() {
    PROBLEM_INDEX=$((PROBLEM_INDEX + 1))
    printf 'summary.attention.%s=%s\n' "$PROBLEM_INDEX" "$1" >> "$PROBLEM_TMP"
  }

  [ "$(state_get integrity.status)" = "error" ] && add_problem "完整性校验异常：$(state_get integrity.reason)"
  [ "$(state_get integrity.status)" = "warn" ] && add_problem "完整性校验警告：$(state_get integrity.reason)"
  [ "$(state_get health.status)" = "error" ] && add_problem "健康检查异常：关键文件或属性状态不完整"
  [ "$(state_get health.status)" = "warn" ] && add_problem "健康检查警告：建议查看诊断卡片"
  [ "$(state_get service.health)" = "problem" ] && add_problem "运行时应用异常：失败 $(state_get service.failed_total) 项，未粘住 $(state_get service.mismatch_total) 项"
  [ "$(state_get service.status)" = "error" ] && add_problem "服务状态异常：$(state_get service.reason)"
  [ "$(state_get match.status)" = "failed" ] && add_problem "规则匹配失败：$(state_get match.reason)"
  [ "$(state_get config.status)" = "failed" ] && add_problem "配置生成失败：$(state_get config.reason)"
  [ "$(state_get restore.status)" = "restored" ] && add_problem "已发生自动恢复：$(state_get restore.reason)"

  CONFLICT_TOTAL="$(state_get conflict.total)"
  if [ "${CONFLICT_TOTAL:-0}" -gt 0 ] 2>/dev/null; then
    add_problem "检测到 $CONFLICT_TOTAL 项模块间属性冲突"
  fi

  printf '%s\n' "$PROBLEM_INDEX"
}

state_clear_attention_keys() {
  [ -f "$STATE_FILE" ] || return 0
  TMP_STATE="$STATE_FILE.clear.tmp"
  grep -v '^summary\.attention\.' "$STATE_FILE" 2>/dev/null | grep -v '^summary\.attention_total=' > "$TMP_STATE" 2>/dev/null || : > "$TMP_STATE"
  mv -f "$TMP_STATE" "$STATE_FILE" 2>/dev/null || true
}

state_recompute_summary() {
  mkdir -p "$STATE_DIR" 2>/dev/null || return 0
  [ -f "$STATE_FILE" ] || return 0

  state_clear_attention_keys
  ATTENTION_TOTAL="$(state_problem_list)"
  SUMMARY_STATUS=ok
  SUMMARY_TITLE="状态正常"
  SUMMARY_MESSAGE="未发现需要立即处理的问题"

  if [ "$(state_get lifecycle.status)" = "failed" ] || [ "$(state_get service.status)" = "error" ] || [ "$(state_get integrity.status)" = "error" ] || [ "$(state_get config.status)" = "failed" ] || [ "$(state_get match.status)" = "failed" ]; then
    SUMMARY_STATUS=error
    SUMMARY_TITLE="需要处理"
    SUMMARY_MESSAGE="发现会影响模块运行或配置生成的异常"
  elif [ "${ATTENTION_TOTAL:-0}" -gt 0 ] 2>/dev/null; then
    SUMMARY_STATUS=warning
    SUMMARY_TITLE="存在警告"
    SUMMARY_MESSAGE="发现 $ATTENTION_TOTAL 项需要关注的状态"
  elif [ "$(state_get restore.status)" = "restored" ]; then
    SUMMARY_STATUS=recovery
    SUMMARY_TITLE="已自动恢复"
    SUMMARY_MESSAGE="模块已执行恢复动作，请确认当前配置"
  elif [ "$(state_get config.source)" = "webui-custom" ]; then
    SUMMARY_STATUS=pending
    SUMMARY_TITLE="自定义配置"
    SUMMARY_MESSAGE="WebUI 自定义配置已生成，通常需要重启后完整生效"
  fi

  state_update \
    "summary.status=$SUMMARY_STATUS" \
    "summary.title=$SUMMARY_TITLE" \
    "summary.message=$SUMMARY_MESSAGE" \
    "summary.updated_at=$(state_now)" \
    "summary.attention_total=${ATTENTION_TOTAL:-0}"
  if [ -s "$STATE_DIR/state-problems.tmp" ]; then
    while IFS= read -r PROBLEM_LINE || [ -n "$PROBLEM_LINE" ]; do
      [ -n "$PROBLEM_LINE" ] && state_update "$PROBLEM_LINE" || true
    done < "$STATE_DIR/state-problems.tmp"
  fi
  rm -f "$STATE_DIR/state-problems.tmp" 2>/dev/null || true
}

state_set_lifecycle() {
  state_update \
    "schema_version=31" \
    "module_version=${MODULE_VERSION:-unknown}" \
    "lifecycle.status=$1" \
    "lifecycle.phase=$2" \
    "lifecycle.reason=$3" \
    "lifecycle.updated_at=$(state_now)"
  state_recompute_summary || true
}

state_set_config_summary() {
  SUMMARY_PROP_FILE="$1"
  SUMMARY_SOURCE="$2"
  SUMMARY_REASON="$3"
  state_update \
    "config.status=ok" \
    "config.source=$SUMMARY_SOURCE" \
    "config.reason=$SUMMARY_REASON" \
    "config.prop_count=$(state_count_props "$SUMMARY_PROP_FILE")" \
    "config.prop_hash=$(state_hash_file "$SUMMARY_PROP_FILE")" \
    "config.updated_at=$(state_now)"
  state_recompute_summary || true
}
