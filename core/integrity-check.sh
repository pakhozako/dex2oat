#!/system/bin/sh

MODDIR="$1"
[ -n "$MODDIR" ] || MODDIR=${0%/*}/..

STATE_DIR=/data/adb/dex2oat-lock
STATE_FILE="$STATE_DIR/state.prop"
REPORT_FILE="$STATE_DIR/integrity-report.txt"
BASELINE_FILE="$MODDIR/core/integrity-baseline.prop"
TMP_REPORT="$REPORT_FILE.tmp"

if [ -f "$MODDIR/core/state.sh" ]; then
  . "$MODDIR/core/state.sh"
fi

mkdir -p "$STATE_DIR" 2>/dev/null || true

hash_file() {
  TARGET="$1"
  [ -s "$TARGET" ] || { printf 'missing'; return 0; }
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$TARGET" 2>/dev/null | awk '{print $1}'
  elif command -v md5sum >/dev/null 2>&1; then
    md5sum "$TARGET" 2>/dev/null | awk '{print $1}'
  else
    wc -c < "$TARGET" 2>/dev/null | tr -d ' '
  fi
}

write_baseline() {
  : > "$BASELINE_FILE" 2>/dev/null || return 1
  for REL_PATH in \
    customize.sh service.sh uninstall.sh system.prop module.prop \
    core/state.sh core/health-check.sh core/conflict-detect.sh core/prop-lock.sh core/integrity-check.sh \
    scripts/capture-props.sh scripts/generate-props.sh \
    webroot/index.html webroot/css/app.css webroot/js/app.js webroot/js/config.js webroot/js/bridge.js webroot/js/ui.js webroot/js/utils.js webroot/js/system-info.js \
    webroot/data/options.json webroot/data/app-meta.json; do
    [ -f "$MODDIR/$REL_PATH" ] || continue
    printf '%s=%s\n' "$REL_PATH" "$(hash_file "$MODDIR/$REL_PATH")" >> "$BASELINE_FILE"
  done
  chmod 0644 "$BASELINE_FILE" 2>/dev/null || true
}

[ -s "$BASELINE_FILE" ] || write_baseline || true

STATUS=ok
REASON=passed
CHECKED_TOTAL=0
MISSING_TOTAL=0
CHANGED_TOTAL=0

{
  printf '[integrity]\n'
  printf 'checked_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  while IFS='=' read -r REL_PATH EXPECTED_HASH || [ -n "$REL_PATH" ]; do
    [ -n "$REL_PATH" ] || continue
    CHECKED_TOTAL=$((CHECKED_TOTAL + 1))
    TARGET_FILE="$MODDIR/$REL_PATH"
    if [ ! -f "$TARGET_FILE" ]; then
      STATUS=error
      REASON=missing-files
      MISSING_TOTAL=$((MISSING_TOTAL + 1))
      printf '%s missing expected=%s actual=missing\n' "$REL_PATH" "$EXPECTED_HASH"
      continue
    fi
    ACTUAL_HASH="$(hash_file "$TARGET_FILE")"
    if [ "$EXPECTED_HASH" != "$ACTUAL_HASH" ]; then
      STATUS=error
      REASON=hash-mismatch
      CHANGED_TOTAL=$((CHANGED_TOTAL + 1))
      printf '%s changed expected=%s actual=%s\n' "$REL_PATH" "$EXPECTED_HASH" "$ACTUAL_HASH"
    fi
  done < "$BASELINE_FILE"
} > "$TMP_REPORT" 2>/dev/null || STATUS=error

{
  printf 'status=%s\n' "$STATUS"
  printf 'reason=%s\n' "$REASON"
  printf 'checked_total=%s\n' "$CHECKED_TOTAL"
  printf 'missing_total=%s\n' "$MISSING_TOTAL"
  printf 'changed_total=%s\n' "$CHANGED_TOTAL"
  cat "$TMP_REPORT" 2>/dev/null
} > "$REPORT_FILE" 2>/dev/null || true
rm -f "$TMP_REPORT" 2>/dev/null || true
chmod 0600 "$REPORT_FILE" 2>/dev/null || true

if command -v state_update >/dev/null 2>&1; then
  state_update \
    "integrity.status=$STATUS" \
    "integrity.reason=$REASON" \
    "integrity.checked_total=$CHECKED_TOTAL" \
    "integrity.missing_total=$MISSING_TOTAL" \
    "integrity.changed_total=$CHANGED_TOTAL" \
    "integrity.checked_at=$(date '+%Y-%m-%d %H:%M:%S')" || true
  state_recompute_summary || true
fi

exit 0
