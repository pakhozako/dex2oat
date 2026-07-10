#!/system/bin/sh

DEX_INPUT_MODDIR=${DEX_INPUT_MODDIR:-${MODDIR:-${0%/*}/..}}
DEX_INPUT_STATE_DIR=${DEX_INPUT_STATE_DIR:-${STATE_DIR:-/data/adb/dex2oat-lock}}

dex_input_find_keycheck() {
  for DEX_INPUT_KEYCHECK in \
    "$DEX_INPUT_MODDIR/keycheck" \
    "$DEX_INPUT_MODDIR/common/keycheck" \
    /data/adb/magisk/keycheck \
    /data/adb/ksu/bin/keycheck \
    /data/adb/ap/bin/keycheck; do
    [ -x "$DEX_INPUT_KEYCHECK" ] && { printf '%s\n' "$DEX_INPUT_KEYCHECK"; return 0; }
  done
  command -v keycheck 2>/dev/null
}

dex_input_event_file() {
  if [ -d "$DEX_INPUT_STATE_DIR" ]; then
    printf '%s\n' "$DEX_INPUT_STATE_DIR/action-key-events.tmp"
  else
    printf '%s\n' "${TMPDIR:-/dev}/dex2oat-action-events"
  fi
}

dex_input_is_volume_up() {
  printf '%s\n' "$1" | grep -E -q 'KEY_VOLUMEUP|VOLUMEUP|volumeup|VolumeUp|(^|[^0-9])(42|115|24)([^0-9]|$)' 2>/dev/null
}

dex_input_is_volume_down() {
  printf '%s\n' "$1" | grep -E -q 'KEY_VOLUMEDOWN|VOLUMEDOWN|volumedown|VolumeDown|(^|[^0-9])(41|114|25)([^0-9]|$)' 2>/dev/null
}

dex_input_wait_keycheck_once() {
  DEX_INPUT_KEYCHECK="$(dex_input_find_keycheck)"
  [ -n "$DEX_INPUT_KEYCHECK" ] || return 2
  DEX_INPUT_EVENT_FILE="$(dex_input_event_file)"
  : > "$DEX_INPUT_EVENT_FILE" 2>/dev/null || true

  if command -v timeout >/dev/null 2>&1; then
    timeout 1 "$DEX_INPUT_KEYCHECK" > "$DEX_INPUT_EVENT_FILE" 2>&1
    DEX_INPUT_KEY_CODE=$?
  else
    "$DEX_INPUT_KEYCHECK" > "$DEX_INPUT_EVENT_FILE" 2>&1 &
    DEX_INPUT_KEY_PID=$!
    sleep 1
    if kill -0 "$DEX_INPUT_KEY_PID" 2>/dev/null; then
      kill "$DEX_INPUT_KEY_PID" 2>/dev/null || true
      wait "$DEX_INPUT_KEY_PID" 2>/dev/null || true
      DEX_INPUT_KEY_CODE=124
    else
      wait "$DEX_INPUT_KEY_PID" 2>/dev/null
      DEX_INPUT_KEY_CODE=$?
    fi
  fi

  DEX_INPUT_KEY_OUTPUT="$(cat "$DEX_INPUT_EVENT_FILE" 2>/dev/null)"
  rm -f "$DEX_INPUT_EVENT_FILE" 2>/dev/null || true
  case "$DEX_INPUT_KEY_CODE" in
    42|115|24) return 0 ;;
    41|114|25) return 1 ;;
  esac
  dex_input_is_volume_up "$DEX_INPUT_KEY_OUTPUT" && return 0
  dex_input_is_volume_down "$DEX_INPUT_KEY_OUTPUT" && return 1
  return 2
}

dex_input_wait_getevent_once() {
  DEX_INPUT_EVENT_FILE="$(dex_input_event_file)"
  DEX_INPUT_GETEVENT=/system/bin/getevent
  [ -x "$DEX_INPUT_GETEVENT" ] || DEX_INPUT_GETEVENT=getevent
  command -v "$DEX_INPUT_GETEVENT" >/dev/null 2>&1 || return 2
  : > "$DEX_INPUT_EVENT_FILE" 2>/dev/null || true

  if command -v timeout >/dev/null 2>&1; then
    timeout 1 "$DEX_INPUT_GETEVENT" -l > "$DEX_INPUT_EVENT_FILE" 2>&1
  else
    "$DEX_INPUT_GETEVENT" -l > "$DEX_INPUT_EVENT_FILE" 2>&1 &
    DEX_INPUT_EVENT_PID=$!
    sleep 1
    kill "$DEX_INPUT_EVENT_PID" 2>/dev/null || true
    wait "$DEX_INPUT_EVENT_PID" 2>/dev/null || true
  fi

  DEX_INPUT_STATUS=2
  grep -E -q 'KEY_VOLUMEUP[[:space:]].*(DOWN|00000001)| 0073 00000001' "$DEX_INPUT_EVENT_FILE" 2>/dev/null && DEX_INPUT_STATUS=0
  [ "$DEX_INPUT_STATUS" = "2" ] && grep -E -q 'KEY_VOLUMEDOWN[[:space:]].*(DOWN|00000001)| 0072 00000001' "$DEX_INPUT_EVENT_FILE" 2>/dev/null && DEX_INPUT_STATUS=1
  rm -f "$DEX_INPUT_EVENT_FILE" 2>/dev/null || true
  return "$DEX_INPUT_STATUS"
}

dex_wait_volume_key() {
  DEX_INPUT_DELAY="${1:-20}"
  DEX_INPUT_WAITED=0
  while [ "$DEX_INPUT_WAITED" -lt "$DEX_INPUT_DELAY" ]; do
    dex_input_wait_getevent_once
    DEX_INPUT_STATUS=$?
    case "$DEX_INPUT_STATUS" in
      0|1) return "$DEX_INPUT_STATUS" ;;
    esac
    dex_input_wait_keycheck_once
    DEX_INPUT_STATUS=$?
    case "$DEX_INPUT_STATUS" in
      0|1) return "$DEX_INPUT_STATUS" ;;
    esac
    DEX_INPUT_WAITED=$((DEX_INPUT_WAITED + 1))
  done
  return 2
}
