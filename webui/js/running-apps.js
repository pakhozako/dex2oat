import { exec } from "./bridge.js";

function cleanFocus(raw) {
  const line = raw.split(/\r?\n/).find(Boolean) || "";
  const match = line.match(/[a-zA-Z0-9_.]+\/[a-zA-Z0-9_.$]+/);
  return match ? match[0].split("/")[0] : "暂不可用";
}

function parseProcesses(stdout) {
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  const processes = [];

  for (const line of lines.slice(0, 20)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2 || !/^\d+$/.test(parts[0])) continue;

    processes.push({
      pid: parts[0],
      name: parts.slice(1, -1).join(" ") || parts[1],
      rss: parts.length > 2 ? `${parts[parts.length - 1]} KB` : "未知"
    });
  }

  return processes;
}

export async function readRunningApps() {
  const command = `
echo __FOCUS__
dumpsys window 2>/dev/null | grep -E 'mCurrentFocus|mFocusedApp' | head -n 1
echo __COUNT__
ps -A 2>/dev/null | wc -l
echo __PS__
ps -A -o PID,NAME,RSS 2>/dev/null | head -n 21
`.trim();

  const result = await exec(command);

  if (result.code !== 0) {
    return {
      foreground: "暂不可用",
      count: "暂不可用",
      processes: []
    };
  }

  const focusPart = result.stdout.split("__COUNT__")[0].replace("__FOCUS__", "").trim();
  const countPart = result.stdout.split("__COUNT__")[1]?.split("__PS__")[0]?.trim() || "";
  const psPart = result.stdout.split("__PS__")[1] || "";

  return {
    foreground: cleanFocus(focusPart),
    count: countPart || "暂不可用",
    processes: parseProcesses(psPart)
  };
}
