import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const options = JSON.parse(await readFile(path.join(root, "webroot-src", "data", "options.json"), "utf8"));
const errors = [];
const warnings = [];
const ids = new Map();
const props = new Map();
const propEntries = new Map();

function riskRank(risk) {
  return { safe: 1, caution: 2, aggressive: 3 }[risk] || 9;
}

for (const category of options.categories || []) {
  if (!["safe", "caution", "aggressive"].includes(category.id)) {
    errors.push(`unknown category id: ${category.id}`);
  }
  for (const item of category.items || []) {
    if (!item.id) errors.push(`missing id in ${category.id}`);
    if (!item.prop) errors.push(`missing prop for ${item.id}`);
    if (!Array.isArray(item.values) || !item.values.includes(item.defaultValue)) {
      errors.push(`defaultValue not present in values: ${item.id}`);
    }
    if (category.id === "aggressive" && item.defaultEnabled) {
      warnings.push(`aggressive defaultEnabled normalized off for auto rules: ${item.id}`);
    }
    ids.set(item.id, (ids.get(item.id) || 0) + 1);
    props.set(item.prop, (props.get(item.prop) || 0) + 1);
    if (item.prop) {
      const entries = propEntries.get(item.prop) || [];
      entries.push({ id: item.id, risk: category.id, defaultEnabled: Boolean(item.defaultEnabled) });
      propEntries.set(item.prop, entries);
    }
  }
}

for (const [id, count] of ids.entries()) {
  if (count > 1) errors.push(`duplicate id: ${id}`);
}

const duplicateProps = [...props.entries()].filter(([, count]) => count > 1);
const computedConflicts = duplicateProps.map(([prop]) => {
  const candidates = propEntries.get(prop) || [];
  const owner = [...candidates]
    .filter((entry) => entry.risk !== "aggressive")
    .sort((left, right) => riskRank(left.risk) - riskRank(right.risk))[0]
    || [...candidates].sort((left, right) => riskRank(left.risk) - riskRank(right.risk))[0];
  return {
    prop,
    owner: owner?.id || "",
    reason: "auto-owner-prefers-lowest-risk-non-aggressive-rule",
    candidates
  };
});
const declaredConflicts = options.ruleConflicts || [];
if (declaredConflicts.length && duplicateProps.length !== declaredConflicts.length) {
  errors.push(`duplicate prop count ${duplicateProps.length} does not match ruleConflicts ${declaredConflicts.length}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(JSON.stringify({
  schemaVersion: options.schemaVersion,
  rulesVersion: options.rulesVersion,
  categories: options.categories?.length || 0,
  items: [...ids.keys()].length,
  duplicateProps: duplicateProps.length,
  conflicts: computedConflicts,
  warnings
}, null, 2));
