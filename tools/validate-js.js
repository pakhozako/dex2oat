const path = require("node:path");
const { listFiles, root, run } = require("./toolkit");

async function validateJs() {
  const files = (await listFiles(root, { skip: ["webroot/assets"] }))
    .filter((file) => [".js", ".mjs"].includes(path.extname(file)));
  const failures = [];

  for (const file of files) {
    const result = run(process.execPath, ["--check", file]);
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
