#!/system/bin/sh

dex_with_runtime_lock() {
  DEX_RUNTIME_LOCK_DIR="$1"
  DEX_RUNTIME_LOCK_TIMEOUT="$2"
  shift 2
  if command -v dex_with_lock >/dev/null 2>&1; then
    dex_with_lock "$DEX_RUNTIME_LOCK_DIR" "$DEX_RUNTIME_LOCK_TIMEOUT" "$@"
  else
    "$@"
  fi
}

dex_write_locked_prop_list() {
  DEX_RUNTIME_LOCK_DIR="$1"
  DEX_RUNTIME_LOCK_TIMEOUT="$2"
  DEX_PROP_SOURCE_FILE="$3"
  DEX_PROP_LOCK_FILE="$4"
  DEX_PROP_LOCK_MODE="$5"
  dex_with_runtime_lock "$DEX_RUNTIME_LOCK_DIR" "$DEX_RUNTIME_LOCK_TIMEOUT" \
    dex_write_prop_lock_list "$DEX_PROP_SOURCE_FILE" "$DEX_PROP_LOCK_FILE" "$DEX_PROP_LOCK_MODE"
}

dex_is_runtime_prop() {
  DEX_RUNTIME_PROP_KEY="$1"
  DEX_RUNTIME_MATCHED_FILE="$2"
  DEX_RUNTIME_RULES_FILE="$3"
  DEX_RUNTIME_EMPTY_MODE="${4:-strict}"

  dex_valid_prop_key "$DEX_RUNTIME_PROP_KEY" || return 1
  if [ -s "$DEX_RUNTIME_MATCHED_FILE" ] && grep -F -q "$DEX_RUNTIME_PROP_KEY=" "$DEX_RUNTIME_MATCHED_FILE" 2>/dev/null; then
    return 0
  fi
  if [ -s "$DEX_RUNTIME_RULES_FILE" ] && awk -F "$(printf '\t')" -v key="$DEX_RUNTIME_PROP_KEY" 'NR > 1 && $3 == key { found = 1; exit } END { exit found ? 0 : 1 }' "$DEX_RUNTIME_RULES_FILE" 2>/dev/null; then
    return 0
  fi
  [ "$DEX_RUNTIME_EMPTY_MODE" = "allow-empty" ] && [ ! -s "$DEX_RUNTIME_MATCHED_FILE" ] && [ ! -s "$DEX_RUNTIME_RULES_FILE" ] && return 0
  return 1
}

dex_apply_checked_prop() {
  DEX_CHECKED_PROP_KEY="$1"
  DEX_CHECKED_PROP_VALUE="$2"
  DEX_CHECKED_OLD_VALUE="$(getprop "$DEX_CHECKED_PROP_KEY")"
  DEX_CHECKED_NEW_VALUE="$DEX_CHECKED_OLD_VALUE"
  DEX_CHECKED_APPLY_CODE=1
  DEX_CHECKED_APPLY_TOOL="${DEX_PROP_APPLY_TOOL:-setprop}"
  DEX_CHECKED_FAILURE_REASON=""

  if [ "$DEX_CHECKED_OLD_VALUE" = "$DEX_CHECKED_PROP_VALUE" ]; then
    DEX_CHECKED_APPLY_CODE=0
    DEX_CHECKED_APPLY_TOOL=none
    return 3
  fi

  if ! command -v dex_apply_prop >/dev/null 2>&1; then
    DEX_CHECKED_FAILURE_REASON=dex_apply_prop_missing
    return 1
  fi

  dex_apply_prop "$DEX_CHECKED_PROP_KEY" "$DEX_CHECKED_PROP_VALUE"
  DEX_CHECKED_APPLY_CODE=$?
  DEX_CHECKED_APPLY_TOOL="${DEX_PROP_APPLY_TOOL:-setprop}"
  DEX_CHECKED_NEW_VALUE="$(getprop "$DEX_CHECKED_PROP_KEY")"
  [ "$DEX_CHECKED_APPLY_CODE" -eq 0 ] 2>/dev/null || return 1
  [ "$DEX_CHECKED_NEW_VALUE" = "$DEX_CHECKED_PROP_VALUE" ] || return 2
  return 0
}
