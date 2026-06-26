import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile, cp } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const parent = path.dirname(root);
const version = JSON.parse(await readFile(path.join(root, "tools", "version.json"), "utf8"));
const releaseRoot = path.join(parent, "发布版");
const staging = path.join(releaseRoot, `Dex2oat-Lock-${version.version}-release`);
const zipPath = path.join(releaseRoot, `Dex2oat-Lock-${version.version}-release.zip`);

const include = [
  "customize.sh",
  "service.sh",
  "uninstall.sh",
  "system.prop",
  "skip_mount",
  "module.prop",
  "core",
  "scripts",
  "META-INF",
  "webroot"
];

const forbidden = new Set(["README.md", "CHANGELOG.md", "update.json"]);

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

await mkdir(releaseRoot, { recursive: true });
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });

for (const item of include) {
  await cp(path.join(root, item), path.join(staging, item), {
    recursive: true,
    force: true,
    filter(source) {
      const rel = path.relative(root, source).replace(/\\/g, "/");
      if (rel.startsWith("webroot-src") || rel.startsWith("tools") || rel.startsWith(".webui-src-temp")) return false;
      if (rel.startsWith("webroot/js") || rel.startsWith("webroot/css")) return false;
      return !forbidden.has(path.basename(source));
    }
  });
}

await rm(zipPath, { force: true });
const compress = spawnSync("powershell", [
  "-NoProfile",
  "-Command",
  `Compress-Archive -LiteralPath '${staging}\\*' -DestinationPath '${zipPath}' -Force`
], { encoding: "utf8" });

if (compress.status !== 0) {
  console.error(compress.stdout);
  console.error(compress.stderr);
  process.exit(compress.status || 1);
}

const zip = await readFile(zipPath);
const hash = sha256(zip);
await writeFile(`${zipPath}.sha256`, `${hash}  ${path.basename(zipPath)}\n`, "utf8");

console.log(JSON.stringify({
  zipPath,
  sha256: hash,
  bytes: zip.length
}, null, 2));
