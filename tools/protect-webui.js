#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const webroot = path.join(root, "webroot");

function walk(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(fullPath));
    else result.push(fullPath);
  }
  return result;
}

function compactLines(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//"))
    .join("\n") + "\n";
}

function terserFile(file) {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const tempFile = `${file}.min.tmp`;
  const result = spawnSync(npx, ["--yes", "terser", file, "-c", "-m", "--module", "-o", tempFile], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.status !== 0 || !fs.existsSync(tempFile)) return false;
  fs.renameSync(tempFile, file);
  return true;
}

function compactCss(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,>])\s*/g, "$1")
    .trim() + "\n";
}

function compactHtml(content) {
  return content
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .replace(/\s{2,}/g, " ")
    .trim() + "\n";
}

for (const file of walk(webroot)) {
  const relative = path.relative(root, file).replace(/\\/g, "/");
  const ext = path.extname(file);
  const original = fs.readFileSync(file, "utf8");
  let next = original;
  if (ext === ".js") {
    if (!terserFile(file)) next = compactLines(original);
    else next = fs.readFileSync(file, "utf8");
  }
  if (ext === ".json") next = compactLines(original);
  if (ext === ".css") next = compactCss(original);
  if (ext === ".html") next = compactHtml(original);
  if (next !== original) fs.writeFileSync(file, next, "utf8");
  console.log(`protect-webui: ${relative}`);
}
