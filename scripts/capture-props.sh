#!/system/bin/sh

OUTPUT_FILE="$1"
RULES_FILE="$2"

[ -n "$OUTPUT_FILE" ] || exit 1
[ -s "$RULES_FILE" ] || exit 1

OUTPUT_DIR="${OUTPUT_FILE%/*}"
TMP_FILE="$OUTPUT_FILE.tmp.$$"
RAW_FILE="$OUTPUT_FILE.getprop.$$"
GETPROP=/system/bin/getprop
[ -x "$GETPROP" ] || GETPROP=getprop

cleanup_capture() {
  rm -f "$TMP_FILE" "$RAW_FILE" 2>/dev/null || true
}
trap 'cleanup_capture' EXIT HUP INT TERM

[ "$OUTPUT_DIR" = "$OUTPUT_FILE" ] || mkdir -p "$OUTPUT_DIR" 2>/dev/null || exit 1

"$GETPROP" > "$RAW_FILE" || exit 1

awk -v rules="$RULES_FILE" '
  BEGIN {
    FS = "\t"
    while ((getline line < rules) > 0) {
      sub(/\r$/, "", line)
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
' "$RAW_FILE" > "$TMP_FILE" || exit 1

mv -f "$TMP_FILE" "$OUTPUT_FILE" || exit 1
chmod 0600 "$OUTPUT_FILE" 2>/dev/null || true
trap - EXIT HUP INT TERM
exit 0
