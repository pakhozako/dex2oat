#!/system/bin/sh

MODDIR="$1"
[ -n "$MODDIR" ] || MODDIR=${0%/*}/..

STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
HEALTH_LOG="$STATE_DIR/health.log"
STATE_FILE="$STATE_DIR/state.prop"
PROP_FILE="$MODDIR/system.prop"
SYSTEM_PROP_BAK="$STATE_DIR/system.prop.bak"
DEVICE_FILE="$STATE_DIR/device.prop"
PROP_LOCK_LIST="$STATE_DIR/prop-lock.list"
CONFIG_SOURCE_FILE="$STATE_DIR/config-source.prop"
CONFIG_LOCK_DIR="$STATE_DIR/.config.lock"
FILES_OK=yes
PROPS_OK=yes
AUTO_FIXED=no
STATUS=ok
REASON=passed

mkdir -p "$STATE_DIR" 2>/dev/null || true

if [ -f "$MODDIR/core/state.sh" ]; then
  . "$MODDIR/core/state.sh"
fi
if [ -f "$MODDIR/core/common.sh" ]; then
  . "$MODDIR/core/common.sh"
fi

with_config_lock() {
  if command -v dex_with_lock >/dev/null 2>&1; then
    dex_with_lock "$CONFIG_LOCK_DIR" 20 "$@"
  else
    "$@"
  fi
}

restore_system_prop_locked() {
  [ -s "$SYSTEM_PROP_BAK" ] || return 1
  cp -af "$SYSTEM_PROP_BAK" "$PROP_FILE" 2>/dev/null || return 1
  chmod 0644 "$PROP_FILE" 2>/dev/null || true
  AUTO_FIXED=yes
  if command -v state_update >/dev/null 2>&1; then
    state_update "restore.status=restored" "restore.reason=system-prop-restored" "restore.updated_at=$(date '+%Y-%m-%d %H:%M:%S')" || true
  fi
  return 0
}

restore_system_prop() {
  with_config_lock restore_system_prop_locked
}

write_prop_lock_list_locked() {
  [ -s "$PROP_FILE" ] || return 1
  TMP_LOCK="$PROP_LOCK_LIST.tmp.$$"
  : > "$TMP_LOCK" 2>/dev/null || return 1
  while IFS='=' read -r PROP_KEY PROP_VALUE; do
    PROP_KEY="$(printf '%s' "$PROP_KEY" | tr -d '\r' | sed 's/[[:space:]]*$//')"
    PROP_VALUE="$(printf '%s' "$PROP_VALUE" | tr -d '\r')"
    case "$PROP_KEY" in
      ""|\#*) continue ;;
    esac
    printf '%s=%s\n' "$PROP_KEY" "$PROP_VALUE" >> "$TMP_LOCK" 2>/dev/null || {
      rm -f "$TMP_LOCK" 2>/dev/null || true
      return 1
    }
  done < "$PROP_FILE"
  mv -f "$TMP_LOCK" "$PROP_LOCK_LIST" 2>/dev/null || {
    rm -f "$TMP_LOCK" 2>/dev/null || true
    return 1
  }
  chmod 0600 "$PROP_LOCK_LIST" 2>/dev/null || true
}

write_prop_lock_list() {
  with_config_lock write_prop_lock_list_locked
}

matched_total_is_zero() {
  MATCHED_TOTAL="$(sed -n 's/^matched_total=//p' "$CONFIG_SOURCE_FILE" 2>/dev/null | head -n 1)"
  [ "${MATCHED_TOTAL:-}" = "0" ]
}

if [ ! -s "$PROP_FILE" ]; then
  if ! restore_system_prop; then
    if command -v state_update >/dev/null 2>&1; then
      state_update "restore.status=failed" "restore.reason=system-prop-restore-failed" "restore.updated_at=$(date '+%Y-%m-%d %H:%M:%S')" || true
    fi
    FILES_OK=no
  fi
fi

[ -s "$PROP_FILE" ] || FILES_OK=no
[ -s "$SYSTEM_PROP_BAK" ] || FILES_OK=no
[ -s "$DEVICE_FILE" ] || FILES_OK=no

if [ ! -s "$PROP_LOCK_LIST" ] && [ -s "$PROP_FILE" ] && ! matched_total_is_zero; then
  write_prop_lock_list && AUTO_FIXED=yes
fi
if [ ! -s "$PROP_LOCK_LIST" ] && ! matched_total_is_zero; then
  FILES_OK=no
fi

if [ -s "$PROP_FILE" ]; then
  while IFS='=' read -r PROP_KEY PROP_VALUE; do
    PROP_KEY="$(printf '%s' "$PROP_KEY" | tr -d '\r' | sed 's/[[:space:]]*$//')"
    PROP_VALUE="$(printf '%s' "$PROP_VALUE" | tr -d '\r')"
    case "$PROP_KEY" in
      ""|\#*) continue ;;
    esac
    CURRENT_VALUE="$(getprop "$PROP_KEY")"
    if [ "$CURRENT_VALUE" != "$PROP_VALUE" ]; then
      PROPS_OK=no
    fi
  done < "$PROP_FILE"
else
  PROPS_OK=no
fi

if [ "$FILES_OK" != "yes" ]; then
  STATUS=warning
  REASON=runtime-files-warning
elif [ "$PROPS_OK" != "yes" ]; then
  STATUS=ok
  REASON=runtime-props-not-yet-applied
fi
if [ ! -s "$PROP_FILE" ]; then
  STATUS=error
  REASON=system-prop-missing
fi

{
  printf '[health]\n'
  printf 'checked_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  printf 'files_ok=%s\n' "$FILES_OK"
  printf 'props_ok=%s\n' "$PROPS_OK"
  printf 'auto_fixed=%s\n' "$AUTO_FIXED"
  printf 'status=%s\n' "$STATUS"
  printf 'reason=%s\n' "$REASON"
  BOOT_ID="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)"
  [ -n "$BOOT_ID" ] && printf 'boot_id=%s\n' "$BOOT_ID"
} > "$HEALTH_LOG" 2>/dev/null || true
chmod 0600 "$HEALTH_LOG" 2>/dev/null || true

if command -v state_update >/dev/null 2>&1; then
  state_update \
    "health.status=$STATUS" \
    "health.reason=$REASON" \
    "health.files_ok=$FILES_OK" \
    "health.props_ok=$PROPS_OK" \
    "health.auto_fixed=$AUTO_FIXED" \
    "health.checked_at=$(date '+%Y-%m-%d %H:%M:%S')" \
    "health.boot_id=$BOOT_ID" || true
  state_recompute_summary || true
fi

exit 0
