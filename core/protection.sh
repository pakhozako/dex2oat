#!/system/bin/sh

PROTECTION_THRESHOLD=${DEX2OAT_PROTECTION_THRESHOLD:-3}

protection_boot_id() { dex_boot_id 2>/dev/null || cat /proc/sys/kernel/random/boot_id 2>/dev/null; }
protection_begin_session() {
  PROTECTION_BOOT_ID="$(protection_boot_id)"
  PREVIOUS_BOOT_ID="$(state_get protection.boot_id)"
  PREVIOUS_STATUS="$(state_get protection.session_status)"
  FAILURE_COUNT="$(state_num protection.failure_count)"
  if [ -n "$PREVIOUS_BOOT_ID" ] && [ "$PREVIOUS_BOOT_ID" != "$PROTECTION_BOOT_ID" ] && [ "$PREVIOUS_STATUS" = running ]; then
    FAILURE_COUNT=$((FAILURE_COUNT + 1))
  fi
  if [ "$FAILURE_COUNT" -ge "$PROTECTION_THRESHOLD" ] 2>/dev/null; then
    state_update "protection.boot_id=$PROTECTION_BOOT_ID" "protection.session_status=blocked" "protection.failure_count=$FAILURE_COUNT" "protection.mode=on" "protection.updated_at=$(state_now)"
    return 1
  fi
  state_update "protection.boot_id=$PROTECTION_BOOT_ID" "protection.session_status=running" "protection.failure_count=$FAILURE_COUNT" "protection.mode=off" "protection.updated_at=$(state_now)"
}
protection_finish_session() {
  PROTECTION_RESULT="$1"; FAILURE_COUNT="$(state_num protection.failure_count)"
  case "$PROTECTION_RESULT" in ok) FAILURE_COUNT=0; MODE=off ;; skipped|blocked) MODE=on ;; *) FAILURE_COUNT=$((FAILURE_COUNT + 1)); MODE=off; [ "$FAILURE_COUNT" -ge "$PROTECTION_THRESHOLD" ] 2>/dev/null && MODE=on ;; esac
  state_update "protection.session_status=$PROTECTION_RESULT" "protection.failure_count=$FAILURE_COUNT" "protection.mode=$MODE" "protection.updated_at=$(state_now)"
}
protection_reset() { state_update "protection.session_status=reset" "protection.failure_count=0" "protection.mode=off" "protection.updated_at=$(state_now)"; }
