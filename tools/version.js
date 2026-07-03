const fs = require("node:fs/promises");
const path = require("node:path");
const { readJson, root, writeJson } = require("./toolkit");

async function readVersion() {
  return readJson(path.join(root, "tools", "version.json"));
}

function moduleProp(version) {
  return [
    `id=${version.id}`,
    `name=${version.name}`,
    `version=${version.version}`,
    `versionCode=${version.versionCode}`,
    `author=${version.author}`,
    `description=${version.description} | 🟩 正常`,
    `updateJson=${version.updateJson}`,
    ""
  ].join("\n");
}

function webSafeUrl(value, { allowHttp = false } = {}) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const isHttp = url.protocol === "http:";
    if (url.protocol === "https:" || (allowHttp && isHttp)) {
      url.hash = "";
      url.pathname = url.pathname.replace(/\/+$/, "") || "/";
      if (url.pathname === "/" && !url.search) return `${url.origin}`;
      return url.href;
    }
  } catch {
    return "";
  }
  return "";
}

async function syncReadme(_version) {
  const readmePath = path.join(root, "README.md");
  let content = await fs.readFile(readmePath, "utf8");
  if (content.includes("<!-- build:version -->")) {
    content = content.replace(/\n*<!-- build:version -->[\s\S]*?<!-- \/build:version -->\n*/, "\n\n");
    await fs.writeFile(readmePath, content, "utf8");
  }
}

async function syncChangelog(version) {
  const changelogPath = path.join(root, "CHANGELOG.md");
  let content = await fs.readFile(changelogPath, "utf8");
  const escapedVersion = version.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const versionHeading = new RegExp(`^## .*${escapedVersion}`, "m");
  if (!versionHeading.test(content)) {
    content = content.replace(
      /# Dex2oat Lock 更新日志\s*/,
      `# Dex2oat Lock 更新日志\n\n## ${version.version} (${new Date().toISOString().slice(0, 10)})\n\n- 自动同步版本元数据。\n\n`
    );
    await fs.writeFile(changelogPath, content, "utf8");
  }
}

async function syncVersion() {
  const version = await readVersion();
  await fs.writeFile(path.join(root, "module.prop"), moduleProp(version), "utf8");
  await writeJson(path.join(root, "update.json"), {
    version: version.version,
    versionCode: version.versionCode,
    zipUrl: version.zipUrl,
    changelog: version.changelog
  });
  const appMeta = {
    moduleName: version.name,
    version: version.version,
    versionCode: version.versionCode,
    author: version.author,
    githubUrl: webSafeUrl(version.githubUrl),
    supportUrl: webSafeUrl(version.supportUrl),
    feedbackUrl: webSafeUrl(version.feedbackUrl, { allowHttp: true }),
    supporterVerifyUrl: webSafeUrl(version.supporterVerifyUrl, { allowHttp: true }),
    supporterDirectoryUrl: webSafeUrl(version.supporterDirectoryUrl, { allowHttp: true }),
    cloudBaseUrl: webSafeUrl(version.cloudBaseUrl, { allowHttp: true }),
    architecture: version.architecture,
    description: "Dex2oat Lock 是一个基于规则库生成 ART / dex2oat 配置并通过统一状态展示运行健康度的模块。"
  };
  await writeJson(path.join(root, "webroot-src", "data", "app-meta.json"), appMeta);
  await syncReadme(version);
  await syncChangelog(version);
  return version;
}

module.exports = {
  readVersion,
  syncVersion
};

if (require.main === module) {
  syncVersion()
    .then((version) => console.log(JSON.stringify(version, null, 2)))
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
