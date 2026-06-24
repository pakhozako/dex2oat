#!/system/bin/sh

STATE_DIR=/data/adb/dex2oat-lock
LOG_DIR="$STATE_DIR/logs"
LOG_FILE="$LOG_DIR/uninstall.log"
FALLBACK_LOG=/data/adb/dex2oat-lock-uninstall-working.log
FINAL_LOG=/data/adb/dex2oat-lock-uninstall.log
FINAL_STATE=/data/adb/dex2oat-lock-uninstall.prop

if ! mkdir -p "$LOG_DIR" 2>/dev/null; then
  LOG_FILE="$FALLBACK_LOG"
fi

log_msg() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE" 2>/dev/null
}

persist_uninstall_log() {
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

cleanup_state_files() {
  [ -d "$STATE_DIR" ] || return 0
  rm -f "$STATE_DIR/config-source.prop" 2>/dev/null
  rm -f "$STATE_DIR/state.prop" 2>/dev/null
  rm -f "$STATE_DIR/device.prop" 2>/dev/null
  rm -f "$STATE_DIR/original-props.conf" 2>/dev/null
  rm -f "$STATE_DIR/matched-props.txt" 2>/dev/null
  rm -f "$STATE_DIR/system.prop.bak" 2>/dev/null
  rm -f "$STATE_DIR/trigger-rematch" 2>/dev/null
  rm -f "$STATE_DIR/captured-keys.txt" 2>/dev/null
  rm -f "$STATE_DIR/captured-values.prop" 2>/dev/null
  rm -f "$STATE_DIR/options-props.txt" 2>/dev/null
  rm -f "$STATE_DIR/service-state.prop" 2>/dev/null
  rm -f "$STATE_DIR/service.log" 2>/dev/null
  rm -f "$STATE_DIR/health.log" 2>/dev/null
  rm -f "$STATE_DIR/conflict-report.txt" 2>/dev/null
  rm -f "$STATE_DIR/conflict-report.tmp" 2>/dev/null
  rm -f "$STATE_DIR/integrity-report.txt" 2>/dev/null
  rm -f "$STATE_DIR/prop-lock.list" 2>/dev/null
  rm -rf "$STATE_DIR/backup" "$STATE_DIR/logs" 2>/dev/null
  chmod 0700 "$STATE_DIR" 2>/dev/null || true
  chmod 0600 "$STATE_DIR/captured-props.txt" "$STATE_DIR/match-report.txt" "$STATE_DIR/install.log" 2>/dev/null || true
}

log_msg "Uninstalling Dex2oat Lock..."
cleanup_state_files
write_uninstall_state ok cleaned
log_msg "Cleanup completed. Module uninstalled. Archived captured-props.txt, match-report.txt, install.log."
persist_uninstall_log
