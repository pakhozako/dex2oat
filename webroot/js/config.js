import { MODULE_DIR, STATE_DIR, exec, readText, writeBase64 } from "./bridge.js";
import { shellQuote, resultMessage } from "./utils.js";

const LEGACY_EVERYTHING_DEFAULTS = new Set([
  "force_install_everything",
  "force_ota_everything",
  "force_cmdline_everything",
  "priv_apps_oob",
  "secondary_everything",
  "global_everything"
]);

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
        enabled: Boolean(item.defaultEnabled),
        value: item.defaultValue
      };
    }
  }

  return {
    profile: "safe",
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

function parseSystemPropEntries(content) {
  const entries = [];

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const enabled = !trimmed.startsWith("#");
    const body = enabled ? trimmed : trimmed.replace(/^#\s*/, "");
    const index = body.indexOf("=");
    if (index <= 0) continue;

    entries.push({
      prop: body.slice(0, index),
      value: body.slice(index + 1),
      enabled
    });
  }

  return entries;
}

export function applySystemPropState(options, config, systemProp) {
  const next = clone(config);
  const entries = parseSystemPropEntries(systemProp);
  const propEntries = new Map();

  for (const entry of entries) {
    if (!propEntries.has(entry.prop)) propEntries.set(entry.prop, []);
    propEntries.get(entry.prop).push(entry);
  }

  for (const category of options.categories) {
    for (const item of category.items) {
      const itemState = next.items[item.id];
      if (!itemState) continue;

      const entry = propEntries.get(item.prop)?.shift();
      if (!entry) continue;

      itemState.enabled = entry.enabled;
      itemState.value = entry.value;
    }
  }

  return next;
}

function parseStateFile(content) {
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

async function readServiceState() {
  return parseStateFile(await readText(`${STATE_DIR}/service-state.prop`));
}

function shouldClearPendingReboot(config, bootId, serviceState) {
  if (!config.pendingReboot) return false;

  if (config.pendingBootId && bootId && config.pendingBootId !== bootId) {
    return true;
  }

  const settledAt = Number(serviceState.settled_at || 0);
  if (serviceState.status !== "settled" || !settledAt || hasServiceProblems(serviceState)) {
    return false;
  }

  if (config.pendingSavedAt && settledAt >= config.pendingSavedAt) {
    return true;
  }

  return Boolean(config.pendingBootId && serviceState.boot_id && serviceState.boot_id !== config.pendingBootId);
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
        : serviceSkipped ? (serviceReason || "设备不在 ColorOS/OPlus 支持范围，运行时属性未应用")
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
    reason = serviceReason || "设备不在 ColorOS/OPlus 支持范围，运行时属性未应用";
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

export function generateSystemProp(options, config) {
  const output = [];
  const owners = enabledOwnerByProp(options, config);

  for (const category of options.categories) {
    output.push("# ============================================================");
    output.push(`# ${category.title}`);
    output.push("# ============================================================");
    output.push("");

    for (const item of category.items) {
      output.push(lineForItem(item, config.items[item.id], owners));
      output.push("");
    }

    output.push("");
  }

  return output.join("\n").trim() + "\n";
}

export function countEnabled(config) {
  return Object.values(config.items).filter((item) => item.enabled).length;
}

function ensureOk(result, action) {
  if (result.code !== 0) {
    throw new Error(`${action} failed: ${resultMessage(result)}`);
  }
}

export async function saveConfig(options, config) {
  const nextConfig = clone(config);
  const bootId = await readBootId();
  delete nextConfig.rebootState;
  nextConfig.pendingReboot = true;
  nextConfig.pendingBootId = bootId;
  nextConfig.pendingSavedAt = Math.floor(Date.now() / 1000);

  const systemProp = generateSystemProp(options, nextConfig);
  const configJson = JSON.stringify(nextConfig, null, 2) + "\n";

  ensureOk(await exec(`mkdir -p ${shellQuote(STATE_DIR + '/backup')}`), "create backup directory");
  ensureOk(await exec(`[ -f ${shellQuote(MODULE_DIR + '/system.prop')} ] && cp -af ${shellQuote(MODULE_DIR + '/system.prop')} ${shellQuote(STATE_DIR + '/backup/system.prop.bak')}`), "backup system.prop");
  ensureOk(await writeBase64(`${MODULE_DIR}/system.prop`, systemProp), "write system.prop");
  ensureOk(await writeBase64(`${STATE_DIR}/config.json`, configJson), "write WebUI config");

  nextConfig.rebootState = buildRebootState(nextConfig, bootId, {});
  return nextConfig;
}

export async function readGeneratedSystemProp() {
  return readText(`${MODULE_DIR}/system.prop`);
}

async function readBootId() {
  return (await readText("/proc/sys/kernel/random/boot_id")).trim();
}
