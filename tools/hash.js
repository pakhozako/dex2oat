const path = require("node:path");
const { firstCommand, run, sha256File } = require("./toolkit");

function detectHashTool() {
  const openssl = firstCommand(["openssl"]);
  if (openssl) return { name: "openssl", path: openssl };
  const certutil = firstCommand(["certutil"]);
  if (certutil) return { name: "certutil", path: certutil };
  const powershell = firstCommand(["pwsh", "powershell"]);
  if (powershell) return { name: "powershell", path: powershell };
  return { name: "node-crypto", path: process.execPath };
}

async function hashFile(file, preferred = detectHashTool()) {
  if (preferred.name === "openssl") {
    const result = run(preferred.path, ["dgst", "-sha256", "-r", file]);
    const match = result.stdout.match(/^([a-fA-F0-9]{64})\b/);
    if (match) return match[1].toLowerCase();
  }

  if (preferred.name === "certutil") {
    const result = run(preferred.path, ["-hashfile", file, "SHA256"]);
    const match = result.stdout.replace(/\s+/g, "").match(/([a-fA-F0-9]{64})/);
    if (match) return match[1].toLowerCase();
  }

  if (preferred.name === "powershell") {
    const result = run(preferred.path, [
      "-NoProfile",
      "-Command",
      `(Get-FileHash -Algorithm SHA256 -LiteralPath '${String(file).replace(/'/g, "''")}').Hash`
    ]);
    const match = result.stdout.match(/([a-fA-F0-9]{64})/);
    if (match) return match[1].toLowerCase();
  }

  return sha256File(file);
}

async function writeSha256(file, outFile, preferred) {
  const hash = await hashFile(file, preferred);
  const fs = require("node:fs/promises");
  await fs.writeFile(outFile, `${hash}  ${path.basename(file)}\n`, "utf8");
  return hash;
}

module.exports = {
  detectHashTool,
  hashFile,
  writeSha256
};

if (require.main === module) {
  (async () => {
    const file = process.argv[2];
    if (!file) throw new Error("usage: node tools/hash.js <file>");
    console.log(await hashFile(file));
  })().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
