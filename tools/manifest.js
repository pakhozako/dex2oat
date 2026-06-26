const fs = require("node:fs/promises");
const path = require("node:path");
const { listFiles, root, slash, writeJson } = require("./toolkit");
const { hashFile } = require("./hash");
const { readVersion } = require("./version");

async function createManifest({ baseDir, artifactPath, outPath, type, hashTool }) {
  const version = await readVersion();
  const files = [];
  for (const file of await listFiles(baseDir)) {
    files.push({
      path: slash(path.relative(baseDir, file)),
      size: (await fs.stat(file)).size,
      sha256: await hashFile(file, hashTool)
    });
  }

  const manifest = {
    type,
    version: version.version,
    versionCode: version.versionCode,
    generatedAt: new Date().toISOString(),
    artifact: artifactPath ? {
      file: path.basename(artifactPath),
      size: (await fs.stat(artifactPath)).size,
      sha256: await hashFile(artifactPath, hashTool)
    } : null,
    files
  };
  await writeJson(outPath, manifest);
  return manifest;
}

module.exports = {
  createManifest
};

if (require.main === module) {
  (async () => {
    const [baseDir, artifactPath, outPath, type = "generic"] = process.argv.slice(2);
    if (!baseDir || !outPath) throw new Error("usage: node tools/manifest.js <baseDir> <artifactPath|-> <outPath> [type]");
    const manifest = await createManifest({
      baseDir: path.resolve(root, baseDir),
      artifactPath: artifactPath === "-" ? "" : path.resolve(root, artifactPath),
      outPath: path.resolve(root, outPath),
      type
    });
    console.log(JSON.stringify({ files: manifest.files.length, type }, null, 2));
  })().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
