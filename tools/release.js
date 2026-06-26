const fs = require("node:fs/promises");
const path = require("node:path");
const { createZipFromDirectory } = require("./archive");
const { createManifest } = require("./manifest");
const { detectHashTool, writeSha256 } = require("./hash");
const { ensureDir, root, safeRemove } = require("./toolkit");
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
      if (relative.startsWith("webroot/js/") || relative.startsWith("webroot/css/")) continue;
      await copyReleaseItem(childSource, childTarget);
    }
  } else if (!forbiddenNames.has(path.basename(source))) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  }
}

async function releaseBuild(options = {}) {
  const version = await readVersion();
  const releaseRoot = options.releaseDir || path.join(path.dirname(root), "发布版");
  const staging = path.join(root, "temp", "release-staging");
  const zipPath = path.join(releaseRoot, `Dex2oat-Lock-${version.version}-release.zip`);
  const shaPath = path.join(releaseRoot, `Dex2oat-Lock-${version.version}-release.sha256`);
  const manifestPath = path.join(releaseRoot, `Dex2oat-Lock-${version.version}-manifest.json`);
  const hashTool = options.hashTool || detectHashTool();

  await ensureDir(releaseRoot);
  await safeRemove(staging, root);
  await ensureDir(staging);

  for (const item of include) {
    await copyReleaseItem(path.join(root, item), path.join(staging, item));
  }

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
    files: manifest.files.length
  };
}

module.exports = {
  releaseBuild
};

if (require.main === module) {
  releaseBuild()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
