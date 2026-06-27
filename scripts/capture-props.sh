#!/system/bin/sh

OUT_FILE="${1:-/data/adb/dex2oat-lock/captured-props.txt}"
EXPORT_FILE="${2-}"
OUT_DIR="${OUT_FILE%/*}"
TMP_FILE="$OUT_FILE.tmp"

[ "$OUT_DIR" != "$OUT_FILE" ] && mkdir -p "$OUT_DIR" 2>/dev/null

GETPROP=/system/bin/getprop
[ -x "$GETPROP" ] || GETPROP=getprop

if ! "$GETPROP" \
  | grep -E '^\[(dalvik\.vm\.|pm\.dexopt\.|persist\.device_config\.runtime|persist\.device_config\.runtime_native|persist\.device_config\.runtime_native_boot|persist\.miui\.|persist\.oplus\.|persist\.sys\.|persist\.dalvik\.|system_perf_init\.|ro\.vendor\.dex2oat|vendor\.oplus\.dalvik\.|oplus\.|sys\.oplus\.|sys\.heap\.|sys\.furtherHeapEnlarge\.|sys\.gcsupression\.)' \
  > "$TMP_FILE"; then
  rm -f "$TMP_FILE" 2>/dev/null
  exit 1
fi

if [ ! -s "$TMP_FILE" ]; then
  rm -f "$TMP_FILE" 2>/dev/null
  exit 1
fi

mv -f "$TMP_FILE" "$OUT_FILE" || exit 1
chmod 0600 "$OUT_FILE" 2>/dev/null || true

if [ -n "$EXPORT_FILE" ]; then
  EXPORT_DIR="${EXPORT_FILE%/*}"
  [ "$EXPORT_DIR" != "$EXPORT_FILE" ] && mkdir -p "$EXPORT_DIR" 2>/dev/null
  cp -af "$OUT_FILE" "$EXPORT_FILE" 2>/dev/null || true
fi

exit 0
