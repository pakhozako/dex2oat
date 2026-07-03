const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createZipFromDirectory } = require("./archive");
const { createManifest } = require("./manifest");
const { detectHashTool, writeSha256 } = require("./hash");
const { readSkinCssAssets } = require("./skin-assets");
const { ensureDir, root, safeRemove } = require("./toolkit");
const { validateReleaseManifest } = require("./validate");
const { validateShell } = require("./validate-shell");
const { readVersion } = require("./version");

const include = [
  "customize.sh",
  "service.sh",
  "uninstall.sh",
  "system.prop",
  "skip_mount",
  "module.prop",
  "core",
  "scripts",
  "META-INF",
  "webroot"
];

const forbiddenNames = new Set(["README.md", "CHANGELOG.md", "update.json"]);
const forbiddenExtensions = new Set([".br", ".gz", ".map"]);
const allowedWebrootCss = new Set(readSkinCssAssets().map((file) => `webroot/css/${file}`));

async function sha256File(file) {
  return crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

async function validateProtectedWebuiManifest() {
  const manifestPath = path.join(root, "dist", "webui-protected", "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Protected WebUI manifest missing or invalid. Run node tools\\build-webui.mjs before release. (${error.message})`);
  }
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  if (!assets.length) throw new Error("Protected WebUI manifest has no assets");
  for (const asset of assets) {
    if (!asset.path || !asset.sha256) throw new Error("Protected WebUI manifest contains an invalid asset entry");
    const target = path.join(root, "webroot", asset.path);
    const stat = await fs.stat(target).catch(() => null);
    if (!stat?.isFile()) throw new Error(`Protected WebUI asset missing: webroot/${asset.path}`);
    if (Number(asset.bytes || 0) !== stat.size) {
      throw new Error(`Protected WebUI asset size mismatch: webroot/${asset.path}`);
    }
    const digest = await sha256File(target);
    if (digest !== asset.sha256) {
      throw new Error(`Protected WebUI asset hash mismatch: webroot/${asset.path}`);
    }
  }
  return { manifestPath, assets: assets.length };
}

async function stageReleaseTree(staging) {
  await safeRemove(staging, root);
  await ensureDir(staging);

  for (const item of include) {
    await copyReleaseItem(path.join(root, item), path.join(staging, item));
  }
}

async function copyReleaseItem(source, target) {
  const stat = await fs.stat(source);
  if (stat.isDirectory()) {
    await fs.mkdir(target, { recursive: true });
    for (const entry of await fs.readdir(source, { withFileTypes: true })) {
      if (forbiddenNames.has(entry.name)) continue;
      const childSource = path.join(source, entry.name);
      const childTarget = path.join(target, entry.name);
      const relative = path.relative(root, childSource).replace(/\\/g, "/");
      if (relative.startsWith("webroot-src/") || relative.startsWith("tools/") || relative.startsWith(".webui-src-temp/")) continue;
      if (relative.startsWith("webroot/js/")) continue;
      if (relative.startsWith("webroot/css/") && !allowedWebrootCss.has(relative)) continue;
      await copyReleaseItem(childSource, childTarget);
    }
  } else if (!forbiddenNames.has(path.basename(source)) && !forbiddenExtensions.has(path.extname(source))) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  }
}

async function releaseBuild(options = {}) {
  const version = await readVersion();
  const releaseRoot = options.releaseDir || path.join(root, "releases");
  const staging = path.join(root, "temp", "release-staging");
  const zipPath = path.join(releaseRoot, `Dex2oat-Lock-${version.version}-release.zip`);
  const shaPath = path.join(releaseRoot, `Dex2oat-Lock-${version.version}-release.sha256`);
  const manifestPath = path.join(releaseRoot, `Dex2oat-Lock-${version.version}-manifest.json`);
  const hashTool = options.hashTool || detectHashTool();

  await ensureDir(releaseRoot);
  const webuiManifest = await validateProtectedWebuiManifest();
  await stageReleaseTree(staging);

  await fs.rm(zipPath, { force: true });
  const zip = await createZipFromDirectory(staging, zipPath);
  const sha256 = await writeSha256(zipPath, shaPath, hashTool);
  const manifest = await createManifest({
    baseDir: staging,
    artifactPath: zipPath,
    outPath: manifestPath,
    type: "release",
    hashTool
  });

  return {
    releaseRoot,
    staging,
    zipPath,
    shaPath,
    manifestPath,
    sha256,
    bytes: zip.bytes,
    files: manifest.files.length,
    webuiManifest
  };
}

module.exports = {
  releaseBuild,
  stageReleaseTree
};

if (require.main === module) {
  (async () => {
    const result = await releaseBuild();
    const shell = await validateShell();
    const gate = validateReleaseManifest({ blocking: true, shell: shell.shell });
    console.log(JSON.stringify({ ...result, gate }, null, 2));
  })()
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
