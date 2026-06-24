#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const jsonFiles = [
  "update.json",
  "webroot/data/app-meta.json",
  "webroot/data/vendors.json",
  "webroot/data/options.json",
  "webroot/data/options-xiaomi.json",
  "webroot/data/options-samsung.json",
  "webroot/data/options-pixel.json",
  "webroot/data/options-generic.json"
];

const jsFiles = [
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
  "scripts/match-props.sh",
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
  "scripts/match-props.sh",
  "core/health-check.sh",
  "core/conflict-detect.sh",
  "core/prop-lock.sh",
  "props/oplus.prop",
  "props/xiaomi.prop",
  "vendor/samsung.prop",
  "vendor/pixel.prop",
  "vendor/miui.prop",
  "vendor/meizu.prop",
  "vendor/redmagic.prop",
  "vendor/generic.prop",
  "webroot/data/options-samsung.json",
  "webroot/data/options-pixel.json",
  "webroot/data/options-generic.json"
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
  for (const category of data.categories) {
    assert(category.id && category.title && category.tone, `${relativePath}: invalid category`);
    assert(Array.isArray(category.items), `${relativePath}: items must be an array`);
    for (const item of category.items) {
      assert(item.id && item.label && item.prop, `${relativePath}: invalid item`);
      assert(Array.isArray(item.values) && item.values.length > 0, `${relativePath}: ${item.id} values missing`);
      assert(item.values.includes(item.defaultValue), `${relativePath}: ${item.id} defaultValue not in values`);
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
assert(moduleProp.version === "v3.0", "module.prop version must be v3.0");
assert(String(moduleProp.versionCode) === "30", "module.prop versionCode must be 30");
assert(updateJson.version === moduleProp.version, "update.json version mismatch");
assert(String(updateJson.versionCode) === String(moduleProp.versionCode), "update.json versionCode mismatch");
assert(appMeta.version === moduleProp.version, "app-meta version mismatch");

console.log("validate-options: ok");
