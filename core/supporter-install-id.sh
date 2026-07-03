#!/system/bin/sh

MODDIR="$1"
[ -n "$MODDIR" ] || MODDIR=${0%/*}/..
# Optional: preferred ID passed by the caller (e.g. a pre-existing
# localStorage-based telemetry ID from a previous module version).
# Used ONLY when no supporter-install-id file exists yet, to preserve
# redemption-code bindings that were established before this script
# was introduced.
PREFERRED_ID="$2"
STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
CONFIG_LOCK_DIR="$STATE_DIR/.config.lock"
INSTALL_ID_FILE="$STATE_DIR/supporter-install-id"

[ -f "$MODDIR/core/common.sh" ] && . "$MODDIR/core/common.sh"

fail_json() {
  printf '{"ok":false,"error":"%s","installId":""}\n' "$1"
  exit 1
}

sanitize_install_id() {
  printf '%s' "$1" | tr -cd 'A-Fa-f0-9-' | cut -c 1-96
}

install_id_valid() {
  VALUE="$(sanitize_install_id "$1")"
  VALUE_LEN=${#VALUE}
  [ "$VALUE_LEN" -ge 8 ] 2>/dev/null && [ "$VALUE_LEN" -le 96 ] 2>/dev/null
}

generate_install_id() {
  if [ -r /proc/sys/kernel/random/uuid ]; then
    sanitize_install_id "$(cat /proc/sys/kernel/random/uuid 2>/dev/null)"
    return
  fi
  if command -v od >/dev/null 2>&1; then
    od -An -N16 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n'
    return
  fi
  if command -v date >/dev/null 2>&1; then
    printf '%s%s' "$(date '+%s' 2>/dev/null)" "$$" | cksum 2>/dev/null | awk '{print $1}'
    return
  fi
  printf '%s\n' "$$"
}

run_locked() {
  mkdir -p "$STATE_DIR" 2>/dev/null || fail_json "create-state-dir"
  INSTALL_ID=""
  if [ -r "$INSTALL_ID_FILE" ]; then
    INSTALL_ID="$(sanitize_install_id "$(cat "$INSTALL_ID_FILE" 2>/dev/null)")"
  fi
  if ! install_id_valid "$INSTALL_ID"; then
    # If a valid preferred ID was passed by the caller (v4.5 migration:
    # localStorage telemetry ID), adopt it rather than generating a new
    # random UUID. This preserves existing server-side code bindings.
    CANDIDATE="$(sanitize_install_id "$PREFERRED_ID")"
    if install_id_valid "$CANDIDATE"; then
      INSTALL_ID="$CANDIDATE"
    else
      INSTALL_ID="$(sanitize_install_id "$(generate_install_id)")"
      install_id_valid "$INSTALL_ID" || fail_json "generate-install-id"
    fi
    TMP_FILE="$INSTALL_ID_FILE.tmp.$$"
    printf '%s\n' "$INSTALL_ID" > "$TMP_FILE" 2>/dev/null || fail_json "write-install-id"
    mv -f "$TMP_FILE" "$INSTALL_ID_FILE" 2>/dev/null || {
      rm -f "$TMP_FILE" 2>/dev/null || true
      fail_json "replace-install-id"
    }
    chmod 0600 "$INSTALL_ID_FILE" 2>/dev/null || true
  fi
  printf '{"ok":true,"installId":"%s"}\n' "$INSTALL_ID"
}

if command -v dex_with_lock >/dev/null 2>&1; then
  dex_with_lock "$CONFIG_LOCK_DIR" 20 run_locked
else
  run_locked
fi
