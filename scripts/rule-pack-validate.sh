#!/system/bin/sh

rule_validate_pack() {
  RULE_PACK_FILE="$1"
  [ -s "$RULE_PACK_FILE" ] && [ ! -L "$RULE_PACK_FILE" ] || return 1
  RULE_PACK_SIZE="$(wc -c < "$RULE_PACK_FILE" 2>/dev/null | tr -d ' ')"
  [ "${RULE_PACK_SIZE:-0}" -le "${DEX2OAT_RULE_PACK_MAX_SIZE:-524288}" ] 2>/dev/null || return 2
  LC_ALL=C awk '
    /^#/ || /^$/ { next }
    /^version=/ { if (versionSeen++) exit 10; version=substr($0,9); next }
    /^seed=/ { if (seedSeen++) exit 11; seed=substr($0,6); next }
    /^length=/ { if (lengthSeen++) exit 12; total=substr($0,8); next }
    /^sha256=/ { if (hashSeen++) exit 13; hash=substr($0,8); next }
    /^data=$/ { if (dataSeen++) exit 14; inData=1; next }
    inData && /^[0-9A-Fa-f]+$/ { encoded += length($0); next }
    { exit 15 }
    END {
      if (version != "1" || seed !~ /^[0-9]+$/ || seed <= 0 || total !~ /^[0-9]+$/ || total <= 0 || total > 262144) exit 16
      if (hash !~ /^[0-9a-fA-F]{64}$/ && length(hash) != 64) exit 17
      if (encoded != total * 2) exit 18
    }
  ' "$RULE_PACK_FILE"
}
