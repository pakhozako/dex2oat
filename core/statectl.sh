#!/system/bin/sh

STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
STATE_FILE=${STATE_FILE:-$STATE_DIR/state.prop}
CORE_DIR="${0%/*}"
. "$CORE_DIR/common.sh" || exit 1
. "$CORE_DIR/state-schema.sh" || exit 1
. "$CORE_DIR/state-store.sh" || exit 1

case "$1" in
  update|transaction)
    shift
    state_update "$@"
    ;;
  clear-attention)
    if command -v dex_with_lock >/dev/null 2>&1; then
      dex_with_lock "$STATE_LOCK_DIR" 15 state_clear_attention_keys
    else
      state_clear_attention_keys
    fi
    ;;
  validate)
    state_schema_file_valid "$STATE_FILE"
    ;;
  *)
    printf '用法: statectl.sh update key=value [...] | transaction key=value [...] | clear-attention | validate\n' >&2
    exit 2
    ;;
esac
