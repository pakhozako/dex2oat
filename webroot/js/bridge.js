export const MODULE_DIR = "/data/adb/modules/dex2oat-lock";
export const STATE_DIR = "/data/adb/dex2oat-lock";

let kernelSuApi;
let kernelSuApiLoaded = false;
let callbackIndex = 0;

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

    globalThis[callbackName] = (errno, stdout, stderr) => {
      delete globalThis[callbackName];
      resolve({
        code: Number(errno || 0),
        stdout: String(stdout || ""),
        stderr: String(stderr || "")
      });
    };

    try {
      bridge.exec(command, "{}", callbackName);
    } catch (error) {
      delete globalThis[callbackName];
      resolve({
        code: 1,
        stdout: "",
        stderr: String(error)
      });
    }
  });
}

export async function readText(path) {
  const result = await exec(`cat '${path}' 2>/dev/null`);
  return result.code === 0 ? result.stdout.trim() : "";
}

export async function writeBase64(path, content) {
  const encoded = btoa(unescape(encodeURIComponent(content)));
  const command = [
    `mkdir -p '${STATE_DIR}/backup'`,
    `printf '%s' '${encoded}' | base64 -d > '${path}'`
  ].join("; ");
  return exec(command);
}
