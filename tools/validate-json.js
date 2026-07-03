const path = require("node:path");
const fs = require("node:fs/promises");
const { listFiles, root } = require("./toolkit");

async function validateJson() {
  const files = (await listFiles(root, {
    // Skip the checked-in KernelSU reference tree; it includes non-strict sample JSON.
    skip: ["KernelSU-ref"]
  })).filter((file) => path.extname(file) === ".json");
  const failures = [];
  for (const file of files) {
    try {
      JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      failures.push({ file, error: error.message });
    }
  }

  if (failures.length) {
    throw new Error(`JSON validation failed:\n${failures.map((item) => `${item.file}: ${item.error}`).join("\n")}`);
  }

  return { files: files.length };
}

module.exports = {
  validateJson
};

if (require.main === module) {
  validateJson()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
