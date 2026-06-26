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
  LOCK_DIR="$1"
  LOCK_TIMEOUT="${2:-10}"
  shift 2
  LOCK_WAIT=0
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    if [ "$LOCK_WAIT" -ge "$LOCK_TIMEOUT" ] 2>/dev/null; then
      return 124
    fi
    sleep 1
    LOCK_WAIT=$((LOCK_WAIT + 1))
  done
  "$@"
  LOCK_CODE=$?
  rmdir "$LOCK_DIR" 2>/dev/null || true
  return "$LOCK_CODE"
}
