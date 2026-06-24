import { shellQuote, resultMessage } from "./utils.js";
export const MODULE_DIR = "/data/adb/modules/dex2oat-lock";
export const STATE_DIR = "/data/adb/dex2oat-lock";

let kernelSuApi;
let kernelSuApiLoaded = false;
let callbackIndex = 0;
const EXEC_TIMEOUT_MS = 15000;

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
      try {
        kernelSuApi = await import("kernelsu");
      } catch {
        kernelSuApi = null;
      }
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
      clearTimeout(timer);
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
  const bytes = new TextEncoder().encode(content);
  const bytesPerChunk = 1536;
  const base64Chunks = [];
  for (let i = 0; i < bytes.length; i += bytesPerChunk) {
    let chunk = "";
    for (let j = i; j < i + bytesPerChunk && j < bytes.length; j++) {
      chunk += String.fromCharCode(bytes[j]);
    }
    base64Chunks.push(btoa(chunk));
  }
  const quotedPath = shellQuote(path);
  const dirCmd = `mkdir -p ${shellQuote(path.replace(/\/[^/]*$/, ""))}`;
  const tempPath = `${path}.b64.tmp`;
  const outputTempPath = `${path}.write.tmp`;
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
