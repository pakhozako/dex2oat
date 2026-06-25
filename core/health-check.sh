#!/system/bin/sh

MODDIR="$1"
[ -n "$MODDIR" ] || MODDIR=${0%/*}/..

STATE_DIR=/data/adb/dex2oat-lock
HEALTH_LOG="$STATE_DIR/health.log"
STATE_FILE="$STATE_DIR/state.prop"
PROP_FILE="$MODDIR/system.prop"
SYSTEM_PROP_BAK="$STATE_DIR/system.prop.bak"
DEVICE_FILE="$STATE_DIR/device.prop"
PROP_LOCK_LIST="$STATE_DIR/prop-lock.list"
FILES_OK=yes
PROPS_OK=yes
AUTO_FIXED=no
STATUS=ok
REASON=passed

mkdir -p "$STATE_DIR" 2>/dev/null || true

if [ -f "$MODDIR/core/state.sh" ]; then
  . "$MODDIR/core/state.sh"
fi

restore_system_prop() {
  [ -s "$SYSTEM_PROP_BAK" ] || return 1
  cp -af "$SYSTEM_PROP_BAK" "$PROP_FILE" 2>/dev/null || return 1
  chmod 0644 "$PROP_FILE" 2>/dev/null || true
  AUTO_FIXED=yes
  if command -v state_update >/dev/null 2>&1; then
    state_update "restore.status=restored" "restore.reason=system-prop-restored" "restore.updated_at=$(date '+%Y-%m-%d %H:%M:%S')" || true
  fi
  return 0
}

write_prop_lock_list() {
  [ -s "$PROP_FILE" ] || return 1
  : > "$PROP_LOCK_LIST" 2>/dev/null || return 1
  while IFS='=' read -r PROP_KEY PROP_VALUE; do
    PROP_KEY="$(printf '%s' "$PROP_KEY" | tr -d '\r' | sed 's/[[:space:]]*$//')"
    PROP_VALUE="$(printf '%s' "$PROP_VALUE" | tr -d '\r')"
    case "$PROP_KEY" in
      ""|\#*) continue ;;
    esac
    printf '%s=%s\n' "$PROP_KEY" "$PROP_VALUE" >> "$PROP_LOCK_LIST" 2>/dev/null || true
  done < "$PROP_FILE"
  chmod 0600 "$PROP_LOCK_LIST" 2>/dev/null || true
}

if [ ! -s "$PROP_FILE" ]; then
  restore_system_prop || FILES_OK=no
fi

[ -s "$PROP_FILE" ] || FILES_OK=no
[ -s "$SYSTEM_PROP_BAK" ] || FILES_OK=no
[ -s "$DEVICE_FILE" ] || FILES_OK=no

if [ ! -s "$PROP_LOCK_LIST" ] && [ -s "$PROP_FILE" ]; then
  write_prop_lock_list && AUTO_FIXED=yes
fi
[ -s "$PROP_LOCK_LIST" ] || FILES_OK=no

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

if [ "$FILES_OK" != "yes" ] || [ "$PROPS_OK" != "yes" ]; then
  STATUS=warning
  REASON=files-or-runtime-props-warning
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
