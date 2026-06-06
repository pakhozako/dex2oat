#!/system/bin/sh

STATE_DIR=/data/adb/dex2oat-lock
LOG_DIR="$STATE_DIR/logs"
LOG_FILE="$LOG_DIR/uninstall.log"
FALLBACK_LOG=/data/adb/dex2oat-lock-uninstall-working.log
FINAL_LOG=/data/adb/dex2oat-lock-uninstall.log
FINAL_STATE=/data/adb/dex2oat-lock-uninstall.prop
ORIGINAL_PROPS="$STATE_DIR/original-props.conf"

if ! mkdir -p "$LOG_DIR" 2>/dev/null; then
  LOG_FILE="$FALLBACK_LOG"
fi

log_msg() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE" 2>/dev/null
}

persist_uninstall_log() {
  if [ -f "$LOG_FILE" ]; then
    cp -af "$LOG_FILE" "$FINAL_LOG" 2>/dev/null
  fi
}

write_uninstall_state() {
  UNINSTALL_STATUS="$1"
  UNINSTALL_REASON="$2"
  NOW="$(date '+%s')"

  {
    printf 'status=%s\n' "$UNINSTALL_STATUS"
    [ -n "$UNINSTALL_REASON" ] && printf 'reason=%s\n' "$UNINSTALL_REASON"
    printf 'prop_total=%s\n' "${PROP_COUNT:-0}"
    printf 'restored=%s\n' "${RESTORED_COUNT:-0}"
    printf 'deleted=%s\n' "${DELETED_COUNT:-0}"
    printf 'mismatch=%s\n' "${MISMATCH_COUNT:-0}"
    printf 'failed=%s\n' "${FAILED_COUNT:-0}"
    printf 'updated_at=%s\n' "$NOW"
  } > "$FINAL_STATE" 2>/dev/null || true
  chmod 0600 "$FINAL_STATE" 2>/dev/null || true
}

restore_prop() {
  PROP_KEY="$1"
  PROP_VALUE="$2"
  OLD_VALUE="$(getprop "$PROP_KEY")"
  APPLY_TOOL="setprop"

  if command -v resetprop >/dev/null 2>&1; then
    APPLY_TOOL="resetprop"
    resetprop "$PROP_KEY" "$PROP_VALUE"
  else
    setprop "$PROP_KEY" "$PROP_VALUE"
  fi

  APPLY_CODE=$?
  NEW_VALUE="$(getprop "$PROP_KEY")"

  if [ "$APPLY_CODE" -ne 0 ]; then
    log_msg "Restore failed: key=$PROP_KEY desired=$PROP_VALUE old=$OLD_VALUE new=$NEW_VALUE tool=$APPLY_TOOL code=$APPLY_CODE"
    return 1
  fi

  if [ "$NEW_VALUE" = "$PROP_VALUE" ]; then
    log_msg "Restored: key=$PROP_KEY desired=$PROP_VALUE old=$OLD_VALUE new=$NEW_VALUE tool=$APPLY_TOOL code=$APPLY_CODE"
    return 0
  fi

  log_msg "Restore mismatch: key=$PROP_KEY desired=$PROP_VALUE old=$OLD_VALUE new=$NEW_VALUE tool=$APPLY_TOOL code=$APPLY_CODE"
  return 2
}

delete_prop() {
  PROP_KEY="$1"
  OLD_VALUE="$(getprop "$PROP_KEY")"
  APPLY_TOOL="setprop"

  if command -v resetprop >/dev/null 2>&1; then
    APPLY_TOOL="resetprop"
    resetprop --delete "$PROP_KEY" 2>/dev/null
  else
    setprop "$PROP_KEY" ""
  fi

  APPLY_CODE=$?
  NEW_VALUE="$(getprop "$PROP_KEY")"

  if [ "$APPLY_CODE" -ne 0 ]; then
    log_msg "Delete failed: key=$PROP_KEY old=$OLD_VALUE new=$NEW_VALUE tool=$APPLY_TOOL code=$APPLY_CODE"
    return 1
  fi

  if [ -z "$NEW_VALUE" ]; then
    log_msg "Deleted: key=$PROP_KEY old=$OLD_VALUE new=$NEW_VALUE tool=$APPLY_TOOL code=$APPLY_CODE"
    return 0
  fi

  log_msg "Delete mismatch: key=$PROP_KEY old=$OLD_VALUE new=$NEW_VALUE tool=$APPLY_TOOL code=$APPLY_CODE"
  return 2
}

log_msg "Uninstalling Dex2oat Lock..."

if [ -f "$ORIGINAL_PROPS" ]; then
  PROP_COUNT=0
  RESTORED_COUNT=0
  DELETED_COUNT=0
  MISMATCH_COUNT=0
  FAILED_COUNT=0
  while IFS= read -r PROP_LINE; do
    case "$PROP_LINE" in
      @unset:*)
        delete_prop "${PROP_LINE#@unset:}"
        APPLY_STATUS=$?
        PROP_COUNT=$((PROP_COUNT + 1))
        case "$APPLY_STATUS" in
          0) DELETED_COUNT=$((DELETED_COUNT + 1)) ;;
          2) MISMATCH_COUNT=$((MISMATCH_COUNT + 1)) ;;
          *) FAILED_COUNT=$((FAILED_COUNT + 1)) ;;
        esac
        ;;
      *=*)
        restore_prop "${PROP_LINE%%=*}" "${PROP_LINE#*=}"
        APPLY_STATUS=$?
        PROP_COUNT=$((PROP_COUNT + 1))
        case "$APPLY_STATUS" in
          0) RESTORED_COUNT=$((RESTORED_COUNT + 1)) ;;
          2) MISMATCH_COUNT=$((MISMATCH_COUNT + 1)) ;;
          *) FAILED_COUNT=$((FAILED_COUNT + 1)) ;;
        esac
        ;;
    esac
  done < "$ORIGINAL_PROPS"
  log_msg "Uninstall property restore completed. Total: $PROP_COUNT restored=$RESTORED_COUNT deleted=$DELETED_COUNT mismatch=$MISMATCH_COUNT failed=$FAILED_COUNT"
  if [ "$FAILED_COUNT" -gt 0 ] || [ "$MISMATCH_COUNT" -gt 0 ]; then
    write_uninstall_state problem restore_problem
  else
    write_uninstall_state ok restored
  fi
else
  log_msg "No original props file found, skipping restore."
  PROP_COUNT=0
  RESTORED_COUNT=0
  DELETED_COUNT=0
  MISMATCH_COUNT=0
  FAILED_COUNT=0
  write_uninstall_state skipped no_original_props
fi

log_msg "Cleanup completed. Module uninstalled."
persist_uninstall_log
rm -rf "$STATE_DIR"
