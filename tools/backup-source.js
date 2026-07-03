const fs = require("node:fs/promises");
const path = require("node:path");
const { createZipFromDirectory } = require("./archive");
const { createManifest } = require("./manifest");
const { detectHashTool, writeSha256 } = require("./hash");
const { copyTree, ensureDir, root, safeRemove } = require("./toolkit");
const { validateSourceManifest } = require("./validate");
const { readVersion } = require("./version");

const skip = [
  ".git",
  "node_modules",
  "dist",
  "release",
  "releases",
  "backups",
  "reports",
  "temp",
  "cache",
  ".cache",
  "__pycache__",
  "*.pyc",
  ".env.local",
  "build.config.json",
  "environment-report.md",
  "unknown 自动化开发与构建报告.md",
  "deploy/cloud/supporters.private.json",
  "webroot-src/data/supporter-redeem-codes.private.json",
  "工具路径清单.md",
  "发布版",
  "源码版",
  "构建"
];

async function backupSource(options = {}) {
  const version = await readVersion();
  const sourceBase = options.sourceDir || path.join(root, "backups");
  const versionDir = path.join(sourceBase, version.version);
  const sourceTree = path.join(versionDir, "source");
  const zipPath = path.join(versionDir, `Dex2oat-Lock-${version.version}-source.zip`);
  const shaPath = path.join(versionDir, `Dex2oat-Lock-${version.version}-source.sha256`);
  const manifestPath = path.join(versionDir, `Dex2oat-Lock-${version.version}-source-manifest.json`);
  const hashTool = options.hashTool || detectHashTool();
  const sourceSkip = [...skip, `${version.version} 自动化开发与构建报告.md`];

  await ensureDir(versionDir);
  await copyTree(root, sourceTree, { skip: sourceSkip, allowedRemoveRoot: versionDir });
  await fs.rm(zipPath, { force: true });
  const zip = await createZipFromDirectory(sourceTree, zipPath, { skip: sourceSkip });
  const sha256 = await writeSha256(zipPath, shaPath, hashTool);
  const manifest = await createManifest({
    baseDir: sourceTree,
    artifactPath: zipPath,
    outPath: manifestPath,
    type: "source",
    hashTool
  });

  return {
    versionDir,
    sourceTree,
    zipPath,
    shaPath,
    manifestPath,
    sha256,
    bytes: zip.bytes,
    files: manifest.files.length
  };
}

module.exports = {
  backupSource
};

if (require.main === module) {
  backupSource()
    .then((result) => {
      const gate = validateSourceManifest({ blocking: true });
      console.log(JSON.stringify({ ...result, gate }, null, 2));
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
