#!/system/bin/sh

DEX2OAT_STATE_DIR=${DEX2OAT_STATE_DIR:-/data/adb/dex2oat-lock}

dex_now() {
  date '+%Y-%m-%d %H:%M:%S'
}

dex_rotate_log() {
  LOG_PATH="$1"
  MAX_SIZE="${2:-262144}"
  [ -f "$LOG_PATH" ] || return 0
  LOG_SIZE="$(wc -c < "$LOG_PATH" 2>/dev/null | tr -d ' ')"
  [ "${LOG_SIZE:-0}" -gt "$MAX_SIZE" ] 2>/dev/null || return 0
  mv -f "$LOG_PATH" "$LOG_PATH.1" 2>/dev/null || true
  : > "$LOG_PATH" 2>/dev/null || true
  chmod 0600 "$LOG_PATH" 2>/dev/null || true
}

dex_hash_file() {
  TARGET_FILE="$1"
  [ -s "$TARGET_FILE" ] || { printf 'missing\n'; return 0; }
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$TARGET_FILE" 2>/dev/null | awk '{print $1}'
  elif command -v md5sum >/dev/null 2>&1; then
    md5sum "$TARGET_FILE" 2>/dev/null | awk '{print $1}'
  else
    wc -c < "$TARGET_FILE" 2>/dev/null | tr -d ' '
  fi
}

dex_normalize_value() {
  printf '%s' "$1" | tr -d '\r'
}

dex_valid_prop_key() {
  case "$1" in
    ""|*[!A-Za-z0-9_.-]*|.*|*.) return 1 ;;
  esac
  return 0
}

dex_prepare_runtime_rules() {
  RULES_DECODE_SCRIPT_ARG="$1"
  RULES_PACK_FILE_ARG="$2"
  RULES_OUTPUT_FILE_ARG="$3"

  [ -f "$RULES_DECODE_SCRIPT_ARG" ] || return 1
  [ -s "$RULES_PACK_FILE_ARG" ] || return 1
  chmod 0755 "$RULES_DECODE_SCRIPT_ARG" 2>/dev/null || true
  sh "$RULES_DECODE_SCRIPT_ARG" "$RULES_PACK_FILE_ARG" "$RULES_OUTPUT_FILE_ARG" || return 1
  [ -s "$RULES_OUTPUT_FILE_ARG" ] || return 1
  chmod 0600 "$RULES_OUTPUT_FILE_ARG" 2>/dev/null || true
  return 0
}

dex_write_prop_lock_list() {
  SOURCE_PROP_FILE="$1"
  TARGET_LOCK_FILE="$2"
  WRITE_MODE="${3:-atomic}"

  case "$WRITE_MODE" in
    direct)
      : > "$TARGET_LOCK_FILE" 2>/dev/null || return 0
      while IFS='=' read -r PROP_KEY PROP_VALUE || [ -n "$PROP_KEY" ]; do
        PROP_KEY="$(printf '%s' "$PROP_KEY" | tr -d '\r' | sed 's/[[:space:]]*$//')"
        PROP_VALUE="$(dex_normalize_value "$PROP_VALUE")"
        case "$PROP_KEY" in
          ""|\#*) continue ;;
        esac
        printf '%s=%s\n' "$PROP_KEY" "$PROP_VALUE" >> "$TARGET_LOCK_FILE" 2>/dev/null || true
      done < "$SOURCE_PROP_FILE"
      chmod 0600 "$TARGET_LOCK_FILE" 2>/dev/null || true
      return 0
      ;;
    atomic)
      [ -s "$SOURCE_PROP_FILE" ] || return 1
      TMP_LOCK_FILE="$TARGET_LOCK_FILE.tmp.$$"
      : > "$TMP_LOCK_FILE" 2>/dev/null || return 1
      while IFS='=' read -r PROP_KEY PROP_VALUE; do
        PROP_KEY="$(printf '%s' "$PROP_KEY" | tr -d '\r' | sed 's/[[:space:]]*$//')"
        PROP_VALUE="$(dex_normalize_value "$PROP_VALUE")"
        case "$PROP_KEY" in
          ""|\#*) continue ;;
        esac
        printf '%s=%s\n' "$PROP_KEY" "$PROP_VALUE" >> "$TMP_LOCK_FILE" 2>/dev/null || {
          rm -f "$TMP_LOCK_FILE" 2>/dev/null || true
          return 1
        }
      done < "$SOURCE_PROP_FILE"
      mv -f "$TMP_LOCK_FILE" "$TARGET_LOCK_FILE" 2>/dev/null || {
        rm -f "$TMP_LOCK_FILE" 2>/dev/null || true
        return 1
      }
      chmod 0600 "$TARGET_LOCK_FILE" 2>/dev/null || true
      return 0
      ;;
    atomic-final)
      [ -s "$SOURCE_PROP_FILE" ] || return 1
      TMP_LOCK_FILE="$TARGET_LOCK_FILE.tmp.$$"
      : > "$TMP_LOCK_FILE" 2>/dev/null || return 1
      while IFS='=' read -r PROP_KEY PROP_VALUE || [ -n "$PROP_KEY" ]; do
        PROP_KEY="$(printf '%s' "$PROP_KEY" | tr -d '\r' | sed 's/[[:space:]]*$//')"
        PROP_VALUE="$(dex_normalize_value "$PROP_VALUE")"
        case "$PROP_KEY" in
          ""|\#*) continue ;;
        esac
        printf '%s=%s\n' "$PROP_KEY" "$PROP_VALUE" >> "$TMP_LOCK_FILE" 2>/dev/null || {
          rm -f "$TMP_LOCK_FILE" 2>/dev/null || true
          return 1
        }
      done < "$SOURCE_PROP_FILE"
      mv -f "$TMP_LOCK_FILE" "$TARGET_LOCK_FILE" 2>/dev/null || {
        rm -f "$TMP_LOCK_FILE" 2>/dev/null || true
        return 1
      }
      chmod 0600 "$TARGET_LOCK_FILE" 2>/dev/null || true
      return 0
      ;;
  esac

  return 1
}

dex_lock_now() {
  date '+%s' 2>/dev/null || printf '0\n'
}

dex_with_lock() {
  (
    LOCK_DIR="$1"
    LOCK_TIMEOUT="${2:-10}"
    LOCK_STALE_SECONDS="${DEX_LOCK_STALE_SECONDS:-300}"
    shift 2

    case "$LOCK_DIR" in
      ""|"/"|"/data"|"/data/adb"|"$DEX2OAT_STATE_DIR")
        return 125
        ;;
    esac

    LOCK_PARENT="${LOCK_DIR%/*}"
    [ "$LOCK_PARENT" != "$LOCK_DIR" ] && mkdir -p "$LOCK_PARENT" 2>/dev/null || true

    dex_lock_pid_alive() {
      [ -f "$LOCK_DIR/pid" ] || return 1
      LOCK_PID="$(cat "$LOCK_DIR/pid" 2>/dev/null)"
      case "$LOCK_PID" in
        ""|*[!0-9]*) return 1 ;;
      esac
      [ -d "/proc/$LOCK_PID" ]
    }

    dex_lock_age() {
      [ -f "$LOCK_DIR/created_at" ] || { printf '0\n'; return 0; }
      LOCK_CREATED="$(cat "$LOCK_DIR/created_at" 2>/dev/null)"
      LOCK_NOW="$(dex_lock_now)"
      case "$LOCK_CREATED:$LOCK_NOW" in
        *[!0-9:]*|:*) printf '0\n' ;;
        *) printf '%s\n' $((LOCK_NOW - LOCK_CREATED)) ;;
      esac
    }

    dex_release_lock() {
      if [ -f "$LOCK_DIR/pid" ] && [ "$(cat "$LOCK_DIR/pid" 2>/dev/null)" = "$$" ]; then
        rm -f "$LOCK_DIR/pid" "$LOCK_DIR/created_at" 2>/dev/null || true
        rmdir "$LOCK_DIR" 2>/dev/null || true
      fi
    }

    LOCK_WAIT=0
    while ! mkdir "$LOCK_DIR" 2>/dev/null; do
      if ! dex_lock_pid_alive; then
        rm -rf "$LOCK_DIR" 2>/dev/null || true
        continue
      fi
      LOCK_AGE="$(dex_lock_age)"
      if [ "${LOCK_AGE:-0}" -gt "$LOCK_STALE_SECONDS" ] 2>/dev/null; then
        rm -rf "$LOCK_DIR" 2>/dev/null || true
        continue
      fi
      if [ "$LOCK_WAIT" -ge "$LOCK_TIMEOUT" ] 2>/dev/null; then
        return 124
      fi
      sleep 1
      LOCK_WAIT=$((LOCK_WAIT + 1))
    done

    printf '%s\n' "$$" > "$LOCK_DIR/pid" 2>/dev/null || true
    dex_lock_now > "$LOCK_DIR/created_at" 2>/dev/null || true
    trap 'dex_release_lock' 0 HUP INT TERM
    "$@"
    LOCK_CODE=$?
    dex_release_lock
    trap - 0 HUP INT TERM
    return "$LOCK_CODE"
  )
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

dex_platform_version_code() {
  if [ -n "$KSU_VER_CODE" ]; then
    printf '%s' "$KSU_VER_CODE"
  elif [ -n "$APATCH_VER_CODE" ]; then
    printf '%s' "$APATCH_VER_CODE"
  elif [ -n "$MAGISK_VER_CODE" ]; then
    printf '%s' "$MAGISK_VER_CODE"
  else
    printf '0'
  fi
}

dex_platform_info() {
  PLATFORM="$(dex_detect_platform)"
  VERSION="$(dex_platform_version)"
  VERSION_CODE="$(dex_platform_version_code)"
  EXTRA_INFO=""
  [ -n "$KSU_RUNTIME_MODE" ] && EXTRA_INFO=", mode: $KSU_RUNTIME_MODE"
  if [ "$VERSION_CODE" != "0" ]; then
    printf '%s %s (code: %s%s)' "$PLATFORM" "$VERSION" "$VERSION_CODE" "$EXTRA_INFO"
  elif [ -n "$EXTRA_INFO" ]; then
    printf '%s %s (%s)' "$PLATFORM" "$VERSION" "${EXTRA_INFO#, }"
  else
    printf '%s %s' "$PLATFORM" "$VERSION"
  fi
}

dex_has_resetprop() {
  command -v resetprop >/dev/null 2>&1
}

dex_apply_prop() {
  PROP_KEY="$1"
  PROP_VALUE="$2"
  DEX_PROP_APPLY_TOOL=setprop

  if dex_has_resetprop; then
    DEX_PROP_APPLY_TOOL=resetprop
    if resetprop -n "$PROP_KEY" "$PROP_VALUE" 2>/dev/null; then
      return 0
    fi
    DEX_PROP_APPLY_TOOL=setprop-fallback
  fi

  setprop "$PROP_KEY" "$PROP_VALUE" 2>/dev/null
}

dex_prop_command() {
  if dex_has_resetprop; then
    printf 'resetprop'
  else
    printf 'setprop'
  fi
}
