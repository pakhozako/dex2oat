#!/system/bin/sh

MODDIR="$1"
[ -n "$MODDIR" ] || MODDIR=${0%/*}/..

STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
STATE_FILE=${STATE_FILE:-$STATE_DIR/state.prop}
REPORT_FILE=${INTEGRITY_REPORT_FILE:-$STATE_DIR/integrity-report.txt}
BASELINE_FILE="$MODDIR/core/integrity-baseline.prop"
TMP_REPORT="$REPORT_FILE.tmp"
SOURCE_REPORT_TMP="$REPORT_FILE.source.tmp"

if [ -f "$MODDIR/core/state.sh" ]; then
  . "$MODDIR/core/state.sh"
fi

mkdir -p "$STATE_DIR" 2>/dev/null || true

normalize_module_prop() {
  awk '
    {
      sub(/\r$/, "")
      if ($0 ~ /^description=/) next
      lines[++count] = $0
    }
    END {
      while (count > 0 && lines[count] == "") count--
      for (idx = 1; idx <= count; idx++) print lines[idx]
    }
  ' "$1" 2>/dev/null
}

hash_file() {
  TARGET="$1"
  [ -s "$TARGET" ] || { printf 'missing'; return 0; }
  if command -v sha256sum >/dev/null 2>&1; then
    case "$TARGET" in
      */module.prop) normalize_module_prop "$TARGET" | sha256sum 2>/dev/null | awk '{print $1}' ;; 
      *) sha256sum "$TARGET" 2>/dev/null | awk '{print $1}' ;; 
    esac
  elif command -v md5sum >/dev/null 2>&1; then
    case "$TARGET" in
      */module.prop) normalize_module_prop "$TARGET" | md5sum 2>/dev/null | awk '{print $1}' ;; 
      *) md5sum "$TARGET" 2>/dev/null | awk '{print $1}' ;; 
    esac
  else
    wc -c < "$TARGET" 2>/dev/null | tr -d ' '
  fi
}

is_refresh_safe_missing_path() {
  case "$1" in
    core/integrity-baseline.prop)
      return 0
      ;;
    README.md|CHANGELOG.md|update.json|docs/*|tools/*|webroot/css/*|webroot/js/*)
      return 0
      ;;
    webroot/assets/*)
      [ -d "$MODDIR/webroot/assets" ] && return 0
      ;;
  esac
  return 1
}

is_refresh_safe_changed_path() {
  case "$1" in
    webroot/index.html|webroot/data/app-meta.json|webroot/assets/*)
      return 0
      ;;
  esac
  return 1
}

scan_baseline() {
  CHECKED_TOTAL=0
  MISSING_TOTAL=0
  BLOCKING_MISSING_TOTAL=0
  CHANGED_TOTAL=0
  BLOCKING_CHANGED_TOTAL=0
  : > "$SOURCE_REPORT_TMP" 2>/dev/null || return 1

  [ -s "$BASELINE_FILE" ] || return 0
  while IFS='=' read -r REL_PATH EXPECTED_HASH || [ -n "$REL_PATH" ]; do
    [ -n "$REL_PATH" ] || continue
    CHECKED_TOTAL=$((CHECKED_TOTAL + 1))
    TARGET_FILE="$MODDIR/$REL_PATH"
    if [ ! -f "$TARGET_FILE" ]; then
      MISSING_TOTAL=$((MISSING_TOTAL + 1))
      is_refresh_safe_missing_path "$REL_PATH" || BLOCKING_MISSING_TOTAL=$((BLOCKING_MISSING_TOTAL + 1))
      printf '%s missing expected=%s actual=missing\n' "$REL_PATH" "$EXPECTED_HASH" >> "$SOURCE_REPORT_TMP"
      continue
    fi
    ACTUAL_HASH="$(hash_file "$TARGET_FILE")"
    if [ "$EXPECTED_HASH" != "$ACTUAL_HASH" ]; then
      CHANGED_TOTAL=$((CHANGED_TOTAL + 1))
      is_refresh_safe_changed_path "$REL_PATH" || BLOCKING_CHANGED_TOTAL=$((BLOCKING_CHANGED_TOTAL + 1))
      printf '%s changed expected=%s actual=%s\n' "$REL_PATH" "$EXPECTED_HASH" "$ACTUAL_HASH" >> "$SOURCE_REPORT_TMP"
    fi
  done < "$BASELINE_FILE"
}

check_runtime_file() {
  LABEL="$1"
  TARGET="$2"
  KIND="$3"
  REQUIRED="${4:-required}"
  if [ ! -s "$TARGET" ]; then
    if [ "$REQUIRED" = "optional" ]; then
      printf '%s optional-missing path=%s\n' "$LABEL" "$TARGET" >> "$TMP_REPORT"
    else
      printf '%s missing path=%s\n' "$LABEL" "$TARGET" >> "$TMP_REPORT"
      RUNTIME_MISSING_TOTAL=$((RUNTIME_MISSING_TOTAL + 1))
    fi
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

STATUS=ok
REASON=passed
CHECKED_TOTAL=0
MISSING_TOTAL=0
BLOCKING_MISSING_TOTAL=0
CHANGED_TOTAL=0
BLOCKING_CHANGED_TOTAL=0
RUNTIME_MISSING_TOTAL=0
RUNTIME_WARNING_TOTAL=0
BASELINE_REFRESHED=no
BASELINE_REFRESH_MISSING_TOTAL=0

: > "$TMP_REPORT" 2>/dev/null || STATUS=error
{
  printf '[integrity]\n'
  printf 'checked_at=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  printf 'baseline=%s\n' "$([ -s "$BASELINE_FILE" ] && printf present || printf missing)"
  printf 'baseline_created=%s\n' "$BASELINE_CREATED"
  printf '[source]\n'
} > "$TMP_REPORT" 2>/dev/null || STATUS=error

if [ "$STATUS" != "error" ] && [ -s "$BASELINE_FILE" ]; then
  scan_baseline || STATUS=error
fi

cat "$SOURCE_REPORT_TMP" >> "$TMP_REPORT" 2>/dev/null || true
{
  printf '[baseline-refresh]\n'
  printf 'refreshed=%s\n' "$BASELINE_REFRESHED"
  printf 'missing_before_refresh=%s\n' "$BASELINE_REFRESH_MISSING_TOTAL"
  printf 'blocking_missing_total=%s\n' "$BLOCKING_MISSING_TOTAL"
  printf 'blocking_changed_total=%s\n' "$BLOCKING_CHANGED_TOTAL"
} >> "$TMP_REPORT" 2>/dev/null || true

{
  printf '[runtime]\n'
} >> "$TMP_REPORT" 2>/dev/null || STATUS=error
check_runtime_file system.prop "$MODDIR/system.prop" prop
check_runtime_file state.prop "$STATE_FILE" state optional
if [ -s "$STATE_DIR/config.json" ]; then
  check_runtime_file config.json "$STATE_DIR/config.json" json
else
  printf 'config.json optional-missing path=%s\n' "$STATE_DIR/config.json" >> "$TMP_REPORT"
fi

if [ "$STATUS" = "error" ]; then
  REASON=check-error
elif [ ! -s "$BASELINE_FILE" ]; then
  STATUS=error
  REASON=baseline-missing
elif [ "$BASELINE_REFRESHED" = "failed" ]; then
  STATUS=error
  REASON=baseline-refresh-failed
elif [ "$MISSING_TOTAL" -gt 0 ] 2>/dev/null; then
  STATUS=missing
  REASON=missing-files
elif [ "$RUNTIME_MISSING_TOTAL" -gt 0 ] 2>/dev/null; then
  STATUS=warning
  REASON=runtime-evidence-not-ready
elif [ "$CHANGED_TOTAL" -gt 0 ] 2>/dev/null; then
  STATUS=changed
  REASON=hash-mismatch
elif [ "$RUNTIME_WARNING_TOTAL" -gt 0 ] 2>/dev/null; then
  STATUS=warning
  REASON=runtime-structure-warning
elif [ "$BASELINE_REFRESHED" = "yes" ]; then
  STATUS=ok
  REASON=baseline-refreshed
elif [ "$BASELINE_CREATED" = "yes" ]; then
  STATUS=ok
  REASON=baseline-created
fi

{
  printf 'status=%s\n' "$STATUS"
  printf 'reason=%s\n' "$REASON"
  printf 'checked_total=%s\n' "$CHECKED_TOTAL"
  printf 'missing_total=%s\n' "$MISSING_TOTAL"
  printf 'blocking_missing_total=%s\n' "$BLOCKING_MISSING_TOTAL"
  printf 'changed_total=%s\n' "$CHANGED_TOTAL"
  printf 'blocking_changed_total=%s\n' "$BLOCKING_CHANGED_TOTAL"
  printf 'runtime_missing_total=%s\n' "$RUNTIME_MISSING_TOTAL"
  printf 'runtime_warning_total=%s\n' "$RUNTIME_WARNING_TOTAL"
  printf 'baseline_created=%s\n' "$BASELINE_CREATED"
  printf 'baseline_refreshed=%s\n' "$BASELINE_REFRESHED"
  printf 'baseline_refresh_missing_total=%s\n' "$BASELINE_REFRESH_MISSING_TOTAL"
  cat "$TMP_REPORT" 2>/dev/null
} > "$REPORT_FILE" 2>/dev/null || true
rm -f "$TMP_REPORT" "$SOURCE_REPORT_TMP" 2>/dev/null || true
chmod 0600 "$REPORT_FILE" 2>/dev/null || true

if command -v state_update >/dev/null 2>&1; then
  state_update \
    "integrity.status=$STATUS" \
    "integrity.reason=$REASON" \
    "integrity.checked_total=$CHECKED_TOTAL" \
    "integrity.missing_total=$MISSING_TOTAL" \
    "integrity.blocking_missing_total=$BLOCKING_MISSING_TOTAL" \
    "integrity.changed_total=$CHANGED_TOTAL" \
    "integrity.blocking_changed_total=$BLOCKING_CHANGED_TOTAL" \
    "integrity.runtime_missing_total=$RUNTIME_MISSING_TOTAL" \
    "integrity.runtime_warning_total=$RUNTIME_WARNING_TOTAL" \
    "integrity.baseline_created=$BASELINE_CREATED" \
    "integrity.baseline_refreshed=$BASELINE_REFRESHED" \
    "integrity.baseline_refresh_missing_total=$BASELINE_REFRESH_MISSING_TOTAL" \
    "integrity.report=$REPORT_FILE" \
    "integrity.checked_at=$(date '+%Y-%m-%d %H:%M:%S')" || true
  state_recompute_summary || true
fi

exit 0
