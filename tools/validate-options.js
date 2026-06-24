#!/usr/bin/env node
// tools/validate-options.js - v2.7 pre-release validation
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
let errors = 0;

function fail(msg) { console.error("  FAIL:", msg); errors++; }
function pass(msg) { console.log("  OK  :", msg); }

// 1. JSON validity
for (const f of ["webroot/data/options.json", "webroot/data/options-xiaomi.json", "webroot/data/vendors.json", "webroot/data/app-meta.json", "update.json"]) {
  try { JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")); pass(`JSON valid: ${f}`); }
  catch (e) { fail(`JSON invalid: ${f} — ${e.message}`); }
}

// 2. JS syntax
for (const f of ["webroot/js/app.js", "webroot/js/bridge.js", "webroot/js/config.js", "webroot/js/utils.js"]) {
  try { execSync(`node --check ${path.join(ROOT, f)}`, { stdio: "pipe" }); pass(`JS syntax: ${f}`); }
  catch (e) { fail(`JS syntax: ${f} — ${e.stderr?.toString().trim()}`); }
}

// 3. LF line endings
for (const f of ["module.prop", "customize.sh", "service.sh", "uninstall.sh", "system.prop", "scripts/capture-props.sh", "scripts/match-props.sh"]) {
  const b = fs.readFileSync(path.join(ROOT, f));
  if (b.includes(Buffer.from("\r\n"))) fail(`CRLF found: ${f}`);
  else pass(`LF: ${f}`);
}

// 4. Version consistency
const moduleProp = fs.readFileSync(path.join(ROOT, "module.prop"), "utf8");
const versionMatch = moduleProp.match(/^version=(.+)$/m);
const versionCodeMatch = moduleProp.match(/^versionCode=(\d+)$/m);
const updateJson = JSON.parse(fs.readFileSync(path.join(ROOT, "update.json"), "utf8"));
const appMeta = JSON.parse(fs.readFileSync(path.join(ROOT, "webroot/data/app-meta.json"), "utf8"));
const moduleVersion = versionMatch?.[1];
const moduleVersionCode = Number(versionCodeMatch?.[1]);
if (moduleVersion === updateJson.version && moduleVersionCode === updateJson.versionCode && moduleVersion === appMeta.version)
  pass(`Version consistent: ${moduleVersion} / ${moduleVersionCode}`);
else
  fail(`Version mismatch: module=${moduleVersion}/${moduleVersionCode} update.json=${updateJson.version}/${updateJson.versionCode} app-meta=${appMeta.version}`);

// 5. Vendors list coverage
const vendors = JSON.parse(fs.readFileSync(path.join(ROOT, "webroot/data/vendors.json"), "utf8"));
for (const v of vendors.vendors) {
  const optFile = path.join(ROOT, "webroot/data", v.options);
  const propFile = path.join(ROOT, "props", `${v.id}.prop`);
  if (!fs.existsSync(optFile)) fail(`vendor ${v.id}: options file missing: ${optFile}`);
  else pass(`vendor ${v.id}: options file OK`);
  if (!fs.existsSync(propFile)) fail(`vendor ${v.id}: prop template missing: ${propFile}`);
  else pass(`vendor ${v.id}: prop template OK`);

  // 6. Safe defaults consistency
  const options = JSON.parse(fs.readFileSync(optFile, "utf8"));
  const items = options.categories.flatMap((c) => c.items.map((i) => ({ ...i, cat: c.id })));
  const propLines = fs.readFileSync(propFile, "utf8").split(/\r?\n/);
  const active = new Map(), all = new Map();
  for (const line of propLines) {
    const t = line.trim();
    if (!t) continue;
    const enabled = !t.startsWith("#");
    const body = enabled ? t : t.replace(/^#\s*/, "");
    const idx = body.indexOf("=");
    if (idx > 0) { all.set(body.slice(0, idx), body.slice(idx + 1)); if (enabled) active.set(body.slice(0, idx), body.slice(idx + 1)); }
  }
  const safeMissing = items.filter((i) => i.cat === "safe" && !active.has(i.prop));
  const safeWrong = items.filter((i) => i.cat === "safe" && active.has(i.prop) && active.get(i.prop) !== i.defaultValue);
  const missingAll = [...new Set(items.map((i) => i.prop))].filter((p) => !all.has(p));
  if (safeMissing.length) fail(`vendor ${v.id}: safe items missing from prop: ${safeMissing.map((i) => i.prop).join(", ")}`);
  else pass(`vendor ${v.id}: all safe items present`);
  if (safeWrong.length) fail(`vendor ${v.id}: safe item value mismatch: ${safeWrong.map((i) => `${i.prop}=${active.get(i.prop)} != ${i.defaultValue}`).join(", ")}`);
  else pass(`vendor ${v.id}: safe item values correct`);
  if (missingAll.length) fail(`vendor ${v.id}: props missing from template: ${missingAll.join(", ")}`);
  else pass(`vendor ${v.id}: all option props covered`);
}

console.log(`\n${errors ? `\u274c ${errors} error(s)` : "\u2705 All checks passed"}`);
if (errors) process.exit(1);
