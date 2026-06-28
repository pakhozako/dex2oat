/**
 * 共享工具函数
 */

export function parseKeyValue(stdout) {
  const data = {};
  for (const line of stdout.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index > 0) data[line.slice(0, index)] = line.slice(index + 1);
  }
  return data;
}

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

export function resultMessage(result) {
  return result.stderr || result.stdout || `exit ${result.code}`;
}

export function parseKeyValueLines(content, allowComments) {
  const entries = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (allowComments !== false && trimmed.startsWith("#")) continue;

    const enabled = !trimmed.startsWith("#");
    const body = enabled ? trimmed : trimmed.replace(/^#\s*/, "");
    const index = body.indexOf("=");
    if (index <= 0) continue;

    entries.push({
      prop: body.slice(0, index),
      value: body.slice(index + 1),
      enabled,
      raw: trimmed
    });
  }
  return entries;
}

export function parseStateFile(content) {
  const state = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    state[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return state;
}
