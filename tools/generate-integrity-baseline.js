#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const output = path.join(root, "core/integrity-baseline.prop");
const files = [
  "customize.sh",
  "service.sh",
  "uninstall.sh",
  "system.prop",
  "module.prop",
  "core/state.sh",
  "core/health-check.sh",
  "core/conflict-detect.sh",
  "core/prop-lock.sh",
  "core/integrity-check.sh",
  "scripts/capture-props.sh",
  "scripts/generate-props.sh",
  "webroot/index.html",
  "webroot/css/app.css",
  "webroot/js/app.js",
  "webroot/js/config.js",
  "webroot/js/bridge.js",
  "webroot/js/ui.js",
  "webroot/js/utils.js",
  "webroot/js/system-info.js",
  "webroot/data/options.json",
  "webroot/data/app-meta.json"
];

function hashFile(relativePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relativePath))).digest("hex");
}

const lines = files
  .filter((relativePath) => fs.existsSync(path.join(root, relativePath)))
  .map((relativePath) => `${relativePath}=${hashFile(relativePath)}`);

fs.writeFileSync(output, `${lines.join("\n")}\n`, "utf8");
console.log(`generate-integrity-baseline: ${path.relative(root, output)}`);
