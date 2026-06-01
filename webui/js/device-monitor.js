import { exec } from "./bridge.js";

function toNumber(value) {
  const number = Number(String(value || "").trim());
  return Number.isFinite(number) ? number : null;
}

function formatBytesFromKb(kb) {
  const value = toNumber(kb);
  if (value == null) return "暂不可用";
  return formatBytes(value * 1024);
}

function formatBytes(bytes) {
  const value = toNumber(bytes);
  if (value == null) return "暂不可用";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let next = value;
  let index = 0;
  while (next >= 1024 && index < units.length - 1) {
    next /= 1024;
    index += 1;
  }
  return `${next.toFixed(index < 2 ? 0 : 1)} ${units[index]}`;
}

function normalizeTemperature(raw) {
  const value = toNumber(raw);
  if (value == null) return null;
  if (Math.abs(value) > 1000) return value / 1000;
  if (Math.abs(value) > 100) return value / 10;
  return value;
}

function formatTemperature(raw) {
  const value = normalizeTemperature(raw);
  return value == null ? "暂不可用" : `${value.toFixed(1)} °C`;
}

function formatUptime(seconds) {
  const value = Math.floor(toNumber(seconds) || 0);
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);

  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}

function parseKeyValue(stdout) {
  const data = {};
  for (const line of stdout.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index > 0) data[line.slice(0, index)] = line.slice(index + 1);
  }
  return data;
}

function computePower(currentNow, voltageNow) {
  const current = toNumber(currentNow);
  const voltage = toNumber(voltageNow);
  if (current == null || voltage == null || current === 0 || voltage === 0) {
    return "暂不可用";
  }
  return `${(Math.abs(current * voltage) / 1_000_000_000_000).toFixed(2)} W`;
}

export async function readDeviceStats() {
  const command = `
BAT=/sys/class/power_supply/battery
read_file() {
  [ -r "$1" ] && cat "$1"
}

[ -r "$BAT/capacity" ] && printf 'battery_capacity=%s\n' "$(read_file "$BAT/capacity")"
[ -r "$BAT/status" ] && printf 'battery_status=%s\n' "$(read_file "$BAT/status")"
[ -r "$BAT/current_now" ] && printf 'current_now=%s\n' "$(read_file "$BAT/current_now")"
[ -r "$BAT/voltage_now" ] && printf 'voltage_now=%s\n' "$(read_file "$BAT/voltage_now")"
[ -r "$BAT/temp" ] && printf 'battery_temp=%s\n' "$(read_file "$BAT/temp")"

while read key value unit; do
  case "$key" in
    MemTotal:) printf 'mem_total=%s\n' "$value" ;;
    MemAvailable:) printf 'mem_available=%s\n' "$value" ;;
    SwapTotal:) printf 'swap_total=%s\n' "$value" ;;
    SwapFree:) printf 'swap_free=%s\n' "$value" ;;
  esac
done < /proc/meminfo

if read uptime rest < /proc/uptime; then
  printf 'uptime=%s\n' "$uptime"
fi

df -k /data 2>/dev/null | while read fs blocks used avail rest; do
  case "$blocks" in
    ''|*[!0-9]*) continue ;;
    *)
      printf 'data_total=%s\n' "$blocks"
      printf 'data_used=%s\n' "$used"
      printf 'data_available=%s\n' "$avail"
      ;;
  esac
done

[ -r /sys/block/zram0/disksize ] && printf 'zram_size=%s\n' "$(cat /sys/block/zram0/disksize)"
for zone in /sys/class/thermal/thermal_zone*; do
  [ -f "$zone/type" ] || continue
  TYPE=$(cat "$zone/type")
  TEMP=$(cat "$zone/temp" 2>/dev/null)
  case "$TYPE" in
    *cpu*|*CPU*|*soc*|*SOC*|*ap*|*AP*)
      printf 'soc_temp=%s\n' "$TEMP"
      break
      ;;
  esac
done
`.trim();

  const result = await exec(command);
  const data = parseKeyValue(result.stdout);

  const total = toNumber(data.data_total);
  const available = toNumber(data.data_available);
  const swapTotal = toNumber(data.swap_total);
  const swapFree = toNumber(data.swap_free);

  return {
    available: result.code === 0,
    battery: data.battery_capacity ? `${data.battery_capacity}%` : "暂不可用",
    batteryStatus: data.battery_status || "暂不可用",
    power: computePower(data.current_now, data.voltage_now),
    batteryTemp: formatTemperature(data.battery_temp),
    socTemp: formatTemperature(data.soc_temp),
    memory: `${formatBytesFromKb(data.mem_available)} / ${formatBytesFromKb(data.mem_total)}`,
    swap: `${formatBytesFromKb((swapTotal || 0) - (swapFree || 0))} / ${formatBytesFromKb(swapTotal)}`,
    zram: data.zram_size ? formatBytes(data.zram_size) : "暂不可用",
    storage: total ? `${formatBytesFromKb(available)} / ${formatBytesFromKb(total)}` : "暂不可用",
    uptime: formatUptime(data.uptime)
  };
}
