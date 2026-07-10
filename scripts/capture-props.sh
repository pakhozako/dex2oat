#!/system/bin/sh

OUT_FILE="${1:-/data/adb/dex2oat-lock/captured-props.txt}"
EXPORT_FILE="${2-}"
RULES_FILE="${3-}"
OUT_DIR="${OUT_FILE%/*}"
TMP_FILE="$OUT_FILE.tmp.$$"

trap 'rm -f "$TMP_FILE" 2>/dev/null || true' EXIT HUP INT TERM

[ "$OUT_DIR" != "$OUT_FILE" ] && mkdir -p "$OUT_DIR" 2>/dev/null

GETPROP=/system/bin/getprop
[ -x "$GETPROP" ] || GETPROP=getprop
command -v "$GETPROP" >/dev/null 2>&1 || exit 1

if [ -s "$RULES_FILE" ]; then
  if ! "$GETPROP" | awk -v rules="$RULES_FILE" '
    BEGIN {
      FS = "\t"
      while ((getline line < rules) > 0) {
        if (line == "" || line ~ /^#/) continue
        split(line, fields, FS)
        if (fields[3] != "" && fields[3] != "prop") wanted[fields[3]] = 1
      }
      close(rules)
    }
    /^\[[^]]+\]: \[.*\]$/ {
      key = $0
      sub(/^\[/, "", key)
      sub(/\]: \[.*$/, "", key)
      if (wanted[key]) print
      next
    }
    /^[^=#][^=]*=/ {
      key = $0
      sub(/=.*/, "", key)
      if (wanted[key]) print
    }
  ' > "$TMP_FILE"; then
    rm -f "$TMP_FILE" 2>/dev/null
    exit 1
  fi
elif ! "$GETPROP" > "$TMP_FILE"; then
  rm -f "$TMP_FILE" 2>/dev/null
  exit 1
fi

if [ ! -s "$TMP_FILE" ]; then
  rm -f "$TMP_FILE" 2>/dev/null
  exit 1
fi

mv -f "$TMP_FILE" "$OUT_FILE" || exit 1
trap - EXIT HUP INT TERM
chmod 0600 "$OUT_FILE" 2>/dev/null || true

if [ -n "$EXPORT_FILE" ]; then
  EXPORT_DIR="${EXPORT_FILE%/*}"
  [ "$EXPORT_DIR" != "$EXPORT_FILE" ] && mkdir -p "$EXPORT_DIR" 2>/dev/null
  cp -af "$OUT_FILE" "$EXPORT_FILE" 2>/dev/null || true
fi

exit 0
