#!/system/bin/sh

SOURCE_FILE="$1"
OUTPUT_FILE="$2"

[ -n "$SOURCE_FILE" ] || exit 1
[ -n "$OUTPUT_FILE" ] || exit 1
[ -s "$SOURCE_FILE" ] || exit 1
command -v sha256sum >/dev/null 2>&1 || exit 1

OUTPUT_DIR="${OUTPUT_FILE%/*}"
[ "$OUTPUT_DIR" = "$OUTPUT_FILE" ] || mkdir -p "$OUTPUT_DIR" 2>/dev/null || exit 1

TMP_FILE="$OUTPUT_FILE.tmp.$$"
trap 'rm -f "$TMP_FILE" 2>/dev/null' 0 HUP INT TERM

LC_ALL=C awk '
  BEGIN {
    for (idx = 0; idx < 16; idx++) {
      char = sprintf("%x", idx)
      hex[char] = idx
      hex[toupper(char)] = idx
    }
  }

  /^version=/ {
    version = substr($0, 9) + 0
    next
  }

  /^seed=/ {
    seed = substr($0, 6) + 0
    next
  }

  /^length=/ {
    total = substr($0, 8) + 0
    next
  }

  /^data=/ {
    in_data = 1
    next
  }

  in_data && /^[0-9A-Fa-f]+$/ {
    data = data $0
    next
  }

  function hex_pair(pair) {
    return hex[substr(pair, 1, 1)] * 16 + hex[substr(pair, 2, 1)]
  }

  function mask_at(pos, source_pos) {
    return (seed + ((pos + 1) * 73) + (((source_pos + 1) % 251) * 17) + total) % 256
  }

  END {
    if (version != 1 || seed <= 0 || total <= 0 || data == "") exit 2
    if (length(data) != total * 2) exit 3

    for (pos = 0; pos < total; pos++) {
      source_pos = total - 1 - pos
      byte = hex_pair(substr(data, pos * 2 + 1, 2)) - mask_at(pos, source_pos)
      while (byte < 0) byte += 256
      byte = byte % 256
      output[source_pos + 1] = sprintf("%c", byte)
    }

    for (pos = 1; pos <= total; pos++) {
      printf "%s", output[pos]
    }
  }
' "$SOURCE_FILE" > "$TMP_FILE" || exit 1

EXPECTED_HASH="$(sed -n 's/^sha256=//p' "$SOURCE_FILE" 2>/dev/null | head -n 1)"
case "$EXPECTED_HASH" in ""|*[!0-9A-Fa-f]*) exit 1 ;; esac
[ "${#EXPECTED_HASH}" -eq 64 ] 2>/dev/null || exit 1
ACTUAL_HASH="$(sha256sum "$TMP_FILE" 2>/dev/null | awk '{print $1}')"
[ -n "$ACTUAL_HASH" ] || exit 1
[ "$EXPECTED_HASH" = "$ACTUAL_HASH" ] || exit 1

mv -f "$TMP_FILE" "$OUTPUT_FILE" || exit 1
chmod 0600 "$OUTPUT_FILE" 2>/dev/null || true
trap - 0 HUP INT TERM
exit 0
