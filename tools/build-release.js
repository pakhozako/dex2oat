#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const distDir = path.join(root, "dist");
const modulePropPath = path.join(root, "module.prop");
const requiredPackageEntries = [
  "META-INF/com/google/android/update-binary",
  "META-INF/com/google/android/updater-script",
  "module.prop",
  "customize.sh",
  "service.sh",
  "uninstall.sh",
  "system.prop",
  "update.json",
  "CHANGELOG.md",
  "README.md",
  "scripts/capture-props.sh",
  "scripts/generate-props.sh",
  "core/state.sh",
  "core/integrity-check.sh",
  "core/integrity-baseline.prop",
  "core/health-check.sh",
  "core/conflict-detect.sh",
  "core/prop-lock.sh",
  "webroot/index.html",
  "webroot/data/options.json",
  "webroot/data/app-meta.json"
];

function parseModuleProp() {
  const result = {};
  for (const line of fs.readFileSync(modulePropPath, "utf8").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index > 0) result[line.slice(0, index)] = line.slice(index + 1);
  }
  return result;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false, ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
}

function shouldCopy(entry) {
  if ([".git", "dist", "tools"].includes(entry)) return false;
  if (/\.zip$/i.test(entry)) return false;
  if (/\.tmp$/i.test(entry)) return false;
  return true;
}

function copyReleaseTree(dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(root)) {
    if (!shouldCopy(entry)) continue;
    fs.cpSync(path.join(root, entry), path.join(dest, entry), { recursive: true });
  }
}

function zipDirectory(sourceRoot, zipPath) {
  const items = fs.readdirSync(sourceRoot);
  const psCommand = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.IO.Compression",
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    `$root = '${sourceRoot.replace(/'/g, "''")}'`,
    `$items = @(${items.map((entry) => `'${entry.replace(/'/g, "''")}'`).join(",")})`,
    `$dest = '${zipPath.replace(/'/g, "''")}'`,
    "if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }",
    "$archive = [System.IO.Compression.ZipFile]::Open($dest, [System.IO.Compression.ZipArchiveMode]::Create)",
    "try {",
    "  foreach ($item in $items) {",
    "    $path = Join-Path $root $item",
    "    if (Test-Path -LiteralPath $path -PathType Leaf) {",
    "      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $path, $item.Replace('\\', '/')) | Out-Null",
    "    } else {",
    "      Get-ChildItem -LiteralPath $path -Recurse -File | ForEach-Object {",
    "        $relative = $_.FullName.Substring($root.Length + 1).Replace('\\', '/')",
    "        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $relative) | Out-Null",
    "      }",
    "    }",
    "  }",
    "} finally { $archive.Dispose() }"
  ].join("; ");
  run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCommand]);
}

function verifyZip(zipPath, { protectedWebui }) {
  if (!fs.existsSync(zipPath)) throw new Error(`zip was not created: ${zipPath}`);
  const forbidden = protectedWebui ? ["tools/", "vendor/", "props/", "webroot/js/app.js.map"] : ["tools/", "vendor/", "props/"];
  const psCommand = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    `$zip = '${zipPath.replace(/'/g, "''")}'`,
    `$required = @(${requiredPackageEntries.map((entry) => `'${entry.replace(/'/g, "''")}'`).join(",")})`,
    `$forbidden = @(${forbidden.map((entry) => `'${entry.replace(/'/g, "''")}'`).join(",")})`,
    "$archive = [System.IO.Compression.ZipFile]::OpenRead($zip)",
    "try {",
    "  $entries = @{}",
    "  foreach ($entry in $archive.Entries) { $entries[$entry.FullName] = $true }",
    "  foreach ($item in $required) { if (-not $entries.ContainsKey($item)) { throw \"missing package entry: $item\" } }",
    "  foreach ($entry in $archive.Entries) { foreach ($bad in $forbidden) { if ($entry.FullName.StartsWith($bad)) { throw \"forbidden package entry: $($entry.FullName)\" } } }",
    "} finally { $archive.Dispose() }"
  ].join("; ");
  run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCommand]);
}

const moduleProp = parseModuleProp();
const version = moduleProp.version;
if (!version) throw new Error("module.prop version missing");

run(process.execPath, [path.join(root, "tools/generate-integrity-baseline.js"), root]);
run(process.execPath, [path.join(root, "tools/validate-options.js")]);

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dex2oat-release-"));
const sourceStage = path.join(tempRoot, "source");
const protectedStage = path.join(tempRoot, "protected");
const sourceZip = path.join(distDir, `Dex2oat-Lock-${version}-webui-source.zip`);
const protectedZip = path.join(distDir, `Dex2oat-Lock-${version}.zip`);

copyReleaseTree(sourceStage);
run(process.execPath, [path.join(root, "tools/generate-integrity-baseline.js"), sourceStage]);
zipDirectory(sourceStage, sourceZip);
verifyZip(sourceZip, { protectedWebui: false });

copyReleaseTree(protectedStage);
run(process.execPath, [path.join(root, "tools/protect-webui.js"), protectedStage]);
run(process.execPath, [path.join(root, "tools/generate-integrity-baseline.js"), protectedStage]);
zipDirectory(protectedStage, protectedZip);
verifyZip(protectedZip, { protectedWebui: true });

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log(`build-release: ${path.relative(root, protectedZip)} public`);
console.log(`build-release: ${path.relative(root, sourceZip)} source-archive`);
