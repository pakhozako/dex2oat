const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  defaultConfig,
  ensureDir,
  firstCommand,
  os,
  root,
  run,
  versionOf,
  where,
  writeJson
} = require("./toolkit");
const { detectHashTool } = require("./hash");

function pathStatus(toolPath) {
  if (!toolPath) return "missing";
  const paths = String(process.env.PATH || "").split(path.delimiter).map((item) => path.resolve(item || ".").toLowerCase());
  return paths.includes(path.dirname(toolPath).toLowerCase()) ? "in PATH" : "not in PATH";
}

function tool(name, commands, versionArgs = ["--version"]) {
  const toolPath = firstCommand(commands);
  return {
    name,
    installed: Boolean(toolPath),
    path: toolPath,
    version: versionOf(toolPath, versionArgs),
    pathStatus: pathStatus(toolPath)
  };
}

function detectShell() {
  const gitShells = [];
  for (const gitPath of where("git")) {
    const gitRoot = path.resolve(path.dirname(gitPath), "..");
    gitShells.push(
      path.join(gitRoot, "bin", "bash.exe"),
      path.join(gitRoot, "usr", "bin", "bash.exe"),
      path.join(gitRoot, "bin", "sh.exe"),
      path.join(gitRoot, "usr", "bin", "sh.exe")
    );
  }
  const bashCandidates = [...gitShells.filter((item) => fs.existsSync(item)), ...where("bash"), ...where("sh")];
  const gitBash = bashCandidates.find((item) => /git/i.test(item));
  if (gitBash) {
    return { type: "git-bash", path: gitBash, command: gitBash, argsPrefix: ["-n"] };
  }

  const wsl = firstCommand(["wsl"]);
  if (wsl && run(wsl, ["sh", "-c", "true"], { timeout: 15000 }).status === 0) {
    return { type: "wsl", path: wsl, command: wsl, argsPrefix: ["sh", "-n"] };
  }

  const busybox = firstCommand(["busybox"]);
  if (busybox && run(busybox, ["sh", "-c", "true"], { timeout: 15000 }).status === 0) {
    return { type: "busybox", path: busybox, command: busybox, argsPrefix: ["sh", "-n"] };
  }

  return { type: "missing", path: "", command: "", argsPrefix: [] };
}

function detectGitDetails(gitPath) {
  const username = gitPath ? run(gitPath, ["config", "--global", "user.name"]).stdout.trim() : "";
  const email = gitPath ? run(gitPath, ["config", "--global", "user.email"]).stdout.trim() : "";
  const lfs = tool("Git LFS", ["git-lfs"], ["version"]);
  const gh = tool("GitHub CLI", ["gh"], ["--version"]);
  let githubStatus = "not checked";
  if (gh.installed) {
    const result = run(gh.path, ["auth", "status"], { timeout: 20000 });
    githubStatus = result.status === 0 ? "logged in" : "not logged in";
  }

  const sshDir = path.join(os.homedir(), ".ssh");
  const sshKey = ["id_ed25519.pub", "id_rsa.pub"].find((name) => fs.existsSync(path.join(sshDir, name)));
  return {
    username,
    email,
    lfs,
    githubCli: gh,
    githubStatus,
    sshKey: sshKey ? path.join(sshDir, sshKey) : ""
  };
}

async function ensureSshKey(report) {
  if (report.git.sshKey) return { changed: false, reason: "exists" };
  const sshKeygen = firstCommand(["ssh-keygen"]);
  if (!sshKeygen) return { changed: false, reason: "ssh-keygen-missing" };
  const sshDir = path.join(os.homedir(), ".ssh");
  await ensureDir(sshDir);
  const keyPath = path.join(sshDir, "id_ed25519");
  if (fs.existsSync(keyPath)) return { changed: false, reason: "private-key-exists" };
  const result = run(sshKeygen, ["-t", "ed25519", "-N", "", "-f", keyPath, "-C", "dex2oat-lock-build"]);
  return { changed: result.status === 0, reason: result.status === 0 ? "created" : result.stderr || result.stdout };
}

function installerCommand() {
  const winget = firstCommand(["winget"]);
  if (winget) return { name: "winget", path: winget };
  const choco = firstCommand(["choco"]);
  if (choco) return { name: "choco", path: choco };
  return { name: "none", path: "" };
}

function installArgs(installer, packageId) {
  if (installer.name === "winget") {
    return ["install", "--id", packageId.winget, "--silent", "--accept-package-agreements", "--accept-source-agreements"];
  }
  if (installer.name === "choco") {
    return ["install", packageId.choco, "-y", "--no-progress"];
  }
  return [];
}

async function installMissingRequired(report) {
  const installed = [];
  const installer = installerCommand();
  if (!installer.path) return { installer, installed, skipped: "no-installer" };

  const required = [
    { key: "git", item: report.tools.git, winget: "Git.Git", choco: "git" }
  ];

  for (const entry of required) {
    if (entry.item.installed) continue;
    const args = installArgs(installer, entry);
    if (!args.length) continue;
    const result = run(installer.path, args, { timeout: 900000 });
    installed.push({
      tool: entry.key,
      status: result.status,
      stdout: result.stdout.slice(-2000),
      stderr: result.stderr.slice(-2000)
    });
  }

  return { installer, installed, skipped: "" };
}

async function detectEnvironment(options = {}) {
  const shell = detectShell();
  const tools = {
    powershell: tool("PowerShell", ["pwsh", "powershell"], ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"]),
    git: tool("Git", ["git"], ["--version"]),
    node: {
      name: "Node.js",
      installed: true,
      path: process.execPath,
      version: process.version,
      pathStatus: pathStatus(process.execPath)
    },
    npm: tool("npm", ["npm"], ["--version"]),
    python: tool("Python 3", ["python", "py"], ["--version"]),
    sevenZip: tool("7-Zip", ["7z", "7zz"], ["--help"]),
    busybox: tool("BusyBox", ["busybox"], ["--help"]),
    wsl: tool("WSL", ["wsl"], ["--version"]),
    openssl: tool("OpenSSL", ["openssl"], ["version"]),
    java: tool("Java", ["java"], ["-version"])
  };
  const hashTool = detectHashTool();
  const git = detectGitDetails(tools.git.path);

  const report = {
    checkedAt: new Date().toISOString(),
    platform: {
      os: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      windowsVersion: process.platform === "win32" ? run("cmd.exe", ["/c", "ver"]).stdout.trim() : ""
    },
    shell,
    tools,
    git,
    hashTool,
    installer: installerCommand(),
    autoInstall: { installer: null, installed: [], skipped: "" }
  };

  if (options.autoInstall) {
    report.autoInstall = await installMissingRequired(report);
  }

  if (options.ensureSshKey) {
    report.git.sshKeyGenerated = await ensureSshKey(report);
  }

  return report;
}

function toolRow(item) {
  return `| ${item.name} | ${item.installed ? "已安装" : "缺失"} | ${String(item.version || "").replace(/\r?\n/g, " ")} | ${item.path || "-"} | ${item.pathStatus || "-"} |`;
}

async function writeEnvironmentFiles(report) {
  const config = defaultConfig();
  config.shellPath = report.shell.path;
  config.gitPath = report.tools.git.path;
  config.pythonPath = report.tools.python.path;
  config.sevenZipPath = report.tools.sevenZip.path;
  config.hashTool = report.hashTool.path;
  await writeJson(path.join(root, "build.config.json"), config);

  const envLocal = [
    `DEX2OAT_NODE=${process.execPath}`,
    `DEX2OAT_SHELL=${report.shell.path}`,
    `DEX2OAT_GIT=${report.tools.git.path}`,
    `DEX2OAT_PYTHON=${report.tools.python.path}`,
    `DEX2OAT_7Z=${report.tools.sevenZip.path}`,
    `DEX2OAT_HASH_TOOL=${report.hashTool.path}`,
    ""
  ].join("\n");
  await fsp.writeFile(path.join(root, ".env.local"), envLocal, "utf8");

  const rows = [
    report.tools.powershell,
    report.tools.git,
    report.git.lfs,
    report.tools.node,
    report.tools.npm,
    report.tools.python,
    report.tools.sevenZip,
    report.tools.busybox,
    report.tools.wsl,
    report.tools.openssl,
    report.tools.java,
    report.git.githubCli
  ].map(toolRow).join("\n");
  const markdown = [
    "# Dex2oat Lock Environment Report",
    "",
    `- Checked at: ${report.checkedAt}`,
    `- OS: ${report.platform.os}`,
    `- Windows: ${report.platform.windowsVersion || "-"}`,
    `- Shell: ${report.shell.type} (${report.shell.path || "missing"})`,
    `- Hash tool: ${report.hashTool.name} (${report.hashTool.path})`,
    `- Installer: ${report.installer.name} (${report.installer.path || "missing"})`,
    "",
    "| Tool | Status | Version | Path | PATH |",
    "| --- | --- | --- | --- | --- |",
    rows,
    "",
    "## Git",
    "",
    `- user.name: ${report.git.username || "未配置"}`,
    `- user.email: ${report.git.email || "未配置"}`,
    `- SSH Key: ${report.git.sshKey || "未找到"}`,
    `- GitHub: ${report.git.githubStatus}`,
    "",
    "## Auto Install",
    "",
    report.autoInstall.installed.length
      ? report.autoInstall.installed.map((item) => `- ${item.tool}: exit ${item.status}`).join("\n")
      : `- ${report.autoInstall.skipped || "本次无需安装"}`,
    ""
  ].join("\n");
  await fsp.writeFile(path.join(root, "environment-report.md"), markdown, "utf8");
}

module.exports = {
  detectEnvironment,
  detectShell,
  installMissingRequired,
  writeEnvironmentFiles
};

if (require.main === module) {
  (async () => {
    const report = await detectEnvironment({ autoInstall: process.env.DEX2OAT_AUTO_INSTALL === "1", ensureSshKey: true });
    await writeEnvironmentFiles(report);
    console.log(JSON.stringify({ shell: report.shell, hashTool: report.hashTool }, null, 2));
  })().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
