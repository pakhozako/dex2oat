#!/usr/bin/env sh
set -eu

ROOT="$1"
TMP_ROOT="${TMPDIR:-/tmp}/dex2oat-install-check-grade-test.$$"
STATE_DIR="$TMP_ROOT/state"
OUTPUT_FILE="$TMP_ROOT/output.txt"
trap 'rm -rf "$TMP_ROOT"' EXIT HUP INT TERM
mkdir -p "$STATE_DIR"

ui_print() {
  printf '%s\n' "$*" >> "$OUTPUT_FILE"
}

state_get() {
  return 1
}

. "$ROOT/core/install-flow.sh"

assert_grade() {
  EXPECTED="$1"
  shift
  ACTUAL="$(install_check_grade "$@")"
  if [ "$ACTUAL" != "$EXPECTED" ]; then
    printf 'grade mismatch: expected=%s actual=%s args=%s\n' "$EXPECTED" "$ACTUAL" "$*" >&2
    exit 1
  fi
}

assert_grade FAIL integrity error baseline-invalid 0 0
assert_grade WARN integrity ok runtime-evidence-not-ready 0 0
assert_grade PASS conflict ok passed 0

cat > "$STATE_DIR/conflict-report.txt" <<'EOF_REPORT'
scan_status=ok
reason=passed
conflict_total=0
EOF_REPORT

cat > "$STATE_DIR/health.log" <<'EOF_REPORT'
status=ok
reason=passed
EOF_REPORT

cat > "$STATE_DIR/integrity-report.txt" <<'EOF_REPORT'
status=ok
reason=passed
blocking_missing_total=0
blocking_changed_total=0
EOF_REPORT

INSTALL_PROP_LOCK_STATUS=warning
INSTALL_PROP_LOCK_REASON=prop-lock-write-failed
install_check_summary
grep -q '部分属性锁定列表写入失败' "$OUTPUT_FILE"
[ -z "${INSTALL_CHECK_BLOCKING_REASON:-}" ]

cat > "$STATE_DIR/integrity-report.txt" <<'EOF_REPORT'
status=error
reason=baseline-invalid
blocking_missing_total=0
blocking_changed_total=0
EOF_REPORT

INSTALL_PROP_LOCK_STATUS=ok
INSTALL_PROP_LOCK_REASON=passed
: > "$OUTPUT_FILE"
install_check_summary
case "$INSTALL_CHECK_BLOCKING_REASON" in
  *'integrity: baseline-invalid'*) ;;
  *)
    printf 'missing integrity blocking reason: %s\n' "$INSTALL_CHECK_BLOCKING_REASON" >&2
    exit 1
    ;;
esac

printf 'install check grade tests: ok\n'
