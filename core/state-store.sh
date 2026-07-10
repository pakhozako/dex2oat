#!/system/bin/sh

STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
STATE_FILE=${STATE_FILE:-$STATE_DIR/state.prop}
STATE_LOCK_DIR="$STATE_DIR/.state.lock"

state_atomic_replace() {
  STATE_ATOMIC_SOURCE="$1"; STATE_ATOMIC_TARGET="$2"; STATE_ATOMIC_MODE="${3:-0600}"
  [ -f "$STATE_ATOMIC_SOURCE" ] && [ ! -L "$STATE_ATOMIC_SOURCE" ] || return 1
  [ ! -L "$STATE_ATOMIC_TARGET" ] || return 1
  if command -v dex_atomic_commit >/dev/null 2>&1; then
    dex_atomic_commit "$STATE_ATOMIC_SOURCE" "$STATE_ATOMIC_TARGET" "$STATE_ATOMIC_MODE"
  else
    [ "${DEX2OAT_SKIP_SYNC:-0}" = 1 ] || sync "$STATE_ATOMIC_SOURCE" 2>/dev/null || true
    mv -f "$STATE_ATOMIC_SOURCE" "$STATE_ATOMIC_TARGET" 2>/dev/null || return 1
    chmod "$STATE_ATOMIC_MODE" "$STATE_ATOMIC_TARGET" 2>/dev/null || true
  fi
}

state_store_apply() {
  mkdir -p "$STATE_DIR" 2>/dev/null || return 1
  [ ! -L "$STATE_DIR" ] || return 1
  state_schema_file_valid "$STATE_FILE" || return 1
  for STATE_STORE_PAIR in "$@"; do state_pair_valid "$STATE_STORE_PAIR" || return 1; done
  STATE_STORE_HAS_SCHEMA=0
  for STATE_STORE_PAIR in "$@"; do
    [ "$(state_pair_key "$STATE_STORE_PAIR")" = schema_version ] && STATE_STORE_HAS_SCHEMA=1 && break
  done
  STATE_STORE_TMP="$STATE_FILE.tmp.$$"
  trap 'rm -f "$STATE_STORE_TMP" 2>/dev/null' HUP INT TERM
  : > "$STATE_STORE_TMP" 2>/dev/null || return 1
  if [ "$STATE_STORE_HAS_SCHEMA" != 1 ]; then
    printf 'schema_version=%s\n' "$STATE_SCHEMA_VERSION" >> "$STATE_STORE_TMP" || return 1
  fi
  if [ -f "$STATE_FILE" ]; then
    while IFS= read -r STATE_STORE_LINE || [ -n "$STATE_STORE_LINE" ]; do
      STATE_STORE_KEY="$(state_pair_key "$STATE_STORE_LINE")" || continue
      [ "$STATE_STORE_KEY" = schema_version ] && continue
      STATE_STORE_SKIP=0
      for STATE_STORE_PAIR in "$@"; do
        [ "$(state_pair_key "$STATE_STORE_PAIR")" = "$STATE_STORE_KEY" ] && STATE_STORE_SKIP=1 && break
      done
      [ "$STATE_STORE_SKIP" = 1 ] || printf '%s\n' "$STATE_STORE_LINE" >> "$STATE_STORE_TMP" || return 1
    done < "$STATE_FILE"
  fi
  for STATE_STORE_PAIR in "$@"; do printf '%s\n' "$STATE_STORE_PAIR" >> "$STATE_STORE_TMP" || return 1; done
  state_schema_file_valid "$STATE_STORE_TMP" || return 1
  state_atomic_replace "$STATE_STORE_TMP" "$STATE_FILE" 0600 || return 1
  trap - HUP INT TERM
}

state_update() {
  [ "$#" -gt 0 ] || return 0
  if command -v dex_with_lock >/dev/null 2>&1; then dex_with_lock "$STATE_LOCK_DIR" 15 state_store_apply "$@"; else state_store_apply "$@"; fi
}
state_transaction_begin() { STATE_TRANSACTION_FILE="$STATE_DIR/.state-transaction.$$"; mkdir -p "$STATE_DIR" || return 1; : > "$STATE_TRANSACTION_FILE" || return 1; chmod 0600 "$STATE_TRANSACTION_FILE" 2>/dev/null || true; }
state_transaction_set() { [ -n "$STATE_TRANSACTION_FILE" ] && state_pair_valid "$1" || return 1; printf '%s\n' "$1" >> "$STATE_TRANSACTION_FILE"; }
state_transaction_abort() { [ -n "$STATE_TRANSACTION_FILE" ] && rm -f "$STATE_TRANSACTION_FILE" 2>/dev/null || true; STATE_TRANSACTION_FILE=; }
state_transaction_commit() {
  [ -s "$STATE_TRANSACTION_FILE" ] || { state_transaction_abort; return 1; }
  set --
  while IFS= read -r STATE_TRANSACTION_PAIR || [ -n "$STATE_TRANSACTION_PAIR" ]; do set -- "$@" "$STATE_TRANSACTION_PAIR"; done < "$STATE_TRANSACTION_FILE"
  state_update "$@"; STATE_TRANSACTION_CODE=$?; state_transaction_abort; return "$STATE_TRANSACTION_CODE"
}

state_get() { LOOKUP_KEY="$1"; [ -f "$STATE_FILE" ] || return 0; awk -F= -v key="$LOOKUP_KEY" '$1 == key { sub(/^[^=]*=/, ""); value=$0; found=1 } END { if (found) print value }' "$STATE_FILE" 2>/dev/null; }
state_num() { VALUE="$(state_get "$1")"; case "$VALUE" in ""|*[!0-9]*) printf '0\n' ;; *) printf '%s\n' "$VALUE" ;; esac; }
state_clear_attention_keys() {
  [ -f "$STATE_FILE" ] || return 0
  STATE_CLEAR_TMP="$STATE_FILE.clear.tmp.$$"; grep -v -E '^(summary\.attention\.|summary\.attention_total=|summary\.attention_alert_total=)' "$STATE_FILE" > "$STATE_CLEAR_TMP" 2>/dev/null || : > "$STATE_CLEAR_TMP"
  state_atomic_replace "$STATE_CLEAR_TMP" "$STATE_FILE" 0600
}
