import { createHash, randomInt } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const version = JSON.parse(await readFile(path.join(root, "tools", "version.json"), "utf8"));
const length = 18;
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const force = process.argv.includes("--force");
const outDir = path.join(root, "构建");
const privatePath = path.join(root, "deploy", "cloud", "supporters.private.json");
const manifestPath = path.join(outDir, `supporter-redeem-codes-${version.version}-manifest.json`);
const allPath = path.join(outDir, `supporter-redeem-codes-${version.version}-all-510.txt`);

const pools = [
  {
    key: "mem",
    codeIdPrefix: "MEM",
    skinId: "memorial-amber",
    count: 500,
    label: "纪念版・琥珀纪元",
    order: 10,
    plainPath: path.join(outDir, `supporter-redeem-codes-${version.version}-memorial-amber-500.txt`)
  },
  {
    key: "founder",
    codeIdPrefix: "FND",
    skinId: "founder-qingmu",
    count: 10,
    label: "创始人版・倾慕 / Elaina",
    order: 20,
    plainPath: path.join(outDir, `supporter-redeem-codes-${version.version}-founder-qingmu-10.txt`)
  }
];

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function makeCode() {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += alphabet[randomInt(alphabet.length)];
  }
  return value;
}

function makeUniqueCode(usedCodes) {
  let code = makeCode();
  while (usedCodes.has(code)) code = makeCode();
  usedCodes.add(code);
  return code;
}

function plainLinesForPool(pool, generatedAt, codes) {
  return [
    `Dex2oat Lock ${version.version} / ${version.versionCode} ${pool.label}兑换码`,
    `生成时间: ${generatedAt}`,
    `授权范围: ${pool.skinId}`,
    "规则: 每个兑换码 18 位；首次验证后绑定设备；同一设备可重复验证；其他设备不可再使用。",
    "输入: WebUI 可直接输入 18 位，也兼容按 6-6-6 加横线输入；不需要输入序号。",
    "",
    ...codes.map((code, index) => `${String(index + 1).padStart(3, "0")} ${code}`)
  ];
}

const outputPaths = [privatePath, manifestPath, allPath, ...pools.map((pool) => pool.plainPath)];
if (!force) {
  const existing = [];
  for (const file of outputPaths) {
    if (await exists(file)) existing.push(file);
  }
  if (existing.length) {
    throw new Error(`Supporter code files already exist. Re-run with --force only when rotating the whole code pool.\n${existing.join("\n")}`);
  }
}

const generatedAt = new Date().toISOString();
const usedCodes = new Set();
const generatedPools = pools.map((pool) => {
  const codes = [];
  while (codes.length < pool.count) codes.push(makeUniqueCode(usedCodes));
  codes.sort();
  return { ...pool, codes, plainLines: plainLinesForPool(pool, generatedAt, codes) };
});

const privateItems = generatedPools.flatMap((pool) => pool.codes.map((code, index) => ({
  id: `supporter-code-${pool.key}-${String(index + 1).padStart(4, "0")}`,
  codeId: `D2OAT-${version.versionCode}-${pool.codeIdPrefix}-${String(index + 1).padStart(4, "0")}`,
  skinId: pool.skinId,
  skinIds: [pool.skinId],
  name: `${pool.label}支持者`,
  tier: pool.label,
  badge: pool.label,
  note: `Dex2oat Lock ${pool.label}`,
  order: pool.order,
  active: true,
  hidden: true,
  public: false,
  expiresAt: 0,
  credentialSha256: sha256(code),
  installHashes: []
})));

const privatePayload = {
  ok: true,
  version: version.version,
  versionCode: Number(version.versionCode || 0),
  generatedAt,
  policy: "server-side one-code-one-install binding; same installHash may re-verify; raw codes are never stored here",
  codePools: generatedPools.map((pool) => ({
    skinId: pool.skinId,
    label: pool.label,
    count: pool.count
  })),
  items: [
    {
      id: "author-pakhozako",
      name: "pakhozako",
      tier: "作者",
      badge: "作者",
      note: "Dex2oat Lock",
      order: 100,
      active: true,
      public: true,
      expiresAt: 0,
      credentialSha256: "",
      installHashes: []
    },
    ...privateItems
  ]
};

const allLines = [
  `Dex2oat Lock ${version.version} / ${version.versionCode} 全量兑换码`,
  `生成时间: ${generatedAt}`,
  "输入: WebUI 可直接输入 18 位兑换码；不需要输入序号。",
  "",
  ...generatedPools.flatMap((pool) => [
    `## ${pool.label} (${pool.skinId})`,
    ...pool.codes.map((code, index) => `${pool.codeIdPrefix}-${String(index + 1).padStart(4, "0")} ${code}`),
    ""
  ])
];

const manifest = {
  ok: true,
  version: version.version,
  versionCode: Number(version.versionCode || 0),
  generatedAt,
  codeLength: length,
  total: generatedPools.reduce((sum, pool) => sum + pool.count, 0),
  pools: generatedPools.map((pool) => ({
    key: pool.key,
    skinId: pool.skinId,
    label: pool.label,
    count: pool.count,
    path: pool.plainPath,
    sha256: sha256(`${pool.plainLines.join("\n")}\n`)
  })),
  allPath,
  allSha256: sha256(`${allLines.join("\n")}\n`),
  privatePath,
  privateSha256: sha256(JSON.stringify(privatePayload))
};

await mkdir(outDir, { recursive: true });
await mkdir(path.dirname(privatePath), { recursive: true });
for (const pool of generatedPools) {
  await writeFile(pool.plainPath, `${pool.plainLines.join("\n")}\n`, "utf8");
}
await writeFile(allPath, `${allLines.join("\n")}\n`, "utf8");
await writeFile(privatePath, `${JSON.stringify(privatePayload, null, 2)}\n`, "utf8");
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify(manifest, null, 2));
