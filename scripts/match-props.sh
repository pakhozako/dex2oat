#!/system/bin/sh

CAPTURED_FILE="$1"
OPTIONS_FILE="$2"
TEMPLATE_FILE="$3"
OUTPUT_FILE="$4"
MATCHED_FILE="$5"
REPORT_FILE="$6"
SOURCE_FILE="$7"
VENDOR_ID="$8"
MODULE_VERSION="$9"
ORIGINAL_PROPS="${10}"

[ -s "$CAPTURED_FILE" ] || exit 1
[ -f "$OPTIONS_FILE" ] || exit 1
[ -f "$TEMPLATE_FILE" ] || exit 1
[ -n "$OUTPUT_FILE" ] || exit 1
[ -n "$MATCHED_FILE" ] || exit 1
[ -n "$REPORT_FILE" ] || exit 1
[ -n "$SOURCE_FILE" ] || exit 1

STATE_DIR="${REPORT_FILE%/*}"
KEYS_FILE="$STATE_DIR/captured-keys.txt"
VALUES_FILE="$STATE_DIR/captured-values.prop"
OPTIONS_PROPS_FILE="$STATE_DIR/options-props.txt"
SKIPPED_FILE="$STATE_DIR/skipped-props.txt"
TMP_OUTPUT="$OUTPUT_FILE.tmp"
TMP_MATCHED="$MATCHED_FILE.tmp"
TMP_REPORT="$REPORT_FILE.tmp"
TMP_SOURCE="$SOURCE_FILE.tmp"

mkdir -p "$STATE_DIR" 2>/dev/null || exit 1

sed -n \
  -e 's/^\[\([^]]*\)\]: \[\(.*\)\]$/\1=\2/p' \
  -e 's/^\([^=#][^=]*\)=\(.*\)$/\1=\2/p' \
  "$CAPTURED_FILE" > "$VALUES_FILE" || exit 1

sed -n 's/^\([^=]*\)=.*$/\1/p' "$VALUES_FILE" | sort -u > "$KEYS_FILE" || exit 1
[ -s "$KEYS_FILE" ] || exit 1

grep '"prop"' "$OPTIONS_FILE" \
  | sed -n 's/.*"prop"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
  | sort -u > "$OPTIONS_PROPS_FILE" || exit 1
[ -s "$OPTIONS_PROPS_FILE" ] || exit 1

CAPTURED_TOTAL=$(wc -l < "$KEYS_FILE" 2>/dev/null | tr -d ' ')
MATCHED_TOTAL=0
TEMPLATE_FALLBACK_TOTAL=0
SKIPPED_INVALID_TOTAL=0
GENERATED_AT="$(date '+%Y-%m-%d %H:%M:%S')"

: > "$TMP_MATCHED" || exit 1
: > "$SKIPPED_FILE" || exit 1

while IFS= read -r CAPTURED_KEY || [ -n "$CAPTURED_KEY" ]; do
  [ -z "$CAPTURED_KEY" ] && continue
  if ! grep -F -x -q "$CAPTURED_KEY" "$OPTIONS_PROPS_FILE"; then
    SKIPPED_INVALID_TOTAL=$((SKIPPED_INVALID_TOTAL + 1))
    printf '%s（无定义）\n' "$CAPTURED_KEY" >> "$SKIPPED_FILE"
  fi
done < "$KEYS_FILE"

{
  printf '# Dex2oat Lock generated system.prop\n'
  printf '# generated_at=%s\n' "$GENERATED_AT"
  printf '# vendor=%s\n' "${VENDOR_ID:-unknown}"
  printf '# mode=dex2oat-match\n'
  printf '# version=%s\n' "${MODULE_VERSION:-unknown}"
  printf '\n'

  while IFS= read -r RAW_LINE || [ -n "$RAW_LINE" ]; do
    LINE="$(printf '%s' "$RAW_LINE" | tr -d '\r')"
    BODY="$LINE"
    ENABLED=1

    case "$BODY" in
      \#*)
        ENABLED=0
        BODY="${BODY#\#}"
        while :; do
          case "$BODY" in " "*) BODY="${BODY# }" ;; *) break ;; esac
        done
        ;;
    esac

    case "$BODY" in
      *=*)
        PROP_KEY="${BODY%%=*}"
        PROP_VALUE="${BODY#*=}"
        CAPTURED_LINE="$(grep -F -m 1 "$PROP_KEY=" "$VALUES_FILE" 2>/dev/null)"
        CAPTURED_VALUE="${CAPTURED_LINE#*=}"
        [ "$CAPTURED_LINE" = "$CAPTURED_VALUE" ] && CAPTURED_VALUE=""

        if [ -n "$CAPTURED_VALUE" ] && ! grep -F -x -q "$PROP_KEY" "$OPTIONS_PROPS_FILE"; then
          SKIPPED_INVALID_TOTAL=$((SKIPPED_INVALID_TOTAL + 1))
          printf '%s（无定义）\n' "$PROP_KEY" >> "$SKIPPED_FILE"
          printf '%s\n' "$LINE"
          continue
        fi

        if [ -n "$CAPTURED_VALUE" ]; then
          case "$CAPTURED_VALUE" in *[!A-Za-z0-9_.,:/@%+-]*)
            SKIPPED_INVALID_TOTAL=$((SKIPPED_INVALID_TOTAL + 1))
            printf '%s（值非法）\n' "$PROP_KEY" >> "$SKIPPED_FILE"
            printf '%s\n' "$LINE"
            continue
            ;;
          esac
        fi

        if [ "$ENABLED" = "1" ]; then
          printf '%s\n' "$LINE"
        elif grep -F -x -q "$PROP_KEY" "$KEYS_FILE" && grep -F -x -q "$PROP_KEY" "$OPTIONS_PROPS_FILE"; then
          MATCHED_TOTAL=$((MATCHED_TOTAL + 1))
          printf '%s=%s\n' "$PROP_KEY" "$PROP_VALUE"
          printf '%s=%s\n' "$PROP_KEY" "$PROP_VALUE" >> "$TMP_MATCHED"
        else
          TEMPLATE_FALLBACK_TOTAL=$((TEMPLATE_FALLBACK_TOTAL + 1))
          printf '%s\n' "$LINE"
        fi
        ;;
      *)
        printf '%s\n' "$LINE"
        ;;
    esac
  done < "$TEMPLATE_FILE"
} > "$TMP_OUTPUT" || exit 1

[ -s "$TMP_OUTPUT" ] || exit 1
[ "$MATCHED_TOTAL" -gt 0 ] || exit 1

{
  printf 'generated_at=%s\n' "$GENERATED_AT"
  printf 'vendor=%s\n' "${VENDOR_ID:-unknown}"
  printf 'mode=dex2oat-match\n'
  printf 'captured_total=%s\n' "${CAPTURED_TOTAL:-0}"
  printf 'matched_total=%s\n' "${MATCHED_TOTAL:-0}"
  printf 'template_fallback_total=%s\n' "${TEMPLATE_FALLBACK_TOTAL:-0}"
  printf 'skipped_invalid_total=%s\n' "${SKIPPED_INVALID_TOTAL:-0}"
  printf 'generated_system_prop=%s\n' "$OUTPUT_FILE"
  printf '[skipped]\n'
  sort -u "$SKIPPED_FILE" 2>/dev/null
  printf '[diff]\n'
  while IFS='=' read -r DIFF_KEY DIFF_VALUE || [ -n "$DIFF_KEY" ]; do
    [ -z "$DIFF_KEY" ] && continue
    ORIGINAL_LINE=""
    [ -n "$ORIGINAL_PROPS" ] && [ -f "$ORIGINAL_PROPS" ] && ORIGINAL_LINE="$(grep -F -m 1 "$DIFF_KEY=" "$ORIGINAL_PROPS" 2>/dev/null)"
    if [ -n "$ORIGINAL_LINE" ]; then
      ORIGINAL_VALUE="${ORIGINAL_LINE#*=}"
    elif [ -n "$ORIGINAL_PROPS" ] && [ -f "$ORIGINAL_PROPS" ] && grep -F -x -q "@unset:$DIFF_KEY" "$ORIGINAL_PROPS" 2>/dev/null; then
      ORIGINAL_VALUE="<unset>"
    else
      ORIGINAL_VALUE="<unknown>"
    fi
    printf '%s: %s -> %s\n' "$DIFF_KEY" "$ORIGINAL_VALUE" "$DIFF_VALUE"
  done < "$TMP_MATCHED"
} > "$TMP_REPORT" || exit 1

{
  printf 'source=dex2oat-match\n'
  printf 'updated_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  printf 'version=%s\n' "${MODULE_VERSION:-unknown}"
  printf 'vendor=%s\n' "${VENDOR_ID:-unknown}"
  printf 'matched_total=%s\n' "${MATCHED_TOTAL:-0}"
} > "$TMP_SOURCE" || exit 1

mv -f "$TMP_OUTPUT" "$OUTPUT_FILE" || exit 1
mv -f "$TMP_MATCHED" "$MATCHED_FILE" || exit 1
mv -f "$TMP_REPORT" "$REPORT_FILE" || exit 1
mv -f "$TMP_SOURCE" "$SOURCE_FILE" || exit 1
chmod 0600 "$OUTPUT_FILE" "$MATCHED_FILE" "$REPORT_FILE" "$SOURCE_FILE" "$KEYS_FILE" "$VALUES_FILE" "$OPTIONS_PROPS_FILE" "$SKIPPED_FILE" 2>/dev/null || true

exit 0
