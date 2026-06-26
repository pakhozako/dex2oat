const { execFileSync, spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function slash(value) {
  return String(value).replace(/\\/g, "/");
}

function rel(file) {
  return slash(path.relative(root, file));
}

function pathExists(target) {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch (error) {
    if (fallback !== null) return fallback;
    throw error;
  }
}

async function writeJson(file, data) {
  await ensureDir(path.dirname(file));
  await fsp.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function run(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: options.timeout || 120000
  });
  return {
    command,
    args,
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || result.error?.message || ""
  };
}

function runOrThrow(command, args = [], options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    const detail = `${result.stdout}\n${result.stderr}`.trim();
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function where(command) {
  const candidates = [];
  const whereResult = run(process.platform === "win32" ? "where.exe" : "which", [command], { timeout: 15000 });
  if (whereResult.status === 0) {
    for (const line of whereResult.stdout.split(/\r?\n/)) {
      const item = line.trim();
      if (item && pathExists(item)) candidates.push(path.resolve(item));
    }
  }
  return [...new Set(candidates)];
}

function firstCommand(commands) {
  for (const command of commands) {
    const found = where(command);
    if (found.length) return found[0];
  }
  return "";
}

function versionOf(command, args = ["--version"]) {
  if (!command) return "";
  const result = run(command, args, { timeout: 15000 });
  const text = `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/)[0] || "";
  return result.status === 0 || text ? text : "";
}

function isInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function safeRemove(target, allowedRoot = root) {
  const resolved = path.resolve(target);
  if (!isInside(allowedRoot, resolved)) {
    throw new Error(`Refusing to remove outside workspace: ${resolved}`);
  }
  await fsp.rm(resolved, { recursive: true, force: true });
}

function shouldSkipRel(relativePath, extraSkips = []) {
  const normalized = slash(relativePath);
  const first = normalized.split("/")[0];
  const defaults = new Set([
    ".git",
    ".webui-src-temp",
    "node_modules",
    "dist",
    "release",
    "temp",
    "cache",
    ".cache",
    "发布版",
    "源码版"
  ]);
  if (defaults.has(first)) return true;
  return extraSkips.some((skip) => normalized === skip || normalized.startsWith(`${skip}/`));
}

async function listFiles(dir, options = {}) {
  const base = path.resolve(dir);
  const files = [];
  async function walk(current) {
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const relative = slash(path.relative(base, full));
      if (shouldSkipRel(relative, options.skip || [])) continue;
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }
  if (pathExists(base)) await walk(base);
  return files.sort((a, b) => slash(a).localeCompare(slash(b)));
}

async function copyTree(source, target, options = {}) {
  const sourceRoot = path.resolve(source);
  const files = await listFiles(sourceRoot, { skip: options.skip || [] });
  await safeRemove(target, options.allowedRemoveRoot || path.dirname(path.resolve(target)));
  await ensureDir(target);
  for (const file of files) {
    const relative = path.relative(sourceRoot, file);
    const out = path.join(target, relative);
    await ensureDir(path.dirname(out));
    await fsp.copyFile(file, out);
  }
}

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function sha256File(file) {
  return sha256Buffer(await fsp.readFile(file));
}

function nowStamp() {
  const d = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function defaultConfig() {
  return {
    root,
    toolsDir: path.join(root, "tools"),
    webuiSourceDir: pathExists(path.join(root, "webroot-src")) ? path.join(root, "webroot-src") : path.join(root, "webroot"),
    webuiOutDir: path.join(root, "webroot"),
    releaseDir: path.join(path.dirname(root), "发布版"),
    sourceDir: path.join(path.dirname(root), "源码版"),
    tempDir: path.join(root, "temp"),
    cacheDir: path.join(root, "cache"),
    distDir: path.join(root, "dist"),
    versionFile: path.join(root, "tools", "version.json"),
    nodePath: process.execPath,
    shellPath: "",
    gitPath: "",
    pythonPath: "",
    sevenZipPath: "",
    hashTool: ""
  };
}

async function loadConfig() {
  const configPath = path.join(root, "build.config.json");
  const generated = defaultConfig();
  const existing = await readJson(configPath, {});
  return { ...generated, ...existing, root };
}

module.exports = {
  copyTree,
  defaultConfig,
  ensureDir,
  firstCommand,
  isInside,
  listFiles,
  loadConfig,
  nowStamp,
  os,
  pathExists,
  readJson,
  rel,
  root,
  run,
  runOrThrow,
  safeRemove,
  sha256Buffer,
  sha256File,
  slash,
  versionOf,
  where,
  writeJson
};
