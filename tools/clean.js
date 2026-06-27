const fs = require("node:fs/promises");
const path = require("node:path");
const { ensureDir, root, safeRemove } = require("./toolkit");

async function clean() {
  const targets = [
    "dist",
    "release",
    "temp",
    "cache",
    ".cache",
    path.join("webroot", "assets")
  ];

  for (const target of targets) {
    await safeRemove(path.join(root, target), root);
  }

  await ensureDir(path.join(root, "temp"));
  await fs.writeFile(path.join(root, "temp", ".gitkeep"), "", "utf8");
  await ensureDir(path.join(root, "webroot", "assets"));
  return targets;
}

module.exports = {
  clean
};

if (require.main === module) {
  clean()
    .then((targets) => console.log(JSON.stringify({ cleaned: targets }, null, 2)))
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
