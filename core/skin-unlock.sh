#!/system/bin/sh

MODDIR="$1"
ACTION="$2"
[ -n "$MODDIR" ] || MODDIR=${0%/*}/..

STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
CONFIG_LOCK_DIR="$STATE_DIR/.config.lock"
UNLOCK_FILE="$STATE_DIR/unlocked-skins.json"
UNLOCK_SKINS="memorial-amber founder-qingmu"

[ -f "$MODDIR/core/common.sh" ] && . "$MODDIR/core/common.sh"

fail() {
  printf '{"ok":false,"error":"%s"}\n' "$1"
  exit 1
}

skin_allowed() {
  case "$1" in
    memorial-amber|founder-qingmu) return 0 ;;
    *) return 1 ;;
  esac
}

bundle_skin() {
  case " $UNLOCK_SKINS " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

mark_bundle_skin_seen() {
  case "$1" in
    memorial-amber) SEEN_MEMORIAL=1 ;;
    founder-qingmu) SEEN_FOUNDER=1 ;;
  esac
}

bundle_skin_seen() {
  case "$1" in
    memorial-amber) [ "$SEEN_MEMORIAL" = "1" ] ; return ;;
    founder-qingmu) [ "$SEEN_FOUNDER" = "1" ] ; return ;;
    *) return 1 ;;
  esac
}

sanitize_token() {
  printf '%s' "$1" | tr -cd 'A-Za-z0-9._:-' | cut -c 1-128
}

hash_text() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum 2>/dev/null | awk '{print $1}'
  elif command -v md5sum >/dev/null 2>&1; then
    printf '%s' "$1" | md5sum 2>/dev/null | awk '{print $1}'
  else
    printf '%s' "$1" | cksum 2>/dev/null | awk '{print $1}'
  fi
}

skin_proof() {
  hash_text "dex2oat-lock|skin-v1|$1|$2|$3"
}

records_checksum() {
  [ -s "$1" ] || { printf 'EMPTY\n'; return 0; }
  hash_text "$(cat "$1" 2>/dev/null)"
}

record_field() {
  FIELD="$1"
  LINE="$2"
  printf '%s\n' "$LINE" | sed -n "s/.*\"$FIELD\":\"\\([^\"]*\\)\".*/\\1/p"
}

collect_valid_records() {
  OUT_FILE="$1"
  INVALID_FILE="$2"
  ALL_RECORDS_FILE="$OUT_FILE.all"
  INVALID_COUNT=0
  : > "$OUT_FILE" 2>/dev/null || return 1
  : > "$ALL_RECORDS_FILE" 2>/dev/null || return 1
  [ -f "$UNLOCK_FILE" ] || {
    printf '0\n' > "$INVALID_FILE" 2>/dev/null || true
    rm -f "$ALL_RECORDS_FILE" 2>/dev/null || true
    return 0
  }
  STORED_CHECKSUM="$(sed -n 's/.*"checksum":"\([^"]*\)".*/\1/p' "$UNLOCK_FILE" 2>/dev/null | head -n 1)"

  while IFS= read -r LINE || [ -n "$LINE" ]; do
    case "$LINE" in
      *'"id":"'*) ;;
      *) continue ;;
    esac
    ID="$(record_field id "$LINE")"
    INSTALL_HASH="$(record_field installHash "$LINE")"
    UNLOCKED_AT="$(record_field unlockedAt "$LINE")"
    PROOF="$(record_field proof "$LINE")"
    CANONICAL_RECORD="$(printf '{"id":"%s","installHash":"%s","unlockedAt":"%s","proof":"%s"}' "$ID" "$INSTALL_HASH" "$UNLOCKED_AT" "$PROOF")"
    printf '%s\n' "$CANONICAL_RECORD" >> "$ALL_RECORDS_FILE"
    if skin_allowed "$ID" && [ -n "$INSTALL_HASH" ] && [ -n "$UNLOCKED_AT" ] && [ "$PROOF" = "$(skin_proof "$ID" "$INSTALL_HASH" "$UNLOCKED_AT")" ]; then
      printf '%s\n' "$CANONICAL_RECORD" >> "$OUT_FILE"
    else
      INVALID_COUNT=$((INVALID_COUNT + 1))
    fi
  done < "$UNLOCK_FILE"
  if [ -n "$STORED_CHECKSUM" ] && [ "$STORED_CHECKSUM" != "$(records_checksum "$ALL_RECORDS_FILE")" ]; then
    INVALID_COUNT=$((INVALID_COUNT + 1))
    : > "$OUT_FILE" 2>/dev/null || true
  fi
  rm -f "$ALL_RECORDS_FILE" 2>/dev/null || true
  printf '%s\n' "$INVALID_COUNT" > "$INVALID_FILE" 2>/dev/null || true
}

write_records_json() {
  RECORDS_FILE="$1"
  TMP_FILE="$UNLOCK_FILE.tmp.$$"
  {
    CHECKSUM="$(records_checksum "$RECORDS_FILE")"
    printf '{\n'
    printf '  "version":1,\n'
    printf '  "records":[\n'
    FIRST=1
    while IFS= read -r LINE || [ -n "$LINE" ]; do
      [ -n "$LINE" ] || continue
      if [ "$FIRST" = "1" ]; then
        FIRST=0
      else
        printf ',\n'
      fi
      printf '    %s' "$LINE"
    done < "$RECORDS_FILE"
    printf '\n  ],\n'
    printf '  "checksum":"%s"\n' "$CHECKSUM"
    printf '}\n'
  } > "$TMP_FILE" 2>/dev/null || {
    rm -f "$TMP_FILE" 2>/dev/null || true
    fail "write-unlock-json"
  }
  mv -f "$TMP_FILE" "$UNLOCK_FILE" 2>/dev/null || {
    rm -f "$TMP_FILE" 2>/dev/null || true
    fail "replace-unlock-json"
  }
  chmod 0600 "$UNLOCK_FILE" 2>/dev/null || true
}

list_locked() {
  CURRENT_INSTALL_HASH="$(sanitize_token "$3")"
  if [ -z "$CURRENT_INSTALL_HASH" ]; then
    printf '{"ok":false,"error":"install-hash-required","skins":["default"],"invalid":0}\n'
    return 0
  fi

  VALID_FILE="$STATE_DIR/unlocked-skins.valid.$$"
  INVALID_FILE="$STATE_DIR/unlocked-skins.invalid.$$"
  NEXT_FILE=""
  trap 'rm -f "$VALID_FILE" "$INVALID_FILE" "$NEXT_FILE" 2>/dev/null || true; dex_release_lock 2>/dev/null || true' EXIT HUP INT TERM
  collect_valid_records "$VALID_FILE" "$INVALID_FILE" || fail "read-unlocks"
  SKINS='"default"'
  SEEN=' default '
  while IFS= read -r LINE || [ -n "$LINE" ]; do
    ID="$(record_field id "$LINE")"
    STORED_INSTALL_HASH="$(record_field installHash "$LINE")"
    [ "$STORED_INSTALL_HASH" != "$CURRENT_INSTALL_HASH" ] && continue
    case "$SEEN" in
      *" $ID "*) continue ;;
    esac
    SEEN="$SEEN$ID "
    SKINS="$SKINS,\"$ID\""
  done < "$VALID_FILE"
  INVALID_COUNT="$(cat "$INVALID_FILE" 2>/dev/null || printf '0')"
  rm -f "$VALID_FILE" "$INVALID_FILE" 2>/dev/null || true
  trap - EXIT HUP INT TERM
  printf '{"ok":true,"skins":[%s],"invalid":%s}\n' "$SKINS" "${INVALID_COUNT:-0}"
}

unlock_locked() {
  SKIN_ID="$3"
  INSTALL_HASH="$(sanitize_token "$4")"
  UNLOCKED_AT="$(sanitize_token "${5:-$(date '+%s' 2>/dev/null || printf 0)}")"
  skin_allowed "$SKIN_ID" || fail "invalid-skin"
  [ -n "$INSTALL_HASH" ] || fail "install-hash-required"
  [ -n "$UNLOCKED_AT" ] || UNLOCKED_AT="$(date '+%s' 2>/dev/null || printf 0)"

  VALID_FILE="$STATE_DIR/unlocked-skins.valid.$$"
  INVALID_FILE="$STATE_DIR/unlocked-skins.invalid.$$"
  NEXT_FILE="$STATE_DIR/unlocked-skins.next.$$"
  trap 'rm -f "$VALID_FILE" "$INVALID_FILE" "$NEXT_FILE" 2>/dev/null || true' EXIT HUP INT TERM
  collect_valid_records "$VALID_FILE" "$INVALID_FILE" || fail "read-unlocks"

  ALREADY=0
  : > "$NEXT_FILE" 2>/dev/null || fail "prepare-unlocks"
  while IFS= read -r LINE || [ -n "$LINE" ]; do
    ID="$(record_field id "$LINE")"
    STORED_INSTALL_HASH="$(record_field installHash "$LINE")"
    if [ "$ID" = "$SKIN_ID" ]; then
      if [ "$STORED_INSTALL_HASH" = "$INSTALL_HASH" ]; then
        ALREADY=1
        printf '%s\n' "$LINE" >> "$NEXT_FILE"
      fi
      continue
    fi
    printf '%s\n' "$LINE" >> "$NEXT_FILE"
  done < "$VALID_FILE"

  if [ "$ALREADY" != "1" ]; then
    PROOF="$(skin_proof "$SKIN_ID" "$INSTALL_HASH" "$UNLOCKED_AT")"
    printf '{"id":"%s","installHash":"%s","unlockedAt":"%s","proof":"%s"}\n' "$SKIN_ID" "$INSTALL_HASH" "$UNLOCKED_AT" "$PROOF" >> "$NEXT_FILE"
  fi

  write_records_json "$NEXT_FILE"
  rm -f "$VALID_FILE" "$INVALID_FILE" "$NEXT_FILE" 2>/dev/null || true
  if [ "$ALREADY" = "1" ]; then
    printf '{"ok":true,"status":"already","skinId":"%s"}\n' "$SKIN_ID"
  else
    printf '{"ok":true,"status":"unlocked","skinId":"%s"}\n' "$SKIN_ID"
  fi
}

unlock_many_locked() {
  INSTALL_HASH="$(sanitize_token "$3")"
  UNLOCKED_AT="$(sanitize_token "${4:-$(date '+%s' 2>/dev/null || printf 0)}")"
  [ -n "$INSTALL_HASH" ] || fail "install-hash-required"
  [ -n "$UNLOCKED_AT" ] || UNLOCKED_AT="$(date '+%s' 2>/dev/null || printf 0)"
  shift 4
  REQUESTED_SKINS=""
  for RAW_SKIN in "$@"; do
    SKIN_ID="$(sanitize_token "$RAW_SKIN")"
    skin_allowed "$SKIN_ID" || fail "invalid-skin"
    case " $REQUESTED_SKINS " in
      *" $SKIN_ID "*) ;;
      *) REQUESTED_SKINS="$REQUESTED_SKINS $SKIN_ID" ;;
    esac
  done
  [ -n "$REQUESTED_SKINS" ] || fail "skin-scope-required"

  VALID_FILE="$STATE_DIR/unlocked-skins.valid.$$"
  INVALID_FILE="$STATE_DIR/unlocked-skins.invalid.$$"
  NEXT_FILE="$STATE_DIR/unlocked-skins.next.$$"
  trap 'rm -f "$VALID_FILE" "$INVALID_FILE" "$NEXT_FILE" 2>/dev/null || true; dex_release_lock 2>/dev/null || true' EXIT HUP INT TERM
  collect_valid_records "$VALID_FILE" "$INVALID_FILE" || fail "read-unlocks"

  SEEN_SKINS=""
  ADDED=0
  ALREADY=0
  : > "$NEXT_FILE" 2>/dev/null || fail "prepare-unlocks"
  while IFS= read -r LINE || [ -n "$LINE" ]; do
    ID="$(record_field id "$LINE")"
    STORED_INSTALL_HASH="$(record_field installHash "$LINE")"
    if bundle_skin "$ID"; then
      if [ "$STORED_INSTALL_HASH" = "$INSTALL_HASH" ]; then
        case " $REQUESTED_SKINS " in
          *" $ID "*)
            case " $SEEN_SKINS " in
              *" $ID "*) ;;
              *) SEEN_SKINS="$SEEN_SKINS $ID" ;;
            esac
            ;;
        esac
        printf '%s\n' "$LINE" >> "$NEXT_FILE"
      fi
      continue
    fi
    printf '%s\n' "$LINE" >> "$NEXT_FILE"
  done < "$VALID_FILE"

  SKINS_JSON=""
  for SKIN_ID in $REQUESTED_SKINS; do
    [ -n "$SKINS_JSON" ] && SKINS_JSON="$SKINS_JSON,"
    SKINS_JSON="$SKINS_JSON\"$SKIN_ID\""
    case " $SEEN_SKINS " in
      *" $SKIN_ID "*)
      ALREADY=$((ALREADY + 1))
      continue
      ;;
    esac
    PROOF="$(skin_proof "$SKIN_ID" "$INSTALL_HASH" "$UNLOCKED_AT")"
    printf '{"id":"%s","installHash":"%s","unlockedAt":"%s","proof":"%s"}\n' "$SKIN_ID" "$INSTALL_HASH" "$UNLOCKED_AT" "$PROOF" >> "$NEXT_FILE"
    ADDED=$((ADDED + 1))
  done

  write_records_json "$NEXT_FILE"
  if [ "$ADDED" -eq 0 ] 2>/dev/null; then
    STATUS=already
  else
    STATUS=unlocked
  fi
  rm -f "$VALID_FILE" "$INVALID_FILE" "$NEXT_FILE" 2>/dev/null || true
  trap - EXIT HUP INT TERM
  printf '{"ok":true,"status":"%s","skins":[%s],"added":%s,"already":%s}\n' "$STATUS" "$SKINS_JSON" "${ADDED:-0}" "${ALREADY:-0}"
}

run_action_locked() {
  mkdir -p "$STATE_DIR" 2>/dev/null || fail "create-state-dir"
  case "$ACTION" in
    list) list_locked "$@" ;;
    unlock) unlock_locked "$@" ;;
    unlock-many) unlock_many_locked "$@" ;;
    *) fail "invalid-action" ;;
  esac
}

if command -v dex_with_lock >/dev/null 2>&1; then
  dex_with_lock "$CONFIG_LOCK_DIR" 20 run_action_locked "$@"
else
  run_action_locked "$@"
fi
