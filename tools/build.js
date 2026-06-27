const fs = require("node:fs/promises");
const path = require("node:path");
const { backupSource } = require("./backup-source");
const { clean } = require("./clean");
const { detectEnvironment, writeEnvironmentFiles } = require("./environment");
const { generateIntegrityBaseline } = require("./generate-integrity");
const { protectWebui } = require("./protect-webui");
const { releaseBuild } = require("./release");
const { root, run } = require("./toolkit");
const { validateAll } = require("./validate");
const { syncVersion } = require("./version");

const reportPath = path.join(root, "v3.6 自动化开发与构建报告.md");

async function maybeNpmInstall() {
  try {
    await fs.access(path.join(root, "package.json"));
  } catch {
    return { skipped: true, reason: "package.json not found" };
  }
  const result = run(firstNpm(), ["install"], { timeout: 900000 });
  if (result.status !== 0) {
    throw new Error(`npm install failed:\n${result.stdout}\n${result.stderr}`);
  }
  return { skipped: false };
}

function firstNpm() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function pushStep(steps, name, status, detail = {}) {
  steps.push({
    name,
    status,
    detail,
    at: new Date().toISOString()
  });
  const marker = status === "ok" ? "OK" : status === "skip" ? "SKIP" : "FAIL";
  console.log(`[${marker}] ${name}`);
}

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

async function writeBuildReport({ status, steps, environment, version, validation, webui, integrity, release, source, error }) {
  const outputFiles = [];
  for (const item of [release, source]) {
    if (!item) continue;
    outputFiles.push(item.zipPath, item.shaPath, item.manifestPath);
  }

  const content = [
    "# v3.6 自动化开发与构建报告",
    "",
    `- 构建状态：${status}`,
    `- 构建时间：${new Date().toISOString()}`,
    `- 版本：${version ? `${version.version} / ${version.versionCode}` : "unknown"}`,
    `- 错误：${error ? error.message : "无"}`,
    "",
    "## ① 开发环境检测结果",
    "",
    `- Shell：${environment?.shell?.type || "unknown"} (${environment?.shell?.path || "missing"})`,
    `- Hash：${environment?.hashTool?.name || "unknown"} (${environment?.hashTool?.path || "missing"})`,
    `- GitHub：${environment?.git?.githubStatus || "not checked"}`,
    "",
    "## ② 自动安装内容",
    "",
    environment?.autoInstall?.installed?.length
      ? environment.autoInstall.installed.map((item) => `- ${item.tool}: exit ${item.status}`).join("\n")
      : `- ${environment?.autoInstall?.skipped || "本次无需安装"}`,
    "",
    "## ③ 工具版本",
    "",
    "```json",
    formatJson(environment?.tools || {}),
    "```",
    "",
    "## ④ Build Pipeline",
    "",
    steps.map((step) => `- ${step.status}: ${step.name}`).join("\n"),
    "",
    "## ⑤ WebUI Protect Pipeline",
    "",
    "```json",
    formatJson(webui || {}),
    "```",
    "",
    "## ⑥ 自动备份流程",
    "",
    "```json",
    formatJson(source || {}),
    "```",
    "",
    "## ⑦ 发布流程",
    "",
    "```json",
    formatJson(release || {}),
    "```",
    "",
    "## ⑧ 完整性流程",
    "",
    "```json",
    formatJson(integrity || {}),
    "```",
    "",
    "## ⑨ 输出文件列表",
    "",
    outputFiles.length ? outputFiles.map((file) => `- ${file}`).join("\n") : "- 未生成",
    "",
    "## ⑩ SHA256",
    "",
    release ? `- Release：${release.sha256}` : "- Release：未生成",
    source ? `- Source：${source.sha256}` : "- Source：未生成",
    "",
    "## ⑪ Manifest",
    "",
    release ? `- ${release.manifestPath}` : "- Release manifest：未生成",
    source ? `- ${source.manifestPath}` : "- Source manifest：未生成",
    "",
    "## ⑫ 自动构建是否完全成功",
    "",
    status === "success" ? "是" : "否",
    "",
    "## Validation",
    "",
    "```json",
    formatJson(validation || {}),
    "```",
    ""
  ].join("\n");

  await fs.writeFile(reportPath, content, "utf8");
}

async function build() {
  const steps = [];
  let environment;
  let version;
  let validation;
  let webui;
  let integrity;
  let release;
  let source;

  try {
    environment = await detectEnvironment({ autoInstall: true, ensureSshKey: true });
    await writeEnvironmentFiles(environment);
    pushStep(steps, "开发环境检查与配置生成", "ok", { environmentReport: path.join(root, "environment-report.md") });

    const npm = await maybeNpmInstall();
    pushStep(steps, "Node 依赖检查", npm.skipped ? "skip" : "ok", npm);

    await clean();
    pushStep(steps, "Clean", "ok");

    version = await syncVersion();
    pushStep(steps, "Version Sync", "ok", version);

    validation = await validateAll(environment);
    pushStep(steps, "Validate", "ok", validation);

    webui = await protectWebui();
    pushStep(steps, "WebUI Build + Protect", "ok", webui);

    integrity = await generateIntegrityBaseline();
    pushStep(steps, "Integrity Baseline", "ok", integrity);

    validation = await validateAll(environment);
    pushStep(steps, "Final Validate", "ok", validation);

    release = await releaseBuild({ hashTool: environment.hashTool });
    pushStep(steps, "Release ZIP + SHA256 + Manifest", "ok", release);

    source = await backupSource({ hashTool: environment.hashTool });
    pushStep(steps, "Source Backup + ZIP + SHA256 + Manifest", "ok", source);

    await writeBuildReport({ status: "success", steps, environment, version, validation, webui, integrity, release, source });
    return { status: "success", reportPath, release, source };
  } catch (error) {
    pushStep(steps, error.step || "Build Failed", "fail", { message: error.message });
    await writeBuildReport({ status: "failed", steps, environment, version, validation, webui, integrity, release, source, error });
    throw error;
  }
}

module.exports = {
  build
};

if (require.main === module) {
  build()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.stack || error.message);
      console.error(`Report: ${reportPath}`);
      process.exit(1);
    });
}
