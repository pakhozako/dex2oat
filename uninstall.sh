#!/system/bin/sh

STATE_DIR=/data/adb/dex2oat-lock
LOG_DIR="$STATE_DIR/logs"
LOG_FILE="$LOG_DIR/uninstall.log"
ORIGINAL_PROPS="$STATE_DIR/original-props.conf"

mkdir -p "$LOG_DIR"

log_msg() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"
}

restore_prop() {
  PROP_KEY="$1"
  PROP_VALUE="$2"

  if command -v resetprop >/dev/null 2>&1; then
    resetprop "$PROP_KEY" "$PROP_VALUE"
  else
    setprop "$PROP_KEY" "$PROP_VALUE"
  fi

  log_msg "Restored: $PROP_KEY=$PROP_VALUE"
}

delete_prop() {
  PROP_KEY="$1"

  if command -v resetprop >/dev/null 2>&1; then
    resetprop --delete "$PROP_KEY" 2>/dev/null
  else
    setprop "$PROP_KEY" ""
  fi

  log_msg "Deleted: $PROP_KEY"
}

log_msg "Uninstalling Dex2oat Lock..."

if [ -f "$ORIGINAL_PROPS" ]; then
  PROP_COUNT=0
  while IFS= read -r PROP_LINE; do
    case "$PROP_LINE" in
      @unset:*)
        delete_prop "${PROP_LINE#@unset:}"
        PROP_COUNT=$((PROP_COUNT + 1))
        ;;
      *=*)
        restore_prop "${PROP_LINE%%=*}" "${PROP_LINE#*=}"
        PROP_COUNT=$((PROP_COUNT + 1))
        ;;
    esac
  done < "$ORIGINAL_PROPS"
  log_msg "Restored $PROP_COUNT properties."
else
  log_msg "No original props file found, skipping restore."
fi

rm -rf "$STATE_DIR"
log_msg "Cleanup completed. Module uninstalled."
