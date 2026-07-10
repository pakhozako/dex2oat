#!/system/bin/sh

STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
STATE_FILE=${STATE_FILE:-$STATE_DIR/state.prop}
STATE_BASE_DESCRIPTION="规则驱动 ART / dexopt 调优"
STATE_MATCH_RUNNING_STALE_SECONDS=${DEX2OAT_MATCH_RUNNING_STALE_SECONDS:-300}
STATE_APPLY_RUNNING_STALE_SECONDS=${DEX2OAT_APPLY_RUNNING_STALE_SECONDS:-300}

state_source_core() {
  STATE_CORE_NAME="$1"
  for STATE_CORE_BASE in "${MODPATH:-}/core" "${MODDIR:-}/core" "${0%/*}"; do
    [ -n "$STATE_CORE_BASE" ] && [ -f "$STATE_CORE_BASE/$STATE_CORE_NAME" ] && { . "$STATE_CORE_BASE/$STATE_CORE_NAME"; return 0; }
  done
  return 1
}
state_source_core common.sh || true
state_source_core state-schema.sh || return 1 2>/dev/null || exit 1
state_source_core state-store.sh || return 1 2>/dev/null || exit 1
state_now() {
  date '+%Y-%m-%d %H:%M:%S'
}

state_module_prop_file() {
  if [ -n "${MODULE_PROP_FILE:-}" ] && [ -f "$MODULE_PROP_FILE" ]; then
    printf '%s\n' "$MODULE_PROP_FILE"
  elif [ -n "${MODPATH:-}" ] && [ -f "$MODPATH/module.prop" ]; then
    printf '%s\n' "$MODPATH/module.prop"
  elif [ -n "${MODDIR:-}" ] && [ -f "$MODDIR/module.prop" ]; then
    printf '%s\n' "$MODDIR/module.prop"
  else
    printf '\n'
  fi
}

state_count_props() {
  TARGET_FILE="$1"
  [ -s "$TARGET_FILE" ] || { printf '0\n'; return 0; }
  grep -E '^[A-Za-z0-9_.-]+=' "$TARGET_FILE" 2>/dev/null | wc -l | tr -d ' '
}

state_epoch_now() {
  date '+%s' 2>/dev/null || printf '0\n'
}

state_epoch_stale() {
  STATE_EPOCH_VALUE="$(state_num "$1")"
  STATE_STALE_SECONDS="$2"
  STATE_NOW_VALUE="$(state_epoch_now)"
  [ "${STATE_EPOCH_VALUE:-0}" -gt 0 ] 2>/dev/null || return 1
  [ "${STATE_NOW_VALUE:-0}" -gt 0 ] 2>/dev/null || return 1
  [ $((STATE_NOW_VALUE - STATE_EPOCH_VALUE)) -gt "${STATE_STALE_SECONDS:-300}" ] 2>/dev/null
}


state_source_core state-migrate.sh || return 1 2>/dev/null || exit 1
state_source_core state-summary.sh || return 1 2>/dev/null || exit 1
state_migrate || return 1 2>/dev/null || exit 1

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
  state_transaction_begin || true
  state_transaction_set "install.status=$INSTALL_STATUS_VALUE" || true
  state_transaction_set "install.percent=$INSTALL_PERCENT" || true
  state_transaction_set "install.progress=$INSTALL_PERCENT" || true
  state_transaction_set "install.stage=$INSTALL_STAGE" || true
  state_transaction_set "install.step=$INSTALL_STAGE" || true
  state_transaction_set "install.message=$INSTALL_MESSAGE" || true
  state_transaction_set "install.updated_at=$(state_now)" || true
  state_transaction_set "install.progress_file=$INSTALL_PROGRESS_FILE" || true
  case "$INSTALL_STATUS_VALUE" in
    ok|done) state_transaction_set "install.completed_at=$(state_now)" || true ;;
    failed) state_transaction_set "install.reason=$INSTALL_MESSAGE" || true ;;
  esac
  state_transaction_commit || true
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
    "config.prop_hash=$(dex_hash_file "$SUMMARY_PROP_FILE")" \
    "config.updated_at=$(state_now)"
  state_recompute_summary || true
}
