#!/system/bin/sh

MODDIR=${0%/*}
STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
LOG_DIR="$STATE_DIR/logs"
LOG_FILE="$LOG_DIR/uninstall.log"
FALLBACK_LOG=/data/adb/dex2oat-lock-uninstall-working.log
FINAL_LOG=/data/adb/dex2oat-lock-uninstall.log
FINAL_STATE=/data/adb/dex2oat-lock-uninstall.prop
ARCHIVE_MAX_SIZE=524288
SERVICE_LOCK_DIR="$STATE_DIR/.service.lock"
ORIGINAL_PROPS="$STATE_DIR/original-props.conf"

[ -f "$MODDIR/core/common.sh" ] && . "$MODDIR/core/common.sh"
[ -f "$MODDIR/core/safety.sh" ] && . "$MODDIR/core/safety.sh"

if ! mkdir -p "$LOG_DIR" 2>/dev/null; then
  LOG_FILE="$FALLBACK_LOG"
fi

uninstall_log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE" 2>/dev/null
}

persist_uninstall_log() {
  [ "$LOG_FILE" = "$FINAL_LOG" ] && return 0
  [ -f "$LOG_FILE" ] && cp -af "$LOG_FILE" "$FINAL_LOG" 2>/dev/null
}

write_uninstall_state() {
  UNINSTALL_STATUS="$1"
  UNINSTALL_REASON="$2"
  {
    printf 'status=%s\n' "$UNINSTALL_STATUS"
    [ -n "$UNINSTALL_REASON" ] && printf 'reason=%s\n' "$UNINSTALL_REASON"
    printf 'updated_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  } > "$FINAL_STATE" 2>/dev/null || true
  chmod 0600 "$FINAL_STATE" 2>/dev/null || true
}

trim_archive_file() {
  TARGET="$1"
  [ -f "$TARGET" ] || return 0
  SIZE="$(wc -c < "$TARGET" 2>/dev/null | tr -d ' ')"
  [ "${SIZE:-0}" -gt "$ARCHIVE_MAX_SIZE" ] 2>/dev/null || return 0
  TMP_FILE="$TARGET.trim"
  tail -c "$ARCHIVE_MAX_SIZE" "$TARGET" > "$TMP_FILE" 2>/dev/null && mv -f "$TMP_FILE" "$TARGET" 2>/dev/null
  rm -f "$TMP_FILE" 2>/dev/null || true
}

is_service_pid() {
  PID_VALUE="$1"
  case "$PID_VALUE" in
    ""|*[!0-9]*|$$) return 1 ;;
  esac
  [ -d "/proc/$PID_VALUE" ] || return 1
  CMDLINE="$(tr '\000' ' ' < "/proc/$PID_VALUE/cmdline" 2>/dev/null)"
  case "$CMDLINE" in
    *dex2oat-lock*service.sh*|*Dex2oat*service.sh*|*dex2oat*service.sh*) return 0 ;;
  esac
  return 1
}

terminate_pid() {
  PID_VALUE="$1"
  is_service_pid "$PID_VALUE" || return 0
  kill "$PID_VALUE" 2>/dev/null || true
  WAIT_COUNT=0
  while [ -d "/proc/$PID_VALUE" ] && [ "$WAIT_COUNT" -lt 5 ]; do
    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
  done
  [ -d "/proc/$PID_VALUE" ] && kill -9 "$PID_VALUE" 2>/dev/null || true
  uninstall_log "已停止运行中的服务 pid=$PID_VALUE"
}

stop_running_service() {
  if [ -f "$SERVICE_LOCK_DIR/pid" ]; then
    terminate_pid "$(cat "$SERVICE_LOCK_DIR/pid" 2>/dev/null)"
  fi
  for PROC_DIR in /proc/[0-9]*; do
    [ -d "$PROC_DIR" ] || continue
    terminate_pid "${PROC_DIR##*/}"
  done
  dex_safe_remove_state_tree "$SERVICE_LOCK_DIR" || uninstall_log "拒绝递归清理非白名单路径: $SERVICE_LOCK_DIR"
}

apply_runtime_prop() {
  PROP_KEY="$1"
  PROP_VALUE="$2"
  case "$PROP_KEY" in
    ""|*[!A-Za-z0-9_.-]*|.*|*.) return 0 ;;
  esac
  case "$PROP_KEY" in
    ro.*) uninstall_log "正在恢复只读属性 key=$PROP_KEY；可能需要重启后完全生效" ;;
  esac
  command -v dex_apply_prop >/dev/null 2>&1 || return 0
  dex_apply_prop "$PROP_KEY" "$PROP_VALUE" 2>/dev/null || true
}

restore_original_props() {
  [ -s "$ORIGINAL_PROPS" ] || return 0
  while IFS= read -r LINE_VALUE || [ -n "$LINE_VALUE" ]; do
    case "$LINE_VALUE" in
      ""|\#*) continue ;;
      @unset:*)
        PROP_KEY="${LINE_VALUE#@unset:}"
        PROP_VALUE=""
        ;;
      *=*)
        PROP_KEY="${LINE_VALUE%%=*}"
        PROP_VALUE="${LINE_VALUE#*=}"
        case "$PROP_VALUE" in @unset:*) PROP_VALUE="" ;; esac
        ;;
      *) continue ;;
    esac
    apply_runtime_prop "$PROP_KEY" "$PROP_VALUE"
  done < "$ORIGINAL_PROPS"
  uninstall_log "已按支持情况从 original-props.conf 恢复运行时属性"
}

cleanup_state_files() {
  [ -d "$STATE_DIR" ] || return 0
  dex_safe_state_dir || { uninstall_log "拒绝清理非安全状态目录: $STATE_DIR"; return 0; }
  rm -f "$STATE_DIR/config-source.prop" 2>/dev/null
  rm -f "$STATE_DIR/state.prop" 2>/dev/null
  rm -f "$STATE_DIR/device.prop" 2>/dev/null
  rm -f "$STATE_DIR/install-progress.prop" 2>/dev/null
  rm -f "$STATE_DIR/install-state.prop" 2>/dev/null
  rm -f "$STATE_DIR/original-props.conf" 2>/dev/null
  rm -f "$STATE_DIR/matched-props.txt" 2>/dev/null
  rm -f "$STATE_DIR/rule-props.tsv" "$STATE_DIR/rule-seen-props.txt" 2>/dev/null
  rm -f "$STATE_DIR/system.prop.bak" 2>/dev/null
  rm -f "$STATE_DIR/captured-keys.txt" 2>/dev/null
  rm -f "$STATE_DIR/captured-values.prop" 2>/dev/null
  rm -f "$STATE_DIR/options-props.txt" 2>/dev/null
  rm -f "$STATE_DIR/service-state.prop" 2>/dev/null
  rm -f "$STATE_DIR/service.log" 2>/dev/null
  rm -f "$STATE_DIR/runtime-props.tmp" "$STATE_DIR/runtime-props.hash" 2>/dev/null
  rm -f "$STATE_DIR/health.log" "$STATE_DIR/health-history.tsv" 2>/dev/null
  rm -f "$STATE_DIR/conflict-report.txt" 2>/dev/null
  rm -f "$STATE_DIR"/conflict-report*.tmp "$STATE_DIR"/conflict-managed*.tmp 2>/dev/null
  rm -f "$STATE_DIR/integrity-report.txt" 2>/dev/null
  rm -f "$STATE_DIR/prop-lock.list" 2>/dev/null
  rm -f "$STATE_DIR/action.log" 2>/dev/null
  rm -f "$STATE_DIR"/.*-status.* 2>/dev/null
  for CLEANUP_DIR in \
    "$STATE_DIR/backup" \
    "$STATE_DIR/logs" \
    "$STATE_DIR/.state.lock" \
    "$STATE_DIR/.summary.lock" \
    "$STATE_DIR/.service.lock" \
    "$STATE_DIR/.runtime.lock" \
    "$STATE_DIR/.action.lock" \
    "$STATE_DIR/.health-history.lock"; do
    dex_safe_remove_state_tree "$CLEANUP_DIR" || uninstall_log "拒绝递归清理非白名单路径: $CLEANUP_DIR"
  done
  trim_archive_file "$STATE_DIR/captured-props.txt"
  trim_archive_file "$STATE_DIR/match-report.txt"
  trim_archive_file "$STATE_DIR/install.log"
  chmod 0700 "$STATE_DIR" 2>/dev/null || true
  chmod 0600 "$STATE_DIR/captured-props.txt" "$STATE_DIR/match-report.txt" "$STATE_DIR/install.log" 2>/dev/null || true
}

uninstall_log "开始卸载 Dex2oat Lock..."
stop_running_service
restore_original_props
persist_uninstall_log
cleanup_state_files
LOG_FILE="$FINAL_LOG"
write_uninstall_state ok cleaned
uninstall_log "清理完成，模块已卸载；已保留 captured-props.txt、match-report.txt、install.log 归档。"
persist_uninstall_log
