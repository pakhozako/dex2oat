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
