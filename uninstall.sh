#!/system/bin/sh

STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
LOG_DIR="$STATE_DIR/logs"
LOG_FILE="$LOG_DIR/uninstall.log"
FALLBACK_LOG=/data/adb/dex2oat-lock-uninstall-working.log
FINAL_LOG=/data/adb/dex2oat-lock-uninstall.log
FINAL_STATE=/data/adb/dex2oat-lock-uninstall.prop
ARCHIVE_MAX_SIZE=524288
SERVICE_LOCK_DIR="$STATE_DIR/.service.lock"
CONFIG_LOCK_DIR="$STATE_DIR/.config.lock"
ORIGINAL_PROPS="$STATE_DIR/original-props.conf"

if ! mkdir -p "$LOG_DIR" 2>/dev/null; then
  LOG_FILE="$FALLBACK_LOG"
fi

log_msg() {
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
    *dex2oat-lock*service.sh*|*Dex2oat*service.sh*|*dex2oat*service.sh*)
      return 0
      ;;
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
  if [ -d "/proc/$PID_VALUE" ]; then
    kill -9 "$PID_VALUE" 2>/dev/null || true
  fi
  log_msg "Stopped running service pid=$PID_VALUE"
}

stop_running_service() {
  if [ -f "$SERVICE_LOCK_DIR/pid" ]; then
    terminate_pid "$(cat "$SERVICE_LOCK_DIR/pid" 2>/dev/null)"
  fi

  for PROC_DIR in /proc/[0-9]*; do
    [ -d "$PROC_DIR" ] || continue
    terminate_pid "${PROC_DIR##*/}"
  done

  rm -rf "$SERVICE_LOCK_DIR" 2>/dev/null || true
}

apply_runtime_prop() {
  PROP_KEY="$1"
  PROP_VALUE="$2"
  case "$PROP_KEY" in
    ""|*[!A-Za-z0-9_.-]*|.*|*.) return 0 ;;
  esac
  case "$PROP_KEY" in
    ro.*)
      log_msg "Restoring read-only prop key=$PROP_KEY; some ROMs require reboot to fully clear cached ro.* values"
      ;;
  esac
  if command -v resetprop >/dev/null 2>&1; then
    resetprop -n "$PROP_KEY" "$PROP_VALUE" 2>/dev/null && return 0
  fi
  setprop "$PROP_KEY" "$PROP_VALUE" 2>/dev/null || true
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
        case "$PROP_VALUE" in
          @unset:*) PROP_VALUE="" ;;
        esac
        ;;
      *)
        continue
        ;;
    esac
    apply_runtime_prop "$PROP_KEY" "$PROP_VALUE"
  done < "$ORIGINAL_PROPS"
  log_msg "Runtime properties restored from original-props.conf when supported by the current root stack"
}

cleanup_state_files() {
  [ -d "$STATE_DIR" ] || return 0
  rm -f "$STATE_DIR/config-source.prop" 2>/dev/null
  rm -f "$STATE_DIR/state.prop" 2>/dev/null
  rm -f "$STATE_DIR/device.prop" 2>/dev/null
  rm -f "$STATE_DIR/install-progress.prop" 2>/dev/null
  rm -f "$STATE_DIR/install-state.prop" 2>/dev/null
  rm -f "$STATE_DIR/original-props.conf" 2>/dev/null
  rm -f "$STATE_DIR/matched-props.txt" 2>/dev/null
  rm -f "$STATE_DIR/rule-props.tsv" "$STATE_DIR/rule-seen-props.txt" 2>/dev/null
  rm -f "$STATE_DIR/system.prop.bak" 2>/dev/null
  rm -f "$STATE_DIR/trigger-rematch" 2>/dev/null
  rm -f "$STATE_DIR/captured-keys.txt" 2>/dev/null
  rm -f "$STATE_DIR/captured-values.prop" 2>/dev/null
  rm -f "$STATE_DIR/options-props.txt" 2>/dev/null
  rm -f "$STATE_DIR/service-state.prop" 2>/dev/null
  rm -f "$STATE_DIR/service.log" 2>/dev/null
  rm -f "$STATE_DIR/runtime-props.tmp" "$STATE_DIR/runtime-props.hash" 2>/dev/null
  rm -f "$STATE_DIR/health.log" 2>/dev/null
  rm -f "$STATE_DIR/conflict-report.txt" 2>/dev/null
  rm -f "$STATE_DIR/conflict-report.tmp" 2>/dev/null
  rm -f "$STATE_DIR/integrity-report.txt" 2>/dev/null
  rm -f "$STATE_DIR/prop-lock.list" 2>/dev/null
  rm -f "$STATE_DIR"/.*-status.* 2>/dev/null
  rm -rf "$STATE_DIR/backup" "$STATE_DIR/logs" "$STATE_DIR"/stage-* "$STATE_DIR"/rollback.* "$STATE_DIR"/.state.lock "$STATE_DIR"/.webui-save.lock "$STATE_DIR"/.service.lock "$CONFIG_LOCK_DIR" 2>/dev/null
  trim_archive_file "$STATE_DIR/captured-props.txt"
  trim_archive_file "$STATE_DIR/match-report.txt"
  trim_archive_file "$STATE_DIR/install.log"
  chmod 0700 "$STATE_DIR" 2>/dev/null || true
  chmod 0600 "$STATE_DIR/captured-props.txt" "$STATE_DIR/match-report.txt" "$STATE_DIR/install.log" 2>/dev/null || true
}

log_msg "Uninstalling Dex2oat Lock..."
stop_running_service
restore_original_props
persist_uninstall_log
cleanup_state_files
LOG_FILE="$FINAL_LOG"
write_uninstall_state ok cleaned
log_msg "Cleanup completed. Module uninstalled. Archived captured-props.txt, match-report.txt, install.log."
persist_uninstall_log
