import { MODULE_DIR, STATE_DIR, exec, readText, writeBase64 } from "./bridge.js";
import { shellQuote, resultMessage, parseKeyValueLines, parseStateFile } from "./utils.js";

const LEGACY_EVERYTHING_DEFAULTS = new Set([
  "force_install_everything",
  "force_ota_everything",
  "force_cmdline_everything",
  "priv_apps_oob",
  "secondary_everything",
  "global_everything"
]);

export function allowedRiskSet(config) {
  const mode = ["safe", "caution", "aggressive"].includes(config.riskMode) ? config.riskMode : "safe";
  if (mode === "aggressive" && !config.riskAgreement?.aggressiveUnlocked) return new Set(["caution"]);
  return new Set([mode]);
}

function riskAllowed(categoryId, config) {
  return allowedRiskSet(config).has(categoryId);
}

export async function loadJson(path, fallback) {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(response.statusText);
    return await response.json();
  } catch {
    return fallback;
  }
}

export function buildDefaultConfig(options) {
  const items = {};

  for (const category of options.categories) {
    for (const item of category.items) {
      items[item.id] = {
        enabled: category.id === "aggressive" ? false : Boolean(item.defaultEnabled),
        value: item.defaultValue
      };
    }
  }

  return {
    profile: "safe",
    riskMode: "safe",
    riskAgreement: {
      version: 1,
      agreed: false,
      agreedAt: "",
      customUnlocked: false,
      aggressiveUnlocked: false
    },
    pendingReboot: false,
    pendingBootId: "",
    pendingSavedAt: 0,
    rebootState: null,
    items
  };
}

function clone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

export async function loadUserConfig(options) {
  const fallback = buildDefaultConfig(options);
  const raw = await readText(`${STATE_DIR}/config.json`);
  const systemProp = await readText(`${MODULE_DIR}/system.prop`);
  const bootId = await readBootId();
  const serviceState = await readServiceState();
  let config = fallback;

  if (raw) {
    try {
      config = mergeConfig(fallback, JSON.parse(raw));
    } catch {
      config = fallback;
    }
  }

  if (shouldClearPendingReboot(config, bootId, serviceState)) {
    config.pendingReboot = false;
    config.pendingBootId = "";
    config.pendingSavedAt = 0;
  }
  config.rebootState = buildRebootState(config, bootId, serviceState);

  return systemProp ? applySystemPropState(options, config, systemProp) : config;
}

export function mergeConfig(base, incoming) {
  const merged = clone(base);

  merged.profile = incoming.profile || merged.profile;
  merged.riskMode = ["safe", "caution", "aggressive"].includes(incoming.riskMode) ? incoming.riskMode : merged.riskMode;
  merged.riskAgreement = {
    ...merged.riskAgreement,
    ...(incoming.riskAgreement || {})
  };
  merged.pendingReboot = Boolean(incoming.pendingReboot);
  merged.pendingBootId = String(incoming.pendingBootId || "");
  merged.pendingSavedAt = Number(incoming.pendingSavedAt || 0);
  merged.rebootState = null;

  for (const [id, value] of Object.entries(incoming.items || {})) {
    if (merged.items[id]) {
      const incomingValue = String(value.value ?? merged.items[id].value);
      merged.items[id] = {
        enabled: Boolean(value.enabled),
        value: LEGACY_EVERYTHING_DEFAULTS.has(id) && incomingValue === "everything"
          ? merged.items[id].value
          : incomingValue
      };
    }
  }

  return merged;
}

function scopedConfig(options, config) {
  const next = clone(config);
  if (next.riskMode === "aggressive" && !next.riskAgreement?.aggressiveUnlocked) {
    next.riskMode = "caution";
  }

  for (const category of options.categories) {
    for (const item of category.items) {
      if (!next.items[item.id]) continue;
      if (!riskAllowed(category.id, next)) {
        next.items[item.id] = {
          ...next.items[item.id],
          enabled: false
        };
      }
      if (category.id === "aggressive" && !next.riskAgreement?.aggressiveUnlocked) {
        next.items[item.id].enabled = false;
      }
    }
  }

  return next;
}

export function applySystemPropState(options, config, systemProp) {
  const next = clone(config);
  const entries = parseKeyValueLines(systemProp, false);
  const propBestEntry = new Map();

  for (const entry of entries) {
    const best = propBestEntry.get(entry.prop);
    if (!best || (entry.enabled && !best.enabled)) {
      propBestEntry.set(entry.prop, entry);
    }
  }

  for (const category of options.categories) {
    for (const item of category.items) {
      const itemState = next.items[item.id];
      if (!itemState) continue;

      const entry = propBestEntry.get(item.prop);
      if (!entry) continue;

      itemState.enabled = entry.enabled;
      itemState.value = entry.value;
    }
  }

  return next;
}

function managedProps(options) {
  const props = new Set();
  for (const category of options.categories) {
    for (const item of category.items) {
      if (item.prop) props.add(item.prop);
    }
  }
  return props;
}

async function readServiceState() {
  const unified = parseStateFile(await readText(`${STATE_DIR}/state.prop`));
  if (unified["service.status"] || unified["service.health"]) {
    return denormalizeState(unified, "service.");
  }
  return parseStateFile(await readText(`${STATE_DIR}/service-state.prop`));
}

function denormalizeState(state, prefix) {
  const result = {};
  for (const [key, value] of Object.entries(state || {})) {
    if (key.startsWith(prefix)) result[key.slice(prefix.length)] = value;
  }
  return result;
}

function shouldClearPendingReboot(config, bootId, serviceState) {
  if (!config.pendingReboot) return false;

  if (config.pendingBootId && bootId && config.pendingBootId !== bootId) {
    return true;
  }

  const settledAt = Number(serviceState.settled_at || 0);
  const settled = serviceState.status === "settled";

  if (settled && !settledAt) {
    return false;
  }

  if (config.pendingSavedAt && settledAt && settledAt >= config.pendingSavedAt) {
    return true;
  }

  if (config.pendingBootId && serviceState.boot_id && serviceState.boot_id !== config.pendingBootId) {
    return true;
  }

  if (config.pendingBootId && !bootId && settled && !hasServiceProblems(serviceState)) {
    return true;
  }

  return false;
}

function serviceCount(serviceState, key) {
  return Number(serviceState[key] || 0);
}

function hasServiceProblems(serviceState) {
  return serviceCount(serviceState, "failed_total") > 0 || serviceCount(serviceState, "mismatch_total") > 0;
}

function buildRebootState(config, bootId, serviceState) {
  const serviceStatus = serviceState.status || "";
  const servicePhase = serviceState.phase || "";
  const serviceHealth = serviceState.health || "";
  const serviceReason = serviceState.reason || "";
  const serviceSettledAt = Number(serviceState.settled_at || 0);
  const servicePropTotal = serviceCount(serviceState, "prop_total");
  const serviceAppliedTotal = serviceCount(serviceState, "applied_total");
  const serviceMatchedTotal = serviceCount(serviceState, "matched_total");
  const serviceMismatchTotal = serviceCount(serviceState, "mismatch_total");
  const serviceFailedTotal = serviceCount(serviceState, "failed_total");
  const serviceProblemTotal = serviceFailedTotal + serviceMismatchTotal;
  const serviceSummary = servicePropTotal
    ? `${servicePropTotal} 项，失败 ${serviceFailedTotal}，未粘住 ${serviceMismatchTotal}`
    : "";
  const serviceStateProblem = serviceStatus === "error" || serviceHealth === "problem" || serviceProblemTotal > 0;
  const serviceSkipped = serviceStatus === "skipped" || serviceHealth === "skipped";

  if (!config.pendingReboot) {
    return {
      label: serviceStateProblem ? "需检查" : serviceSkipped ? "未应用" : "已生效",
      reason: serviceStateProblem
        ? (serviceReason || `服务已运行，但有 ${serviceProblemTotal} 项写入异常`)
        : serviceSkipped ? (serviceReason || "设备未匹配到可应用的运行时属性")
          : serviceStatus === "settled" ? "服务已完成 settled" : "没有待应用配置",
      bootIdAvailable: Boolean(bootId),
      pendingBootId: "",
      pendingSavedAt: 0,
      serviceStatus,
      servicePhase,
      serviceHealth,
      serviceReason,
      serviceSettledAt,
      servicePropTotal,
      serviceAppliedTotal,
      serviceMatchedTotal,
      serviceMismatchTotal,
      serviceFailedTotal,
      serviceSummary
    };
  }

  let reason = "等待重启后生效";
  if (serviceStateProblem) {
    reason = serviceReason || `服务已运行，但有 ${serviceProblemTotal} 项写入异常`;
  } else if (serviceSkipped) {
    reason = serviceReason || "设备未匹配到可应用的运行时属性";
  } else if (!bootId && serviceStatus !== "settled") {
    reason = "未读到 boot_id，且服务尚未 settled";
  } else if (serviceStatus === "settled" && !serviceSettledAt) {
    reason = "服务状态缺少 settled_at";
  } else if (config.pendingSavedAt && serviceSettledAt && serviceSettledAt < config.pendingSavedAt) {
    reason = "服务 settled 早于本次保存";
  }

  return {
    label: "待重启",
    reason,
    bootIdAvailable: Boolean(bootId),
    pendingBootId: config.pendingBootId,
    pendingSavedAt: config.pendingSavedAt,
    serviceStatus,
    servicePhase,
    serviceHealth,
    serviceReason,
    serviceSettledAt,
    servicePropTotal,
    serviceAppliedTotal,
    serviceMatchedTotal,
    serviceMismatchTotal,
    serviceFailedTotal,
    serviceSummary
  };
}

function enabledOwnerByProp(options, config) {
  const owners = {};

  for (const category of options.categories) {
    for (const item of category.items) {
      if (config.items[item.id]?.enabled) {
        owners[item.prop] = item.id;
      }
    }
  }

  return owners;
}

function lineForItem(item, state, owners) {
  const value = state?.value ?? item.defaultValue;
  const enabled = Boolean(state?.enabled) && owners[item.prop] === item.id;
  const prefix = enabled ? "" : "# ";
  const description = String(item.description || "").replace(/\s+/g, " ").trim();

  return [
    `# ${item.label}`,
    ...(description ? [`# ${description}`] : []),
    `# 可选值: ${item.values.join(", ")}；当前值: ${value}`,
    `${prefix}${item.prop}=${value}`
  ].join("\n");
}

function preservedUnmanagedLines(options, currentSystemProp) {
  const managed = managedProps(options);
  const lines = [];
  for (const entry of parseKeyValueLines(currentSystemProp || "")) {
    if (!managed.has(entry.prop) && shouldPreserveUnmanagedProp(entry.prop)) {
      lines.push(`${entry.prop}=${entry.value}`);
    }
  }
  return lines;
}

function shouldPreserveUnmanagedProp(prop) {
  return !(
    prop.startsWith("oplus.") ||
    prop.startsWith("sys.oplus.") ||
    prop.startsWith("persist.oplus.") ||
    prop.startsWith("persist.sys.oplus.") ||
    prop.startsWith("persist.miui.") ||
    prop.startsWith("persist.sys.dexpreload.")
  );
}

export function generateSystemProp(options, config, currentSystemProp = "") {
  const output = [];
  const scoped = scopedConfig(options, config);
  const owners = enabledOwnerByProp(options, scoped);
  const preserved = preservedUnmanagedLines(options, currentSystemProp);

  for (const category of options.categories) {
    if (!riskAllowed(category.id, scoped)) continue;
    output.push("# ============================================================");
    output.push(`# ${category.title}`);
    output.push("# ============================================================");
    output.push("");

    for (const item of category.items) {
      output.push(lineForItem(item, scoped.items[item.id], owners));
      output.push("");
    }

    output.push("");
  }

  if (preserved.length) {
    output.push("# ============================================================");
    output.push("# Preserved unmanaged properties");
    output.push("# ============================================================");
    output.push("");
    output.push(...preserved);
    output.push("");
  }

  return output.join("\n").trim() + "\n";
}

function buildPropLockList(systemProp) {
  return parseKeyValueLines(systemProp)
    .map((entry) => `${entry.prop}=${entry.value}`)
    .join("\n") + "\n";
}

export function countEnabled(config, options = null) {
  if (!options) return Object.values(config.items).filter((item) => item.enabled).length;
  const scoped = scopedConfig(options, config);
  return Object.values(scoped.items).filter((item) => item.enabled).length;
}

export function countChanged(options, config) {
  const scoped = scopedConfig(options, config);
  let total = 0;
  for (const category of options.categories) {
    if (!riskAllowed(category.id, scoped)) continue;
    for (const item of category.items) {
      const current = scoped.items[item.id] || {};
      if (Boolean(current.enabled) !== Boolean(item.defaultEnabled) || String(current.value ?? "") !== String(item.defaultValue ?? "")) {
        total += 1;
      }
    }
  }
  return total;
}

export function countHighRiskEnabled(options, config) {
  const scoped = scopedConfig(options, config);
  let total = 0;
  for (const category of options.categories) {
    if (category.id !== "aggressive") continue;
    for (const item of category.items) {
      if (scoped.items[item.id]?.enabled) total += 1;
    }
  }
  return total;
}

function ensureOk(result, action) {
  if (result.code !== 0) {
    throw new Error(`${action} failed: ${resultMessage(result)}`);
  }
}

export async function saveConfig(options, config) {
  const nextConfig = scopedConfig(options, config);
  const bootId = await readBootId();
  delete nextConfig.rebootState;
  nextConfig.pendingReboot = true;
  nextConfig.pendingBootId = bootId;
  nextConfig.pendingSavedAt = Math.floor(Date.now() / 1000);

  const currentSystemProp = await readText(`${MODULE_DIR}/system.prop`);
  const systemProp = generateSystemProp(options, nextConfig, currentSystemProp);
  const configJson = JSON.stringify(nextConfig, null, 2) + "\n";
  const propLockList = buildPropLockList(systemProp);
  const stageDir = `${STATE_DIR}/stage-webui-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const configSource = `source=webui-custom\nupdated_at=${formatTimestamp(new Date())}\nversion=webui\nmatched_total=0\nreason=manual-save\n`;

  ensureOk(await exec(`rm -rf ${shellQuote(stageDir)} && mkdir -p ${shellQuote(stageDir)}`), "create staging directory");
  const writeResults = await Promise.all([
    writeBase64(`${stageDir}/system.prop`, systemProp),
    writeBase64(`${stageDir}/prop-lock.list`, propLockList),
    writeBase64(`${stageDir}/config.json`, configJson),
    writeBase64(`${stageDir}/config-source.prop`, configSource),
    writeBase64(`${stageDir}/risk-mode`, `${nextConfig.riskMode || "safe"}\n`)
  ]);
  ["stage system.prop", "stage prop-lock.list", "stage WebUI config", "stage config source", "stage risk mode"]
    .forEach((action, index) => ensureOk(writeResults[index], action));
  ensureOk(await exec(`sh ${shellQuote(`${MODULE_DIR}/core/webui-save.sh`)} ${shellQuote(MODULE_DIR)} ${shellQuote(stageDir)}`), "commit staged config");

  nextConfig.rebootState = buildRebootState(nextConfig, bootId, {});
  return nextConfig;
}

export async function readGeneratedSystemProp() {
  return readText(`${MODULE_DIR}/system.prop`);
}

async function readBootId() {
  return (await readText("/proc/sys/kernel/random/boot_id")).trim();
}

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
