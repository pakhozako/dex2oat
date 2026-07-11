#!/system/bin/sh

dex_runtime_write_status() {
  DEX_RUNTIME_STATE_DIR="$1"
  DEX_RUNTIME_STATUS="$2"
  DEX_RUNTIME_REASON="$3"
  DEX_RUNTIME_STATUS_FILE="$DEX_RUNTIME_STATE_DIR/runtime-status.prop"
  DEX_RUNTIME_STATUS_TMP="$DEX_RUNTIME_STATE_DIR/.runtime-status.new.$$"

  mkdir -p "$DEX_RUNTIME_STATE_DIR" 2>/dev/null || return 1
  {
    printf 'updated_at=%s\n' "$(dex_now)"
    printf 'status=%s\n' "$DEX_RUNTIME_STATUS"
    printf 'reason=%s\n' "$DEX_RUNTIME_REASON"
    printf 'phase=%s\n' "${DEX_RUNTIME_PHASE:-runtime}"
    printf 'config_hash=%s\n' "${DEX_RUNTIME_CONFIG_HASH:-unknown}"
    printf 'prop_total=%s\n' "${DEX_RUNTIME_TOTAL:-0}"
    printf 'applied_total=%s\n' "${DEX_RUNTIME_APPLIED:-0}"
    printf 'unchanged_total=%s\n' "${DEX_RUNTIME_UNCHANGED:-0}"
    printf 'mismatch_total=%s\n' "${DEX_RUNTIME_MISMATCH:-0}"
    printf 'failed_total=%s\n' "${DEX_RUNTIME_FAILED:-0}"
  } > "$DEX_RUNTIME_STATUS_TMP" 2>/dev/null || return 1
  chmod 0600 "$DEX_RUNTIME_STATUS_TMP" 2>/dev/null || true
  mv -f "$DEX_RUNTIME_STATUS_TMP" "$DEX_RUNTIME_STATUS_FILE" 2>/dev/null || {
    rm -f "$DEX_RUNTIME_STATUS_TMP" 2>/dev/null || true
    return 1
  }
}

dex_runtime_apply() {
  DEX_RUNTIME_CONFIG_FILE="$1"
  DEX_RUNTIME_STATE_DIR="$2"
  DEX_RUNTIME_PHASE="${3:-runtime}"
  DEX_RUNTIME_TOTAL=0
  DEX_RUNTIME_APPLIED=0
  DEX_RUNTIME_UNCHANGED=0
  DEX_RUNTIME_MISMATCH=0
  DEX_RUNTIME_FAILED=0

  dex_validate_prop_file "$DEX_RUNTIME_CONFIG_FILE" || {
    DEX_RUNTIME_CONFIG_HASH=invalid
    dex_runtime_write_status "$DEX_RUNTIME_STATE_DIR" error invalid-config || true
    return 1
  }
  DEX_RUNTIME_CONFIG_HASH="$(dex_hash_file "$DEX_RUNTIME_CONFIG_FILE")" || {
    DEX_RUNTIME_CONFIG_HASH=unavailable
    dex_runtime_write_status "$DEX_RUNTIME_STATE_DIR" error hash-unavailable || true
    return 1
  }

  while IFS='=' read -r DEX_RUNTIME_KEY DEX_RUNTIME_VALUE || [ -n "$DEX_RUNTIME_KEY" ]; do
    DEX_RUNTIME_KEY="$(printf '%s' "$DEX_RUNTIME_KEY" | tr -d '\r')"
    DEX_RUNTIME_VALUE="$(printf '%s' "$DEX_RUNTIME_VALUE" | tr -d '\r')"
    case "$DEX_RUNTIME_KEY" in ""|\#*) continue ;; esac
    dex_valid_prop_key "$DEX_RUNTIME_KEY" || {
      DEX_RUNTIME_FAILED=$((DEX_RUNTIME_FAILED + 1))
      continue
    }
    dex_valid_prop_value "$DEX_RUNTIME_VALUE" || {
      DEX_RUNTIME_FAILED=$((DEX_RUNTIME_FAILED + 1))
      continue
    }

    DEX_RUNTIME_TOTAL=$((DEX_RUNTIME_TOTAL + 1))
    dex_apply_checked_prop "$DEX_RUNTIME_KEY" "$DEX_RUNTIME_VALUE"
    DEX_RUNTIME_RESULT=$?
    case "$DEX_RUNTIME_RESULT" in
      0)
        DEX_RUNTIME_APPLIED=$((DEX_RUNTIME_APPLIED + 1))
        command -v dex_runtime_log >/dev/null 2>&1 && dex_runtime_log "applied key=$DEX_RUNTIME_KEY value=$DEX_RUNTIME_VALUE tool=$DEX_CHECKED_APPLY_TOOL"
        ;;
      3)
        DEX_RUNTIME_UNCHANGED=$((DEX_RUNTIME_UNCHANGED + 1))
        ;;
      2)
        DEX_RUNTIME_MISMATCH=$((DEX_RUNTIME_MISMATCH + 1))
        command -v dex_runtime_log >/dev/null 2>&1 && dex_runtime_log "mismatch key=$DEX_RUNTIME_KEY expected=$DEX_RUNTIME_VALUE actual=$DEX_CHECKED_NEW_VALUE"
        ;;
      *)
        DEX_RUNTIME_FAILED=$((DEX_RUNTIME_FAILED + 1))
        command -v dex_runtime_log >/dev/null 2>&1 && dex_runtime_log "failed key=$DEX_RUNTIME_KEY value=$DEX_RUNTIME_VALUE tool=$DEX_CHECKED_APPLY_TOOL code=$DEX_CHECKED_APPLY_CODE"
        ;;
    esac
  done < "$DEX_RUNTIME_CONFIG_FILE"

  DEX_RUNTIME_RESULT_STATUS=ok
  DEX_RUNTIME_RESULT_REASON=applied
  if [ "$DEX_RUNTIME_FAILED" -gt 0 ] 2>/dev/null; then
    DEX_RUNTIME_RESULT_STATUS=error
    DEX_RUNTIME_RESULT_REASON=property-write-failed
  elif [ "$DEX_RUNTIME_MISMATCH" -gt 0 ] 2>/dev/null; then
    DEX_RUNTIME_RESULT_STATUS=warning
    DEX_RUNTIME_RESULT_REASON=property-mismatch
  elif [ "$DEX_RUNTIME_TOTAL" -eq 0 ] 2>/dev/null; then
    DEX_RUNTIME_RESULT_STATUS=warning
    DEX_RUNTIME_RESULT_REASON=no-properties
  elif [ "$DEX_RUNTIME_APPLIED" -eq 0 ] 2>/dev/null; then
    DEX_RUNTIME_RESULT_REASON=already-matched
  fi

  dex_runtime_write_status "$DEX_RUNTIME_STATE_DIR" "$DEX_RUNTIME_RESULT_STATUS" "$DEX_RUNTIME_RESULT_REASON" || return 1
  [ "$DEX_RUNTIME_FAILED" -eq 0 ] 2>/dev/null && [ "$DEX_RUNTIME_MISMATCH" -eq 0 ] 2>/dev/null
}
