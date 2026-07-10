#!/system/bin/sh

SNAPSHOT_DIR=${SNAPSHOT_DIR:-$STATE_DIR/snapshots}
SNAPSHOT_KEEP=${DEX2OAT_SNAPSHOT_KEEP:-3}
SNAPSHOT_MAX_SIZE=${DEX2OAT_SNAPSHOT_MAX_SIZE:-262144}

snapshot_validate_prop_file() {
  SNAPSHOT_FILE="$1"
  [ -f "$SNAPSHOT_FILE" ] && [ ! -L "$SNAPSHOT_FILE" ] || return 1
  SNAPSHOT_SIZE="$(wc -c < "$SNAPSHOT_FILE" 2>/dev/null | tr -d ' ')"
  [ "${SNAPSHOT_SIZE:-0}" -gt 0 ] 2>/dev/null || return 1
  [ "$SNAPSHOT_SIZE" -le "$SNAPSHOT_MAX_SIZE" ] 2>/dev/null || return 1
  while IFS= read -r SNAPSHOT_LINE || [ -n "$SNAPSHOT_LINE" ]; do
    case "$SNAPSHOT_LINE" in
      ""|\#*) continue ;;
    esac
    SNAPSHOT_KEY="${SNAPSHOT_LINE%%=*}"
    [ "$SNAPSHOT_KEY" != "$SNAPSHOT_LINE" ] || return 1
    dex_valid_prop_key "$SNAPSHOT_KEY" || return 1
    [ "$(printf '%s' "$SNAPSHOT_LINE" | tr -d '\r\n')" = "$SNAPSHOT_LINE" ] || return 1
  done < "$SNAPSHOT_FILE"
}

snapshot_compact_index() {
  [ -d "$SNAPSHOT_DIR" ] || return 0
  SNAPSHOT_INDEX="$SNAPSHOT_DIR/index.tsv"
  SNAPSHOT_INDEX_TMP="$SNAPSHOT_INDEX.tmp.$$"
  : > "$SNAPSHOT_INDEX_TMP" || return 1
  SNAPSHOT_COUNT=0
  find "$SNAPSHOT_DIR" -name '*.prop' -type f -print 2>/dev/null | sort -r | while IFS= read -r SNAPSHOT_FILE; do
    SNAPSHOT_COUNT=$((SNAPSHOT_COUNT + 1))
    if [ "$SNAPSHOT_COUNT" -le "$SNAPSHOT_KEEP" ]; then
      SNAPSHOT_HASH="$(dex_hash_file "$SNAPSHOT_FILE")"
      SNAPSHOT_SIZE="$(wc -c < "$SNAPSHOT_FILE" 2>/dev/null | tr -d ' ')"
      printf '%s\t%s\t%s\t%s\n' "${SNAPSHOT_FILE##*/}" "$SNAPSHOT_HASH" "$SNAPSHOT_SIZE" "$SNAPSHOT_FILE" >> "$SNAPSHOT_INDEX_TMP" || exit 1
    else
      rm -f "$SNAPSHOT_FILE" 2>/dev/null || exit 1
    fi
  done
  mv -f "$SNAPSHOT_INDEX_TMP" "$SNAPSHOT_INDEX" 2>/dev/null || return 1
  chmod 0600 "$SNAPSHOT_INDEX" 2>/dev/null || true
}

snapshot_create() {
  SNAPSHOT_SOURCE="$1"
  SNAPSHOT_REASON="$2"
  snapshot_validate_prop_file "$SNAPSHOT_SOURCE" || return 1
  [ ! -L "$SNAPSHOT_DIR" ] || return 1
  mkdir -p "$SNAPSHOT_DIR" || return 1
  chmod 0700 "$SNAPSHOT_DIR" 2>/dev/null || true
  SNAPSHOT_HASH="$(dex_hash_file "$SNAPSHOT_SOURCE")"
  SNAPSHOT_SIZE="$(wc -c < "$SNAPSHOT_SOURCE" 2>/dev/null | tr -d ' ')"
  SNAPSHOT_FILE="$SNAPSHOT_DIR/$(date '+%Y%m%d-%H%M%S').$SNAPSHOT_HASH.prop"
  for EXISTING in "$SNAPSHOT_DIR"/*."$SNAPSHOT_HASH".prop; do
    [ -f "$EXISTING" ] && { snapshot_compact_index; return 0; }
  done
  cp -f "$SNAPSHOT_SOURCE" "$SNAPSHOT_FILE" || return 1
  chmod 0600 "$SNAPSHOT_FILE" 2>/dev/null || true
  snapshot_validate_prop_file "$SNAPSHOT_FILE" || return 1
  [ "$(dex_hash_file "$SNAPSHOT_FILE")" = "$SNAPSHOT_HASH" ] || return 1
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$SNAPSHOT_HASH" "$SNAPSHOT_SIZE" "$SNAPSHOT_REASON" "$SNAPSHOT_FILE" >> "$SNAPSHOT_DIR/index.tsv" || return 1
  snapshot_compact_index || return 1
  state_update "snapshot.status=ok" "snapshot.last_file=$SNAPSHOT_FILE" "snapshot.hash=$SNAPSHOT_HASH" "snapshot.size=$SNAPSHOT_SIZE" "snapshot.reason=$SNAPSHOT_REASON" "snapshot.updated_at=$(state_now)" || true
}

snapshot_latest() {
  find "$SNAPSHOT_DIR" -name '*.prop' -type f -print 2>/dev/null | sort -r | head -n 1
}

snapshot_restore_latest() {
  SNAPSHOT_TARGET="$1"
  [ ! -L "$SNAPSHOT_TARGET" ] || return 1
  SNAPSHOT_FILE="$(snapshot_latest)"
  snapshot_validate_prop_file "$SNAPSHOT_FILE" || return 1
  SNAPSHOT_HASH="${SNAPSHOT_FILE##*.}"
  SNAPSHOT_HASH="${SNAPSHOT_FILE%."$SNAPSHOT_HASH"}"
  SNAPSHOT_HASH="${SNAPSHOT_HASH##*.}"
  [ -n "$SNAPSHOT_HASH" ] || return 1
  [ "$(dex_hash_file "$SNAPSHOT_FILE")" = "$SNAPSHOT_HASH" ] || return 1
  cp -f "$SNAPSHOT_FILE" "$SNAPSHOT_TARGET.tmp.$$" || return 1
  snapshot_validate_prop_file "$SNAPSHOT_TARGET.tmp.$$" || return 1
  [ "$(dex_hash_file "$SNAPSHOT_TARGET.tmp.$$")" = "$SNAPSHOT_HASH" ] || return 1
  mv -f "$SNAPSHOT_TARGET.tmp.$$" "$SNAPSHOT_TARGET" || return 1
  chmod 0644 "$SNAPSHOT_TARGET" 2>/dev/null || true
  state_update "snapshot.status=restored" "snapshot.last_file=$SNAPSHOT_FILE" "snapshot.hash=$SNAPSHOT_HASH" "snapshot.updated_at=$(state_now)" || true
}
