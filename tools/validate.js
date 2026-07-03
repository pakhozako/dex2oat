const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { run, root } = require("./toolkit");
const { readSkinCssAssets } = require("./skin-assets");
const { validateJs } = require("./validate-js");
const { validateJson } = require("./validate-json");
const { validatePython } = require("./validate-python");
const { validateShell } = require("./validate-shell");
const { validateFixtures } = require("./validate-fixtures");
const { validateWebuiSmoke } = require("./validate-webui-smoke");

function slash(value) {
  return String(value).replace(/\\/g, "/");
}

function listFilesSync(dir) {
  const base = path.resolve(dir);
  const files = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }
  if (fs.existsSync(base)) walk(base);
  return files.sort((a, b) => slash(a).localeCompare(slash(b)));
}

function validateSupporterPoolVersion() {
  const warnings = [];
  const versionPath = path.join(root, "tools", "version.json");
  const supportersPath = path.join(root, "deploy", "cloud", "supporters.private.json");
  if (!fs.existsSync(supportersPath)) return { available: false, warnings };

  try {
    const version = JSON.parse(fs.readFileSync(versionPath, "utf8"));
    const supporters = JSON.parse(fs.readFileSync(supportersPath, "utf8"));
    if (supporters.versionCode !== version.versionCode || supporters.version !== version.version) {
      warnings.push(`supporter pool ${supporters.version || "unknown"}/${supporters.versionCode || 0} != release ${version.version}/${version.versionCode}; confirm reuse or rotate explicitly`);
    }
    return {
      available: true,
      version: supporters.version || "",
      versionCode: Number(supporters.versionCode || 0),
      releaseVersion: version.version || "",
      releaseVersionCode: Number(version.versionCode || 0),
      warnings
    };
  } catch (error) {
    warnings.push(`supporter pool version check failed: ${error.message}`);
    return { available: false, warnings };
  }
}

function validateBuiltSourceVersion(options = {}) {
  const warnings = [];
  const versionPath = path.join(root, "tools", "version.json");
  const modulePropPath = path.join(root, "构建", "source", "module.prop");
  if (!fs.existsSync(modulePropPath)) return { available: false, warnings };

  const version = JSON.parse(fs.readFileSync(versionPath, "utf8"));
  const moduleProp = fs.readFileSync(modulePropPath, "utf8");
  const expectedVersion = `version=${version.version}`;
  const expectedVersionCode = `versionCode=${version.versionCode}`;
  const ok = moduleProp.includes(expectedVersion) && moduleProp.includes(expectedVersionCode);
  if (!ok) {
    const message = `构建/source 版本不是 ${version.version}/${version.versionCode}，请重新执行 node tools/build.js 后再发布`;
    if (options.blocking) throw new Error(message);
    warnings.push(message);
  }
  return {
    available: true,
    path: modulePropPath,
    version: version.version,
    versionCode: Number(version.versionCode || 0),
    ok,
    warnings
  };
}

function readKeyValueFile(file) {
  const result = {};
  const text = fs.readFileSync(file, "utf8");
  return parseKeyValueText(text);
}

function parseKeyValueText(text) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (match) result[match[1].trim()] = match[2].trim();
  }
  return result;
}

function assertHttpsUrl(value, label) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") throw new Error("not https");
    return url;
  } catch {
    throw new Error(`${label} must be a valid https URL`);
  }
}

function validateUpdateMetadata() {
  const version = JSON.parse(fs.readFileSync(path.join(root, "tools", "version.json"), "utf8"));
  const updatePath = path.join(root, "update.json");
  const modulePropPath = path.join(root, "module.prop");
  const appMetaPath = path.join(root, "webroot-src", "data", "app-meta.json");
  const update = JSON.parse(fs.readFileSync(updatePath, "utf8"));
  const moduleProp = readKeyValueFile(modulePropPath);
  const appMeta = JSON.parse(fs.readFileSync(appMetaPath, "utf8"));
  const expectedZipName = `Dex2oat-Lock-${version.version}-release.zip`;

  if (update.version !== version.version || Number(update.versionCode || 0) !== Number(version.versionCode || 0)) {
    throw new Error(`update.json version ${update.version}/${update.versionCode} != ${version.version}/${version.versionCode}`);
  }
  if (update.zipUrl !== version.zipUrl) {
    throw new Error("update.json zipUrl does not match tools/version.json");
  }
  if (update.changelog !== version.changelog) {
    throw new Error("update.json changelog does not match tools/version.json");
  }
  const zipUrl = assertHttpsUrl(update.zipUrl, "update.json zipUrl");
  assertHttpsUrl(update.changelog, "update.json changelog");
  if (!zipUrl.pathname.endsWith(`/${expectedZipName}`)) {
    throw new Error(`update.json zipUrl must point to ${expectedZipName}`);
  }

  const requiredModuleFields = {
    id: version.id,
    name: version.name,
    version: version.version,
    versionCode: String(version.versionCode),
    author: version.author,
    updateJson: version.updateJson
  };
  for (const [key, expected] of Object.entries(requiredModuleFields)) {
    if (moduleProp[key] !== String(expected)) {
      throw new Error(`module.prop ${key} ${moduleProp[key] || "missing"} != ${expected}`);
    }
  }
  assertHttpsUrl(moduleProp.updateJson, "module.prop updateJson");

  if (appMeta.moduleName !== version.name || appMeta.version !== version.version || Number(appMeta.versionCode || 0) !== Number(version.versionCode || 0)) {
    throw new Error("webroot-src/data/app-meta.json version metadata does not match tools/version.json");
  }
  for (const [key, value] of Object.entries({
    githubUrl: version.githubUrl,
    supportUrl: version.supportUrl,
    feedbackUrl: version.feedbackUrl,
    supporterVerifyUrl: version.supporterVerifyUrl,
    supporterDirectoryUrl: version.supporterDirectoryUrl,
    cloudBaseUrl: version.cloudBaseUrl
  })) {
    if (appMeta[key] !== value) {
      throw new Error(`app-meta.json ${key} ${appMeta[key] || "missing"} != ${value}`);
    }
  }

  const releaseZipPath = path.join(root, "releases", expectedZipName);
  if (fs.existsSync(releaseZipPath)) {
    const releaseBuffer = fs.readFileSync(releaseZipPath);
    const releaseSha256 = crypto.createHash("sha256").update(releaseBuffer).digest("hex");
    if (update.sha256 && update.sha256 !== releaseSha256) {
      throw new Error("update.json sha256 does not match release zip");
    }
    if (update.size && Number(update.size) !== releaseBuffer.length) {
      throw new Error("update.json size does not match release zip");
    }
  }

  return {
    version: update.version,
    versionCode: Number(update.versionCode || 0),
    zipUrl: update.zipUrl,
    moduleProp: modulePropPath,
    appMeta: appMetaPath
  };
}

function validateBuildReport(options = {}) {
  const warnings = [];
  const version = JSON.parse(fs.readFileSync(path.join(root, "tools", "version.json"), "utf8"));
  const reportPath = path.join(root, `${version.version} \u81ea\u52a8\u5316\u5f00\u53d1\u4e0e\u6784\u5efa\u62a5\u544a.md`);
  if (!fs.existsSync(reportPath)) {
    const message = "build report missing";
    if (options.blocking) throw new Error(message);
    return { available: false, warnings: [message] };
  }

  const text = fs.readFileSync(reportPath, "utf8");
  const suspicious = text.match(/[\ufffd]|鑷|鏋|鐗|鍙|鈶|锛|歠|侊|娴|粨|粋|笁/);
  if (suspicious) {
    throw new Error(`build report contains mojibake-like text near ${JSON.stringify(suspicious[0])}`);
  }
  const requiredText = [
    `${version.version} \u81ea\u52a8\u5316\u5f00\u53d1\u4e0e\u6784\u5efa\u62a5\u544a`,
    "\u6784\u5efa\u72b6\u6001\uff1asuccess",
    "Release Manifest Gate",
    "Source Manifest Gate",
    "Built Source Sync + Version Gate",
    "WebUI Protect Pipeline",
    "Validation"
  ];
  const missingText = requiredText.filter((item) => !text.includes(item));
  if (missingText.length) throw new Error(`build report missing required text: ${missingText.join(", ")}`);
  if (options.requireBuildReportGate !== false && !/^- ok: Build Report Gate$/m.test(text)) {
    throw new Error("build report missing successful Build Report Gate step");
  }
  const toolProbeFailure = text.match(/spawnSync [^\r\n"]+ (?:ENOENT|EINVAL|EFTYPE)/);
  if (toolProbeFailure) {
    throw new Error(`build report contains failed tool probe: ${toolProbeFailure[0]}`);
  }

  const releaseManifestPath = path.join(root, "releases", `Dex2oat-Lock-${version.version}-manifest.json`);
  const sourceManifestPath = path.join(root, "backups", version.version, `Dex2oat-Lock-${version.version}-source-manifest.json`);
  const releaseManifest = fs.existsSync(releaseManifestPath) ? JSON.parse(fs.readFileSync(releaseManifestPath, "utf8")) : null;
  const sourceManifest = fs.existsSync(sourceManifestPath) ? JSON.parse(fs.readFileSync(sourceManifestPath, "utf8")) : null;
  for (const [label, manifest] of [["release", releaseManifest], ["source", sourceManifest]]) {
    const sha = manifest?.artifact?.sha256;
    if (sha && !text.includes(sha)) throw new Error(`build report does not contain ${label} sha256`);
  }

  return {
    available: true,
    path: reportPath,
    bytes: Buffer.byteLength(text, "utf8"),
    warnings
  };
}

function toShellPath(file, shellType) {
  const resolved = path.resolve(file);
  if (shellType === "git-bash") {
    const match = resolved.match(/^([A-Za-z]):\\(.*)$/);
    if (match) return `/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
  }
  if (shellType === "wsl") {
    const match = resolved.match(/^([A-Za-z]):\\(.*)$/);
    if (match) return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
  }
  return resolved.replace(/\\/g, "/");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function runShellCommand(shell, command, timeout = 120000) {
  if (!shell?.command) throw new Error("No shell found for release runtime smoke");
  const args = shell.type === "wsl" ? ["sh", "-c", command] : ["-c", command];
  const result = run(shell.command, args, { timeout });
  if (result.status !== 0) {
    throw new Error(`${command} failed\n${result.stdout}\n${result.stderr}`.trim());
  }
  return result;
}

function readZipEntries(zipPath, buffer = fs.readFileSync(zipPath), label = "zip") {
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= 0 && offset >= buffer.length - 0xffff - 22; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error(`${label} central directory not found`);

  const entryTotal = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (centralOffset + centralSize > buffer.length) throw new Error(`${label} central directory is out of range`);

  const entries = [];
  let offset = centralOffset;
  for (let index = 0; index < entryTotal; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error(`${label} central entry ${index} is invalid`);
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    const localOffset = buffer.readUInt32LE(offset + 42);
    if (nameEnd > buffer.length) throw new Error(`${label} central entry ${index} name is out of range`);
    const encoding = (flags & 0x0800) ? "utf8" : "latin1";
    const name = buffer.slice(nameStart, nameEnd).toString(encoding);
    entries.push({ path: name, size, compressedSize, method, flags, localOffset });
    offset = nameEnd + extraLength + commentLength;
  }
  if (offset !== centralOffset + centralSize) {
    throw new Error(`${label} central directory size mismatch`);
  }
  return entries;
}

function extractZipEntry(buffer, entry, label = "zip") {
  if (buffer.readUInt32LE(entry.localOffset) !== 0x04034b50) {
    throw new Error(`${label} local header is invalid for ${entry.path}`);
  }
  const nameLength = buffer.readUInt16LE(entry.localOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
  const nameStart = entry.localOffset + 30;
  const nameEnd = nameStart + nameLength;
  if (nameEnd > buffer.length) throw new Error(`${label} local name is out of range for ${entry.path}`);
  const encoding = (entry.flags & 0x0800) ? "utf8" : "latin1";
  const localName = buffer.slice(nameStart, nameEnd).toString(encoding);
  if (localName !== entry.path) {
    throw new Error(`${label} central/local name mismatch for ${entry.path}`);
  }
  const dataStart = nameEnd + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) throw new Error(`${label} data is out of range for ${entry.path}`);
  const compressed = buffer.slice(dataStart, dataEnd);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return zlib.inflateRawSync(compressed);
  throw new Error(`unsupported ${label} compression method ${entry.method} for ${entry.path}`);
}

function validateManifestZipArtifact({ label, manifest, zipPath, shaPath, filePaths, options = {} }) {
  const warnings = [];
  const zipName = path.basename(zipPath);
  if (!manifest.artifact) throw new Error(`${label} manifest artifact is missing`);
  if (manifest.artifact.file && manifest.artifact.file !== zipName) {
    throw new Error(`${label} manifest artifact file ${manifest.artifact.file} != ${zipName}`);
  }

  const duplicatePaths = [];
  const manifestEntryByPath = new Map();
  for (const item of manifest.files || []) {
    if (manifestEntryByPath.has(item.path)) duplicatePaths.push(item.path);
    manifestEntryByPath.set(item.path, item);
  }
  if (duplicatePaths.length) throw new Error(`${label} manifest contains duplicate files: ${duplicatePaths.join(", ")}`);

  if (!fs.existsSync(zipPath)) {
    const message = `${label} zip missing`;
    if (options.blocking !== false) throw new Error(message);
    warnings.push(message);
    return { warnings, zipEntries: [], sha256: manifest.artifact?.sha256 || "" };
  }

  const zipBuffer = fs.readFileSync(zipPath);
  const digest = crypto.createHash("sha256").update(zipBuffer).digest("hex");
  if (Number(manifest.artifact.size || 0) !== zipBuffer.length) {
    throw new Error(`${label} manifest artifact size does not match zip`);
  }
  if (manifest.artifact.sha256 && manifest.artifact.sha256 !== digest) {
    throw new Error(`${label} manifest sha256 does not match zip`);
  }

  if (fs.existsSync(shaPath)) {
    const shaText = fs.readFileSync(shaPath, "utf8");
    if (!shaText.includes(digest) || !shaText.includes(zipName)) {
      throw new Error(`${label} sha256 file does not match zip`);
    }
  } else {
    const message = `${label} sha256 file missing`;
    if (options.blocking !== false) throw new Error(message);
    warnings.push(message);
  }

  const zipEntries = readZipEntries(zipPath, zipBuffer, `${label} zip`);
  const zipPaths = new Set(zipEntries.map((item) => item.path));
  const missingFromZip = [...filePaths].filter((item) => !zipPaths.has(item));
  const extraInZip = [...zipPaths].filter((item) => !filePaths.has(item));
  if (missingFromZip.length || extraInZip.length) {
    throw new Error(`${label} zip entries do not match manifest; missing=${missingFromZip.join(", ") || "none"} extra=${extraInZip.join(", ") || "none"}`);
  }

  for (const entry of zipEntries) {
    const manifestEntry = manifestEntryByPath.get(entry.path);
    if (!manifestEntry) continue;
    if (Number(manifestEntry.size || 0) !== Number(entry.size || 0)) {
      throw new Error(`${label} zip entry size mismatch for ${entry.path}`);
    }
    if (manifestEntry.sha256) {
      const entryDigest = crypto.createHash("sha256").update(extractZipEntry(zipBuffer, entry, `${label} zip`)).digest("hex");
      if (entryDigest !== manifestEntry.sha256) {
        throw new Error(`${label} zip entry sha256 mismatch for ${entry.path}`);
      }
    }
  }

  return { warnings, zipEntries, sha256: digest };
}

function validateManifestSourceTree({ label, manifest, sourceTree, filePaths, options = {} }) {
  const warnings = [];
  if (!fs.existsSync(sourceTree)) {
    const message = `${label} source tree missing`;
    if (options.blocking !== false) throw new Error(message);
    warnings.push(message);
    return { warnings, files: 0 };
  }

  const manifestEntryByPath = new Map((manifest.files || []).map((item) => [item.path, item]));
  const files = listFilesSync(sourceTree);
  const sourcePaths = new Set(files.map((file) => slash(path.relative(sourceTree, file))));
  const missingFromTree = [...filePaths].filter((item) => !sourcePaths.has(item));
  const extraInTree = [...sourcePaths].filter((item) => !filePaths.has(item));
  if (missingFromTree.length || extraInTree.length) {
    throw new Error(`${label} source tree does not match manifest; missing=${missingFromTree.join(", ") || "none"} extra=${extraInTree.join(", ") || "none"}`);
  }

  for (const file of files) {
    const relative = slash(path.relative(sourceTree, file));
    const manifestEntry = manifestEntryByPath.get(relative);
    if (!manifestEntry) continue;
    const stat = fs.statSync(file);
    if (Number(manifestEntry.size || 0) !== Number(stat.size || 0)) {
      throw new Error(`${label} source tree file size mismatch for ${relative}`);
    }
    if (manifestEntry.sha256) {
      const digest = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      if (digest !== manifestEntry.sha256) {
        throw new Error(`${label} source tree sha256 mismatch for ${relative}`);
      }
    }
  }

  return { warnings, files: files.length };
}

function decodeProtectedHtml(protectedHtml) {
  const base64Match = protectedHtml.match(/\}\)\((\[[\s\S]*?\])\);<\/script>/);
  if (base64Match) {
    return Buffer.from(JSON.parse(base64Match[1]).join(""), "base64").toString("utf8");
  }
  return protectedHtml;
}

function validateReleaseRuntimeSmoke(zipPath, zipEntries, shell) {
  if (!shell?.command) return { skipped: true, reason: "No shell found for release runtime smoke" };

  const buffer = fs.readFileSync(zipPath);
  const entryMap = new Map(zipEntries.map((entry) => [entry.path, entry]));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dex2oat-release-smoke-"));
  try {
    const writeEntry = (entryPath) => {
      const entry = entryMap.get(entryPath);
      if (!entry) throw new Error(`release smoke missing ${entryPath}`);
      const target = path.join(tempDir, entryPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, extractZipEntry(buffer, entry, "release zip"));
      return target;
    };

    const scriptPaths = zipEntries
      .map((entry) => entry.path)
      .filter((entryPath) => entryPath.endsWith(".sh"));
    for (const scriptPath of scriptPaths) writeEntry(scriptPath);
    for (const scriptPath of scriptPaths) {
      runShellCommand(shell, `sh -n ${shellQuote(toShellPath(path.join(tempDir, scriptPath), shell.type))}`, 30000);
    }

    const version = JSON.parse(fs.readFileSync(path.join(root, "tools", "version.json"), "utf8"));
    const modulePropText = extractZipEntry(buffer, entryMap.get("module.prop"), "release zip").toString("utf8");
    const moduleProp = parseKeyValueText(modulePropText);
    for (const [key, expected] of Object.entries({
      id: version.id,
      name: version.name,
      version: version.version,
      versionCode: String(version.versionCode),
      author: version.author,
      updateJson: version.updateJson
    })) {
      if (moduleProp[key] !== String(expected)) {
        throw new Error(`release smoke module.prop ${key} ${moduleProp[key] || "missing"} != ${expected}`);
      }
    }

    const updateBinary = extractZipEntry(buffer, entryMap.get("META-INF/com/google/android/update-binary"), "release zip").toString("utf8");
    if (!updateBinary.startsWith("#!/sbin/sh")) {
      throw new Error("release smoke update-binary has no /sbin/sh shebang");
    }
    for (const marker of ["MODID=\"dex2oat-lock\"", "find_util_functions()", "extract_zip()", "busybox unzip", "util_functions.sh"]) {
      if (!updateBinary.includes(marker)) throw new Error(`release smoke update-binary missing marker: ${marker}`);
    }
    const updaterScript = extractZipEntry(buffer, entryMap.get("META-INF/com/google/android/updater-script"), "release zip").toString("utf8").trim();
    if (updaterScript !== "#MAGISK") {
      throw new Error("release smoke updater-script is not the Magisk marker");
    }

    const decodeScript = writeEntry("scripts/decode-rules.sh");
    const rulePack = writeEntry("webroot/data/rule-props.pack");
    const decodedRules = path.join(tempDir, "rule-props.tsv");
    runShellCommand(
      shell,
      `sh ${shellQuote(toShellPath(decodeScript, shell.type))} ${shellQuote(toShellPath(rulePack, shell.type))} ${shellQuote(toShellPath(decodedRules, shell.type))}`,
      30000
    );
    const decoded = fs.readFileSync(decodedRules, "utf8");
    if (!/^id\tlabel\tprop\t/m.test(decoded)) {
      throw new Error("release smoke decoded rule-props.tsv has no recognizable header");
    }
    if (!/dalvik\.|pm\.dexopt\./.test(decoded)) {
      throw new Error("release smoke decoded rule-props.tsv has no ART/dexopt rules");
    }

    for (const assetPath of [
      "webroot/assets/dex2oat-ui.protected.css",
      "webroot/assets/dex2oat-ui.protected.js",
      "webroot/index.html"
    ]) {
      const entry = entryMap.get(assetPath);
      if (!entry || entry.size < 100) throw new Error(`release smoke asset is missing or too small: ${assetPath}`);
    }
    const indexHtml = extractZipEntry(buffer, entryMap.get("webroot/index.html"), "release zip").toString("utf8");
    const decodedIndex = decodeProtectedHtml(indexHtml);
    for (const assetName of ["dex2oat-ui.protected.css", "dex2oat-ui.protected.js"]) {
      if (!decodedIndex.includes(assetName)) {
        throw new Error(`release smoke index.html does not reference ${assetName}`);
      }
    }
    const skinCssAssets = readSkinCssAssets();
    for (const fileName of skinCssAssets) {
      const assetPath = `webroot/css/${fileName}`;
      const entry = entryMap.get(assetPath);
      if (!entry || entry.size < 20) throw new Error(`release smoke skin CSS missing or too small: ${assetPath}`);
      if (decodedIndex.includes(fileName) || decodedIndex.includes(`css/${fileName}`)) {
        throw new Error(`release smoke skin CSS is referenced by first-screen index.html: ${fileName}`);
      }
    }

    return { scripts: scriptPaths.length, decodedRuleBytes: decoded.length, skinCss: skinCssAssets.length };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function validateReleaseManifest(options = {}) {
  const warnings = [];
  const versionPath = path.join(root, "tools", "version.json");
  const version = JSON.parse(fs.readFileSync(versionPath, "utf8"));
  const releaseDir = path.join(root, "releases");
  const manifestPath = path.join(releaseDir, `Dex2oat-Lock-${version.version}-manifest.json`);
  const zipPath = path.join(releaseDir, `Dex2oat-Lock-${version.version}-release.zip`);
  const shaPath = path.join(releaseDir, `Dex2oat-Lock-${version.version}-release.sha256`);
  if (!fs.existsSync(manifestPath)) {
    const message = "release manifest missing";
    if (options.blocking !== false) throw new Error(message);
    return { available: false, warnings: [message] };
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const filePaths = new Set((manifest.files || []).map((item) => item.path));
  const required = [
    "module.prop",
    "customize.sh",
    "service.sh",
    "uninstall.sh",
    "core/common.sh",
    "core/conflict-detect.sh",
    "core/health-check.sh",
    "core/integrity-baseline.prop",
    "core/integrity-check.sh",
    "core/prop-lock.sh",
    "core/redeem-code-verify.sh",
    "core/skin-unlock.sh",
    "core/state.sh",
    "core/statectl.sh",
    "core/supporter-install-id.sh",
    "core/webui-config-save.sh",
    "core/webui-save.sh",
    "scripts/capture-props.sh",
    "scripts/decode-rules.sh",
    "scripts/generate-props.sh",
    "webroot/index.html",
    "webroot/assets/dex2oat-ui.protected.css",
    "webroot/assets/dex2oat-ui.protected.js",
    ...readSkinCssAssets().map((file) => `webroot/css/${file}`),
    "webroot/data/rule-props.pack"
  ];
  const missing = required.filter((item) => !filePaths.has(item));
  if (missing.length) throw new Error(`release manifest missing required runtime files: ${missing.join(", ")}`);

  const forbidden = [...filePaths].filter((item) => {
    if (item.startsWith("webroot-src/") || item.startsWith("tools/") || item.startsWith("deploy/")) return true;
    return /\.(?:map|gz|br)$/i.test(item);
  });
  if (forbidden.length) throw new Error(`release manifest contains forbidden files: ${forbidden.join(", ")}`);
  const boundaryViolations = [...filePaths].filter((item) => {
    if (/^webroot\/data\/(rule-props\.pack|prop-policy\.tsv)$/.test(item)) return false;
    if (item.startsWith("webroot/data/")) return true;
    if (/^META-INF\/com\/google\/android\/(update-binary|updater-script)$/.test(item)) return false;
    if (item.startsWith("META-INF/")) return true;
    if (/(^|\/)(?:node_modules|backups|releases|dist|temp|cache|__pycache__)(?:\/|$)/.test(item)) return true;
    if (/(^|\/)(?:fixtures?|tests?|before-|backup)/i.test(item)) return true;
    if (/(^|\/)(?:supporters?\.private|supporter-redeem-codes|redeem-codes?\.private)/i.test(item)) return true;
    if (/(?:\.private|\.bak|\.tmp|\.orig|\.log|\.pyc)(?:$|\/)/i.test(item)) return true;
    if (/(?:^|\/)\.(?:env|git|codex|cache)(?:$|\/)/.test(item)) return true;
    return false;
  });
  if (boundaryViolations.length) {
    throw new Error(`release manifest contains files outside the runtime boundary: ${boundaryViolations.join(", ")}`);
  }

  if (manifest.version !== version.version || Number(manifest.versionCode || 0) !== Number(version.versionCode || 0)) {
    throw new Error(`release manifest version ${manifest.version}/${manifest.versionCode} != ${version.version}/${version.versionCode}`);
  }

  const artifact = validateManifestZipArtifact({
    label: "release",
    manifest,
    zipPath,
    shaPath,
    filePaths,
    options
  });
  warnings.push(...artifact.warnings);
  const runtimeSmoke = artifact.zipEntries.length
    ? validateReleaseRuntimeSmoke(zipPath, artifact.zipEntries, options.shell)
    : undefined;

  return {
    available: true,
    path: manifestPath,
    version: manifest.version,
    versionCode: Number(manifest.versionCode || 0),
    files: filePaths.size,
    zipEntries: artifact.zipEntries.length,
    runtimeSmoke,
    sha256: artifact.sha256,
    warnings
  };
}

function validateSourceManifest(options = {}) {
  const warnings = [];
  const versionPath = path.join(root, "tools", "version.json");
  const version = JSON.parse(fs.readFileSync(versionPath, "utf8"));
  const sourceDir = path.join(root, "backups", version.version);
  const sourceTree = path.join(sourceDir, "source");
  const manifestPath = path.join(sourceDir, `Dex2oat-Lock-${version.version}-source-manifest.json`);
  const zipPath = path.join(sourceDir, `Dex2oat-Lock-${version.version}-source.zip`);
  const shaPath = path.join(sourceDir, `Dex2oat-Lock-${version.version}-source.sha256`);
  if (!fs.existsSync(manifestPath)) {
    const message = "source manifest missing";
    if (options.blocking !== false) throw new Error(message);
    return { available: false, warnings: [message] };
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.type !== "source") {
    throw new Error(`source manifest type ${manifest.type || "unknown"} != source`);
  }
  if (manifest.version !== version.version || Number(manifest.versionCode || 0) !== Number(version.versionCode || 0)) {
    throw new Error(`source manifest version ${manifest.version}/${manifest.versionCode} != ${version.version}/${version.versionCode}`);
  }

  const filePaths = new Set((manifest.files || []).map((item) => item.path));
  const required = [
    ".gitignore",
    "package.json",
    "module.prop",
    "customize.sh",
    "service.sh",
    "uninstall.sh",
    "core/common.sh",
    "core/conflict-detect.sh",
    "core/health-check.sh",
    "core/integrity-check.sh",
    "core/prop-lock.sh",
    "core/redeem-code-verify.sh",
    "core/skin-unlock.sh",
    "core/state.sh",
    "core/statectl.sh",
    "core/supporter-install-id.sh",
    "core/webui-config-save.sh",
    "core/webui-save.sh",
    "scripts/capture-props.sh",
    "scripts/decode-rules.sh",
    "scripts/generate-props.sh",
    "tools/android-release-smoke.py",
    "tools/build.js",
    "tools/build-webui.mjs",
    "tools/backup-source.js",
    "tools/environment.js",
    "tools/generate-integrity.js",
    "tools/hash.js",
    "tools/manifest.js",
    "tools/protect-webui.js",
    "tools/release.js",
    "tools/skin-assets.js",
    "tools/toolkit.js",
    "tools/validate-fixtures.js",
    "tools/validate-js.js",
    "tools/validate-json.js",
    "tools/validate-options.mjs",
    "tools/validate-python-fixtures.py",
    "tools/validate-python.js",
    "tools/validate-shell.js",
    "tools/validate-webui-smoke.js",
    "tools/validate.js",
    "tools/deploy-cloud-release.py",
    "webroot-src/index.html",
    "webroot-src/js/app.js",
    "webroot-src/js/bridge.js",
    "webroot-src/js/config.js",
    "webroot-src/js/skin-manifest.js",
    "webroot-src/data/options.json",
    "webroot-src/data/prop-policy.tsv",
    "deploy/cloud/dex2oat_cloud_server.py"
  ];
  const missing = required.filter((item) => !filePaths.has(item));
  if (missing.length) throw new Error(`source manifest missing required source files: ${missing.join(", ")}`);
  const forbidden = [...filePaths].filter((item) => {
    if (item.startsWith("backups/") || item.startsWith("releases/") || item.startsWith("dist/")) return true;
    if (item.startsWith("node_modules/") || item.startsWith(".git/")) return true;
    if (/^deploy\/cloud\/supporters\.private(?:\.|$)/.test(item)) return true;
    if (/^webroot-src\/data\/.*\.private\.json$/i.test(item)) return true;
    if (item === ".env.local" || item === "build.config.json" || item === "environment-report.md") return true;
    return item.startsWith("构建/");
  });
  if (forbidden.length) throw new Error(`source manifest contains forbidden recursive files: ${forbidden.join(", ")}`);

  const artifact = validateManifestZipArtifact({
    label: "source",
    manifest,
    zipPath,
    shaPath,
    filePaths,
    options
  });
  warnings.push(...artifact.warnings);
  const tree = validateManifestSourceTree({
    label: "source",
    manifest,
    sourceTree,
    filePaths,
    options
  });
  warnings.push(...tree.warnings);

  return {
    available: true,
    path: manifestPath,
    version: manifest.version,
    versionCode: Number(manifest.versionCode || 0),
    files: filePaths.size,
    zipEntries: artifact.zipEntries.length,
    sourceTreeFiles: tree.files,
    sha256: artifact.sha256,
    warnings
  };
}

async function validateAll(environment = null, options = {}) {
  const shell = await validateShell(environment?.shell);
  const js = await validateJs();
  const json = await validateJson();
  const python = await validatePython();
  const fixtures = await validateFixtures();
  const webuiSmoke = options.skipWebuiSmoke
    ? { skipped: true, reason: "WebUI smoke is skipped for this validation pass" }
    : await validateWebuiSmoke();
  const supporterPool = validateSupporterPoolVersion();
  const builtSource = validateBuiltSourceVersion({ blocking: options.builtSourceBlocking !== false });
  const updateMetadata = validateUpdateMetadata();
  const buildReport = options.skipBuildReport
    ? { skipped: true, reason: "build report is generated later in build pipeline" }
    : validateBuildReport({ blocking: options.buildReportBlocking !== false });
  const releaseManifest = options.skipReleaseManifest
    ? { skipped: true, reason: "release manifest is generated later in build pipeline" }
    : validateReleaseManifest({ blocking: options.releaseManifestBlocking !== false, shell: shell.shell });
  const sourceManifest = options.skipSourceManifest
    ? { skipped: true, reason: "source manifest is generated later in build pipeline" }
    : validateSourceManifest({ blocking: options.sourceManifestBlocking !== false });
  const optionsResult = run(process.execPath, ["tools/validate-options.mjs"]);
  if (optionsResult.status !== 0) {
    throw new Error(`Options validation failed:\n${optionsResult.stdout}\n${optionsResult.stderr}`.trim());
  }
  return {
    shell,
    js,
    json,
    python,
    fixtures,
    webuiSmoke,
    supporterPool,
    builtSource,
    updateMetadata,
    buildReport,
    releaseManifest,
    sourceManifest,
    options: JSON.parse(optionsResult.stdout)
  };
}

module.exports = {
  validateAll,
  validateBuildReport,
  validateBuiltSourceVersion,
  validateUpdateMetadata,
  validateReleaseManifest,
  validateSourceManifest
};

if (require.main === module) {
  validateAll()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
