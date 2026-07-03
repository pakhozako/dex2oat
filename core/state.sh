#!/system/bin/sh

STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
STATE_FILE=${STATE_FILE:-$STATE_DIR/state.prop}
STATE_SCHEMA_VERSION=32
STATE_BASE_DESCRIPTION="规则驱动 ART / dexopt 调优与状态监控"

if [ -n "$MODPATH" ] && [ -f "$MODPATH/core/common.sh" ]; then
  . "$MODPATH/core/common.sh"
elif [ -n "$MODDIR" ] && [ -f "$MODDIR/core/common.sh" ]; then
  . "$MODDIR/core/common.sh"
elif [ -f "${0%/*}/common.sh" ]; then
  . "${0%/*}/common.sh"
fi

state_now() {
  date '+%Y-%m-%d %H:%M:%S'
}

state_module_prop_file() {
  if [ -n "$MODULE_PROP_FILE" ] && [ -f "$MODULE_PROP_FILE" ]; then
    printf '%s\n' "$MODULE_PROP_FILE"
    return 0
  fi

  if [ -n "$MODPATH" ] && [ -f "$MODPATH/module.prop" ]; then
    printf '%s\n' "$MODPATH/module.prop"
    return 0
  fi

  if [ -n "$MODDIR" ] && [ -f "$MODDIR/module.prop" ]; then
    printf '%s\n' "$MODDIR/module.prop"
    return 0
  fi

  printf '\n'
}

state_hash_file() {
  TARGET_FILE="$1"
  [ -s "$TARGET_FILE" ] || { printf 'missing\n'; return 0; }
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$TARGET_FILE" 2>/dev/null | awk '{print $1}'
  elif command -v md5sum >/dev/null 2>&1; then
    md5sum "$TARGET_FILE" 2>/dev/null | awk '{print $1}'
  else
    wc -c < "$TARGET_FILE" 2>/dev/null | tr -d ' '
  fi
}

state_count_props() {
  TARGET_FILE="$1"
  [ -s "$TARGET_FILE" ] || { printf '0\n'; return 0; }
  grep -E '^[A-Za-z0-9_.-]+=' "$TARGET_FILE" 2>/dev/null | wc -l | tr -d ' '
}

state_num() {
  VALUE="$(state_get "$1")"
  case "$VALUE" in
    ''|*[!0-9]*) printf '0\n' ;;
    *) printf '%s\n' "$VALUE" ;;
  esac
}

state_health_warning_is_actionable() {
  HEALTH_STATUS_VALUE="$(state_get health.status)"
  case "$HEALTH_STATUS_VALUE" in
    warning|warn) : ;;
    *) return 1 ;;
  esac
  case "$(state_get health.reason)" in
    files-or-runtime-props-warning|runtime-props-not-yet-applied)
      return 1
      ;;
  esac
  return 0
}

state_pair_key() {
  STATE_PAIR_KEY="${1%%=*}"
  [ "$STATE_PAIR_KEY" != "$1" ] || return 1
  case "$STATE_PAIR_KEY" in
    ""|*[!A-Za-z0-9_.-]*)
      return 1
      ;;
  esac
  printf '%s\n' "$STATE_PAIR_KEY"
}

state_pair_valid() {
  state_pair_key "$1" >/dev/null || return 1
  case "$1" in
    *"
"*)
      return 1
      ;;
  esac
  return 0
}

state_update() {
  STATECTL="$(state_statectl_path)"
  if [ -n "$STATECTL" ]; then
    STATE_DIR="$STATE_DIR" STATE_FILE="$STATE_FILE" sh "$STATECTL" update "$@"
    return $?
  fi
  mkdir -p "$STATE_DIR" 2>/dev/null || return 1
  TMP_STATE="$STATE_FILE.tmp.$$"
  state_update_apply "$TMP_STATE" "$@"
}

state_statectl_path() {
  if [ -n "$MODPATH" ] && [ -r "$MODPATH/core/statectl.sh" ]; then
    printf '%s\n' "$MODPATH/core/statectl.sh"
  elif [ -n "$MODDIR" ] && [ -r "$MODDIR/core/statectl.sh" ]; then
    printf '%s\n' "$MODDIR/core/statectl.sh"
  elif [ -r "${0%/*}/statectl.sh" ]; then
    printf '%s\n' "${0%/*}/statectl.sh"
  fi
}

state_update_apply() {
  TMP_STATE="$1"
  shift
  for STATE_PAIR in "$@"; do
    state_pair_valid "$STATE_PAIR" || return 1
  done
  : > "$TMP_STATE" 2>/dev/null || return 1
  if [ -f "$STATE_FILE" ]; then
    while IFS= read -r STATE_LINE || [ -n "$STATE_LINE" ]; do
      STATE_KEY="$(state_pair_key "$STATE_LINE" 2>/dev/null)" || continue
      SKIP_STATE_KEY=0
      for STATE_PAIR in "$@"; do
        STATE_PAIR_KEY="$(state_pair_key "$STATE_PAIR" 2>/dev/null)" || {
          rm -f "$TMP_STATE" 2>/dev/null || true
          return 1
        }
        [ "$STATE_PAIR_KEY" = "$STATE_KEY" ] && SKIP_STATE_KEY=1 && break
      done
      if [ "$SKIP_STATE_KEY" != "1" ]; then
        printf '%s\n' "$STATE_LINE" >> "$TMP_STATE" || {
          rm -f "$TMP_STATE" 2>/dev/null || true
          return 1
        }
      fi
    done < "$STATE_FILE"
  fi
  for STATE_PAIR in "$@"; do
    printf '%s\n' "$STATE_PAIR" >> "$TMP_STATE" || {
      rm -f "$TMP_STATE" 2>/dev/null || true
      return 1
    }
  done
  sync "$TMP_STATE" 2>/dev/null || true
  mv -f "$TMP_STATE" "$STATE_FILE" 2>/dev/null || {
    rm -f "$TMP_STATE" 2>/dev/null || true
    return 1
  }
  chmod 0600 "$STATE_FILE" 2>/dev/null || true
}

state_get() {
  LOOKUP_KEY="$1"
  [ -f "$STATE_FILE" ] || return 0
  awk -F= -v key="$LOOKUP_KEY" '$1 == key { sub(/^[^=]*=/, ""); value=$0; found=1 } END { if (found) print value }' "$STATE_FILE" 2>/dev/null
}

state_clear_attention_keys() {
  [ -f "$STATE_FILE" ] || return 0
  STATECTL="$(state_statectl_path)"
  if [ -n "$STATECTL" ]; then
    STATE_DIR="$STATE_DIR" STATE_FILE="$STATE_FILE" sh "$STATECTL" clear-attention
    return $?
  fi
  TMP_STATE="$STATE_FILE.clear.tmp.$$"
  grep -v -E '^(summary\.attention\.|summary\.attention_total=|summary\.attention_alert_total=)' "$STATE_FILE" > "$TMP_STATE" 2>/dev/null || : > "$TMP_STATE"
  mv -f "$TMP_STATE" "$STATE_FILE" 2>/dev/null || true
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
  INTEGRITY_BLOCKING_MISSING="$(state_num integrity.blocking_missing_total)"
  INTEGRITY_BLOCKING_CHANGED="$(state_num integrity.blocking_changed_total)"
  CONFIG_SOURCE="$(state_get config.source)"
  CONFLICT_TOTAL="$(state_num conflict.total)"
  APPLY_FAILED="$(state_num apply.failed_total)"
  APPLY_MISMATCH="$(state_num apply.mismatch_total)"
  SERVICE_FAILED="$(state_num service.failed_total)"
  SERVICE_MISMATCH="$(state_num service.mismatch_total)"
  INTEGRITY_MISSING="$(state_num integrity.missing_total)"
  INTEGRITY_CHANGED="$(state_num integrity.changed_total)"

  case "$INSTALL_STATUS" in
    failed) state_attention_add error install "Install failed: $(state_get install.reason)" ;;
    running) state_attention_add info install "Install in progress: $(state_get install.stage) $(state_get install.percent)%" ;;
    warning) state_attention_add warning install "Install warning: $(state_get install.reason)" ;;
  esac

  case "$LIFECYCLE_STATUS" in
    failed) state_attention_add error lifecycle "Lifecycle failed: $(state_get lifecycle.reason)" ;;
    recovery) state_attention_add warning lifecycle "Lifecycle recovery: $(state_get lifecycle.reason)" ;;
  esac

  case "$MATCH_STATUS" in
    error|failed) state_attention_add error match "Rule match failed: $(state_get match.reason)" ;;
    warning) state_attention_add warning match "Rule match completed with warnings: $(state_get match.reason)" ;;
    partial|fallback|ok) : ;;
  esac

  case "$CONFIG_STATUS" in
    error|failed) state_attention_add error config "Config generation failed: $(state_get config.reason)" ;;
    warning) state_attention_add warning config "Config generation warning: $(state_get config.reason)" ;;
  esac

  case "$APPLY_STATUS" in
    error) state_attention_add error apply "Apply failed for ${APPLY_FAILED:-0} runtime properties" ;;
    warning) state_attention_add warning apply "Apply completed with ${APPLY_MISMATCH:-0} runtime property details" ;;
    pending) state_attention_add info apply "Apply is waiting for reboot after save" ;;
    running) state_attention_add info apply "Apply is syncing runtime properties" ;;
  esac

  if [ "$SERVICE_STATUS" = "error" ]; then
    state_attention_add error service "Service error: $(state_get service.reason)"
  elif [ "$SERVICE_STATUS" = "settled" ] && [ "${SERVICE_FAILED:-0}" -gt 0 ] 2>/dev/null; then
    state_attention_add error service "Runtime service reported ${SERVICE_FAILED:-0} failed runtime properties"
  elif [ "$SERVICE_STATUS" = "settled" ] && [ "${SERVICE_MISMATCH:-0}" -gt 0 ] 2>/dev/null; then
    state_attention_add warning service "Runtime service reported ${SERVICE_MISMATCH:-0} mismatched runtime properties"
  elif [ "$SERVICE_HEALTH" = "problem" ] && [ "${SERVICE_FAILED:-0}" -gt 0 ] 2>/dev/null; then
    state_attention_add error service "Runtime service reported failed=${SERVICE_FAILED:-0}"
  elif [ "$SERVICE_HEALTH" = "warning" ] && [ "${SERVICE_MISMATCH:-0}" -gt 0 ] 2>/dev/null; then
    state_attention_add info service "Runtime service recorded ${SERVICE_MISMATCH:-0} property details"
  fi

  case "$HEALTH_STATUS" in
    error) state_attention_add error health "Health check failed: $(state_get health.reason)" ;;
    warning|warn)
      case "$(state_get health.reason)" in
        files-or-runtime-props-warning|runtime-props-not-yet-applied) : ;;
        *) state_attention_add warning health "Health check detail: $(state_get health.reason)" ;;
      esac
      ;;
  esac
  [ "$(state_get health.auto_fixed)" = "yes" ] && state_attention_add info health "Health check repaired a missing runtime file"

  if [ "$CONFLICT_STATUS" = "error" ]; then
    state_attention_add error conflict "Conflict scan failed: $(state_get conflict.reason)"
  elif [ "$CONFLICT_STATUS" = "warning" ] && [ "${CONFLICT_TOTAL:-0}" -gt 0 ] 2>/dev/null; then
    state_attention_add warning conflict "Detected ${CONFLICT_TOTAL} module property conflicts"
  elif [ "$CONFLICT_STATUS" = "warning" ]; then
    state_attention_add warning conflict "Conflict scan warning: $(state_get conflict.reason)"
  elif [ "${CONFLICT_TOTAL:-0}" -gt 0 ] 2>/dev/null; then
    state_attention_add warning conflict "Detected ${CONFLICT_TOTAL} module property conflicts"
  fi

  case "$INTEGRITY_STATUS" in
    error) state_attention_add error integrity "Integrity check failed: $(state_get integrity.reason)" ;;
    missing)
      INTEGRITY_BLOCKING_MISSING="$(state_num integrity.blocking_missing_total)"
      if [ "${INTEGRITY_BLOCKING_MISSING:-0}" -gt 0 ] 2>/dev/null; then
        state_attention_add warning integrity "Integrity check found ${INTEGRITY_BLOCKING_MISSING:-0} missing key files"
      else
        state_attention_add info integrity "Integrity check recorded ${INTEGRITY_MISSING:-0} non-key missing files"
      fi
      ;;
    changed)
      INTEGRITY_BLOCKING_CHANGED="$(state_num integrity.blocking_changed_total)"
      if [ "${INTEGRITY_BLOCKING_CHANGED:-0}" -gt 0 ] 2>/dev/null; then
        state_attention_add warning integrity "Integrity check found ${INTEGRITY_BLOCKING_CHANGED:-0} changed key files"
      else
        state_attention_add info integrity "Integrity check recorded ${INTEGRITY_CHANGED:-0} non-key changed files"
      fi
      ;;
    warning|warn) state_attention_add info integrity "Integrity detail: $(state_get integrity.reason)" ;;
  esac

  case "$RESTORE_STATUS" in
    restored|recovered) state_attention_add info restore "Runtime restore was performed: $(state_get restore.reason)" ;;
    recovery) state_attention_add info restore "Recovery is active: $(state_get restore.reason)" ;;
    failed) state_attention_add error restore "Restore failed: $(state_get restore.reason)" ;;
  esac

  printf '%s\n' "$STATE_ATTENTION_INDEX"
}

state_summary_reason() {
  REASON=""
  INSTALL_STATUS="$(state_get install.status)"
  LIFECYCLE_STATUS="$(state_get lifecycle.status)"
  MATCH_STATUS="$(state_get match.status)"
  CONFIG_STATUS="$(state_get config.status)"
  APPLY_STATUS="$(state_get apply.status)"
  SERVICE_STATUS="$(state_get service.status)"
  SERVICE_HEALTH="$(state_get service.health)"
  INTEGRITY_STATUS="$(state_get integrity.status)"
  HEALTH_STATUS="$(state_get health.status)"
  RESTORE_STATUS="$(state_get restore.status)"
  CONFLICT_TOTAL="$(state_num conflict.total)"
  CONFLICT_STATUS="$(state_get conflict.status)"
  INTEGRITY_BLOCKING_MISSING="$(state_num integrity.blocking_missing_total)"
  INTEGRITY_BLOCKING_CHANGED="$(state_num integrity.blocking_changed_total)"

  [ "$CONFLICT_STATUS" = "error" ] && REASON="${REASON:+$REASON / }conflict error"
  [ "$CONFLICT_STATUS" = "warning" ] && REASON="${REASON:+$REASON / }conflict warning"
  [ "${CONFLICT_TOTAL:-0}" -gt 0 ] 2>/dev/null && [ "$CONFLICT_STATUS" != "warning" ] && [ "$CONFLICT_STATUS" != "error" ] && REASON="${REASON:+$REASON / }conflict"

  case "$INSTALL_STATUS" in
    running) REASON="${REASON:+$REASON / }install running" ;;
    failed) REASON="${REASON:+$REASON / }install failed" ;;
  esac

  case "$LIFECYCLE_STATUS" in
    running) REASON="${REASON:+$REASON / }lifecycle running" ;;
    failed) REASON="${REASON:+$REASON / }lifecycle failed" ;;
  esac

  case "$MATCH_STATUS" in
    running) REASON="${REASON:+$REASON / }match running" ;;
    error|failed) REASON="${REASON:+$REASON / }match failed" ;;
  esac

  case "$CONFIG_STATUS" in
    running) REASON="${REASON:+$REASON / }config running" ;;
    error|failed) REASON="${REASON:+$REASON / }config failed" ;;
  esac

  case "$APPLY_STATUS" in
    error) REASON="${REASON:+$REASON / }apply error" ;;
    warning) REASON="${REASON:+$REASON / }apply warning" ;;
    pending) REASON="${REASON:+$REASON / }apply pending" ;;
    running) REASON="${REASON:+$REASON / }apply running" ;;
  esac

  [ "${APPLY_FAILED:-0}" -gt 0 ] 2>/dev/null && REASON="${REASON:+$REASON / }apply failed"
  [ "${APPLY_MISMATCH:-0}" -gt 0 ] 2>/dev/null && REASON="${REASON:+$REASON / }apply warning"

  case "$SERVICE_STATUS" in
    error) REASON="${REASON:+$REASON / }service error" ;;
    settled)
      [ "${SERVICE_FAILED:-0}" -gt 0 ] 2>/dev/null && REASON="${REASON:+$REASON / }service failed"
      [ "${SERVICE_MISMATCH:-0}" -gt 0 ] 2>/dev/null && REASON="${REASON:+$REASON / }service warning"
      ;;
  esac

  case "$SERVICE_HEALTH" in
    warning|warn) REASON="${REASON:+$REASON / }service warning" ;;
  esac

  case "$INTEGRITY_STATUS" in
    error) REASON="${REASON:+$REASON / }integrity error" ;;
    missing)
      [ "${INTEGRITY_BLOCKING_MISSING:-0}" -gt 0 ] 2>/dev/null && REASON="${REASON:+$REASON / }integrity missing"
      ;;
    changed)
      [ "${INTEGRITY_BLOCKING_CHANGED:-0}" -gt 0 ] 2>/dev/null && REASON="${REASON:+$REASON / }integrity changed"
      ;;
  esac

  case "$HEALTH_STATUS" in
    error) REASON="${REASON:+$REASON / }health error" ;;
    warning|warn)
      case "$(state_get health.reason)" in
        files-or-runtime-props-warning|runtime-props-not-yet-applied) : ;;
        *) REASON="${REASON:+$REASON / }health warning" ;;
      esac
      ;;
  esac

  case "$RESTORE_STATUS" in
    failed) REASON="${REASON:+$REASON / }restore failed" ;;
    recovery) REASON="${REASON:+$REASON / }restore recovery" ;;
  esac

  [ -n "$REASON" ] || REASON="clean"
  printf '%s\n' "$REASON"
}

state_write_module_summary() {
  MODULE_PROP_TARGET="$(state_module_prop_file)"
  [ -n "$MODULE_PROP_TARGET" ] || return 0
  [ -f "$MODULE_PROP_TARGET" ] || return 0

  SUMMARY_STATUS_VALUE="$(state_get summary.status)"
  SUMMARY_REASON_VALUE="$(state_summary_reason)"
  case "$SUMMARY_STATUS_VALUE" in
    error) DESCRIPTION_VALUE="$STATE_BASE_DESCRIPTION | 🟥 异常 ($SUMMARY_REASON_VALUE)" ;;
    running)
      case "$(state_get match.status)" in
        running) DESCRIPTION_VALUE="$STATE_BASE_DESCRIPTION | 🟦 匹配中 ($SUMMARY_REASON_VALUE)" ;;
        *)
          case "$(state_get apply.status)" in
            running) DESCRIPTION_VALUE="$STATE_BASE_DESCRIPTION | 🟦 同步中 ($SUMMARY_REASON_VALUE)" ;;
            *) DESCRIPTION_VALUE="$STATE_BASE_DESCRIPTION | 🟦 处理中 ($SUMMARY_REASON_VALUE)" ;;
          esac
          ;;
      esac
      ;;
    pending)
      case "$(state_get match.status)" in
        running) DESCRIPTION_VALUE="$STATE_BASE_DESCRIPTION | 🟦 匹配中 ($SUMMARY_REASON_VALUE)" ;;
        *) DESCRIPTION_VALUE="$STATE_BASE_DESCRIPTION | 🟦 处理中 ($SUMMARY_REASON_VALUE)" ;;
      esac
      ;;
    recovery) DESCRIPTION_VALUE="$STATE_BASE_DESCRIPTION | 🟦 恢复中 ($SUMMARY_REASON_VALUE)" ;;
    warning) DESCRIPTION_VALUE="$STATE_BASE_DESCRIPTION | 🟨 关注 ($SUMMARY_REASON_VALUE)" ;;
    *) DESCRIPTION_VALUE="$STATE_BASE_DESCRIPTION | 🟩 正常" ;;
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
    ALERT_TOTAL="$(awk -F= '
      /^summary\.attention\.[0-9]+\.level=/ {
        if ($2 !~ /^(info|note|debug)$/) count++
      }
      END { print count + 0 }
    ' "$STATE_ATTENTION_TMP" 2>/dev/null)"
  fi
  SUMMARY_STATUS=ok
  SUMMARY_TITLE="状态正常"
  SUMMARY_MESSAGE="当前没有发现需要处理的问题。"

  MATCH_STATUS="$(state_get match.status)"
  CONFIG_STATUS="$(state_get config.status)"
  APPLY_STATUS="$(state_get apply.status)"
  SERVICE_STATUS="$(state_get service.status)"
  SERVICE_HEALTH="$(state_get service.health)"
  APPLY_FAILED="$(state_num apply.failed_total)"
  APPLY_MISMATCH="$(state_num apply.mismatch_total)"
  SERVICE_FAILED="$(state_num service.failed_total)"
  SERVICE_MISMATCH="$(state_num service.mismatch_total)"
  INTEGRITY_STATUS="$(state_get integrity.status)"
  HEALTH_STATUS="$(state_get health.status)"
  INSTALL_STATUS="$(state_get install.status)"
  LIFECYCLE_STATUS="$(state_get lifecycle.status)"
  RESTORE_STATUS="$(state_get restore.status)"
  INTEGRITY_BLOCKING_MISSING="$(state_num integrity.blocking_missing_total)"
  INTEGRITY_BLOCKING_CHANGED="$(state_num integrity.blocking_changed_total)"
  CONFLICT_TOTAL="$(state_num conflict.total)"
  CONFLICT_STATUS="$(state_get conflict.status)"

  if [ "$INSTALL_STATUS" = "failed" ] || [ "$LIFECYCLE_STATUS" = "failed" ] || [ "$RESTORE_STATUS" = "failed" ] || [ "$SERVICE_STATUS" = "error" ] || [ "$APPLY_STATUS" = "error" ] || [ "$INTEGRITY_STATUS" = "error" ] || [ "$CONFIG_STATUS" = "error" ] || [ "$CONFIG_STATUS" = "failed" ] || [ "$MATCH_STATUS" = "error" ] || [ "$MATCH_STATUS" = "failed" ] || [ "$CONFLICT_STATUS" = "error" ] || [ "${SERVICE_FAILED:-0}" -gt 0 ] 2>/dev/null || [ "${APPLY_FAILED:-0}" -gt 0 ] 2>/dev/null; then
    SUMMARY_STATUS=error
    SUMMARY_TITLE="需要处理"
    if [ "${SERVICE_FAILED:-0}" -gt 0 ] 2>/dev/null; then
      SUMMARY_MESSAGE="运行时服务报告 ${SERVICE_FAILED:-0} 项失败，请先查看诊断。"
    elif [ "${APPLY_FAILED:-0}" -gt 0 ] 2>/dev/null; then
      SUMMARY_MESSAGE="运行时应用报告 ${APPLY_FAILED:-0} 项失败，请先查看诊断。"
    else
      SUMMARY_MESSAGE="安装、恢复、匹配、配置、应用、服务、完整性或冲突扫描存在需要处理的问题。"
    fi
  elif [ "$MATCH_STATUS" = "running" ]; then
    SUMMARY_STATUS=running
    SUMMARY_TITLE="匹配中"
    SUMMARY_MESSAGE="规则抓取和匹配正在进行中。"
  elif [ "$APPLY_STATUS" = "running" ]; then
    SUMMARY_STATUS=running
    SUMMARY_TITLE="同步中"
    SUMMARY_MESSAGE="运行时属性正在同步写入。"
  elif [ "$INSTALL_STATUS" = "running" ] || [ "$LIFECYCLE_STATUS" = "running" ] || [ "$CONFIG_STATUS" = "running" ]; then
    SUMMARY_STATUS=running
    SUMMARY_TITLE="处理中"
    SUMMARY_MESSAGE="安装、匹配、配置或应用正在进行中。"
  elif [ "$APPLY_STATUS" = "pending" ]; then
    SUMMARY_STATUS=pending
    SUMMARY_TITLE="待重启"
    SUMMARY_MESSAGE="配置已经保存，等待重启后完成应用。"
  elif [ "$RESTORE_STATUS" = "recovery" ]; then
    SUMMARY_STATUS=recovery
    SUMMARY_TITLE="恢复中"
    SUMMARY_MESSAGE="模块正在尝试恢复必要的运行文件。"
  elif [ "$CONFLICT_STATUS" = "warning" ] || [ "${CONFLICT_TOTAL:-0}" -gt 0 ] 2>/dev/null; then
    SUMMARY_STATUS=warning
    SUMMARY_TITLE="需要关注"
    SUMMARY_MESSAGE="检测到模块属性冲突，建议先查看冲突报告。"
  elif [ "$APPLY_STATUS" = "warning" ] || [ "$SERVICE_HEALTH" = "warning" ] || [ "$SERVICE_HEALTH" = "warn" ] || state_health_warning_is_actionable || [ "${SERVICE_MISMATCH:-0}" -gt 0 ] 2>/dev/null || [ "${APPLY_MISMATCH:-0}" -gt 0 ] 2>/dev/null; then
    SUMMARY_STATUS=warning
    SUMMARY_TITLE="需要关注"
    if [ "${SERVICE_MISMATCH:-0}" -gt 0 ] 2>/dev/null; then
      SUMMARY_MESSAGE="运行时服务报告 ${SERVICE_MISMATCH:-0} 项偏差，建议查看诊断。"
    elif [ "${APPLY_MISMATCH:-0}" -gt 0 ] 2>/dev/null; then
      SUMMARY_MESSAGE="运行时应用报告 ${APPLY_MISMATCH:-0} 项偏差，建议查看诊断。"
    else
      SUMMARY_MESSAGE="运行时应用或健康检查存在少量偏差，建议查看诊断。"
    fi
  elif [ "${ALERT_TOTAL:-0}" -gt 0 ] 2>/dev/null; then
    SUMMARY_STATUS=warning
    SUMMARY_TITLE="需要关注"
    SUMMARY_MESSAGE="模块可用，诊断中有少量细节可查看。"
  elif [ "$INTEGRITY_STATUS" = "missing" ] && [ "${INTEGRITY_BLOCKING_MISSING:-0}" -gt 0 ] 2>/dev/null; then
    SUMMARY_STATUS=warning
    SUMMARY_TITLE="需要关注"
    SUMMARY_MESSAGE="一个或多个受保护模块文件缺失。"
  elif [ "$INTEGRITY_STATUS" = "changed" ] && [ "${INTEGRITY_BLOCKING_CHANGED:-0}" -gt 0 ] 2>/dev/null; then
    SUMMARY_STATUS=warning
    SUMMARY_TITLE="需要关注"
    SUMMARY_MESSAGE="一个或多个受保护模块文件发生变化。"
  fi

  state_update \
    "schema_version=$STATE_SCHEMA_VERSION" \
    "summary.status=$SUMMARY_STATUS" \
    "summary.title=$SUMMARY_TITLE" \
    "summary.message=$SUMMARY_MESSAGE" \
    "summary.attention_total=${ATTENTION_TOTAL:-0}" \
    "summary.attention_alert_total=${ALERT_TOTAL:-0}" \
    "summary.updated_at=$(state_now)"

  if [ -s "$STATE_ATTENTION_TMP" ]; then
    while IFS= read -r ATTENTION_LINE || [ -n "$ATTENTION_LINE" ]; do
      [ -n "$ATTENTION_LINE" ] && state_update "$ATTENTION_LINE" || true
    done < "$STATE_ATTENTION_TMP"
  fi
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

state_set_lifecycle() {
  state_update \
    "schema_version=$STATE_SCHEMA_VERSION" \
    "module_version=${MODULE_VERSION:-unknown}" \
    "lifecycle.status=$1" \
    "lifecycle.phase=$2" \
    "lifecycle.reason=$3" \
    "lifecycle.updated_at=$(state_now)"
  state_recompute_summary || true
}

state_set_install_progress() {
  INSTALL_PERCENT="$1"
  INSTALL_STAGE="$2"
  INSTALL_STATUS_VALUE="$3"
  INSTALL_MESSAGE="$4"
  [ "$INSTALL_STAGE" = "complete" ] && [ "$INSTALL_STATUS_VALUE" = "ok" ] && INSTALL_STATUS_VALUE=done
  INSTALL_PROGRESS_FILE="${INSTALL_PROGRESS_FILE:-$STATE_DIR/install-progress.prop}"
  mkdir -p "$STATE_DIR" 2>/dev/null || true
  {
    printf 'status=%s\n' "$INSTALL_STATUS_VALUE"
    printf 'percent=%s\n' "$INSTALL_PERCENT"
    printf 'progress=%s\n' "$INSTALL_PERCENT"
    printf 'stage=%s\n' "$INSTALL_STAGE"
    printf 'step=%s\n' "$INSTALL_STAGE"
    printf 'message=%s\n' "$INSTALL_MESSAGE"
    printf 'updated_at=%s\n' "$(state_now)"
  } > "$INSTALL_PROGRESS_FILE" 2>/dev/null || true
  chmod 0600 "$INSTALL_PROGRESS_FILE" 2>/dev/null || true
  state_update \
    "install.status=$INSTALL_STATUS_VALUE" \
    "install.percent=$INSTALL_PERCENT" \
    "install.progress=$INSTALL_PERCENT" \
    "install.stage=$INSTALL_STAGE" \
    "install.step=$INSTALL_STAGE" \
    "install.message=$INSTALL_MESSAGE" \
    "install.updated_at=$(state_now)" \
    "install.progress_file=$INSTALL_PROGRESS_FILE" || true
  case "$INSTALL_STATUS_VALUE" in
    ok|done) state_update "install.completed_at=$(state_now)" || true ;;
  esac
  [ "$INSTALL_STATUS_VALUE" = "failed" ] && state_update "install.reason=$INSTALL_MESSAGE" || true
  state_recompute_summary || true
}

state_set_config_summary() {
  SUMMARY_PROP_FILE="$1"
  SUMMARY_SOURCE="$2"
  SUMMARY_REASON="$3"
  CONFIG_STATUS_VALUE=ok
  [ -s "$SUMMARY_PROP_FILE" ] || CONFIG_STATUS_VALUE=error
  state_update \
    "schema_version=$STATE_SCHEMA_VERSION" \
    "config.status=$CONFIG_STATUS_VALUE" \
    "config.source=$SUMMARY_SOURCE" \
    "config.reason=$SUMMARY_REASON" \
    "config.generated=$([ -s "$SUMMARY_PROP_FILE" ] && printf yes || printf no)" \
    "config.prop_count=$(state_count_props "$SUMMARY_PROP_FILE")" \
    "config.prop_hash=$(state_hash_file "$SUMMARY_PROP_FILE")" \
    "config.updated_at=$(state_now)"
  state_recompute_summary || true
}
