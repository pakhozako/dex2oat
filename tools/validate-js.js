const path = require("node:path");
const fs = require("node:fs/promises");
const { listFiles, root, run } = require("./toolkit");

function isWebuiModule(file) {
  return path.relative(root, file).replace(/\\/g, "/").startsWith("webroot-src/js/");
}

async function validateJs() {
  const files = (await listFiles(root, { skip: ["webroot/assets"] }))
    .filter((file) => [".js", ".mjs"].includes(path.extname(file)));
  const failures = [];

  for (const file of files) {
    let checkFile = file;
    let tempFile = "";
    if (path.extname(file) === ".js" && isWebuiModule(file)) {
      tempFile = path.join(root, "temp", "validate-js", `${path.basename(file, ".js")}.mjs`);
      await fs.mkdir(path.dirname(tempFile), { recursive: true });
      await fs.copyFile(file, tempFile);
      checkFile = tempFile;
    }
    const result = run(process.execPath, ["--check", checkFile]);
    if (tempFile) await fs.rm(tempFile, { force: true });
    if (result.status !== 0) {
      failures.push({ file, error: `${result.stdout}\n${result.stderr}`.trim() });
    }
  }

  if (failures.length) {
    const detail = failures.map((item) => `${item.file}\n${item.error}`).join("\n\n");
    throw new Error(`JavaScript validation failed:\n${detail}`);
  }

  return { files: files.length };
}

module.exports = {
  validateJs
};

if (require.main === module) {
  validateJs()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
