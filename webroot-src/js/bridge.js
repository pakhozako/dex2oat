import { shellQuote } from "./utils.js";
export const MODULE_DIR = "/data/adb/modules/dex2oat-lock";
export const STATE_DIR = "/data/adb/dex2oat-lock";

let kernelSuApi;
let kernelSuApiLoaded = false;
let callbackIndex = 0;
const EXEC_TIMEOUT_MS = 15000;
const callbackRegistry = new Map();
const EXPORT_DIR = "/storage/emulated/0/Download";
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const ALLOWED_EXPORT_PATHS = new Set([
  `${EXPORT_DIR}/dex2oat-lock-config-backup.json`
]);
const ALLOWED_STATE_WRITE_PATHS = new Set([
  `${STATE_DIR}/trigger-rematch`,
  `${STATE_DIR}/dex2oat-lock-diagnostic.txt`
]);

function uniqueWriteSuffix() {
  return `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

async function loadKernelSuApi() {
  try {
    const dynamicImport = Function("name", "return import(name)");
    return await dynamicImport("kernelsu");
  } catch {
    return null;
  }
}

function normalizeWritePath(path) {
  return String(path || "").replace(/\/+/g, "/");
}

function isAuthorizedWritePath(path) {
  const normalized = normalizeWritePath(path);
  if (!normalized.startsWith("/") || normalized.includes("/../") || normalized.endsWith("/..")) return false;
  if (/^\/data\/adb\/dex2oat-lock\/stage-webui-[A-Za-z0-9.-]+\/(system\.prop|prop-lock\.list|config\.json|config-source\.prop|risk-mode)$/.test(normalized)) return true;
  if (ALLOWED_STATE_WRITE_PATHS.has(normalized)) return true;
  if (ALLOWED_EXPORT_PATHS.has(normalized)) return true;
  return false;
}

function encodeUtf8Bytes(value) {
  const text = String(value);
  if (typeof TextEncoder === "function") {
    return new TextEncoder().encode(text);
  }

  const bytes = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      }
    }

    if (code <= 0x7f) {
      bytes.push(code);
    } else if (code <= 0x7ff) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code <= 0xffff) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return bytes;
}

function encodeBase64Binary(binary) {
  if (typeof btoa === "function") return btoa(binary);
  let output = "";
  let index = 0;
  while (index < binary.length) {
    const first = binary.charCodeAt(index++) & 0xff;
    const second = index < binary.length ? binary.charCodeAt(index++) & 0xff : NaN;
    const third = index < binary.length ? binary.charCodeAt(index++) & 0xff : NaN;
    output += BASE64_ALPHABET[first >> 2];
    output += BASE64_ALPHABET[((first & 0x03) << 4) | ((second || 0) >> 4)];
    output += second !== second ? "=" : BASE64_ALPHABET[((second & 0x0f) << 2) | ((third || 0) >> 6)];
    output += third !== third ? "=" : BASE64_ALPHABET[third & 0x3f];
  }
  return output;
}

function normalizeExecResult(result) {
  if (result == null) {
    return { code: 0, stdout: "", stderr: "" };
  }

  if (typeof result === "string") {
    return { code: 0, stdout: result, stderr: "" };
  }

  return {
    code: Number(result.code ?? result.errno ?? result.exitCode ?? 0),
    stdout: String(result.stdout ?? result.out ?? result.result ?? ""),
    stderr: String(result.stderr ?? result.err ?? "")
  };
}

export async function exec(command) {
  try {
    if (!kernelSuApiLoaded) {
      kernelSuApiLoaded = true;
      kernelSuApi = await loadKernelSuApi();
    }

    if (kernelSuApi && typeof kernelSuApi.exec === "function") {
      return normalizeExecResult(await kernelSuApi.exec(command));
    }

    if (globalThis.ksu && typeof globalThis.ksu.exec === "function") {
      return execWithCallback(globalThis.ksu, command);
    }

    if (globalThis.KernelSU && typeof globalThis.KernelSU.exec === "function") {
      return execWithCallback(globalThis.KernelSU, command);
    }

    const bridges = [
      globalThis.apatch,
      globalThis.APatch,
      globalThis.WebUI,
      globalThis.webui,
      globalThis.WebUIX,
      globalThis.webuiX,
      globalThis.nativeBridge
    ];

    for (const bridge of bridges) {
      if (bridge && typeof bridge.exec === "function") {
        return normalizeExecResult(await bridge.exec(command));
      }
      if (bridge && typeof bridge.shell === "function") {
        return normalizeExecResult(await bridge.shell(command));
      }
    }
  } catch (error) {
    return { code: 1, stdout: "", stderr: String(error) };
  }

  return {
    code: 127,
    stdout: "",
    stderr: "No WebUI shell bridge is available."
  };
}



function execWithCallback(bridge, command) {
  return new Promise((resolve) => {
    const callbackName = `dex2oat_exec_${Date.now()}_${callbackIndex++}`;
    const finish = (result) => {
      const entry = callbackRegistry.get(callbackName);
      if (!entry) return;
      clearTimeout(entry.timer);
      callbackRegistry.delete(callbackName);
      delete globalThis[callbackName];
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({
        code: 124,
        stdout: "",
        stderr: `WebUI shell bridge timed out after ${EXEC_TIMEOUT_MS}ms.`
      });
    }, EXEC_TIMEOUT_MS);
    callbackRegistry.set(callbackName, { timer, resolve });

    globalThis[callbackName] = (errno, stdout, stderr) => {
      finish({
        code: Number(errno || 0),
        stdout: String(stdout || ""),
        stderr: String(stderr || "")
      });
    };

    try {
      bridge.exec(command, "{}", callbackName);
    } catch (error) {
      finish({
        code: 1,
        stdout: "",
        stderr: String(error)
      });
    }
  });
}

export async function readText(path) {
  const result = await exec(`cat ${shellQuote(path)} 2>/dev/null`);
  return result.code === 0 ? result.stdout.trim() : "";
}

export async function writeBase64(path, content) {
  const safePath = normalizeWritePath(path);
  if (!isAuthorizedWritePath(safePath)) {
    return {
      code: 126,
      stdout: "",
      stderr: `Unauthorized WebUI write path: ${path}`
    };
  }
  const bytes = encodeUtf8Bytes(content);
  const bytesPerChunk = 6144;
  const base64Chunks = [];
  for (let i = 0; i < bytes.length; i += bytesPerChunk) {
    let chunk = "";
    for (let j = i; j < i + bytesPerChunk && j < bytes.length; j++) {
      chunk += String.fromCharCode(bytes[j]);
    }
    base64Chunks.push(encodeBase64Binary(chunk));
  }
  const quotedPath = shellQuote(safePath);
  const dirCmd = `mkdir -p ${shellQuote(safePath.replace(/\/[^/]*$/, ""))}`;
  const tempSuffix = uniqueWriteSuffix();
  const tempPath = `${safePath}.${tempSuffix}.b64.tmp`;
  const outputTempPath = `${safePath}.${tempSuffix}.write.tmp`;
  const quotedTempPath = shellQuote(tempPath);
  const quotedOutputTempPath = shellQuote(outputTempPath);
  const appendCommands = base64Chunks.map((chunk) => `printf '%s' ${shellQuote(chunk)} >> ${quotedTempPath}`);
  const writeCmd = `base64 -d ${quotedTempPath} 2>/dev/null > ${quotedOutputTempPath}`;
  const fallbackCmd = `base64 --decode ${quotedTempPath} 2>/dev/null > ${quotedOutputTempPath}`;
  let result = await exec([dirCmd, `rm -f ${quotedTempPath} ${quotedOutputTempPath}`, `: > ${quotedTempPath}`].join("; "));
  if (result.code !== 0) return result;

  for (const command of appendCommands) {
    result = await exec(command);
    if (result.code !== 0) {
      await exec(`rm -f ${quotedTempPath} ${quotedOutputTempPath}`);
      return result;
    }
  }

  result = await exec(`(${writeCmd}) || (${fallbackCmd})`);
  if (result.code === 0) {
    result = await exec(`mv -f ${quotedOutputTempPath} ${quotedPath}`);
  }
  await exec(`rm -f ${quotedTempPath} ${quotedOutputTempPath}`);
  if (result.code !== 0) return result;

  return exec(`chmod 0600 ${quotedPath} 2>/dev/null || true`);
}
