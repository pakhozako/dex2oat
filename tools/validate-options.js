#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const jsonFiles = [
  "update.json",
  "webroot/data/app-meta.json",
  "webroot/data/options.json"
];

const jsFiles = [
  "tools/generate-integrity-baseline.js",
  "tools/protect-webui.js",
  "webroot/js/app.js",
  "webroot/js/bridge.js",
  "webroot/js/config.js",
  "webroot/js/system-info.js",
  "webroot/js/ui.js",
  "webroot/js/utils.js"
];

const lfFiles = [
  "module.prop",
  "customize.sh",
  "service.sh",
  "uninstall.sh",
  "system.prop",
  "scripts/capture-props.sh",
  "scripts/generate-props.sh",
  "core/state.sh",
  "core/integrity-baseline.prop",
  "core/integrity-check.sh",
  "core/health-check.sh",
  "core/conflict-detect.sh",
  "core/prop-lock.sh"
];

const requiredFiles = [
  "module.prop",
  "customize.sh",
  "service.sh",
  "uninstall.sh",
  "scripts/capture-props.sh",
  "scripts/generate-props.sh",
  "core/state.sh",
  "core/integrity-baseline.prop",
  "core/integrity-check.sh",
  "core/health-check.sh",
  "core/conflict-detect.sh",
  "core/prop-lock.sh",
  "webroot/data/options.json"
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseModuleProp() {
  const result = {};
  for (const line of read("module.prop").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index > 0) result[line.slice(0, index)] = line.slice(index + 1);
  }
  return result;
}

function parseJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function runNodeCheck(relativePath) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, relativePath)], { stdio: "inherit" });
  assert(result.status === 0, `JS syntax check failed: ${relativePath}`);
}

function validateOptionFile(relativePath) {
  const data = parseJson(relativePath);
  assert(Array.isArray(data.categories), `${relativePath}: categories must be an array`);
  const categoryIds = new Set(data.categories.map((category) => category.id));
  for (const required of ["safe", "caution", "aggressive"]) {
    assert(categoryIds.has(required), `${relativePath}: missing risk category ${required}`);
  }
  const propOwners = new Map();
  for (const category of data.categories) {
    assert(category.id && category.title && category.tone, `${relativePath}: invalid category`);
    assert(Array.isArray(category.items), `${relativePath}: items must be an array`);
    for (const item of category.items) {
      assert(item.id && item.label && item.prop, `${relativePath}: invalid item`);
      assert(Array.isArray(item.values) && item.values.length > 0, `${relativePath}: ${item.id} values missing`);
      assert(item.values.includes(item.defaultValue), `${relativePath}: ${item.id} defaultValue not in values`);
      const owner = propOwners.get(item.prop);
      if (owner) {
        assert(owner === item.id || category.id !== "safe", `${relativePath}: duplicate safe prop ${item.prop}`);
      }
      propOwners.set(item.prop, item.id);
    }
  }
}

for (const file of requiredFiles) {
  assert(fs.existsSync(path.join(root, file)), `required file missing: ${file}`);
}

for (const file of jsonFiles) parseJson(file);
for (const file of jsFiles) runNodeCheck(file);
for (const file of lfFiles) {
  assert(!read(file).includes("\r\n"), `CRLF line endings found: ${file}`);
}

for (const file of jsonFiles.filter((file) => file.includes("options"))) {
  validateOptionFile(file);
}

const moduleProp = parseModuleProp();
const updateJson = parseJson("update.json");
const appMeta = parseJson("webroot/data/app-meta.json");
assert(moduleProp.version === "v3.1", "module.prop version must be v3.1");
assert(String(moduleProp.versionCode) === "31", "module.prop versionCode must be 31");
assert(updateJson.version === moduleProp.version, "update.json version mismatch");
assert(String(updateJson.versionCode) === String(moduleProp.versionCode), "update.json versionCode mismatch");
assert(appMeta.version === moduleProp.version, "app-meta version mismatch");

console.log("validate-options: ok");
