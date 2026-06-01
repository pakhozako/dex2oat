#!/system/bin/sh

STATE_DIR=/data/adb/dex2oat-lock
ORIGINAL_PROPS="$STATE_DIR/original-props.conf"

restore_prop() {
  PROP_KEY="$1"
  PROP_VALUE="$2"

  if command -v resetprop >/dev/null 2>&1; then
    resetprop "$PROP_KEY" "$PROP_VALUE"
  else
    setprop "$PROP_KEY" "$PROP_VALUE"
  fi
}

delete_prop() {
  PROP_KEY="$1"

  if command -v resetprop >/dev/null 2>&1; then
    resetprop --delete "$PROP_KEY" 2>/dev/null
  else
    setprop "$PROP_KEY" ""
  fi
}

if [ -f "$ORIGINAL_PROPS" ]; then
  while IFS= read -r PROP_LINE; do
    case "$PROP_LINE" in
      @unset:*)
        delete_prop "${PROP_LINE#@unset:}"
        ;;
      *=*)
        restore_prop "${PROP_LINE%%=*}" "${PROP_LINE#*=}"
        ;;
    esac
  done < "$ORIGINAL_PROPS"
fi

rm -rf "$STATE_DIR"