#!/system/bin/sh

OUT_FILE="${1:-/data/adb/dex2oat-lock/captured-props.txt}"
EXPORT_FILE="${2:-/storage/emulated/0/Download/dex2oat-captured-props.txt}"
OUT_DIR="${OUT_FILE%/*}"
TMP_FILE="$OUT_FILE.tmp"

[ "$OUT_DIR" != "$OUT_FILE" ] && mkdir -p "$OUT_DIR" 2>/dev/null

GETPROP=/system/bin/getprop
[ -x "$GETPROP" ] || GETPROP=getprop

if ! "$GETPROP" \
  | grep -Ev 'bluetooth|wifi|audio|camera|radio|nfc|display|sensor|vibrat|touch|fingerprint|boot\.(anim|logo|sound|reason)|boottime|build\.(description|fingerprint|display|host|tags|user|version)|product\.(board|brand|cpu|device|manufacturer|model|name|sku|soc\.model)|vendor\.oplus\.(camera|audio|display|touch|sensor|radio|face|vibrat|ifaa|cryptoeng|hdr|tonemap|video|sap|boot|caihong|biometric)' \
  | grep -Ei 'oplus|art|compile|dex|dalvik|oat|jit|profile|startup|cache|odex|vdex|image|speed|bgopt|opex|osense|hmbird|artd|art_boot|iorap|dexopt|dex2oat|ocompiler|nandswap|zygote|usap|heap|swap|gc|zram|lmk|memory|memcg|hybridswap|compress|zstd|lz4|zlib|perf|sched|cpuset|cgroup|binder|ipc|vm\.|runtime|native|dalvik_sync|tango|app32|ossi|obrain|gaia|theia|cvt|olc|urcc|phoenix|aotcrash|canceldex|extrabgdex|bgdex2oat|canceldexopt|dex2oat_enabled|dexopt_enabled|compile_enabled|aot|pgo|speed_profile|jit_profile|profile_saver|hotness|startup_filter|dex_preopt|preopt|odex_filter|art_service|artservice|art_daemon|heapprofd|perfetto|traced|perf2|perfservice|opex_apk|opex_state|dex_state|compile_state|install_state|package_compile|pm_dexopt|dexopt_trigger|dexopt_schedule|dexopt_policy|dexopt_filter|dexopt_reason|dexopt_status|lightos|ocomp|sys\.oplus|persist\.oplus|persist\.sys\.oplus|persist\.sys\.feature|persist\.device_config\.runtime|persist\.dalvik|ro\.dalvik|ro\.oplus\.ocompiler|ro\.cp_system|pms\.dex|vtools|vendor\.memory|vendor\.perf|vendor\.oplus\.dalvik|sys\.lmk|ro\.lmk|ro\.pgo|ro\.runtime|ro\.zygote|ro\.sys\.fw|ro\.sys\.gaia|sys\.gaia|sys\.nirvana|sys\.furtherHeap|sys\.gcsup|sys\.heap|lmkd|kcmdline|hidl_memory|generate_runtime|memory\.init|memory\.post|ioscheduler|perf_lsm|swaplow|kohash|system_clear|opluspcm|opluspm|oplusnetwake|obrain_obfuscate|tango_target|tango_zygote|data_migrate|sys\.opluspcm|sys\.opluspm|persist\.sys\.min\.swap|persist\.sys\.lmk|persist\.sys\.obrain|persist\.sys\.gaia|persist\.sys\.input_native|persist\.sys\.startup|persist\.sys\.tango|persist\.sys\.data_migrate|persist\.oplus\.zygote|persist\.oplus\.ocompiler|oplus\.systemclearservice|oplus\.keyguard|oplus\.p2p|oplus\.softap|sys\.oplus\.zygote|sys\.oplus\.reboot|sys\.oplus\.appio|sys\.oplus\.sqlctrl|sys\.oplus\.nandswap|sys\.tango|tango\.debug|vold\.has_compress|ro\.virtual_ab' \
  > "$TMP_FILE"; then
  rm -f "$TMP_FILE" 2>/dev/null
  exit 1
fi

if [ ! -s "$TMP_FILE" ]; then
  rm -f "$TMP_FILE" 2>/dev/null
  exit 1
fi

mv -f "$TMP_FILE" "$OUT_FILE" || exit 1
chmod 0600 "$OUT_FILE" 2>/dev/null || true

if [ -n "$EXPORT_FILE" ]; then
  EXPORT_DIR="${EXPORT_FILE%/*}"
  [ "$EXPORT_DIR" != "$EXPORT_FILE" ] && mkdir -p "$EXPORT_DIR" 2>/dev/null
  cp -af "$OUT_FILE" "$EXPORT_FILE" 2>/dev/null || true
fi

exit 0
