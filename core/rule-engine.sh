#!/system/bin/sh

dex_rule_cleanup() {
  [ -n "$DEX_RULE_WORK_DIR" ] || return 0
  case "$DEX_RULE_WORK_DIR" in
    "$DEX_RULE_STATE_DIR"/.rule-work.*)
      rm -rf "$DEX_RULE_WORK_DIR" 2>/dev/null || true
      ;;
  esac
  DEX_RULE_WORK_DIR=""
}

dex_rule_preflight() {
  DEX_RULE_MODULE_DIR="$1"
  DEX_RULE_STATE_DIR="$2"
  command -v sha256sum >/dev/null 2>&1 || return 1
  for DEX_RULE_REQUIRED in "$DEX_RULE_MODULE_DIR/rules/rule-props.pack" "$DEX_RULE_MODULE_DIR/rules/prop-policy.tsv" "$DEX_RULE_MODULE_DIR/scripts/decode-rules.sh" "$DEX_RULE_MODULE_DIR/scripts/capture-props.sh" "$DEX_RULE_MODULE_DIR/scripts/generate-props.sh" "$DEX_RULE_MODULE_DIR/core/common.sh" "$DEX_RULE_MODULE_DIR/core/conflict-detect.sh"; do
    [ -s "$DEX_RULE_REQUIRED" ] || return 1
  done
  mkdir -p "$DEX_RULE_STATE_DIR" 2>/dev/null || return 1
  DEX_RULE_PROBE="$DEX_RULE_STATE_DIR/.write-probe.$$"
  : > "$DEX_RULE_PROBE" 2>/dev/null || return 1
  rm -f "$DEX_RULE_PROBE" 2>/dev/null || return 1
  return 0
}

dex_rule_read_value() {
  DEX_RULE_READ_KEY="$1"
  DEX_RULE_READ_FILE="$2"
  awk -F= -v key="$DEX_RULE_READ_KEY" '
    $1 == key {
      sub(/^[^=]*=/, "")
      value = $0
      found = 1
    }
    END { if (found) print value }
  ' "$DEX_RULE_READ_FILE" 2>/dev/null
}

dex_rule_build() {
  DEX_RULE_MODULE_DIR="$1"
  DEX_RULE_STATE_DIR="$2"
  DEX_RULE_MODE="${3:-commit}"
  DEX_RULE_VERSION="$4"
  DEX_RULE_WORK_DIR="$DEX_RULE_STATE_DIR/.rule-work.$$"

  dex_rule_preflight "$DEX_RULE_MODULE_DIR" "$DEX_RULE_STATE_DIR" || return 1
  mkdir "$DEX_RULE_WORK_DIR" 2>/dev/null || return 1

  DEX_RULE_TSV="$DEX_RULE_WORK_DIR/rules.tsv"
  DEX_RULE_CAPTURED="$DEX_RULE_WORK_DIR/captured.prop"
  DEX_RULE_CANDIDATE="$DEX_RULE_WORK_DIR/system.prop.candidate"
  DEX_RULE_FILTERED="$DEX_RULE_WORK_DIR/system.prop.filtered"
  DEX_RULE_MATCH_REPORT="$DEX_RULE_WORK_DIR/match-report.prop"
  DEX_RULE_CONFLICT_REPORT="$DEX_RULE_WORK_DIR/conflict-report.txt"

  sh "$DEX_RULE_MODULE_DIR/scripts/decode-rules.sh" "$DEX_RULE_MODULE_DIR/rules/rule-props.pack" "$DEX_RULE_TSV" || {
      dex_rule_cleanup
      return 1
    }
  sh "$DEX_RULE_MODULE_DIR/scripts/generate-props.sh" --validate "$DEX_RULE_TSV" || {
    dex_rule_cleanup
    return 1
  }
  sh "$DEX_RULE_MODULE_DIR/scripts/capture-props.sh" "$DEX_RULE_CAPTURED" "$DEX_RULE_TSV" || {
    dex_rule_cleanup
    return 1
  }
  DEX2OAT_PROP_POLICY_FILE="$DEX_RULE_MODULE_DIR/rules/prop-policy.tsv" sh "$DEX_RULE_MODULE_DIR/scripts/generate-props.sh" "$DEX_RULE_CAPTURED" "$DEX_RULE_TSV" "$DEX_RULE_CANDIDATE" "$DEX_RULE_MATCH_REPORT" "$DEX_RULE_VERSION" || {
        dex_rule_cleanup
        return 1
      }
  sh "$DEX_RULE_MODULE_DIR/core/conflict-detect.sh" "$DEX_RULE_MODULE_DIR" "$DEX_RULE_CANDIDATE" "$DEX_RULE_FILTERED" "$DEX_RULE_CONFLICT_REPORT" || {
      dex_rule_cleanup
      return 1
    }

  dex_validate_prop_file "$DEX_RULE_FILTERED" || {
    dex_rule_cleanup
    return 1
  }

  DEX_RULE_RESOLVED_TOTAL="$(dex_rule_read_value resolved_total "$DEX_RULE_MATCH_REPORT")"
  DEX_RULE_CONFLICT_TOTAL="$(dex_rule_read_value conflict_total "$DEX_RULE_CONFLICT_REPORT")"
  DEX_RULE_FINAL_TOTAL="$(dex_count_props "$DEX_RULE_FILTERED")"
  DEX_RULE_CONFIG_HASH="$(dex_hash_file "$DEX_RULE_FILTERED")" || {
    dex_rule_cleanup
    return 1
  }
  {
    printf 'conflict_total=%s\n' "${DEX_RULE_CONFLICT_TOTAL:-0}"
    printf 'final_total=%s\n' "${DEX_RULE_FINAL_TOTAL:-0}"
    printf 'config_hash=%s\n' "$DEX_RULE_CONFIG_HASH"
  } >> "$DEX_RULE_MATCH_REPORT" || {
    dex_rule_cleanup
    return 1
  }

  [ "$DEX_RULE_MODE" = commit ] || return 0

  DEX_RULE_CONFIG_STAGE="$DEX_RULE_MODULE_DIR/.system.prop.new.$$"
  DEX_RULE_MATCH_STAGE="$DEX_RULE_STATE_DIR/.match-report.new.$$"
  DEX_RULE_CONFLICT_STAGE="$DEX_RULE_STATE_DIR/.conflict-report.new.$$"
  cp "$DEX_RULE_FILTERED" "$DEX_RULE_CONFIG_STAGE" 2>/dev/null || {
    dex_rule_cleanup
    return 1
  }
  cp "$DEX_RULE_MATCH_REPORT" "$DEX_RULE_MATCH_STAGE" 2>/dev/null || {
    rm -f "$DEX_RULE_CONFIG_STAGE" 2>/dev/null || true
    dex_rule_cleanup
    return 1
  }
  cp "$DEX_RULE_CONFLICT_REPORT" "$DEX_RULE_CONFLICT_STAGE" 2>/dev/null || {
    rm -f "$DEX_RULE_CONFIG_STAGE" "$DEX_RULE_MATCH_STAGE" 2>/dev/null || true
    dex_rule_cleanup
    return 1
  }
  chmod 0644 "$DEX_RULE_CONFIG_STAGE" 2>/dev/null || true
  chmod 0600 "$DEX_RULE_MATCH_STAGE" "$DEX_RULE_CONFLICT_STAGE" 2>/dev/null || true

  mv -f "$DEX_RULE_CONFIG_STAGE" "$DEX_RULE_MODULE_DIR/system.prop" 2>/dev/null || {
    rm -f "$DEX_RULE_CONFIG_STAGE" "$DEX_RULE_MATCH_STAGE" "$DEX_RULE_CONFLICT_STAGE" 2>/dev/null || true
    dex_rule_cleanup
    return 1
  }
  mv -f "$DEX_RULE_MATCH_STAGE" "$DEX_RULE_STATE_DIR/match-report.prop" 2>/dev/null || {
    rm -f "$DEX_RULE_MATCH_STAGE" "$DEX_RULE_CONFLICT_STAGE" 2>/dev/null || true
    dex_rule_cleanup
    return 1
  }
  mv -f "$DEX_RULE_CONFLICT_STAGE" "$DEX_RULE_STATE_DIR/conflict-report.txt" 2>/dev/null || {
    rm -f "$DEX_RULE_CONFLICT_STAGE" 2>/dev/null || true
    dex_rule_cleanup
    return 1
  }

  dex_rule_cleanup
  return 0
}
