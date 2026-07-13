#!/system/bin/sh

case "$0" in
  */*) SCRIPT_DIR=${0%/*} ;;
  *) SCRIPT_DIR=. ;;
esac
MODDIR="$(cd "$SCRIPT_DIR" 2>/dev/null && pwd)"
STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
SERVICE_LOG="$STATE_DIR/service.log"
CONFIG_FILE="$MODDIR/system.prop"
OPERATION_LOCK="$STATE_DIR/.operation.lock"
BOOT_WAIT_SECONDS=${DEX2OAT_BOOT_WAIT_SECONDS:-300}
LOCK_TIMEOUT=${DEX2OAT_LOCK_TIMEOUT:-20}

[ -f "$MODDIR/core/common.sh" ] || exit 1
[ -f "$MODDIR/core/runtime.sh" ] || exit 1
. "$MODDIR/core/common.sh"
. "$MODDIR/core/runtime.sh"

dex_bounded_uint() {
  DEX_BOUND_VALUE="$1"
  DEX_BOUND_DEFAULT="$2"
  DEX_BOUND_MAX="$3"
  case "$DEX_BOUND_VALUE" in ""|*[!0-9]*) DEX_BOUND_VALUE="$DEX_BOUND_DEFAULT" ;; esac
  [ "$DEX_BOUND_VALUE" -le "$DEX_BOUND_MAX" ] 2>/dev/null || DEX_BOUND_VALUE="$DEX_BOUND_MAX"
  printf '%s\n' "$DEX_BOUND_VALUE"
}

BOOT_WAIT_SECONDS="$(dex_bounded_uint "$BOOT_WAIT_SECONDS" 300 600)"
LOCK_TIMEOUT="$(dex_bounded_uint "$LOCK_TIMEOUT" 20 60)"

mkdir -p "$STATE_DIR" 2>/dev/null || exit 1
chmod 0700 "$STATE_DIR" 2>/dev/null || true

service_log() {
  dex_rotate_log "$SERVICE_LOG" 262144 2>/dev/null || true
  printf '%s %s\n' "$(dex_now)" "$*" >> "$SERVICE_LOG" 2>/dev/null || true
}

dex_runtime_log() {
  service_log "$*"
}

service_write_error() {
  DEX_RUNTIME_PHASE=service
  DEX_RUNTIME_CONFIG_HASH="$(dex_hash_file "$CONFIG_FILE" 2>/dev/null || printf 'unavailable')"
  DEX_RUNTIME_TOTAL=0
  DEX_RUNTIME_APPLIED=0
  DEX_RUNTIME_UNCHANGED=0
  DEX_RUNTIME_MISMATCH=0
  DEX_RUNTIME_FAILED=1
  dex_runtime_write_status "$STATE_DIR" error "$1" || true
}

service_signal() {
  SERVICE_SIGNAL="$1"
  SERVICE_EXIT="$2"
  trap - HUP INT TERM EXIT
  service_log "interrupted signal=$SERVICE_SIGNAL"
  service_write_error interrupted
  dex_lock_release
  exit "$SERVICE_EXIT"
}

trap 'service_signal HUP 129' HUP
trap 'service_signal INT 130' INT
trap 'service_signal TERM 143' TERM

service_log "waiting for Android boot"
BOOT_WAITED=0
while [ "$(getprop sys.boot_completed)" != 1 ] && [ "$BOOT_WAITED" -lt "$BOOT_WAIT_SECONDS" ]; do
  BOOT_REMAINING=$((BOOT_WAIT_SECONDS - BOOT_WAITED))
  BOOT_SLEEP=5
  [ "$BOOT_REMAINING" -lt "$BOOT_SLEEP" ] 2>/dev/null && BOOT_SLEEP="$BOOT_REMAINING"
  [ "$BOOT_SLEEP" -gt 0 ] 2>/dev/null || break
  sleep "$BOOT_SLEEP"
  BOOT_WAITED=$((BOOT_WAITED + BOOT_SLEEP))
done

if [ "$(getprop sys.boot_completed)" != 1 ]; then
  service_log "boot wait timed out after ${BOOT_WAIT_SECONDS}s"
  service_write_error boot-timeout
  trap - HUP INT TERM
  exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
  service_log "system.prop is missing"
  service_write_error missing-config
  trap - HUP INT TERM
  exit 1
fi

if ! dex_lock_acquire "$OPERATION_LOCK" "$LOCK_TIMEOUT" service.sh; then
  service_log "another module operation is active; runtime apply skipped"
  trap - HUP INT TERM
  exit 0
fi
trap 'dex_lock_release' EXIT

service_log "runtime apply started"
if dex_runtime_apply "$CONFIG_FILE" "$STATE_DIR" service; then
  service_log "runtime apply completed total=$DEX_RUNTIME_TOTAL applied=$DEX_RUNTIME_APPLIED unchanged=$DEX_RUNTIME_UNCHANGED"
  SERVICE_RESULT=0
else
  service_log "runtime apply failed total=$DEX_RUNTIME_TOTAL mismatch=$DEX_RUNTIME_MISMATCH failed=$DEX_RUNTIME_FAILED"
  SERVICE_RESULT=1
fi

dex_lock_release
trap - HUP INT TERM EXIT
exit "$SERVICE_RESULT"
