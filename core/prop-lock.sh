#!/system/bin/sh

MODDIR="$1"
[ -n "$MODDIR" ] || MODDIR=${0%/*}/..

STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
LOCK_FILE="$STATE_DIR/prop-lock.list"
SERVICE_LOG="$STATE_DIR/service.log"
PROP_FILE="$MODDIR/system.prop"

mkdir -p "$STATE_DIR" 2>/dev/null || true

rotate_log() {
  LOG_PATH="$1"
  MAX_SIZE="${2:-262144}"
  [ -f "$LOG_PATH" ] || return 0
  LOG_SIZE="$(wc -c < "$LOG_PATH" 2>/dev/null | tr -d ' ')"
  [ "${LOG_SIZE:-0}" -gt "$MAX_SIZE" ] || return 0
  mv -f "$LOG_PATH" "$LOG_PATH.1" 2>/dev/null || true
  : > "$LOG_PATH" 2>/dev/null || true
  chmod 0600 "$LOG_PATH" 2>/dev/null || true
}

log_warn() {
  rotate_log "$SERVICE_LOG"
  printf '%s Warning: prop-lock restored key=%s desired=%s old=%s new=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" "$2" "$3" "$4" >> "$SERVICE_LOG" 2>/dev/null || true
}

apply_prop() {
  PROP_KEY="$1"
  PROP_VALUE="$2"
  if command -v resetprop >/dev/null 2>&1; then
    resetprop -n "$PROP_KEY" "$PROP_VALUE" 2>/dev/null || setprop "$PROP_KEY" "$PROP_VALUE" 2>/dev/null
  else
    setprop "$PROP_KEY" "$PROP_VALUE" 2>/dev/null
  fi
}

[ -s "$LOCK_FILE" ] || exit 0

if [ -s "$PROP_FILE" ] && [ "$PROP_FILE" -nt "$LOCK_FILE" ]; then
  printf '%s Warning: prop-lock skipped because system.prop is newer than prop-lock.list\n' "$(date '+%Y-%m-%d %H:%M:%S')" >> "$SERVICE_LOG" 2>/dev/null || true
  exit 0
fi

while IFS='=' read -r PROP_KEY PROP_VALUE; do
  PROP_KEY="$(printf '%s' "$PROP_KEY" | tr -d '\r' | sed 's/[[:space:]]*$//')"
  PROP_VALUE="$(printf '%s' "$PROP_VALUE" | tr -d '\r')"
  case "$PROP_KEY" in
    ""|\#*|*[!A-Za-z0-9_.-]*|.*|*.) continue ;;
  esac
  CURRENT_VALUE="$(getprop "$PROP_KEY")"
  if [ "$CURRENT_VALUE" != "$PROP_VALUE" ]; then
    apply_prop "$PROP_KEY" "$PROP_VALUE"
    NEW_VALUE="$(getprop "$PROP_KEY")"
    log_warn "$PROP_KEY" "$PROP_VALUE" "$CURRENT_VALUE" "$NEW_VALUE"
  fi
done < "$LOCK_FILE"

exit 0
