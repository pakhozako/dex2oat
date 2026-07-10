#!/system/bin/sh

MODDIR="$1"
[ -n "$MODDIR" ] || MODDIR=${0%/*}/..
STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
STATE_FILE=${STATE_FILE:-$STATE_DIR/state.prop}
REPORT_FILE=${INTEGRITY_REPORT_FILE:-$STATE_DIR/integrity-report.txt}
BASELINE_FILE="$MODDIR/core/integrity-baseline.prop"
TMP_REPORT="$REPORT_FILE.tmp.$$"
SOURCE_REPORT_TMP="$REPORT_FILE.source.tmp.$$"
trap 'rm -f "$TMP_REPORT" "$SOURCE_REPORT_TMP" 2>/dev/null || true' EXIT HUP INT TERM
[ -f "$MODDIR/core/state.sh" ] && . "$MODDIR/core/state.sh"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 1
[ ! -L "$STATE_DIR" ] && [ ! -L "$REPORT_FILE" ] || exit 1

scan_baseline() {
  CHECKED_TOTAL=0; MISSING_TOTAL=0; BLOCKING_MISSING_TOTAL=0; CHANGED_TOTAL=0; BLOCKING_CHANGED_TOTAL=0; HASH_UNSUPPORTED_TOTAL=0
  : > "$SOURCE_REPORT_TMP" || return 1
  BASELINE_VERSION="$(sed -n 's/^meta.baseline_version=//p' "$BASELINE_FILE" | head -n 1)"
  BASELINE_FORMAT="$(sed -n 's/^meta.format=//p' "$BASELINE_FILE" | head -n 1)"
  [ "$BASELINE_VERSION" = 1 ] && [ "$BASELINE_FORMAT" = 'path|sha256|critical' ] || return 1
  while IFS='|' read -r REL_PATH EXPECTED_HASH CRITICAL_FLAG || [ -n "$REL_PATH" ]; do
    case "$REL_PATH" in ''|\#*|meta.*) continue ;; esac
    [ "$CRITICAL_FLAG" = critical ] || [ "$CRITICAL_FLAG" = mutable ] || return 1
    case "$REL_PATH" in /*|*..*|*'\'*) return 1 ;; esac
    CHECKED_TOTAL=$((CHECKED_TOTAL + 1)); TARGET_FILE="$MODDIR/$REL_PATH"
    if [ ! -f "$TARGET_FILE" ] || [ -L "$TARGET_FILE" ]; then
      MISSING_TOTAL=$((MISSING_TOTAL + 1)); [ "$CRITICAL_FLAG" = critical ] && BLOCKING_MISSING_TOTAL=$((BLOCKING_MISSING_TOTAL + 1))
      printf '%s missing expected=%s policy=%s\n' "$REL_PATH" "$EXPECTED_HASH" "$CRITICAL_FLAG" >> "$SOURCE_REPORT_TMP"
      continue
    fi
    case "$REL_PATH" in
      module.prop) ACTUAL_HASH="$(dex_hash_file "$TARGET_FILE" module-prop require-sha256)" ;;
      *) ACTUAL_HASH="$(dex_hash_file "$TARGET_FILE" file require-sha256)" ;;
    esac
    if [ "$ACTUAL_HASH" = unsupported ] || [ -z "$ACTUAL_HASH" ]; then HASH_UNSUPPORTED_TOTAL=$((HASH_UNSUPPORTED_TOTAL + 1)); continue; fi
    if [ "$EXPECTED_HASH" != "$ACTUAL_HASH" ]; then
      CHANGED_TOTAL=$((CHANGED_TOTAL + 1)); [ "$CRITICAL_FLAG" = critical ] && BLOCKING_CHANGED_TOTAL=$((BLOCKING_CHANGED_TOTAL + 1))
      printf '%s changed expected=%s actual=%s policy=%s\n' "$REL_PATH" "$EXPECTED_HASH" "$ACTUAL_HASH" "$CRITICAL_FLAG" >> "$SOURCE_REPORT_TMP"
    fi
  done < "$BASELINE_FILE"
  [ "$CHECKED_TOTAL" -gt 0 ]
}

check_runtime_file() {
  LABEL="$1"; TARGET="$2"; KIND="$3"; REQUIRED=${4:-required}
  if [ ! -s "$TARGET" ] || [ -L "$TARGET" ]; then
    [ "$REQUIRED" = optional ] || RUNTIME_MISSING_TOTAL=$((RUNTIME_MISSING_TOTAL + 1))
    printf '%s missing path=%s\n' "$LABEL" "$TARGET" >> "$TMP_REPORT"; return
  fi
  case "$KIND" in
    prop) grep -q -E '^[A-Za-z0-9_.-]+=' "$TARGET" 2>/dev/null || RUNTIME_WARNING_TOTAL=$((RUNTIME_WARNING_TOTAL + 1)) ;;
    state) state_schema_file_valid "$TARGET" 2>/dev/null || RUNTIME_WARNING_TOTAL=$((RUNTIME_WARNING_TOTAL + 1)) ;;
    tsv) grep -q -E '^[^#].*\t' "$TARGET" 2>/dev/null || RUNTIME_WARNING_TOTAL=$((RUNTIME_WARNING_TOTAL + 1)) ;;
  esac
}

STATUS=ok; REASON=passed; CHECKED_TOTAL=0; MISSING_TOTAL=0; BLOCKING_MISSING_TOTAL=0; CHANGED_TOTAL=0; BLOCKING_CHANGED_TOTAL=0; HASH_UNSUPPORTED_TOTAL=0; RUNTIME_MISSING_TOTAL=0; RUNTIME_WARNING_TOTAL=0
: > "$TMP_REPORT" || STATUS=error
[ -s "$BASELINE_FILE" ] && [ ! -L "$BASELINE_FILE" ] || { STATUS=error; REASON=baseline-missing; }
[ "$STATUS" = error ] || scan_baseline || { STATUS=error; REASON=baseline-invalid; }
cat "$SOURCE_REPORT_TMP" >> "$TMP_REPORT" 2>/dev/null || true
check_runtime_file system.prop "$MODDIR/system.prop" prop
check_runtime_file state.prop "$STATE_FILE" state optional
check_runtime_file rule-props.tsv "$STATE_DIR/rule-props.tsv" tsv optional
if [ "$STATUS" != error ]; then
  if [ "$HASH_UNSUPPORTED_TOTAL" -gt 0 ]; then STATUS=error; REASON=hash-tool-unavailable
  elif [ "$BLOCKING_MISSING_TOTAL" -gt 0 ]; then STATUS=missing; REASON=missing-files
  elif [ "$BLOCKING_CHANGED_TOTAL" -gt 0 ]; then STATUS=changed; REASON=hash-mismatch
  elif [ "$RUNTIME_MISSING_TOTAL" -gt 0 ]; then REASON=runtime-evidence-not-ready
  elif [ "$RUNTIME_WARNING_TOTAL" -gt 0 ]; then REASON=runtime-structure-warning
  fi
fi
{
  printf 'status=%s\nreason=%s\nbaseline_version=%s\nchecked_total=%s\nmissing_total=%s\nblocking_missing_total=%s\nchanged_total=%s\nblocking_changed_total=%s\nhash_unsupported_total=%s\nruntime_missing_total=%s\nruntime_warning_total=%s\n' "$STATUS" "$REASON" "${BASELINE_VERSION:-unknown}" "$CHECKED_TOTAL" "$MISSING_TOTAL" "$BLOCKING_MISSING_TOTAL" "$CHANGED_TOTAL" "$BLOCKING_CHANGED_TOTAL" "$HASH_UNSUPPORTED_TOTAL" "$RUNTIME_MISSING_TOTAL" "$RUNTIME_WARNING_TOTAL"
  cat "$TMP_REPORT"
} > "$REPORT_FILE" || exit 1
chmod 0600 "$REPORT_FILE" 2>/dev/null || exit 1
rm -f "$TMP_REPORT" "$SOURCE_REPORT_TMP"; trap - EXIT HUP INT TERM
state_update "integrity.status=$STATUS" "integrity.reason=$REASON" "integrity.checked_total=$CHECKED_TOTAL" "integrity.missing_total=$MISSING_TOTAL" "integrity.blocking_missing_total=$BLOCKING_MISSING_TOTAL" "integrity.changed_total=$CHANGED_TOTAL" "integrity.blocking_changed_total=$BLOCKING_CHANGED_TOTAL" "integrity.hash_unsupported_total=$HASH_UNSUPPORTED_TOTAL" "integrity.runtime_missing_total=$RUNTIME_MISSING_TOTAL" "integrity.runtime_warning_total=$RUNTIME_WARNING_TOTAL" "integrity.baseline_version=${BASELINE_VERSION:-unknown}" "integrity.baseline_refresh_supported=no" "integrity.report=$REPORT_FILE" "integrity.checked_at=$(date '+%Y-%m-%d %H:%M:%S')" || exit 1
state_recompute_summary || true
[ "$STATUS" = ok ]
