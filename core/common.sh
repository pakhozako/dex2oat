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
  [ "${LOG_SIZE:-0}" -gt "$MAX_SIZE" ] || return 0
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

dex_normalize_key() {
  printf '%s' "$1" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

dex_normalize_value() {
  printf '%s' "$1" | tr -d '\r'
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

    dex_lock_now() {
      date '+%s' 2>/dev/null || printf '0\n'
    }

    dex_lock_pid_alive() {
      [ -f "$LOCK_DIR/pid" ] || return 1
      LOCK_PID="$(cat "$LOCK_DIR/pid" 2>/dev/null)"
      case "$LOCK_PID" in
        ""|*[!0-9]*)
          return 1
          ;;
      esac
      [ -d "/proc/$LOCK_PID" ]
    }

    dex_lock_age() {
      [ -f "$LOCK_DIR/created_at" ] || { printf '0\n'; return 0; }
      LOCK_CREATED="$(cat "$LOCK_DIR/created_at" 2>/dev/null)"
      LOCK_NOW="$(dex_lock_now)"
      case "$LOCK_CREATED:$LOCK_NOW" in
        *[!0-9:]*|:*)
          printf '0\n'
          ;;
        *)
          printf '%s\n' $((LOCK_NOW - LOCK_CREATED))
          ;;
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
