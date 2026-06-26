import { exec } from "./bridge.js";
import { parseKeyValue } from "./utils.js";



export async function readSystemInfo() {
  const command = `
GETPROP=/system/bin/getprop
[ -x "$GETPROP" ] || GETPROP=getprop
UNAME=/system/bin/uname
[ -x "$UNAME" ] || UNAME=uname

prop_first() {
  for key in "$@"; do
    value=$($GETPROP "$key" 2>/dev/null)
    [ -n "$value" ] && {
      printf '%s' "$value"
      return
    }
  done
}

printf 'model=%s\n' "$(prop_first ro.product.marketname ro.product.model ro.product.device)"
printf 'android=%s\n' "$(prop_first ro.build.version.release)"
printf 'sdk=%s\n' "$(prop_first ro.build.version.sdk)"
printf 'coloros=%s\n' "$(prop_first ro.build.version.oplusrom ro.oplus.version ro.build.version.opporom)"
printf 'brand=%s\n' "$(prop_first ro.product.brand)"
printf 'manufacturer=%s\n' "$(prop_first ro.product.manufacturer)"
printf 'kernel=%s\n' "$($UNAME -r 2>/dev/null)"
if [ -d /data/adb/ksu ]; then
  printf 'root=%s\n' 'KernelSU'
elif [ -n "$KSU" ] || [ -n "$KSU_VER" ] || [ -n "$KernelSU" ]; then
  printf 'root=%s\n' 'KernelSU'
elif [ -d /data/adb/ap ]; then
  printf 'root=%s\n' 'APatch'
elif [ -n "$APATCH" ] || [ -n "$APATCH_VER" ]; then
  printf 'root=%s\n' 'APatch'
elif command -v magisk >/dev/null 2>&1; then
  printf 'root=Magisk %s\n' "$(magisk -v 2>/dev/null)"
else
  printf 'root=%s\n' 'Unknown'
fi
`.trim();

  const result = await exec(command);

  if (result.code !== 0) {
    return {
      available: false,
      error: result.stderr || result.stdout || `exit ${result.code}`,
      model: "暂不可用",
      android: "暂不可用",
      coloros: "暂不可用",
      kernel: "暂不可用",
      root: "暂不可用"
    };
  }

  const values = parseKeyValue(result.stdout);
  const coloros = values.coloros || values.oplus || "Unknown";

  return {
    available: true,
    model: values.model || values.brand || "Unknown",
    android: values.android ? `Android ${values.android}` : "Unknown",
    sdk: values.sdk || "",
    coloros,
    brand: values.brand || "",
    manufacturer: values.manufacturer || "",
    kernel: values.kernel || "Unknown",
    root: values.root || "Unknown"
  };
}
