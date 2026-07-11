#!/system/bin/sh

DEX2OAT_STATE_DIR=${DEX2OAT_STATE_DIR:-/data/adb/dex2oat-lock}

dex_now() {
  date '+%Y-%m-%d %H:%M:%S'
}

dex_epoch() {
  date '+%s' 2>/dev/null || printf '0\n'
}

dex_boot_id() {
  cat /proc/sys/kernel/random/boot_id 2>/dev/null
}

dex_rotate_log() {
  DEX_LOG_PATH="$1"
  DEX_LOG_MAX="${2:-262144}"
  [ -f "$DEX_LOG_PATH" ] || return 0
  DEX_LOG_SIZE="$(wc -c < "$DEX_LOG_PATH" 2>/dev/null | tr -d ' ')"
  [ "${DEX_LOG_SIZE:-0}" -gt "$DEX_LOG_MAX" ] 2>/dev/null || return 0
  mv -f "$DEX_LOG_PATH" "$DEX_LOG_PATH.1" 2>/dev/null || return 1
  : > "$DEX_LOG_PATH" 2>/dev/null || return 1
  chmod 0600 "$DEX_LOG_PATH" 2>/dev/null || true
}

dex_hash_file() {
  DEX_HASH_TARGET="$1"
  [ -f "$DEX_HASH_TARGET" ] || return 1
  command -v sha256sum >/dev/null 2>&1 || return 1
  DEX_HASH_VALUE="$(sha256sum "$DEX_HASH_TARGET" 2>/dev/null | awk '{print $1}')"
  case "$DEX_HASH_VALUE" in
    [0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]*)
      [ "${#DEX_HASH_VALUE}" -eq 64 ] 2>/dev/null || return 1
      printf '%s\n' "$DEX_HASH_VALUE"
      ;;
    *)
      return 1
      ;;
  esac
}

dex_valid_prop_key() {
  case "$1" in
    ""|*[!A-Za-z0-9_.-]*|.*|*.) return 1 ;;
    *.*) return 0 ;;
  esac
  return 1
}

dex_valid_prop_value() {
  case "$1" in
    *[!A-Za-z0-9_.,:/@%+*-]*) return 1 ;;
  esac
  return 0
}

dex_count_props() {
  DEX_COUNT_FILE="$1"
  [ -f "$DEX_COUNT_FILE" ] || { printf '0\n'; return 0; }
  awk -F= '/^[A-Za-z0-9_.-]+=/ { count++ } END { print count + 0 }' "$DEX_COUNT_FILE" 2>/dev/null
}

dex_validate_prop_file() {
  DEX_VALIDATE_FILE="$1"
  [ -f "$DEX_VALIDATE_FILE" ] || return 1
  awk -F= '
    /^[[:space:]]*($|#)/ { next }
    index($0, "=") == 0 { invalid = 1; next }
    {
      key = $1
      value = $0
      sub(/^[^=]*=/, "", value)
      sub(/\r$/, "", value)
      if (key == "" || key !~ /^[A-Za-z0-9_.-]+$/ || key !~ /\./ || key ~ /^\./ || key ~ /\.$/) invalid = 1
      if (value ~ /[^-A-Za-z0-9_.,:\/@%+*]/) invalid = 1
      if (seen[key]++) invalid = 1
    }
    END { exit invalid ? 1 : 0 }
  ' "$DEX_VALIDATE_FILE"
}

dex_detect_platform() {
  if [ -n "$KSU" ]; then
    printf 'KernelSU'
  elif [ -n "$APATCH" ]; then
    printf 'APatch'
  elif [ -n "$MAGISK_VER" ]; then
    printf 'Magisk'
  else
    printf 'Unknown'
  fi
}

dex_platform_version() {
  if [ -n "$KSU_VER" ]; then
    printf '%s' "$KSU_VER"
  elif [ -n "$APATCH_VER" ]; then
    printf '%s' "$APATCH_VER"
  elif [ -n "$MAGISK_VER" ]; then
    printf '%s' "$MAGISK_VER"
  else
    printf 'unknown'
  fi
}

dex_apply_prop() {
  DEX_PROP_KEY="$1"
  DEX_PROP_VALUE="$2"
  DEX_PROP_APPLY_TOOL=setprop

  if command -v resetprop >/dev/null 2>&1; then
    DEX_PROP_APPLY_TOOL=resetprop
    if resetprop -n "$DEX_PROP_KEY" "$DEX_PROP_VALUE" 2>/dev/null; then
      return 0
    fi
    DEX_PROP_APPLY_TOOL=setprop-fallback
  fi

  setprop "$DEX_PROP_KEY" "$DEX_PROP_VALUE" 2>/dev/null
}

dex_apply_checked_prop() {
  DEX_CHECKED_PROP_KEY="$1"
  DEX_CHECKED_PROP_VALUE="$2"
  DEX_CHECKED_OLD_VALUE="$(getprop "$DEX_CHECKED_PROP_KEY")"
  DEX_CHECKED_NEW_VALUE="$DEX_CHECKED_OLD_VALUE"
  DEX_CHECKED_APPLY_CODE=0
  DEX_CHECKED_APPLY_TOOL=none

  if [ "$DEX_CHECKED_OLD_VALUE" = "$DEX_CHECKED_PROP_VALUE" ]; then
    return 3
  fi

  dex_apply_prop "$DEX_CHECKED_PROP_KEY" "$DEX_CHECKED_PROP_VALUE"
  DEX_CHECKED_APPLY_CODE=$?
  DEX_CHECKED_APPLY_TOOL="${DEX_PROP_APPLY_TOOL:-setprop}"
  [ "$DEX_CHECKED_APPLY_CODE" -eq 0 ] 2>/dev/null || return 1

  DEX_CHECKED_NEW_VALUE="$(getprop "$DEX_CHECKED_PROP_KEY")"
  [ "$DEX_CHECKED_NEW_VALUE" = "$DEX_CHECKED_PROP_VALUE" ] || return 2
  return 0
}

dex_lock_read() {
  DEX_LOCK_PATH="$1"
  [ -f "$DEX_LOCK_PATH/owner" ] || return 1
  IFS='|' read -r DEX_LOCK_PID DEX_LOCK_BOOT DEX_LOCK_NAME DEX_LOCK_CREATED < "$DEX_LOCK_PATH/owner"
  case "$DEX_LOCK_PID" in ""|*[!0-9]*) return 1 ;; esac
  [ -n "$DEX_LOCK_BOOT" ] || return 1
  [ -n "$DEX_LOCK_NAME" ] || return 1
}

dex_lock_remove() {
  DEX_LOCK_PATH="$1"
  rm -f "$DEX_LOCK_PATH/owner" "$DEX_LOCK_PATH"/owner.tmp.* 2>/dev/null || true
  rmdir "$DEX_LOCK_PATH" 2>/dev/null
}

dex_lock_acquire() {
  DEX_LOCK_PATH="$1"
  DEX_LOCK_TIMEOUT="${2:-20}"
  DEX_LOCK_REQUEST_NAME="${3:-operation}"
  DEX_LOCK_WAIT=0
  DEX_LOCK_EMPTY_WAIT=0
  DEX_LOCK_CURRENT_BOOT="$(dex_boot_id)"
  [ -n "$DEX_LOCK_CURRENT_BOOT" ] || DEX_LOCK_CURRENT_BOOT=unknown

  mkdir -p "${DEX_LOCK_PATH%/*}" 2>/dev/null || return 1
  while ! mkdir "$DEX_LOCK_PATH" 2>/dev/null; do
    if dex_lock_read "$DEX_LOCK_PATH"; then
      if [ "$DEX_LOCK_BOOT" != "$DEX_LOCK_CURRENT_BOOT" ] || [ ! -d "/proc/$DEX_LOCK_PID" ]; then
        DEX_LOCK_SNAPSHOT="$DEX_LOCK_PID|$DEX_LOCK_BOOT|$DEX_LOCK_NAME|$DEX_LOCK_CREATED"
        [ "$(cat "$DEX_LOCK_PATH/owner" 2>/dev/null)" = "$DEX_LOCK_SNAPSHOT" ] && dex_lock_remove "$DEX_LOCK_PATH"
        continue
      fi
      DEX_LOCK_EMPTY_WAIT=0
    else
      DEX_LOCK_EMPTY_WAIT=$((DEX_LOCK_EMPTY_WAIT + 1))
      if [ "$DEX_LOCK_EMPTY_WAIT" -ge 2 ] 2>/dev/null && [ ! -f "$DEX_LOCK_PATH/owner" ]; then
        dex_lock_remove "$DEX_LOCK_PATH"
        continue
      fi
    fi

    [ "$DEX_LOCK_WAIT" -lt "$DEX_LOCK_TIMEOUT" ] 2>/dev/null || return 124
    sleep 1
    DEX_LOCK_WAIT=$((DEX_LOCK_WAIT + 1))
  done

  DEX_LOCK_TOKEN="$$|$DEX_LOCK_CURRENT_BOOT|$DEX_LOCK_REQUEST_NAME|$(dex_epoch)"
  DEX_LOCK_TMP="$DEX_LOCK_PATH/owner.tmp.$$"
  printf '%s\n' "$DEX_LOCK_TOKEN" > "$DEX_LOCK_TMP" 2>/dev/null || {
    dex_lock_remove "$DEX_LOCK_PATH"
    return 1
  }
  mv -f "$DEX_LOCK_TMP" "$DEX_LOCK_PATH/owner" 2>/dev/null || {
    dex_lock_remove "$DEX_LOCK_PATH"
    return 1
  }
  chmod 0600 "$DEX_LOCK_PATH/owner" 2>/dev/null || true
  DEX_ACTIVE_LOCK_PATH="$DEX_LOCK_PATH"
  DEX_ACTIVE_LOCK_TOKEN="$DEX_LOCK_TOKEN"
  return 0
}

dex_lock_release() {
  [ -n "$DEX_ACTIVE_LOCK_PATH" ] || return 0
  if [ "$(cat "$DEX_ACTIVE_LOCK_PATH/owner" 2>/dev/null)" = "$DEX_ACTIVE_LOCK_TOKEN" ]; then
    dex_lock_remove "$DEX_ACTIVE_LOCK_PATH" || true
  fi
  DEX_ACTIVE_LOCK_PATH=""
  DEX_ACTIVE_LOCK_TOKEN=""
}
