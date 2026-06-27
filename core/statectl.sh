#!/system/bin/sh

STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
STATE_FILE=${STATE_FILE:-$STATE_DIR/state.prop}
STATE_LOCK_DIR="$STATE_DIR/.state.lock"

[ -f "${0%/*}/common.sh" ] && . "${0%/*}/common.sh"

statectl_apply() {
  mkdir -p "$STATE_DIR" 2>/dev/null || return 1
  TMP_STATE="$STATE_FILE.tmp.$$"
  : > "$TMP_STATE" 2>/dev/null || return 1

  if [ -f "$STATE_FILE" ]; then
    while IFS= read -r STATE_LINE || [ -n "$STATE_LINE" ]; do
      STATE_KEY="${STATE_LINE%%=*}"
      [ -n "$STATE_KEY" ] || continue
      SKIP_STATE_KEY=0
      for STATE_PAIR in "$@"; do
        [ "${STATE_PAIR%%=*}" = "$STATE_KEY" ] && SKIP_STATE_KEY=1 && break
      done
      [ "$SKIP_STATE_KEY" = "1" ] || printf '%s\n' "$STATE_LINE" >> "$TMP_STATE"
    done < "$STATE_FILE"
  fi

  for STATE_PAIR in "$@"; do
    printf '%s\n' "$STATE_PAIR" >> "$TMP_STATE"
  done

  sync "$TMP_STATE" 2>/dev/null || sync 2>/dev/null || true
  mv -f "$TMP_STATE" "$STATE_FILE" 2>/dev/null || {
    rm -f "$TMP_STATE" 2>/dev/null || true
    return 1
  }
  chmod 0600 "$STATE_FILE" 2>/dev/null || true
}

statectl_update() {
  if command -v dex_with_lock >/dev/null 2>&1; then
    dex_with_lock "$STATE_LOCK_DIR" 15 statectl_apply "$@"
  else
    statectl_apply "$@"
  fi
}

statectl_clear_attention_apply() {
  mkdir -p "$STATE_DIR" 2>/dev/null || return 1
  [ -f "$STATE_FILE" ] || return 0
  TMP_STATE="$STATE_FILE.clear.tmp.$$"
  grep -v -E '^(summary\.attention\.|summary\.attention_total=|summary\.attention_alert_total=)' "$STATE_FILE" > "$TMP_STATE" 2>/dev/null || : > "$TMP_STATE"
  mv -f "$TMP_STATE" "$STATE_FILE" 2>/dev/null || {
    rm -f "$TMP_STATE" 2>/dev/null || true
    return 1
  }
  chmod 0600 "$STATE_FILE" 2>/dev/null || true
}

statectl_clear_attention() {
  if command -v dex_with_lock >/dev/null 2>&1; then
    dex_with_lock "$STATE_LOCK_DIR" 15 statectl_clear_attention_apply
  else
    statectl_clear_attention_apply
  fi
}

case "$1" in
  update)
    shift
    statectl_update "$@"
    ;;
  clear-attention)
    statectl_clear_attention
    ;;
  *)
    printf 'usage: statectl.sh update key=value [...] | clear-attention\n' >&2
    exit 2
    ;;
esac
