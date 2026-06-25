#!/system/bin/sh

STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
STATE_FILE=${STATE_FILE:-$STATE_DIR/state.prop}
STATE_SCHEMA_VERSION=32
STATE_BASE_DESCRIPTION="Rule-driven dexopt tuning and unified state monitor"

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
  LOOKUP_KEY="$1"
  [ -f "$STATE_FILE" ] || return 0
  awk -F= -v key="$LOOKUP_KEY" '$1 == key { sub(/^[^=]*=/, ""); value=$0; found=1 } END { if (found) print value }' "$STATE_FILE" 2>/dev/null
}

state_clear_attention_keys() {
  [ -f "$STATE_FILE" ] || return 0
  TMP_STATE="$STATE_FILE.clear.tmp"
  grep -v -E '^(summary\.attention\.|summary\.attention_total=|summary\.attention_alert_total=)' "$STATE_FILE" > "$TMP_STATE" 2>/dev/null || : > "$TMP_STATE"
  mv -f "$TMP_STATE" "$STATE_FILE" 2>/dev/null || true
}

state_attention_reset() {
  STATE_ATTENTION_INDEX=0
  STATE_ATTENTION_ALERT_INDEX=0
  STATE_ATTENTION_TMP="$STATE_DIR/state-attention.tmp"
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
    partial) state_attention_add warning match "Partial rule match; conservative defaults were used" ;;
    fallback) state_attention_add warning match "Fallback rule strategy is active because capture evidence was insufficient" ;;
    ok) : ;;
  esac

  case "$CONFIG_STATUS" in
    error|failed) state_attention_add error config "Config generation failed: $(state_get config.reason)" ;;
    warning) state_attention_add warning config "Config generation warning: $(state_get config.reason)" ;;
  esac

  if [ "$CONFIG_SOURCE" = "webui-custom" ]; then
    state_attention_add info risk "Custom WebUI configuration overrides automatic rule output"
  fi

  case "$APPLY_STATUS" in
    error) state_attention_add error apply "Apply failed for ${APPLY_FAILED:-0} runtime properties" ;;
    warning) state_attention_add warning apply "Apply mismatch detected for ${APPLY_MISMATCH:-0} runtime properties" ;;
    pending|running) state_attention_add info apply "Apply result is pending after config generation" ;;
  esac

  if [ "$SERVICE_STATUS" = "error" ]; then
    state_attention_add error service "Service error: $(state_get service.reason)"
  elif [ "$SERVICE_HEALTH" = "problem" ] && { [ "${SERVICE_FAILED:-0}" -gt 0 ] 2>/dev/null || [ "${SERVICE_MISMATCH:-0}" -gt 0 ] 2>/dev/null; }; then
    state_attention_add warning service "Runtime service reported failed=${SERVICE_FAILED:-0}, mismatch=${SERVICE_MISMATCH:-0}"
  fi

  case "$HEALTH_STATUS" in
    error) state_attention_add error health "Health check failed: $(state_get health.reason)" ;;
    warning|warn) state_attention_add warning health "Health check warning: $(state_get health.reason)" ;;
  esac
  [ "$(state_get health.auto_fixed)" = "yes" ] && state_attention_add info health "Health check repaired a missing runtime file"

  if [ "${CONFLICT_TOTAL:-0}" -gt 0 ] 2>/dev/null; then
    state_attention_add warning conflict "Detected ${CONFLICT_TOTAL} module property conflicts"
  elif [ "$CONFLICT_STATUS" = "error" ]; then
    state_attention_add error conflict "Conflict scan failed"
  fi

  case "$INTEGRITY_STATUS" in
    error) state_attention_add error integrity "Integrity check failed: $(state_get integrity.reason)" ;;
    missing) state_attention_add warning integrity "Integrity check found ${INTEGRITY_MISSING:-0} missing files" ;;
    changed) state_attention_add warning integrity "Integrity check found ${INTEGRITY_CHANGED:-0} changed files" ;;
    warning|warn) state_attention_add warning integrity "Integrity warning: $(state_get integrity.reason)" ;;
  esac

  case "$RESTORE_STATUS" in
    restored|recovered) state_attention_add info restore "Runtime restore was performed: $(state_get restore.reason)" ;;
    recovery) state_attention_add warning restore "Recovery is active: $(state_get restore.reason)" ;;
    failed) state_attention_add error restore "Restore failed: $(state_get restore.reason)" ;;
  esac

  printf '%s\n' "$STATE_ATTENTION_INDEX"
}

state_summary_reason() {
  REASON=""
  MATCH_STATUS="$(state_get match.status)"
  CONFIG_SOURCE="$(state_get config.source)"
  APPLY_STATUS="$(state_get apply.status)"
  SERVICE_STATUS="$(state_get service.status)"
  INTEGRITY_STATUS="$(state_get integrity.status)"
  HEALTH_STATUS="$(state_get health.status)"
  CONFLICT_TOTAL="$(state_num conflict.total)"

  case "$MATCH_STATUS" in
    partial) REASON="partial match" ;;
    fallback) REASON="fallback rule set" ;;
  esac

  [ "$CONFIG_SOURCE" = "webui-custom" ] && REASON="${REASON:+$REASON / }custom config"
  [ "${CONFLICT_TOTAL:-0}" -gt 0 ] 2>/dev/null && REASON="${REASON:+$REASON / }conflict"

  case "$APPLY_STATUS" in
    warning) REASON="${REASON:+$REASON / }apply warning" ;;
    error) REASON="${REASON:+$REASON / }apply error" ;;
  esac

  case "$SERVICE_STATUS" in
    error) REASON="${REASON:+$REASON / }service error" ;;
  esac

  case "$INTEGRITY_STATUS" in
    missing|changed|warning|warn|error) REASON="${REASON:+$REASON / }integrity $INTEGRITY_STATUS" ;;
  esac

  case "$HEALTH_STATUS" in
    warning|warn|error) REASON="${REASON:+$REASON / }health $HEALTH_STATUS" ;;
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
  SUMMARY_ICON="🟨"
  case "$SUMMARY_STATUS_VALUE" in
    ok) SUMMARY_ICON="🟩" ;;
    warning|partial|fallback|pending|recovery) SUMMARY_ICON="🟨" ;;
    error) SUMMARY_ICON="🟥" ;;
  esac
  case "$SUMMARY_STATUS_VALUE" in
    ok) DESCRIPTION_VALUE="$STATE_BASE_DESCRIPTION | $SUMMARY_ICON OK" ;;
    warning) DESCRIPTION_VALUE="$STATE_BASE_DESCRIPTION | $SUMMARY_ICON Warning ($SUMMARY_REASON_VALUE)" ;;
    error) DESCRIPTION_VALUE="$STATE_BASE_DESCRIPTION | $SUMMARY_ICON Error ($SUMMARY_REASON_VALUE)" ;;
    partial) DESCRIPTION_VALUE="$STATE_BASE_DESCRIPTION | $SUMMARY_ICON Partial ($SUMMARY_REASON_VALUE)" ;;
    fallback) DESCRIPTION_VALUE="$STATE_BASE_DESCRIPTION | $SUMMARY_ICON Fallback ($SUMMARY_REASON_VALUE)" ;;
    recovery) DESCRIPTION_VALUE="$STATE_BASE_DESCRIPTION | $SUMMARY_ICON Recovery ($SUMMARY_REASON_VALUE)" ;;
    pending) DESCRIPTION_VALUE="$STATE_BASE_DESCRIPTION | $SUMMARY_ICON Pending ($SUMMARY_REASON_VALUE)" ;;
    *) DESCRIPTION_VALUE="$STATE_BASE_DESCRIPTION | 🟨 Unknown" ;;
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

state_recompute_summary() {
  mkdir -p "$STATE_DIR" 2>/dev/null || return 0
  [ -f "$STATE_FILE" ] || return 0

  state_clear_attention_keys
  ATTENTION_TOTAL="$(state_collect_attention)"
  ALERT_TOTAL="${STATE_ATTENTION_ALERT_INDEX:-0}"
  SUMMARY_STATUS=ok
  SUMMARY_TITLE="Status OK"
  SUMMARY_MESSAGE="No blocking issue was found in the unified state."

  MATCH_STATUS="$(state_get match.status)"
  CONFIG_STATUS="$(state_get config.status)"
  APPLY_STATUS="$(state_get apply.status)"
  SERVICE_STATUS="$(state_get service.status)"
  INTEGRITY_STATUS="$(state_get integrity.status)"
  HEALTH_STATUS="$(state_get health.status)"
  INSTALL_STATUS="$(state_get install.status)"
  LIFECYCLE_STATUS="$(state_get lifecycle.status)"
  RESTORE_STATUS="$(state_get restore.status)"

  if [ "$INSTALL_STATUS" = "failed" ] || [ "$LIFECYCLE_STATUS" = "failed" ] || [ "$SERVICE_STATUS" = "error" ] || [ "$APPLY_STATUS" = "error" ] || [ "$INTEGRITY_STATUS" = "error" ] || [ "$CONFIG_STATUS" = "error" ] || [ "$CONFIG_STATUS" = "failed" ] || [ "$MATCH_STATUS" = "error" ] || [ "$MATCH_STATUS" = "failed" ]; then
    SUMMARY_STATUS=error
    SUMMARY_TITLE="Action Required"
    SUMMARY_MESSAGE="A blocking install, match, config, apply, service, or integrity problem is present."
  elif [ "$INSTALL_STATUS" = "running" ] || [ "$LIFECYCLE_STATUS" = "running" ]; then
    SUMMARY_STATUS=pending
    SUMMARY_TITLE="Install In Progress"
    SUMMARY_MESSAGE="The installer is still writing progress and final state."
  elif [ "$RESTORE_STATUS" = "recovery" ]; then
    SUMMARY_STATUS=recovery
    SUMMARY_TITLE="Recovery In Progress"
    SUMMARY_MESSAGE="The module is trying to recover a required runtime file."
  elif [ "$MATCH_STATUS" = "partial" ]; then
    SUMMARY_STATUS=partial
    SUMMARY_TITLE="Partial Rule Match"
    SUMMARY_MESSAGE="Rules matched useful evidence, but conservative defaults filled missing inputs."
  elif [ "$MATCH_STATUS" = "fallback" ]; then
    SUMMARY_STATUS=fallback
    SUMMARY_TITLE="Fallback Strategy"
    SUMMARY_MESSAGE="No reliable capture evidence was found; safe defaults generated system.prop."
  elif [ "$APPLY_STATUS" = "pending" ] || { [ "$(state_get config.source)" = "webui-custom" ] && [ "$(state_get service.status)" != "settled" ]; }; then
    SUMMARY_STATUS=pending
    SUMMARY_TITLE="Pending Apply"
    SUMMARY_MESSAGE="system.prop has been generated and normally needs a reboot or service settle pass."
  elif [ "${ALERT_TOTAL:-0}" -gt 0 ] 2>/dev/null || [ "$INTEGRITY_STATUS" = "missing" ] || [ "$INTEGRITY_STATUS" = "changed" ] || [ "$INTEGRITY_STATUS" = "warning" ] || [ "$HEALTH_STATUS" = "warning" ] || [ "$HEALTH_STATUS" = "warn" ]; then
    SUMMARY_STATUS=warning
    SUMMARY_TITLE="Warnings Present"
    SUMMARY_MESSAGE="The module is usable, but one or more diagnostics need attention."
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
