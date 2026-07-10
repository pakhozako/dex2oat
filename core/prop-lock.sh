#!/system/bin/sh

MODDIR="$1"
[ -n "$MODDIR" ] || MODDIR=${0%/*}/..

STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
LOCK_FILE="$STATE_DIR/prop-lock.list"
SERVICE_LOG="$STATE_DIR/service.log"
PROP_FILE="$MODDIR/system.prop"

[ -f "$MODDIR/core/common.sh" ] && . "$MODDIR/core/common.sh"

mkdir -p "$STATE_DIR" 2>/dev/null || true

log_warn() {
  command -v dex_rotate_log >/dev/null 2>&1 && dex_rotate_log "$SERVICE_LOG" 262144
  printf '%s 警告: prop-lock 已恢复 key=%s 目标=%s 旧值=%s 新值=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" "$2" "$3" "$4" >> "$SERVICE_LOG" 2>/dev/null || true
}

prop_lock_apply_prop() {
  PROP_KEY="$1"
  PROP_VALUE="$2"
  command -v dex_apply_prop >/dev/null 2>&1 || return 1
  dex_apply_prop "$PROP_KEY" "$PROP_VALUE"
}

[ -s "$LOCK_FILE" ] || exit 0

if [ -s "$PROP_FILE" ] && [ "$PROP_FILE" -nt "$LOCK_FILE" ]; then
  printf '%s 警告: system.prop 比 prop-lock.list 更新，已跳过 prop-lock\n' "$(date '+%Y-%m-%d %H:%M:%S')" >> "$SERVICE_LOG" 2>/dev/null || true
  exit 0
fi

while IFS='=' read -r PROP_KEY PROP_VALUE; do
  PROP_KEY="$(printf '%s' "$PROP_KEY" | tr -d '\r' | sed 's/[[:space:]]*$//')"
  PROP_VALUE="$(printf '%s' "$PROP_VALUE" | tr -d '\r')"
  case "$PROP_KEY" in ""|\#*) continue ;; esac
  dex_valid_prop_key "$PROP_KEY" || continue
  CURRENT_VALUE="$(getprop "$PROP_KEY")"
  if [ "$CURRENT_VALUE" != "$PROP_VALUE" ]; then
    prop_lock_apply_prop "$PROP_KEY" "$PROP_VALUE"
    NEW_VALUE="$(getprop "$PROP_KEY")"
    log_warn "$PROP_KEY" "$PROP_VALUE" "$CURRENT_VALUE" "$NEW_VALUE"
  fi
done < "$LOCK_FILE"

exit 0
