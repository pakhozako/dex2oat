import { MODULE_DIR, STATE_DIR, exec, readText, writeBase64 } from "./bridge.js";
import { shellQuote, resultMessage, parseKeyValueLines, parseStateFile } from "./utils.js";
import { DEFAULT_SKIN_ID, VALID_SKIN_IDS } from "./skin-manifest.js";

const LEGACY_EVERYTHING_DEFAULTS = new Set([
  "force_install_everything",
  "force_ota_everything",
  "force_cmdline_everything",
  "priv_apps_oob",
  "secondary_everything",
  "global_everything"
]);

function coerceBooleanLike(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value !== 0 : fallback;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeSkinId(value, fallback = DEFAULT_SKIN_ID) {
  const id = String(value || "").trim();
  return VALID_SKIN_IDS.has(id) ? id : fallback;
}

const RISK_MODE_IDS = ["safe", "caution", "aggressive"];

function normalizeRiskMode(value, fallback = "safe") {
  const mode = String(value || "").trim();
  if (RISK_MODE_IDS.includes(mode)) return mode;
  return RISK_MODE_IDS.includes(fallback) ? fallback : "safe";
}

export function allowedRiskSet(config) {
  const mode = normalizeRiskMode(config?.riskMode, normalizeRiskMode(config?.profile));
  if (mode === "aggressive" && !config.riskAgreement?.aggressiveUnlocked) return new Set(["caution"]);
  return new Set([mode]);
}

function riskAllowed(categoryId, config) {
  return allowedRiskSet(config).has(categoryId);
}

let propPolicyPromise = null;

function parsePropPolicy(text) {
  const policy = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith("#")) continue;
    const [section, key, value = ""] = line.split("\t");
    if (!section || key !== "prop" || !value) continue;
    if (!policy[section]) policy[section] = [];
    policy[section].push(value);
  }
  return policy;
}

function propPatternMatches(pattern, prop) {
  const source = String(pattern || "");
  if (!source) return false;
  if (!/[?*]/.test(source)) return source === prop;
  const escaped = source.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`).test(prop);
}

function policyPropMatches(policy, section, prop) {
  return (policy?.[section] || []).some((pattern) => propPatternMatches(pattern, prop));
}

function shouldPromoteToEverything(value, prop, categoryId, policy) {
  if (!["safe", "caution"].includes(categoryId)) return false;
  if (!["verify", "speed-profile", "speed"].includes(String(value))) return false;
  return policyPropMatches(policy, "everything-compatible", prop);
}

function shouldKeepBackgroundDefault(prop, policy) {
  return policyPropMatches(policy, "background-default", prop);
}

export async function loadJson(path, fallback) {
  const protectedJson = readProtectedJson(path);
  if (protectedJson) return protectedJson;

  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(response.statusText);
    return await response.json();
  } catch {
    return fallback;
  }
}

function protectedDataForPath(path) {
  const data = globalThis.__DEX2OAT_WEBUI_DATA || {};
  if (path.endsWith("/app-meta.json")) return data.a;
  if (path.endsWith("/options.json")) return data.o;
  if (path.endsWith("/prop-policy.tsv")) return data.p;
  return null;
}

function readProtectedTextAsset(path) {
  const item = protectedDataForPath(path);
  if (!item) return null;
  try {
    return decodeProtectedText(item);
  } catch {
    return null;
  }
}

function readProtectedJson(path) {
  const text = readProtectedTextAsset(path);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function loadTextAsset(path, fallback = "") {
  const protectedText = readProtectedTextAsset(path);
  if (protectedText != null) return protectedText;

  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(response.statusText);
    return await response.text();
  } catch {
    return fallback;
  }
}

async function loadPropPolicy() {
  if (!propPolicyPromise) {
    propPolicyPromise = loadTextAsset("./data/prop-policy.tsv", "")
      .then(parsePropPolicy)
      .catch(() => ({}));
  }
  return propPolicyPromise;
}

export function decodeProtectedText(item) {
  const bytes = decodeProtectedBytes(item);
  let output = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    output += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
  }
  return decodeUtf8(output);
}

export function decodeProtectedBytes(item) {
  const chunks = item.c.slice().reverse();
  if (item.v >= 2 && chunks.length) {
    const rotation = Number(item.r || 0) % chunks.length;
    chunks.unshift(...chunks.splice(chunks.length - rotation, rotation));
  }
  const base64 = chunks.join("");
  const binary = atob(base64);
  const output = new Uint8Array(item.l);
  const name = item.n || "data";
  let maskState = (item.s ^ item.l ^ name.charCodeAt(0)) >>> 0;
  for (let index = 0; index < item.l; index += 1) {
    const nameCode = name.charCodeAt(index % name.length);
    let mask;
    if (item.v >= 2) {
      maskState = (Math.imul(maskState ^ (index + 0x9e3779b9) ^ nameCode, 1664525) + 1013904223) >>> 0;
      mask = (maskState ^ (maskState >>> 8) ^ (maskState >>> 16) ^ (item.s >>> ((index & 3) * 8))) & 0xff;
    } else {
      mask = (item.s + index * 31 + (index >>> 3) * 17 + nameCode) & 0xff;
    }
    output[item.l - 1 - index] = binary.charCodeAt(index) ^ mask;
  }
  return output;
}

function decodeUtf8(binaryText) {
  try {
    return decodeURIComponent(escape(binaryText));
  } catch {
    return binaryText;
  }
}

export function buildDefaultConfig(options) {
  const items = {};

  for (const category of options.categories) {
    for (const item of category.items) {
      items[item.id] = defaultStateForItem(item);
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
    ui: {
      skin: "default",
      skinMotion: true
    },
    rebootState: null,
    items
  };
}

export function fallbackValueForItem(item) {
  return String(item?.fallbackValue ?? item?.defaultValue ?? "");
}

export function displayFallbackValueForItem(item) {
  return String(item?.displayFallbackValue ?? item?.fallbackValue ?? item?.defaultValue ?? "");
}

function defaultStateForItem(item) {
  return {
    enabled: false,
    value: fallbackValueForItem(item),
    explicit: false,
    matched: false
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
  const propPolicy = await loadPropPolicy();
  const bootId = await readBootId();
  const serviceState = await readServiceState();
  let config = fallback;

  if (raw) {
    try {
      config = mergeConfig(fallback, JSON.parse(raw), options);
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

  return systemProp ? applySystemPropState(options, config, systemProp, propPolicy) : config;
}

export function mergeConfig(base, incoming, options = null) {
  const merged = clone(base);
  const incomingAgreement = incoming.riskAgreement || {};
  const optionsById = options ? optionIndex(options) : new Map();

  merged.riskMode = normalizeRiskMode(incoming.riskMode, normalizeRiskMode(incoming.profile, merged.riskMode));
  merged.profile = merged.riskMode;
  merged.riskAgreement = {
    ...merged.riskAgreement,
    ...incomingAgreement,
    agreed: coerceBooleanLike(incomingAgreement.agreed, merged.riskAgreement.agreed),
    customUnlocked: coerceBooleanLike(incomingAgreement.customUnlocked, merged.riskAgreement.customUnlocked),
    aggressiveUnlocked: coerceBooleanLike(incomingAgreement.aggressiveUnlocked, merged.riskAgreement.aggressiveUnlocked)
  };
  merged.pendingReboot = coerceBooleanLike(incoming.pendingReboot, merged.pendingReboot);
  merged.pendingBootId = String(incoming.pendingBootId || "");
  merged.pendingSavedAt = Number(incoming.pendingSavedAt || 0);
  merged.ui = {
    ...merged.ui,
    ...(incoming.ui && typeof incoming.ui === "object" ? incoming.ui : {}),
    skin: normalizeSkinId(incoming.ui?.skin, merged.ui.skin),
    skinMotion: coerceBooleanLike(incoming.ui?.skinMotion, merged.ui.skinMotion)
  };
  merged.rebootState = null;

  for (const [id, value] of Object.entries(incoming.items || {})) {
    if (merged.items[id]) {
      const item = optionsById.get(id);
      const baseState = merged.items[id];
      const incomingValue = String(value.value ?? baseState.value);
      const incomingEnabled = coerceBooleanLike(value.enabled, baseState.enabled);
      const hasExplicitField = Object.prototype.hasOwnProperty.call(value, "explicit");
      const normalizedIncomingValue = LEGACY_EVERYTHING_DEFAULTS.has(id) && incomingValue === "everything"
        ? baseState.value
        : incomingValue;
      const legacyDefaultValue = String(item?.defaultValue ?? baseState.value);
      const migratedExplicit = incomingEnabled !== baseState.enabled
        || (normalizedIncomingValue !== baseState.value && normalizedIncomingValue !== legacyDefaultValue);
      merged.items[id] = {
        enabled: incomingEnabled,
        value: normalizedIncomingValue,
        explicit: hasExplicitField
          ? coerceBooleanLike(value.explicit, baseState.explicit)
          : migratedExplicit,
        matched: coerceBooleanLike(value.matched, baseState.matched)
      };
    }
  }

  return merged;
}

function optionIndex(options) {
  const index = new Map();
  for (const category of options.categories || []) {
    for (const item of category.items || []) {
      index.set(item.id, item);
    }
  }
  return index;
}

export function normalizeConfig(options, config) {
  const fallback = buildDefaultConfig(options);
  const next = mergeConfig(fallback, config || {}, options);
  const index = optionIndex(options);

  next.riskMode = normalizeRiskMode(next.riskMode, normalizeRiskMode(next.profile));
  next.profile = next.riskMode;
  if (!next.riskAgreement || typeof next.riskAgreement !== "object") {
    next.riskAgreement = fallback.riskAgreement;
  }
  if (!next.ui || typeof next.ui !== "object") {
    next.ui = fallback.ui;
  }
  next.ui = {
    ...fallback.ui,
    ...next.ui,
    skin: normalizeSkinId(next.ui.skin, fallback.ui.skin),
    skinMotion: coerceBooleanLike(next.ui.skinMotion, fallback.ui.skinMotion)
  };

  for (const id of Object.keys(next.items)) {
    const item = index.get(id);
    if (!item) {
      delete next.items[id];
      continue;
    }
    const fallbackValue = fallbackValueForItem(item);
    const value = String(next.items[id]?.value ?? fallbackValue);
    next.items[id] = {
      enabled: coerceBooleanLike(next.items[id]?.enabled, false),
      value: item.values?.includes(value) ? value : fallbackValue,
      explicit: coerceBooleanLike(next.items[id]?.explicit, false),
      matched: coerceBooleanLike(next.items[id]?.matched, false)
    };
  }

  for (const [id, item] of index.entries()) {
    if (!next.items[id]) {
      next.items[id] = defaultStateForItem(item);
    }
  }

  return next;
}

function scopedConfig(options, config) {
  const next = clone(config);
  if (next.riskMode === "aggressive" && !next.riskAgreement?.aggressiveUnlocked) {
    next.riskMode = "caution";
    next.profile = next.riskMode;
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

export function applySystemPropState(options, config, systemProp, propPolicy = null) {
  const next = normalizeConfig(options, config);
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
      if (!itemState || itemState.explicit) continue;

      const entry = propBestEntry.get(item.prop);
      if (!entry?.enabled) {
        if (itemState.matched) {
          itemState.enabled = false;
          itemState.matched = false;
          itemState.value = fallbackValueForItem(item);
        }
        continue;
      }

      if (shouldKeepBackgroundDefault(item.prop, propPolicy) && item.defaultValue !== "") {
        itemState.enabled = true;
        itemState.matched = true;
        itemState.value = item.defaultValue;
        continue;
      }

      itemState.enabled = true;
      itemState.matched = true;
      const nextValue = shouldPromoteToEverything(entry.value, item.prop, category.id, propPolicy) && item.values?.includes("everything")
        ? "everything"
        : entry.value;
      itemState.value = item.values?.includes(nextValue) ? nextValue : fallbackValueForItem(item);
    }
  }

  return next;
}

export function applyRiskModeForMatched(options, config, matchedProps = null) {
  const next = normalizeConfig(options, config);
  const matched = normalizedMatchedProps(matchedProps);
  if (!matched) return next;

  if (next.riskMode === "aggressive" && !next.riskAgreement?.aggressiveUnlocked) {
    next.riskMode = "caution";
    next.profile = next.riskMode;
  }

  for (const category of options.categories) {
    for (const item of category.items) {
      const itemState = next.items[item.id];
      if (!itemState || itemState.explicit) continue;
      const isMatched = matched.has(item.prop);
      if (!isMatched) {
        itemState.enabled = false;
        itemState.matched = isMatched;
        itemState.value = fallbackValueForItem(item);
        continue;
      }
      itemState.enabled = true;
      itemState.matched = true;
      if (!item.values?.includes(String(itemState.value ?? ""))) {
        itemState.value = fallbackValueForItem(item);
      }
    }
  }

  return next;
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
  return serviceCount(serviceState, "failed_total") > 0 || serviceState.status === "error" || serviceState.health === "problem";
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
  const serviceStateProblem = serviceStatus === "error" || serviceHealth === "problem" || serviceFailedTotal > 0;
  const serviceStateWarning = serviceStatus === "warning" || serviceHealth === "warning" || serviceHealth === "warn" || serviceMismatchTotal > 0;
  const serviceSkipped = serviceStatus === "skipped" || serviceHealth === "skipped";
  const serviceRunning = serviceStatus === "running" || serviceHealth === "running";
  const syncingLabel = "同步中";
  const syncingReason = serviceReason || "服务正在同步运行时属性";

  if (!config.pendingReboot) {
    return {
      label: serviceStateProblem ? "需检查" : serviceSkipped ? "未应用" : serviceRunning ? syncingLabel : serviceStateWarning ? "需关注" : "已生效",
      reason: serviceStateProblem
        ? (serviceReason || `服务已运行，但有 ${serviceProblemTotal} 项写入异常`)
        : serviceSkipped ? (serviceReason || "设备未匹配到可应用的运行时属性")
          : serviceRunning ? syncingReason
          : serviceStateWarning ? (serviceReason || `服务已完成，但仍有 ${serviceProblemTotal} 项偏差`)
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

  let label = "待重启";
  let reason = "等待重启后生效";
  if (serviceStateProblem) {
    reason = serviceReason || `服务已运行，但有 ${serviceProblemTotal} 项写入异常`;
  } else if (serviceSkipped) {
    reason = serviceReason || "设备未匹配到可应用的运行时属性";
  } else if (serviceRunning) {
    label = syncingLabel;
    reason = syncingReason;
  } else if (serviceStateWarning) {
    label = "需关注";
    reason = serviceReason || `服务已完成，但仍有 ${serviceProblemTotal} 项偏差`;
  } else if (!bootId && serviceStatus !== "settled") {
    reason = "未读到 boot_id，且服务尚未 settled";
  } else if (serviceStatus === "settled" && !serviceSettledAt) {
    reason = "服务状态缺少 settled_at";
  } else if (config.pendingSavedAt && serviceSettledAt && serviceSettledAt < config.pendingSavedAt) {
    reason = "服务 settled 早于本次保存";
  }

  return {
    label,
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
      if (coerceBooleanLike(config.items[item.id]?.enabled, false)) {
        owners[item.prop] = item.id;
      }
    }
  }

  return owners;
}

function preferredOwnerByProp(options) {
  const owners = {};

  for (const category of options.categories) {
    for (const item of category.items) {
      if (!owners[item.prop]) owners[item.prop] = item.id;
    }
  }

  return owners;
}

function normalizedMatchedProps(matchedProps) {
  if (!matchedProps) return null;
  if (matchedProps instanceof Set) return matchedProps;
  if (Array.isArray(matchedProps)) return new Set(matchedProps.map(String).filter(Boolean));
  if (typeof matchedProps === "object") {
    return new Set(Object.keys(matchedProps).filter((key) => matchedProps[key]));
  }
  return null;
}

function lineForItem(item, state, owners) {
  const fallbackValue = fallbackValueForItem(item);
  const writeValue = String(state?.value ?? fallbackValue);
  const displayFallbackValue = displayFallbackValueForItem(item);
  const value = writeValue === fallbackValue && displayFallbackValue ? displayFallbackValue : writeValue;
  const enabled = Boolean(state?.enabled) && owners[item.prop] === item.id;
  const prefix = enabled ? "" : "# ";
  const description = String(item.description || "").replace(/\s+/g, " ").trim();

  return [
    `# ${item.label}`,
    ...(description ? [`# ${description}`] : []),
    `# 可选值: ${item.values.join(", ")}；当前值: ${value}`,
    `${prefix}${item.prop}=${writeValue}`
  ].join("\n");
}

export function generateSystemProp(options, config, currentSystemProp = "") {
  throw new Error("matched-props required; use generateSystemPropForMatched()");
}

export function generateSystemPropForMatched(options, config, currentSystemProp = "", matchedProps = null) {
  const output = [];
  const scoped = normalizeConfig(options, config);
  const owners = enabledOwnerByProp(options, scoped);
  const matched = normalizedMatchedProps(matchedProps);
  if (!matched) throw new Error("matched-props required");
  const preferredOwners = preferredOwnerByProp(options);

  for (const category of options.categories) {
    const lines = [];
    for (const item of category.items) {
      if (!matched.has(item.prop)) continue;
      if (owners[item.prop]) {
        if (owners[item.prop] !== item.id) continue;
      } else if (preferredOwners[item.prop] && preferredOwners[item.prop] !== item.id) {
        continue;
      }
      lines.push(lineForItem(item, scoped.items[item.id], owners));
    }
    if (!lines.length) continue;
    output.push("# ============================================================");
    output.push(`# ${category.title}`);
    output.push("# ============================================================");
    output.push("");
    for (const line of lines) {
      output.push(line);
      output.push("");
    }
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
  if (!options) return Object.values(config.items).filter((item) => coerceBooleanLike(item.enabled, false)).length;
  const scoped = scopedConfig(options, config);
  return Object.values(scoped.items).filter((item) => coerceBooleanLike(item.enabled, false)).length;
}

export function countChanged(options, config) {
  const scoped = scopedConfig(options, config);
  let total = 0;
  for (const category of options.categories) {
    if (!riskAllowed(category.id, scoped)) continue;
    for (const item of category.items) {
      const current = scoped.items[item.id] || {};
      if (coerceBooleanLike(current.enabled, false) || String(current.value ?? "") !== fallbackValueForItem(item)) {
        total += 1;
      }
    }
  }
  return total;
}

export function countHighRiskEnabled(options, config) {
  const next = scopedConfig(options, normalizeConfig(options, config));
  let total = 0;
  for (const category of options.categories) {
    if (category.id !== "aggressive") continue;
    for (const item of category.items) {
      if (coerceBooleanLike(next.items[item.id]?.enabled, false)) total += 1;
    }
  }
  return total;
}

export function countEnabledForMatched(options, config, matchedProps) {
  const matched = normalizedMatchedProps(matchedProps);
  if (!matched) return 0;
  const next = normalizeConfig(options, config);
  const owners = enabledOwnerByProp(options, next);
  let total = 0;

  for (const category of options.categories) {
    for (const item of category.items) {
      if (matched.has(item.prop) && owners[item.prop] === item.id) total += 1;
    }
  }

  return total;
}

export function countChangedForMatched(options, config, matchedProps) {
  const matched = normalizedMatchedProps(matchedProps);
  if (!matched) return 0;
  const next = normalizeConfig(options, config);
  const owners = enabledOwnerByProp(options, next);
  const preferredOwners = preferredOwnerByProp(options);
  let total = 0;

  for (const category of options.categories) {
    for (const item of category.items) {
      if (!matched.has(item.prop)) continue;
      if (owners[item.prop]) {
        if (owners[item.prop] !== item.id) continue;
      } else if (preferredOwners[item.prop] && preferredOwners[item.prop] !== item.id) {
        continue;
      }
      const current = next.items[item.id] || {};
      if (coerceBooleanLike(current.enabled, false) || String(current.value ?? "") !== fallbackValueForItem(item)) total += 1;
    }
  }

  return total;
}

export function countHighRiskEnabledForMatched(options, config, matchedProps) {
  const matched = normalizedMatchedProps(matchedProps);
  if (!matched) return 0;
  const next = normalizeConfig(options, config);
  const owners = enabledOwnerByProp(options, next);
  let total = 0;

  for (const category of options.categories) {
    if (category.id !== "aggressive") continue;
    for (const item of category.items) {
      if (matched.has(item.prop) && owners[item.prop] === item.id) total += 1;
    }
  }

  return total;
}

function ensureOk(result, action) {
  if (result.code !== 0) {
    throw new Error(`${action} failed: ${resultMessage(result)}`);
  }
}

export async function saveConfig(options, config, onProgress = null) {
  throw new Error("matched-props required; use saveConfigForMatched()");
}

export async function saveConfigForMatched(options, config, matchedProps = null, onProgress = null) {
  const nextConfig = normalizeConfig(options, config);
  const matched = normalizedMatchedProps(matchedProps);
  if (nextConfig.riskMode === "aggressive" && !nextConfig.riskAgreement?.aggressiveUnlocked) {
    nextConfig.riskMode = "caution";
    nextConfig.profile = nextConfig.riskMode;
  }
  const bootId = await readBootId();
  delete nextConfig.rebootState;
  nextConfig.pendingReboot = true;
  nextConfig.pendingBootId = bootId;
  nextConfig.pendingSavedAt = Math.floor(Date.now() / 1000);

  const currentSystemProp = await readText(`${MODULE_DIR}/system.prop`);
  const systemProp = generateSystemPropForMatched(options, nextConfig, currentSystemProp, matched);
  const configJson = JSON.stringify(nextConfig, null, 2) + "\n";
  const propLockList = buildPropLockList(systemProp);
  const stageDir = `${STATE_DIR}/stage-webui-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const configSource = `source=webui-custom\nupdated_at=${formatTimestamp(new Date())}\nversion=webui\nmatched_total=${matched ? matched.size : 0}\nreason=manual-save\n`;

  try {
    if (typeof onProgress === "function") onProgress("正在准备保存工作区...");
    ensureOk(await exec(`rm -rf ${shellQuote(stageDir)} && mkdir -p ${shellQuote(stageDir)}`), "create staging directory");
    const stagedFiles = [
      ["正在写入 system.prop...", "stage system.prop", `${stageDir}/system.prop`, systemProp],
      ["正在写入 prop-lock.list...", "stage prop-lock.list", `${stageDir}/prop-lock.list`, propLockList],
      ["正在写入配置 JSON...", "stage WebUI config", `${stageDir}/config.json`, configJson],
      ["正在写入来源信息...", "stage config source", `${stageDir}/config-source.prop`, configSource],
      ["正在写入 risk mode...", "stage risk mode", `${stageDir}/risk-mode`, `${nextConfig.riskMode || "safe"}\n`]
    ];
    for (const [progress, action, filePath, content] of stagedFiles) {
      if (typeof onProgress === "function") onProgress(progress);
      ensureOk(await writeBase64(filePath, content), action);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (typeof onProgress === "function") onProgress("正在提交配置...");
    ensureOk(await exec(`sh ${shellQuote(`${MODULE_DIR}/core/webui-save.sh`)} ${shellQuote(MODULE_DIR)} ${shellQuote(stageDir)}`), "commit staged config");
  } catch (error) {
    await exec(`rm -rf ${shellQuote(stageDir)}`);
    throw error;
  }

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
