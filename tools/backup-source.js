const fs = require("node:fs/promises");
const path = require("node:path");
const { createZipFromDirectory } = require("./archive");
const { createManifest } = require("./manifest");
const { detectHashTool, writeSha256 } = require("./hash");
const { copyTree, ensureDir, root, safeRemove } = require("./toolkit");
const { readVersion } = require("./version");

const skip = [
  ".git",
  "node_modules",
  "dist",
  "release",
  "temp",
  "cache",
  ".cache",
  ".env.local",
  "build.config.json",
  "environment-report.md",
  "v3.5 自动化开发与构建报告.md",
  "发布版",
  "源码版"
];

async function backupSource(options = {}) {
  const version = await readVersion();
  const sourceBase = options.sourceDir || path.join(path.dirname(root), "源码版");
  const versionDir = path.join(sourceBase, version.version);
  const sourceTree = path.join(versionDir, "source");
  const zipPath = path.join(versionDir, `Dex2oat-Lock-${version.version}-source.zip`);
  const shaPath = path.join(versionDir, `Dex2oat-Lock-${version.version}-source.sha256`);
  const manifestPath = path.join(versionDir, `Dex2oat-Lock-${version.version}-source-manifest.json`);
  const hashTool = options.hashTool || detectHashTool();

  await ensureDir(versionDir);
  await copyTree(root, sourceTree, { skip, allowedRemoveRoot: versionDir });
  await fs.rm(zipPath, { force: true });
  const zip = await createZipFromDirectory(sourceTree, zipPath, { skip });
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
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
