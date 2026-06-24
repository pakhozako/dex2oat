#!/usr/bin/env node

const fs = require("fs");
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
  "props/oplus.prop",
  "props/xiaomi.prop",
  "vendor/samsung.prop",
  "vendor/pixel.prop",
  "vendor/miui.prop",
  "vendor/meizu.prop",
  "vendor/redmagic.prop",
  "vendor/generic.prop",
  "scripts/capture-props.sh",
  "scripts/match-props.sh",
  "core/health-check.sh",
  "core/conflict-detect.sh",
  "core/prop-lock.sh",
  "webroot/index.html",
  "webroot/data/vendors.json",
  "webroot/data/options.json",
  "webroot/data/options-xiaomi.json",
  "webroot/data/options-samsung.json",
  "webroot/data/options-pixel.json",
  "webroot/data/options-generic.json",
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
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
  }
}

const moduleProp = parseModuleProp();
const version = moduleProp.version;
if (!version) throw new Error("module.prop version missing");

run(process.execPath, [path.join(root, "tools/validate-options.js")]);

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

const zipName = `dex2oat-${version}.zip`;
const zipPath = path.join(distDir, zipName);
const exclude = new Set([".git", "dist", "tools"]);
const entries = fs.readdirSync(root).filter((entry) => !exclude.has(entry));

const psCommand = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName System.IO.Compression",
  "Add-Type -AssemblyName System.IO.Compression.FileSystem",
  `$root = '${root.replace(/'/g, "''")}'`,
  `$items = @(${entries.map((entry) => `'${entry.replace(/'/g, "''")}'`).join(",")})`,
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
  "} finally {",
  "  $archive.Dispose()",
  "}"
].join("; ");

run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCommand]);

if (!fs.existsSync(zipPath)) throw new Error(`zip was not created: ${zipPath}`);

const verifyCommand = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName System.IO.Compression.FileSystem",
  `$zip = '${zipPath.replace(/'/g, "''")}'`,
  `$required = @(${requiredPackageEntries.map((entry) => `'${entry.replace(/'/g, "''")}'`).join(",")})`,
  "$archive = [System.IO.Compression.ZipFile]::OpenRead($zip)",
  "try {",
  "  $entries = @{}",
  "  foreach ($entry in $archive.Entries) { $entries[$entry.FullName] = $true }",
  "  foreach ($item in $required) { if (-not $entries.ContainsKey($item)) { throw \"missing package entry: $item\" } }",
  "} finally {",
  "  $archive.Dispose()",
  "}"
].join("; ");

run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", verifyCommand]);
console.log(`build-release: ${path.relative(root, zipPath)}`);
