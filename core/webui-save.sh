#!/system/bin/sh

MODDIR="$1"
STAGE_DIR="$2"
[ -n "$MODDIR" ] || MODDIR=${0%/*}/..

STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
STATE_FILE="$STATE_DIR/state.prop"
LOCK_DIR="$STATE_DIR/.webui-save.lock"
CONFIG_LOCK_DIR="$STATE_DIR/.config.lock"
PROP_FILE="$MODDIR/system.prop"
CONFIG_FILE="$STATE_DIR/config.json"
CONFIG_SOURCE_FILE="$STATE_DIR/config-source.prop"
PROP_LOCK_LIST="$STATE_DIR/prop-lock.list"
SYSTEM_PROP_BAK="$STATE_DIR/system.prop.bak"
RUNTIME_PROP_FILE="$STATE_DIR/runtime-props.tmp"
RUNTIME_PROP_HASH_FILE="$STATE_DIR/runtime-props.hash"

[ -f "$MODDIR/core/common.sh" ] && . "$MODDIR/core/common.sh"
[ -f "$MODDIR/core/state.sh" ] && . "$MODDIR/core/state.sh"

fail() {
  printf 'error=%s\n' "$1" >&2
  exit 1
}

validate_stage() {
  case "$STAGE_DIR" in
    "$STATE_DIR"/stage-*) ;;
    *) fail "invalid-stage-path" ;;
  esac
  [ -s "$STAGE_DIR/system.prop" ] || fail "missing-staged-system-prop"
  [ -s "$STAGE_DIR/config.json" ] || fail "missing-staged-config"
  [ -s "$STAGE_DIR/prop-lock.list" ] || fail "missing-staged-prop-lock"
  if ! grep -q -E '^[A-Za-z0-9_.-]+=' "$STAGE_DIR/system.prop" 2>/dev/null; then
    grep -q -E '^# [A-Za-z0-9_.-]+=' "$STAGE_DIR/system.prop" 2>/dev/null \
      || grep -q '^# Dex2oat Lock generated system.prop' "$STAGE_DIR/system.prop" 2>/dev/null \
      || fail "invalid-system-prop"
  fi
  grep -q '[{}]' "$STAGE_DIR/config.json" 2>/dev/null || fail "invalid-config-json"
  grep -q '"items"[[:space:]]*:' "$STAGE_DIR/config.json" 2>/dev/null || fail "invalid-config-items"
  grep -q -E '"riskMode"[[:space:]]*:[[:space:]]*"(safe|caution|aggressive)"' "$STAGE_DIR/config.json" 2>/dev/null || fail "invalid-config-risk-mode"
}

apply_stage_locked() {
  mkdir -p "$STATE_DIR/backup" 2>/dev/null || fail "create-backup-dir"
  validate_stage

  ROLLBACK_DIR="$STATE_DIR/rollback.$$"
  mkdir -p "$ROLLBACK_DIR" 2>/dev/null || fail "create-rollback-dir"
  [ -f "$PROP_FILE" ] && cp -af "$PROP_FILE" "$ROLLBACK_DIR/system.prop" 2>/dev/null || true
  [ -f "$SYSTEM_PROP_BAK" ] && cp -af "$SYSTEM_PROP_BAK" "$ROLLBACK_DIR/system.prop.bak" 2>/dev/null || true
  [ -f "$PROP_LOCK_LIST" ] && cp -af "$PROP_LOCK_LIST" "$ROLLBACK_DIR/prop-lock.list" 2>/dev/null || true
  [ -f "$CONFIG_FILE" ] && cp -af "$CONFIG_FILE" "$ROLLBACK_DIR/config.json" 2>/dev/null || true
  [ -f "$CONFIG_SOURCE_FILE" ] && cp -af "$CONFIG_SOURCE_FILE" "$ROLLBACK_DIR/config-source.prop" 2>/dev/null || true

  rollback_stage() {
    [ -f "$ROLLBACK_DIR/system.prop" ] && cp -af "$ROLLBACK_DIR/system.prop" "$PROP_FILE" 2>/dev/null || true
    [ -f "$ROLLBACK_DIR/system.prop.bak" ] && cp -af "$ROLLBACK_DIR/system.prop.bak" "$SYSTEM_PROP_BAK" 2>/dev/null || true
    [ -f "$ROLLBACK_DIR/prop-lock.list" ] && cp -af "$ROLLBACK_DIR/prop-lock.list" "$PROP_LOCK_LIST" 2>/dev/null || true
    [ -f "$ROLLBACK_DIR/config.json" ] && cp -af "$ROLLBACK_DIR/config.json" "$CONFIG_FILE" 2>/dev/null || true
    [ -f "$ROLLBACK_DIR/config-source.prop" ] && cp -af "$ROLLBACK_DIR/config-source.prop" "$CONFIG_SOURCE_FILE" 2>/dev/null || true
  }

  cleanup_stage() {
    for WORK_DIR in "$ROLLBACK_DIR" "$STAGE_DIR"; do
      case "$WORK_DIR" in
        "$STATE_DIR"/rollback.*|"$STATE_DIR"/stage-*)
          rm -rf "$WORK_DIR" 2>/dev/null || true
          ;;
      esac
    done
  }

  replace_file() {
    SRC_FILE="$1"
    DST_FILE="$2"
    LABEL="$3"
    TMP_FILE="$DST_FILE.tmp.$$"
    cp -af "$SRC_FILE" "$TMP_FILE" 2>/dev/null || {
      rm -f "$TMP_FILE" 2>/dev/null || true
      rollback_stage
      cleanup_stage
      fail "$LABEL"
    }
    sync "$TMP_FILE" 2>/dev/null || sync 2>/dev/null || true
    mv -f "$TMP_FILE" "$DST_FILE" 2>/dev/null || {
      rm -f "$TMP_FILE" 2>/dev/null || true
      rollback_stage
      cleanup_stage
      fail "$LABEL"
    }
  }

  replace_file "$STAGE_DIR/system.prop" "$PROP_FILE" replace-system-prop
  replace_file "$STAGE_DIR/system.prop" "$SYSTEM_PROP_BAK" replace-system-prop-backup
  replace_file "$STAGE_DIR/prop-lock.list" "$PROP_LOCK_LIST" replace-prop-lock
  replace_file "$STAGE_DIR/config.json" "$CONFIG_FILE" replace-config
  replace_file "$STAGE_DIR/config-source.prop" "$CONFIG_SOURCE_FILE" replace-config-source

  rm -f "$RUNTIME_PROP_FILE" "$RUNTIME_PROP_HASH_FILE" 2>/dev/null || true
  chmod 0644 "$PROP_FILE" 2>/dev/null || true
  chmod 0600 "$SYSTEM_PROP_BAK" "$PROP_LOCK_LIST" "$CONFIG_FILE" "$CONFIG_SOURCE_FILE" 2>/dev/null || true

  PROP_COUNT="$(grep -E '^[A-Za-z0-9_.-]+=' "$PROP_FILE" 2>/dev/null | wc -l | tr -d ' ')"
  PROP_HASH="$(dex_hash_file "$PROP_FILE" 2>/dev/null)"
  if command -v state_update >/dev/null 2>&1; then
    RISK_MODE_FROM_CFG="$(grep -oE '"riskMode"[[:space:]]*:[[:space:]]*"[a-z]+"' "$STAGE_DIR/config.json" 2>/dev/null \
      | sed 's/.*"\([a-z]*\)"[[:space:]]*$/\1/' | head -n 1)"
    case "$RISK_MODE_FROM_CFG" in
      safe|caution|aggressive) ;;
      *) RISK_MODE_FROM_CFG="safe" ;;
    esac
    state_update \
      "config.status=ok" \
      "config.source=webui-custom" \
      "config.reason=manual-save" \
      "config.generated=yes" \
      "config.prop_count=${PROP_COUNT:-0}" \
      "config.prop_hash=$PROP_HASH" \
      "config.updated_at=$(dex_now)" \
      "apply.status=pending" \
      "apply.last_status=pending" \
      "apply.reason=waiting-for-reboot-or-service" \
      "apply.last_reason=waiting-for-reboot-or-service" \
      "apply.last_updated_at=$(dex_now)" \
      "risk.mode=$RISK_MODE_FROM_CFG" || true
    state_recompute_summary || true
  fi
  cleanup_stage
}

apply_stage() {
  if command -v dex_with_lock >/dev/null 2>&1; then
    dex_with_lock "$CONFIG_LOCK_DIR" 20 apply_stage_locked
  else
    apply_stage_locked
  fi
}

mkdir -p "$STATE_DIR" 2>/dev/null || fail "create-state-dir"
if command -v dex_with_lock >/dev/null 2>&1; then
  dex_with_lock "$LOCK_DIR" 20 apply_stage
else
  apply_stage
fi
