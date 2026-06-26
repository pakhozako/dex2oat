const path = require("node:path");
const { detectShell } = require("./environment");
const { listFiles, root, run } = require("./toolkit");

function toWslPath(file) {
  const resolved = path.resolve(file);
  const match = resolved.match(/^([A-Za-z]):\\(.*)$/);
  if (!match) return resolved.replace(/\\/g, "/");
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
}

function shellArgs(shell, file) {
  if (shell.type === "wsl") return ["sh", "-n", toWslPath(file)];
  if (shell.type === "busybox") return ["sh", "-n", file];
  return ["-n", file];
}

async function validateShell(shell = detectShell()) {
  if (!shell.command) {
    throw new Error("No shell found for sh -n. Install Git Bash, WSL, or BusyBox.");
  }

  const files = (await listFiles(root)).filter((file) => path.extname(file) === ".sh");
  const failures = [];
  for (const file of files) {
    const result = run(shell.command, shellArgs(shell, file));
    if (result.status !== 0) {
      failures.push({ file, error: `${result.stdout}\n${result.stderr}`.trim() });
    }
  }

  if (failures.length) {
    throw new Error(`Shell validation failed:\n${failures.map((item) => `${item.file}\n${item.error}`).join("\n\n")}`);
  }

  return { files: files.length, shell };
}

module.exports = {
  validateShell
};

if (require.main === module) {
  validateShell()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
