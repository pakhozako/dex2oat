const fs = require("node:fs/promises");
const path = require("node:path");
const { listFiles, root, sha256Buffer } = require("./toolkit");
const { stageReleaseTree } = require("./release");

function normalizeModuleProp(buffer) {
  return `${buffer.toString("utf8")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !line.startsWith("description="))
    .join("\n")
    .trimEnd()}\n`;
}

function includeInBaseline(relative) {
  if (relative === "core/integrity-baseline.prop") return false;
  if (relative === "skip_mount") return false;
  return new Set([
    "service.sh",
    "uninstall.sh",
    "module.prop",
    "core/common.sh",
    "core/conflict-detect.sh",
    "core/health-check.sh",
    "core/integrity-check.sh",
    "core/prop-lock.sh",
    "core/redeem-code-verify.sh",
    "core/skin-unlock.sh",
    "core/state.sh",
    "core/statectl.sh",
    "core/supporter-install-id.sh",
    "core/webui-save.sh",
    "core/webui-config-save.sh",
    "scripts/capture-props.sh",
    "scripts/decode-rules.sh",
    "scripts/generate-props.sh",
    "webroot/index.html",
    "webroot/assets/dex2oat-ui.protected.css",
    "webroot/assets/dex2oat-ui.protected.js",
    "webroot/css/skin-badges.css",
    "webroot/css/theme-founder-qingmu.css",
    "webroot/css/theme-memorial-amber.css",
    "webroot/data/rule-props.pack"
  ]).has(relative);
}

async function generateIntegrityBaseline(options = {}) {
  const staging = options.staging || path.join(root, "temp", "integrity-baseline-staging");
  await stageReleaseTree(staging);

  const files = (await listFiles(staging))
    .map((file) => ({ file, relative: path.relative(staging, file).replace(/\\/g, "/") }))
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
  return { baselinePath, staging, files: rows.length };
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
