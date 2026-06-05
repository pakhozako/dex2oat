import { MODULE_DIR, STATE_DIR, exec, readText, writeBase64 } from "./bridge.js";

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

  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw);
    return mergeConfig(fallback, parsed);
  } catch {
    return fallback;
  }
}

export function mergeConfig(base, incoming) {
  const merged = clone(base);

  merged.profile = incoming.profile || merged.profile;
  merged.pendingReboot = Boolean(incoming.pendingReboot);

  for (const [id, value] of Object.entries(incoming.items || {})) {
    if (merged.items[id]) {
      merged.items[id] = {
        enabled: Boolean(value.enabled),
        value: String(value.value ?? merged.items[id].value)
      };
    }
  }

  return merged;
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

  return [
    `# ${item.label}`,
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

export function resetSafeProfile(options) {
  return buildDefaultConfig(options);
}

export async function saveConfig(options, config) {
  const nextConfig = clone(config);
  nextConfig.pendingReboot = true;

  const systemProp = generateSystemProp(options, nextConfig);
  const configJson = JSON.stringify(nextConfig, null, 2) + "\n";

  await exec(`mkdir -p '${STATE_DIR}/backup'`);
  await exec(`[ -f '${MODULE_DIR}/system.prop' ] && cp -af '${MODULE_DIR}/system.prop' '${STATE_DIR}/backup/system.prop.bak'`);
  await writeBase64(`${MODULE_DIR}/system.prop`, systemProp);
  await writeBase64(`${STATE_DIR}/config.json`, configJson);

  return nextConfig;
}

export async function readGeneratedSystemProp() {
  return readText(`${MODULE_DIR}/system.prop`);
}
