#!/system/bin/sh

MODDIR="$1"
REDEEM_CODE="$2"
INSTALL_HASH="$3"
[ -n "$MODDIR" ] || MODDIR=${0%/*}/..

STATE_DIR=${STATE_DIR:-/data/adb/dex2oat-lock}
ENDPOINT=${DEX2OAT_SUPPORTER_VERIFY_URL:-https://cloud.154-219-110-62.sslip.io/api/supporter/verify}
RESPONSE_FILE="$STATE_DIR/redeem-response.$$"
SCOPE_LOG="$STATE_DIR/supporter-scope.log"

[ -f "$MODDIR/core/common.sh" ] && . "$MODDIR/core/common.sh"

fail_json() {
  ERROR="$1"
  MESSAGE="${2:-$1}"
  printf '{"ok":false,"error":"%s","message":"%s"}\n' "$ERROR" "$(json_escape "$MESSAGE")"
  rm -f "$RESPONSE_FILE" 2>/dev/null || true
  exit 1
}

json_escape() {
  printf '%s' "$1" | tr '\r\n\t' '   ' | sed 's/\\/\\\\/g; s/"/\\"/g'
}

canonical_code() {
  RAW_CODE="$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')"
  MATCHED_CODE="$(printf '%s' "$RAW_CODE" | sed -n 's/.*\([A-Z0-9]\{6\}[ -]*[A-Z0-9]\{6\}[ -]*[A-Z0-9]\{6\}\).*/\1/p' | head -n 1)"
  if [ -n "$MATCHED_CODE" ]; then
    printf '%s' "$MATCHED_CODE" | tr -cd 'A-Z0-9'
    return
  fi
  COMPACT_CODE="$(printf '%s' "$RAW_CODE" | tr -cd 'A-Z0-9')"
  COMPACT_LEN=${#COMPACT_CODE}
  if [ "$COMPACT_LEN" -gt 18 ] && [ "$COMPACT_LEN" -le 24 ]; then
    printf '%s' "$COMPACT_CODE" | sed 's/^.*\(.\{18\}\)$/\1/'
    return
  fi
  printf '%s' "$COMPACT_CODE"
}

sanitize_hash() {
  printf '%s' "$1" | tr -cd 'A-Za-z0-9._:-' | cut -c 1-96
}

hash_text() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum 2>/dev/null | awk '{print $1}'
  elif command -v md5sum >/dev/null 2>&1; then
    printf '%s' "$1" | md5sum 2>/dev/null | awk '{print $1}'
  else
    printf '%s' "$1" | cksum 2>/dev/null | awk '{print $1}'
  fi
}

json_string_field() {
  FIELD="$1"
  sed -n "s/.*\"$FIELD\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" "$RESPONSE_FILE" | head -n 1
}

json_array_values() {
  FIELD="$1"
  tr '\r\n' '  ' < "$RESPONSE_FILE" 2>/dev/null \
    | sed -n "s/.*\"$FIELD\"[[:space:]]*:[[:space:]]*\[\([^]]*\)\].*/\1/p" \
    | tr ',' '\n' \
    | sed -n 's/^[[:space:]]*"\([^"]*\)".*/\1/p'
}

json_bool_field() {
  FIELD="$1"
  sed -n "s/.*\"$FIELD\"[[:space:]]*:[[:space:]]*\\(true\\|false\\).*/\\1/p" "$RESPONSE_FILE" | head -n 1
}

json_number_field() {
  FIELD="$1"
  sed -n "s/.*\"$FIELD\"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p" "$RESPONSE_FILE" | head -n 1
}

log_scope_fallback() {
  MATCHED_SCOPE="$1"
  CODE_ID_RAW="$(json_string_field codeId)"
  [ -n "$CODE_ID_RAW" ] || CODE_ID_RAW="$(json_string_field code_id)"
  TIER_RAW="$(json_string_field tier)"
  BADGE_RAW="$(json_string_field badge)"
  NOTE_RAW="$(json_string_field note)"
  LOG_TS="$(date '+%Y-%m-%dT%H:%M:%S%z' 2>/dev/null || date '+%s' 2>/dev/null || printf 0)"
  {
    printf '%s scope=%s codeId="%s" tier="%s" badge="%s" note="%s"\n' \
      "$LOG_TS" "$MATCHED_SCOPE" "$(json_escape "$CODE_ID_RAW")" "$(json_escape "$TIER_RAW")" "$(json_escape "$BADGE_RAW")" "$(json_escape "$NOTE_RAW")"
  } >> "$SCOPE_LOG" 2>/dev/null || true
  chmod 0600 "$SCOPE_LOG" 2>/dev/null || true
}

append_scope() {
  RAW="$1"
  case "$RAW" in
    memorial-amber|founder-qingmu)
      case " $SCOPE " in
        *" $RAW "*) ;;
        *) SCOPE="$SCOPE $RAW" ;;
      esac
      ;;
  esac
}

scope_from_token() {
  RAW_TOKEN="$1"
  TOKEN="$(printf '%s' "$RAW_TOKEN" | tr '[:upper:]' '[:lower:]')"
  case "$TOKEN" in
    *founder*|*fnd*|*elaina*|*创始人*|*倾慕*)
      printf '%s\n' "founder-qingmu"
      return 0
      ;;
    *memorial*|*mem*|*amber*|*纪念*|*琥珀*)
      printf '%s\n' "memorial-amber"
      return 0
      ;;
  esac
  return 1
}

skin_scope_from_response() {
  SCOPE=""
  for RAW in $(json_array_values skinIds) $(json_array_values skin_ids); do
    append_scope "$RAW"
  done
  for RAW in "$(json_string_field skinId)" "$(json_string_field skin_id)"; do
    append_scope "$RAW"
  done
  if [ -n "$SCOPE" ]; then
    printf '%s\n' "$SCOPE"
    return 0
  fi

  for RAW in "$(json_string_field codeId)" "$(json_string_field code_id)" "$(json_string_field id)"; do
    [ -n "$RAW" ] || continue
    MATCHED_SCOPE="$(scope_from_token "$RAW")" || continue
    log_scope_fallback "$MATCHED_SCOPE"
    printf '%s\n' "$MATCHED_SCOPE"
    return 0
  done

  TEXT="$(printf '%s %s %s' "$(json_string_field tier)" "$(json_string_field badge)" "$(json_string_field note)")"
  MATCHED_SCOPE="$(scope_from_token "$TEXT")" || {
    log_scope_fallback "missing"
    return 1
  }
  log_scope_fallback "$MATCHED_SCOPE"
  printf '%s\n' "$MATCHED_SCOPE"
}

module_prop_value() {
  KEY="$1"
  sed -n "s/^$KEY=//p" "$MODDIR/module.prop" 2>/dev/null | head -n 1
}

CODE="$(canonical_code "$REDEEM_CODE")"
[ -n "$CODE" ] || fail_json "credential_required" "请输入兑换码"
[ "${#CODE}" -eq 18 ] || fail_json "credential_required" "兑换码应为 18 位"

INSTALL_HASH="$(sanitize_hash "$INSTALL_HASH")"
[ -n "$INSTALL_HASH" ] || fail_json "install_hash_required" "缺少 WebUI installHash，无法绑定兑换码"
mkdir -p "$STATE_DIR" 2>/dev/null || fail_json "create-state-dir" "无法创建本地状态目录"

MODULE_VERSION="$(json_escape "$(module_prop_value version)")"
VERSION_CODE="$(module_prop_value versionCode)"
case "$VERSION_CODE" in
  ''|*[!0-9]*) VERSION_CODE=0 ;;
esac

PAYLOAD="$(printf '{"credential":"%s","installHash":"%s","moduleVersion":"%s","versionCode":%s,"manager":"webui-shell"}' \
  "$CODE" "$INSTALL_HASH" "$MODULE_VERSION" "$VERSION_CODE")"

if ! command -v curl >/dev/null 2>&1; then
  fail_json "network" "当前系统缺少 curl，无法连接兑换服务"
fi

HTTP_CODE="$(curl -sS --ssl-reqd \
  --connect-timeout 8 \
  --max-time 10 \
  --retry 1 \
  --retry-delay 1 \
  -H 'Content-Type: application/json' \
  -o "$RESPONSE_FILE" \
  -w '%{http_code}' \
  --data "$PAYLOAD" \
  "$ENDPOINT" 2>"$STATE_DIR/redeem-curl.$$.err" \
  || curl -sS \
    --connect-timeout 8 \
    --max-time 10 \
    --retry 1 \
    --retry-delay 1 \
    -H 'Content-Type: application/json' \
    -o "$RESPONSE_FILE" \
    -w '%{http_code}' \
    --data "$PAYLOAD" \
    "$ENDPOINT" 2>>"$STATE_DIR/redeem-curl.$$.err")"
CURL_CODE=$?
CURL_ERR="$(cat "$STATE_DIR/redeem-curl.$$.err" 2>/dev/null)"
rm -f "$STATE_DIR/redeem-curl.$$.err" 2>/dev/null || true

if [ "$CURL_CODE" -ne 0 ]; then
  fail_json "network" "${CURL_ERR:-网络请求失败}"
fi

SERVER_OK="$(json_bool_field ok)"
SERVER_ERROR="$(json_string_field error)"
SERVER_MESSAGE="$(json_string_field message)"
if [ "$SERVER_OK" != "true" ] || [ "${HTTP_CODE:-0}" -lt 200 ] || [ "${HTTP_CODE:-0}" -ge 300 ]; then
  [ -n "$SERVER_ERROR" ] || SERVER_ERROR="http_error"
  [ -n "$SERVER_MESSAGE" ] || SERVER_MESSAGE="HTTP $HTTP_CODE"
  case "$SERVER_ERROR" in
    http_error)
      RESPONSE_TEXT="$(tr '\r\n' '  ' < "$RESPONSE_FILE" 2>/dev/null | cut -c 1-240)"
      [ -n "$RESPONSE_TEXT" ] && SERVER_MESSAGE="HTTP $HTTP_CODE: $RESPONSE_TEXT"
      ;;
  esac
  fail_json "$SERVER_ERROR" "$SERVER_MESSAGE"
fi

VERIFIED_AT="$(json_number_field verifiedAt)"
[ -n "$VERIFIED_AT" ] || VERIFIED_AT="$(date '+%s' 2>/dev/null || printf 0)"

SKIN_SCOPE="$(skin_scope_from_response)" \
  || fail_json "skin_scope_missing" "无法识别该兑换码对应的皮肤范围，请稍后重试或联系维护者"

UNLOCK_RESULT="$(sh "$MODDIR/core/skin-unlock.sh" "$MODDIR" unlock-many "$INSTALL_HASH" "$VERIFIED_AT" $SKIN_SCOPE 2>/dev/null)"
UNLOCK_CODE=$?
if [ "$UNLOCK_CODE" -ne 0 ]; then
  fail_json "local_unlock_failed" "${UNLOCK_RESULT:-本地解锁记录写入失败}"
fi

NAME="$(json_escape "$(json_string_field name)")"
TIER="$(json_escape "$(json_string_field tier)")"
BADGE="$(json_escape "$(json_string_field badge)")"
NOTE="$(json_escape "$(json_string_field note)")"
EXPIRES_AT="$(json_number_field expiresAt)"
REUSED="$(json_bool_field reused)"
[ -n "$EXPIRES_AT" ] || EXPIRES_AT=0
[ "$REUSED" = "true" ] || REUSED=false

rm -f "$RESPONSE_FILE" 2>/dev/null || true
SKINS_JSON=""
for SKIN_ID in $SKIN_SCOPE; do
  [ -n "$SKINS_JSON" ] && SKINS_JSON="$SKINS_JSON,"
  SKINS_JSON="$SKINS_JSON\"$SKIN_ID\""
done
[ -n "$SKINS_JSON" ] || SKINS_JSON="\"default\""
printf '{"ok":true,"name":"%s","tier":"%s","badge":"%s","note":"%s","expiresAt":%s,"verifiedAt":%s,"reused":%s,"skins":[%s],"status":"unlocked"}\n' \
  "$NAME" "$TIER" "$BADGE" "$NOTE" "$EXPIRES_AT" "$VERIFIED_AT" "$REUSED" "$SKINS_JSON"
