const fs = require("node:fs/promises");
const path = require("node:path");
const { listFiles, root, sha256Buffer } = require("./toolkit");

function normalizeModuleProp(buffer) {
  return `${buffer.toString("utf8")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !line.startsWith("description="))
    .join("\n")
    .trimEnd()}\n`;
}

function includeInBaseline(relative) {
  if (["README.md", "CHANGELOG.md", "update.json", ".gitattributes", ".gitignore", ".env.local", "build.config.json", "environment-report.md", "v3.5 自动化开发与构建报告.md"].includes(relative)) return false;
  if (relative === "core/integrity-baseline.prop") return false;
  if (relative.startsWith("tools/") || relative.startsWith("webroot-src/") || relative.startsWith(".webui-src-temp/")) return false;
  if (relative.startsWith("webroot/js/") || relative.startsWith("webroot/css/")) return false;
  return true;
}

async function generateIntegrityBaseline() {
  const files = (await listFiles(root))
    .map((file) => ({ file, relative: path.relative(root, file).replace(/\\/g, "/") }))
    .filter(({ relative }) => includeInBaseline(relative));

  const rows = [];
  for (const { file, relative } of files) {
    const content = await fs.readFile(file);
    const hash = relative === "module.prop"
      ? sha256Buffer(Buffer.from(normalizeModuleProp(content), "utf8"))
      : sha256Buffer(content);
    rows.push(`${relative}=${hash}`);
  }

  rows.sort();
  const baselinePath = path.join(root, "core", "integrity-baseline.prop");
  await fs.writeFile(baselinePath, `${rows.join("\n")}\n`, "utf8");
  return { baselinePath, files: rows.length };
}

module.exports = {
  generateIntegrityBaseline
};

if (require.main === module) {
  generateIntegrityBaseline()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
