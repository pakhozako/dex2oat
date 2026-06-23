#!/usr/bin/env node
// tools/build-release.js - v2.7 build script
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");

// 1. Run validation
console.log("=== Validating ===");
try { execSync(`node ${path.join(ROOT, "tools/validate-options.js")}`, { stdio: "inherit", cwd: ROOT }); }
catch { process.exit(1); }

// 2. Read version for filename
const moduleProp = fs.readFileSync(path.join(ROOT, "module.prop"), "utf8");
const version = moduleProp.match(/^version=(.+)$/m)?.[1]?.trim();
if (!version) { console.error("Cannot read version from module.prop"); process.exit(1); }

const zipPath = path.join(ROOT, `dex2oat-${version}.zip`);

// 3. Build ZIP using JSZip-free approach (Node built-in)
const FILES = [
  "META-INF/com/google/android/update-binary",
  "META-INF/com/google/android/updater-script",
  "customize.sh",
  "module.prop",
  "service.sh",
  "skip_mount",
  "system.prop",
  "uninstall.sh",
  "update.json",
  "props/oplus.prop",
  "props/xiaomi.prop",
  "webroot/css/app.css",
  "webroot/data/app-meta.json",
  "webroot/data/options.json",
  "webroot/data/options-xiaomi.json",
  "webroot/data/vendors.json",
  "webroot/index.html",
  "webroot/js/app.js",
  "webroot/js/bridge.js",
  "webroot/js/config.js",
  "webroot/js/system-info.js",
  "webroot/js/ui.js",
  "webroot/js/utils.js",
];

// Use PowerShell to build the zip (Windows)
const ps1 = [
  `Add-Type -AssemblyName System.IO.Compression`,
  `Add-Type -AssemblyName System.IO.Compression.FileSystem`,
  `$base = '${ROOT.replace(/\\/g, "\\\\")}'`,
  `$zipPath = '${zipPath.replace(/\\/g, "\\\\")}'; if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }`,
  `$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)`,
  `try {`,
  ...FILES.map((f) => {
    const src = path.join(ROOT, f).replace(/\\/g, "\\\\");
    return `  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, '${src}', '${f}', [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null`;
  }),
  `} finally { $zip.Dispose() }`,
  `Write-Host "ZIP: $((Get-Item -LiteralPath $zipPath).Length) bytes -> $zipPath"`,
].join("; ");

console.log(`\n=== Building ${version} ===`);
try { execSync(`powershell -Command "${ps1}"`, { stdio: "inherit" }); }
catch { process.exit(1); }

// 4. Verify ZIP paths (no backslashes)
const { execSync: run } = require("child_process");
const verifyPs = [
  `Add-Type -AssemblyName System.IO.Compression.FileSystem`,
  `$zip = [System.IO.Compression.ZipFile]::OpenRead('${zipPath.replace(/\\/g, "\\\\")}')`,
  `try { $bad = @($zip.Entries | Where-Object { $_.FullName -like '*\\\\*' }); if ($bad.Count) { $bad | ForEach-Object { $_.FullName }; exit 1 }; 'OK entries=' + $zip.Entries.Count } finally { $zip.Dispose() }`,
].join("; ");
try {
  const out = run(`powershell -Command "${verifyPs}"`, { encoding: "utf8" }).trim();
  console.log(`\nZIP verify: ${out}`);
} catch { console.error("ZIP path verification failed"); process.exit(1); }

console.log(`\n✅ Build complete: dex2oat-${version}.zip`);
