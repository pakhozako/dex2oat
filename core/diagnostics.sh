#!/system/bin/sh

DIAGNOSTIC_COOLDOWN=${DEX2OAT_DIAGNOSTIC_COOLDOWN:-21600}
DIAGNOSTIC_DIR=${DIAGNOSTIC_DIR:-$STATE_DIR/diagnostics}
DIAGNOSTIC_KEEP=${DEX2OAT_DIAGNOSTIC_KEEP:-3}
DIAGNOSTIC_EXPORT_MAX_BYTES=${DEX2OAT_DIAGNOSTIC_EXPORT_MAX_BYTES:-262144}

diagnostic_input_hash() {
  {
    dex_hash_file "$MODDIR/system.prop"
    dex_hash_file "$MODDIR/rules/rule-props.pack"
    dex_hash_file "$MODDIR/core/integrity-baseline.prop"
  } | tr '\n' ':'
}

diagnostic_should_run() {
  [ "$1" = force ] && return 0
  NOW="$(date '+%s' 2>/dev/null || printf 0)"
  LAST="$(state_num diagnostics.checked_epoch)"
  HASH="$(diagnostic_input_hash)"
  [ "$HASH" != "$(state_get diagnostics.input_hash)" ] && return 0
  [ $((NOW - LAST)) -ge "$DIAGNOSTIC_COOLDOWN" ] 2>/dev/null
}

diagnostic_run_script() {
  DIAGNOSTIC_SCRIPT="$1"
  DIAGNOSTIC_LABEL="$2"
  [ -f "$DIAGNOSTIC_SCRIPT" ] || return 1
  sh "$DIAGNOSTIC_SCRIPT" "$MODDIR" 2>/dev/null
}

diagnostic_run() {
  DIAGNOSTIC_MODE="${1:-scheduled}"
  diagnostic_should_run "$DIAGNOSTIC_MODE" || return 0
  START="$(date '+%s' 2>/dev/null || printf 0)"
  mkdir -p "$DIAGNOSTIC_DIR" || return 1
  DIAGNOSTIC_ERRORS=0
  diagnostic_run_script "$MODDIR/core/conflict-detect.sh" conflict || DIAGNOSTIC_ERRORS=$((DIAGNOSTIC_ERRORS + 1))
  diagnostic_run_script "$MODDIR/core/health-check.sh" health || DIAGNOSTIC_ERRORS=$((DIAGNOSTIC_ERRORS + 1))
  diagnostic_run_script "$MODDIR/core/integrity-check.sh" integrity || DIAGNOSTIC_ERRORS=$((DIAGNOSTIC_ERRORS + 1))
  END="$(date '+%s' 2>/dev/null || printf 0)"
  DURATION=$((END - START))
  NOW_TEXT="$(state_now)"
  if [ "$DIAGNOSTIC_ERRORS" -gt 0 ]; then
    state_update \
      "diagnostics.status=failed" \
      "diagnostics.reason=subcheck-failed" \
      "diagnostics.mode=$DIAGNOSTIC_MODE" \
      "diagnostics.error_total=$DIAGNOSTIC_ERRORS" \
      "diagnostics.updated_at=$NOW_TEXT" \
      "performance.diagnostics_seconds=$DURATION" || true
    state_recompute_summary || true
    return 1
  fi
  HASH="$(diagnostic_input_hash)"
  state_update \
    "diagnostics.status=ok" \
    "diagnostics.reason=passed" \
    "diagnostics.mode=$DIAGNOSTIC_MODE" \
    "diagnostics.error_total=0" \
    "diagnostics.input_hash=$HASH" \
    "diagnostics.checked_epoch=$END" \
    "diagnostics.updated_at=$NOW_TEXT" \
    "performance.diagnostics_seconds=$DURATION" || true
  state_recompute_summary || true
}

diagnostic_redact() {
  sed -E \
    -e 's/(serial|android_id|imei|meid|subscriber|account|token|fingerprint|hostname|device\.(model|manufacturer|brand|android))[^=]*=.*/\1=<已隐藏>/Ig' \
    -e 's@(/storage/emulated/[0-9]+|/sdcard|/data/user/[0-9]+/[^ /]+|/data/data/[^ /]+)@<用户路径>@g' \
    -e 's@([A-Fa-f0-9]{16,})@<标识符>@g' \
    "$1"
}

diagnostic_rotate_exports() {
  DIAGNOSTIC_EXPORT_COUNT=0
  find "$DIAGNOSTIC_DIR" -name 'dex2oat-lock-diagnostic-*.txt' -type f -print 2>/dev/null | sort -r | while IFS= read -r DIAGNOSTIC_EXPORT; do
    DIAGNOSTIC_EXPORT_COUNT=$((DIAGNOSTIC_EXPORT_COUNT + 1))
    [ "$DIAGNOSTIC_EXPORT_COUNT" -le "$DIAGNOSTIC_KEEP" ] || rm -f "$DIAGNOSTIC_EXPORT" 2>/dev/null || true
  done
}

diagnostic_export_source() {
  DIAGNOSTIC_SOURCE="$1"
  [ -f "$DIAGNOSTIC_SOURCE" ] && [ ! -L "$DIAGNOSTIC_SOURCE" ] || return 0
  DIAGNOSTIC_SIZE="$(wc -c < "$DIAGNOSTIC_SOURCE" 2>/dev/null | tr -d ' ')"
  [ "${DIAGNOSTIC_SIZE:-0}" -le "$DIAGNOSTIC_EXPORT_MAX_BYTES" ] 2>/dev/null || {
    printf '===== %s =====\n<文件过大，已跳过>\n\n' "${DIAGNOSTIC_SOURCE##*/}"
    return 0
  }
  printf '===== %s =====\n' "${DIAGNOSTIC_SOURCE##*/}"
  diagnostic_redact "$DIAGNOSTIC_SOURCE"
  printf '\n'
}

diagnostic_export() {
  mkdir -p "$DIAGNOSTIC_DIR" || return 1
  chmod 0700 "$DIAGNOSTIC_DIR" 2>/dev/null || true
  EXPORT_FILE="$DIAGNOSTIC_DIR/dex2oat-lock-diagnostic-$(date '+%Y%m%d-%H%M%S').txt"
  {
    printf 'Dex2oat Lock 诊断包\n生成时间=%s\n模块版本=%s\n\n' "$(state_now)" "$(module_version 2>/dev/null || printf unknown)"
    for SOURCE in "$STATE_FILE" "$STATE_DIR/health.log" "$STATE_DIR/conflict-report.txt" "$STATE_DIR/integrity-report.txt" "$STATE_DIR/match-report.txt"; do
      diagnostic_export_source "$SOURCE"
    done
  } > "$EXPORT_FILE" || return 1
  chmod 0600 "$EXPORT_FILE" 2>/dev/null || true
  diagnostic_rotate_exports
  state_update "diagnostics.export_status=ok" "diagnostics.export_file=$EXPORT_FILE" "diagnostics.exported_at=$(state_now)" || true
  printf '%s\n' "$EXPORT_FILE"
}
