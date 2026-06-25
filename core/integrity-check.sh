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

baseline_files() {
  for REL_PATH in \
    customize.sh service.sh uninstall.sh system.prop module.prop update.json README.md CHANGELOG.md \
    core/state.sh core/health-check.sh core/conflict-detect.sh core/prop-lock.sh core/integrity-check.sh \
    scripts/capture-props.sh scripts/generate-props.sh \
    webroot/index.html webroot/css/app.css webroot/js/app.js webroot/js/config.js webroot/js/bridge.js webroot/js/ui.js webroot/js/utils.js webroot/js/system-info.js \
    webroot/data/options.json webroot/data/app-meta.json; do
    [ -f "$MODDIR/$REL_PATH" ] && printf '%s\n' "$REL_PATH"
  done
  if [ -d "$MODDIR/webroot/assets" ]; then
    find "$MODDIR/webroot/assets" -type f 2>/dev/null | sort | while IFS= read -r ASSET_PATH; do
      case "$ASSET_PATH" in
        *.mjs|*.js|*.css|*.json) printf '%s\n' "${ASSET_PATH#$MODDIR/}" ;;
      esac
    done
  fi
}

write_baseline() {
  : > "$BASELINE_FILE" 2>/dev/null || return 1
  baseline_files | while IFS= read -r REL_PATH; do
    printf '%s=%s\n' "$REL_PATH" "$(hash_file "$MODDIR/$REL_PATH")" >> "$BASELINE_FILE" || exit 1
  done
  chmod 0644 "$BASELINE_FILE" 2>/dev/null || true
}

check_runtime_file() {
  LABEL="$1"
  TARGET="$2"
  KIND="$3"
  if [ ! -s "$TARGET" ]; then
    printf '%s missing path=%s\n' "$LABEL" "$TARGET" >> "$TMP_REPORT"
    RUNTIME_MISSING_TOTAL=$((RUNTIME_MISSING_TOTAL + 1))
    return 0
  fi

  case "$KIND" in
    prop)
      if grep -q -E '^[A-Za-z0-9_.-]+=' "$TARGET" 2>/dev/null; then
        printf '%s ok path=%s\n' "$LABEL" "$TARGET" >> "$TMP_REPORT"
      else
        printf '%s invalid-prop path=%s\n' "$LABEL" "$TARGET" >> "$TMP_REPORT"
        RUNTIME_WARNING_TOTAL=$((RUNTIME_WARNING_TOTAL + 1))
      fi
      ;;
    state)
      if grep -q '^summary\.status=' "$TARGET" 2>/dev/null || grep -q '^schema_version=' "$TARGET" 2>/dev/null; then
        printf '%s ok path=%s\n' "$LABEL" "$TARGET" >> "$TMP_REPORT"
      else
        printf '%s invalid-state path=%s\n' "$LABEL" "$TARGET" >> "$TMP_REPORT"
        RUNTIME_WARNING_TOTAL=$((RUNTIME_WARNING_TOTAL + 1))
      fi
      ;;
    json)
      if grep -q '[{}]' "$TARGET" 2>/dev/null; then
        printf '%s ok path=%s\n' "$LABEL" "$TARGET" >> "$TMP_REPORT"
      else
        printf '%s invalid-json path=%s\n' "$LABEL" "$TARGET" >> "$TMP_REPORT"
        RUNTIME_WARNING_TOTAL=$((RUNTIME_WARNING_TOTAL + 1))
      fi
      ;;
  esac
}

BASELINE_CREATED=no
if [ ! -s "$BASELINE_FILE" ]; then
  if write_baseline; then
    BASELINE_CREATED=yes
  else
    BASELINE_CREATED=failed
  fi
fi

STATUS=ok
REASON=passed
CHECKED_TOTAL=0
MISSING_TOTAL=0
CHANGED_TOTAL=0
RUNTIME_MISSING_TOTAL=0
RUNTIME_WARNING_TOTAL=0

: > "$TMP_REPORT" 2>/dev/null || STATUS=error
{
  printf '[integrity]\n'
  printf 'checked_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  printf 'baseline=%s\n' "$([ -s "$BASELINE_FILE" ] && printf present || printf missing)"
  printf 'baseline_created=%s\n' "$BASELINE_CREATED"
  printf '[source]\n'
} > "$TMP_REPORT" 2>/dev/null || STATUS=error

if [ "$STATUS" != "error" ] && [ -s "$BASELINE_FILE" ]; then
  while IFS='=' read -r REL_PATH EXPECTED_HASH || [ -n "$REL_PATH" ]; do
    [ -n "$REL_PATH" ] || continue
    CHECKED_TOTAL=$((CHECKED_TOTAL + 1))
    TARGET_FILE="$MODDIR/$REL_PATH"
    if [ ! -f "$TARGET_FILE" ]; then
      MISSING_TOTAL=$((MISSING_TOTAL + 1))
      printf '%s missing expected=%s actual=missing\n' "$REL_PATH" "$EXPECTED_HASH" >> "$TMP_REPORT"
      continue
    fi
    ACTUAL_HASH="$(hash_file "$TARGET_FILE")"
    if [ "$EXPECTED_HASH" != "$ACTUAL_HASH" ]; then
      CHANGED_TOTAL=$((CHANGED_TOTAL + 1))
      printf '%s changed expected=%s actual=%s\n' "$REL_PATH" "$EXPECTED_HASH" "$ACTUAL_HASH" >> "$TMP_REPORT"
    fi
  done < "$BASELINE_FILE"
fi

{
  printf '[runtime]\n'
} >> "$TMP_REPORT" 2>/dev/null || STATUS=error
check_runtime_file system.prop "$MODDIR/system.prop" prop
check_runtime_file state.prop "$STATE_FILE" state
check_runtime_file config.json "$STATE_DIR/config.json" json

if [ "$STATUS" = "error" ]; then
  REASON=check-error
elif [ "$BASELINE_CREATED" = "failed" ]; then
  STATUS=error
  REASON=baseline-create-failed
elif [ "$MISSING_TOTAL" -gt 0 ] 2>/dev/null || [ "$RUNTIME_MISSING_TOTAL" -gt 0 ] 2>/dev/null; then
  STATUS=missing
  REASON=missing-files
elif [ "$CHANGED_TOTAL" -gt 0 ] 2>/dev/null; then
  STATUS=changed
  REASON=hash-mismatch
elif [ "$BASELINE_CREATED" = "yes" ] || [ "$RUNTIME_WARNING_TOTAL" -gt 0 ] 2>/dev/null; then
  STATUS=warning
  REASON=runtime-structure-warning
fi

{
  printf 'status=%s\n' "$STATUS"
  printf 'reason=%s\n' "$REASON"
  printf 'checked_total=%s\n' "$CHECKED_TOTAL"
  printf 'missing_total=%s\n' "$MISSING_TOTAL"
  printf 'changed_total=%s\n' "$CHANGED_TOTAL"
  printf 'runtime_missing_total=%s\n' "$RUNTIME_MISSING_TOTAL"
  printf 'runtime_warning_total=%s\n' "$RUNTIME_WARNING_TOTAL"
  printf 'baseline_created=%s\n' "$BASELINE_CREATED"
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
    "integrity.runtime_missing_total=$RUNTIME_MISSING_TOTAL" \
    "integrity.runtime_warning_total=$RUNTIME_WARNING_TOTAL" \
    "integrity.baseline_created=$BASELINE_CREATED" \
    "integrity.report=$REPORT_FILE" \
    "integrity.checked_at=$(date '+%Y-%m-%d %H:%M:%S')" || true
  state_recompute_summary || true
fi

exit 0
