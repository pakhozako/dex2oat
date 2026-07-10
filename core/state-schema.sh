#!/system/bin/sh

STATE_SCHEMA_VERSION=60
STATE_MAX_FILE_SIZE=${DEX2OAT_STATE_MAX_FILE_SIZE:-1048576}
STATE_MAX_VALUE_LENGTH=${DEX2OAT_STATE_MAX_VALUE_LENGTH:-4096}
STATE_MAX_KEY_LENGTH=${DEX2OAT_STATE_MAX_KEY_LENGTH:-128}
STATE_MAX_TEXT_LENGTH=${DEX2OAT_STATE_MAX_TEXT_LENGTH:-2048}

state_pair_key() {
  STATE_PAIR_KEY="${1%%=*}"
  [ "$STATE_PAIR_KEY" != "$1" ] || return 1
  [ "${#STATE_PAIR_KEY}" -le "$STATE_MAX_KEY_LENGTH" ] 2>/dev/null || return 1
  case "$STATE_PAIR_KEY" in ""|*[!A-Za-z0-9_.-]*) return 1 ;; esac
  printf '%s\n' "$STATE_PAIR_KEY"
}

state_schema_key_valid() {
  case "$1" in
    schema_version|module_version|device.*|root.*|lifecycle.*|install.*|agreement.*|match.*|config.*|apply.*|service.*|health.*|conflict.*|integrity.*|restore.*|summary.*|runtime.*|snapshot.*|protection.*|diagnostics.*|performance.*|migration.*|prop_lock.*) return 0 ;;
  esac
  return 1
}

state_schema_uint() {
  case "$1" in ""|*[!0-9]*) return 1 ;; esac
  [ "$1" -le "${2:-9999999999}" ] 2>/dev/null
}

state_schema_percent() {
  state_schema_uint "$1" 100
}

state_schema_enum() {
  STATE_ENUM_VALUE="$1"
  shift
  for STATE_ENUM_ALLOWED in "$@"; do
    [ "$STATE_ENUM_VALUE" = "$STATE_ENUM_ALLOWED" ] && return 0
  done
  return 1
}

state_schema_bool() {
  state_schema_enum "$1" yes no true false enabled disabled on off 0 1
}

state_schema_path() {
  [ "$(printf '%s' "$1" | tr -d '\r\n')" = "$1" ] || return 1
  case "$1" in
    ""|*..*) return 1 ;;
    /*) return 0 ;;
  esac
  return 1
}

state_schema_hash() {
  case "$1" in
    missing|unsupported) return 0 ;;
    *[!A-Za-z0-9:._-]*) return 1 ;;
  esac
  [ "${#1}" -ge 8 ] 2>/dev/null
}

state_schema_status() {
  state_schema_enum "$1" \
    ok done running pending failed error warning warn missing changed settled problem \
    restored restoring skipped blocked reset recovered recovery preview unavailable unknown off on fallback partial
}

state_schema_mode() {
  state_schema_enum "$1" rule-driven auto-rules scheduled force manual on off enabled disabled full quick
}

state_schema_text() {
  [ "${#1}" -le "$STATE_MAX_TEXT_LENGTH" ] 2>/dev/null || return 1
  [ "$(printf '%s' "$1" | tr -d '\r\n')" = "$1" ]
}

state_schema_value_valid() {
  STATE_SCHEMA_KEY="$1"
  STATE_SCHEMA_VALUE="$2"
  case "$STATE_SCHEMA_KEY" in
    schema_version)
      state_schema_uint "$STATE_SCHEMA_VALUE" "$STATE_SCHEMA_VERSION" ;;
    *.status|*.health|*.session_status|summary.status)
      state_schema_status "$STATE_SCHEMA_VALUE" ;;
    *.mode|install.check_mode|match.mode|diagnostics.mode|protection.mode)
      state_schema_mode "$STATE_SCHEMA_VALUE" ;;
    *.percent|*.progress)
      state_schema_percent "$STATE_SCHEMA_VALUE" ;;
    *.total|*_total|*.count|*_count|*.seconds|*_seconds|*.epoch|*_epoch|*.sdk|*.size|*.version_code|*.baseline_version|*.failure_count|*.checked_total|*.missing_total|*.changed_total|*.warning_total)
      state_schema_uint "$STATE_SCHEMA_VALUE" ;;
    *.generated|*.supported|*.baseline_refresh_supported)
      state_schema_bool "$STATE_SCHEMA_VALUE" ;;
    *.file|*.path|*.report|*.progress_file|*.export_file|*.last_file)
      state_schema_path "$STATE_SCHEMA_VALUE" ;;
    *.hash|*.input_hash)
      state_schema_hash "$STATE_SCHEMA_VALUE" ;;
    *)
      state_schema_text "$STATE_SCHEMA_VALUE" ;;
  esac
}

state_pair_valid() {
  STATE_PAIR_VALUE="$1"
  STATE_PAIR_KEY_VALUE="$(state_pair_key "$STATE_PAIR_VALUE")" || return 1
  state_schema_key_valid "$STATE_PAIR_KEY_VALUE" || return 1
  STATE_PAIR_DATA="${STATE_PAIR_VALUE#*=}"
  [ "${#STATE_PAIR_DATA}" -le "$STATE_MAX_VALUE_LENGTH" ] 2>/dev/null || return 1
  STATE_PAIR_CLEAN="$(printf '%s' "$STATE_PAIR_VALUE" | tr -d '\r\n')"
  [ "$STATE_PAIR_CLEAN" = "$STATE_PAIR_VALUE" ] || return 1
  state_schema_value_valid "$STATE_PAIR_KEY_VALUE" "$STATE_PAIR_DATA"
}

state_schema_file_valid() {
  STATE_SCHEMA_FILE="$1"
  [ -f "$STATE_SCHEMA_FILE" ] || return 0
  [ ! -L "$STATE_SCHEMA_FILE" ] || return 1
  STATE_SCHEMA_SIZE="$(wc -c < "$STATE_SCHEMA_FILE" 2>/dev/null | tr -d ' ')"
  [ "${STATE_SCHEMA_SIZE:-0}" -le "$STATE_MAX_FILE_SIZE" ] 2>/dev/null || return 1
  STATE_SCHEMA_HAS_VERSION=0
  while IFS= read -r STATE_SCHEMA_LINE || [ -n "$STATE_SCHEMA_LINE" ]; do
    state_pair_valid "$STATE_SCHEMA_LINE" || return 1
    [ "$(state_pair_key "$STATE_SCHEMA_LINE")" = schema_version ] && STATE_SCHEMA_HAS_VERSION=1
  done < "$STATE_SCHEMA_FILE"
  [ "$STATE_SCHEMA_HAS_VERSION" = 1 ] || return 1
  STATE_SCHEMA_DUPLICATE="$(awk -F= '{count[$1]++} END { for (key in count) if (count[key] > 1) { print key; exit } }' "$STATE_SCHEMA_FILE" 2>/dev/null)"
  [ -z "$STATE_SCHEMA_DUPLICATE" ]
}
