import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { generateIntegrityBaseline } = require("./generate-integrity");
const root = process.cwd();
const srcRoot = path.join(root, "webroot-src");
const outRoot = path.join(root, "webroot");
const versionPath = path.join(root, "tools", "version.json");
const version = JSON.parse(await readFile(versionPath, "utf8"));

function sha256(textOrBuffer) {
  return createHash("sha256").update(textOrBuffer).digest("hex");
}

function shortHash(textOrBuffer) {
  return sha256(textOrBuffer).slice(0, 10);
}

function protectedSeed(name, buffer) {
  const hash = sha256(`${version.version}:${version.versionCode}:${name}:${sha256(buffer)}`);
  return parseInt(hash.slice(0, 8), 16) >>> 0;
}

function nextMaskState(state, index, nameCode) {
  return (Math.imul(state ^ (index + 0x9e3779b9) ^ nameCode, 1664525) + 1013904223) >>> 0;
}

function protectBuffer(name, buffer, mime) {
  const seed = protectedSeed(name, buffer);
  const masked = Buffer.alloc(buffer.length);
  let maskState = seed ^ buffer.length ^ name.charCodeAt(0);
  for (let index = 0; index < buffer.length; index += 1) {
    const sourceIndex = buffer.length - 1 - index;
    maskState = nextMaskState(maskState, index, name.charCodeAt(index % name.length));
    const mask = (maskState ^ (maskState >>> 8) ^ (maskState >>> 16) ^ (seed >>> ((index & 3) * 8))) & 0xff;
    masked[index] = buffer[sourceIndex] ^ mask;
  }
  const base64 = masked.toString("base64");
  const chunks = [];
  for (let index = 0; index < base64.length; index += 61) {
    chunks.push(base64.slice(index, index + 61));
  }
  const rotation = chunks.length ? seed % chunks.length : 0;
  const rotatedChunks = chunks.slice(rotation).concat(chunks.slice(0, rotation)).reverse();
  return {
    v: 2,
    n: name,
    m: mime,
    l: buffer.length,
    s: seed,
    r: rotation,
    c: rotatedChunks
  };
}

async function buildProtectedData(optionsJson) {
  const appMeta = await readFile(path.join(srcRoot, "data", "app-meta.json"));
  const lyrics = await readFile(path.join(srcRoot, "data", "easter-lyrics.txt"));
  const cover = await readFile(path.join(srcRoot, "data", "easter-cover.jpg"));
  return {
    a: protectBuffer("a", appMeta, "application/json"),
    o: protectBuffer("o", Buffer.from(optionsJson, "utf8"), "application/json"),
    l: protectBuffer("l", lyrics, "text/plain;charset=utf-8"),
    c: protectBuffer("c", cover, "image/jpeg")
  };
}

function normalizeNewlines(text) {
  return text.replace(/\r\n/g, "\n");
}

function stripModuleSyntax(source) {
  let output = normalizeNewlines(source);
  output = output.replace(/^import\s+[^;]+;\n/gm, "");
  output = output.replace(/^export\s+async\s+function\s+/gm, "async function ");
  output = output.replace(/^export\s+function\s+/gm, "function ");
  output = output.replace(/^export\s+const\s+/gm, "const ");
  output = output.replace(/^export\s+let\s+/gm, "let ");
  output = output.replace(/^export\s+\{[^}]+\};?\n/gm, "");
  return output.trim();
}

function destructure(moduleName, names) {
  if (!names.length) return "";
  return `const { ${names.join(", ")} } = ${moduleName};`;
}

function wrapModule({ fileName, varName, imports = [], exports = [] }) {
  return async () => {
    const source = await readFile(path.join(srcRoot, "js", fileName), "utf8");
    const importLines = imports.map(([moduleName, names]) => destructure(moduleName, names)).filter(Boolean).join("\n");
    const returnLine = exports.length ? `\nreturn { ${exports.join(", ")} };` : "";
    return `\n/* ${fileName} */\nconst ${varName} = (() => {\n${importLines}\n${stripModuleSyntax(source)}${returnLine}\n})();\n`;
  };
}

async function appModule() {
  const source = await readFile(path.join(srcRoot, "js", "app.js"), "utf8");
  return `\n/* app.js */\n(() => {\n${destructure("__bridge", ["MODULE_DIR", "STATE_DIR", "exec", "readText", "writeBase64"])}
${destructure("__config", ["countChanged", "countEnabled", "countHighRiskEnabled", "decodeProtectedBytes", "decodeProtectedText", "loadJson", "loadUserConfig", "mergeConfig", "readGeneratedSystemProp", "saveConfig"])}
${destructure("__systemInfo", ["readSystemInfo"])}
${destructure("__ui", ["$", "createElement", "metric", "setStatus", "showConfirm"])}
${destructure("__utils", ["shellQuote", "resultMessage", "parseKeyValueLines", "parseStateFile"])}
${destructure("__m3Theme", ["initTheme"])}
${stripModuleSyntax(source)}
})();\n`;
}

function minifyCss(css) {
  return normalizeNewlines(css)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,>+~])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

function protectHtml(html) {
  const escaped = encodeLegacy(html);
  let encoded = "";
  const firstCode = escaped.charCodeAt(0) + escaped.length;
  encoded += `%u${firstCode.toString(16).padStart(4, "0").toUpperCase()}`;
  for (let index = 1; index < escaped.length; index += 1) {
    const code = escaped.charCodeAt(index) + escaped.charCodeAt(index - 1);
    encoded += code > 0xff
      ? `%u${code.toString(16).padStart(4, "0").toUpperCase()}`
      : `%${code.toString(16).padStart(2, "0").toUpperCase()}`;
  }
  return `<!doctype html><meta charset="utf-8"><script charset="utf-8">document.write(unescape(function(a){a=unescape(a);var c=String.fromCharCode(a.charCodeAt(0)-a.length);for(var i=1;i<a.length;i++){c+=String.fromCharCode(a.charCodeAt(i)-c.charCodeAt(i-1))}return c}("${encoded}")));</script>\n`;
}

function encodeLegacy(text) {
  let output = "";
  for (let index = 0; index < text.length; index += 1) {
    const ch = text.charAt(index);
    const code = text.charCodeAt(index);
    if (/^[A-Za-z0-9@*_+\-./]$/.test(ch)) {
      output += ch;
    } else if (code < 0x100) {
      output += `%${code.toString(16).padStart(2, "0").toUpperCase()}`;
    } else {
      output += `%u${code.toString(16).padStart(4, "0").toUpperCase()}`;
    }
  }
  return output;
}

function decodeLegacy(text) {
  return text.replace(/%u([0-9A-Fa-f]{4})|%([0-9A-Fa-f]{2})/g, (_match, wide, byte) =>
    String.fromCharCode(parseInt(wide || byte, 16))
  );
}

function decodeProtectedHtml(protectedHtml) {
  const match = protectedHtml.match(/return c}\("([^"]+)"\)/);
  if (!match) return protectedHtml;
  const encoded = decodeLegacy(match[1]);
  let decoded = String.fromCharCode(encoded.charCodeAt(0) - encoded.length);
  for (let index = 1; index < encoded.length; index += 1) {
    decoded += String.fromCharCode(encoded.charCodeAt(index) - decoded.charCodeAt(index - 1));
  }
  return decodeLegacy(decoded);
}

function tsvValue(value) {
  return String(value ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ").trim();
}

function riskRank(risk) {
  return { safe: 1, caution: 2, aggressive: 3 }[risk] || 9;
}

function resolveRuleOwners(options) {
  const byProp = new Map();
  for (const category of options.categories || []) {
    for (const item of category.items || []) {
      if (!item.prop) continue;
      const entries = byProp.get(item.prop) || [];
      entries.push({ category, item });
      byProp.set(item.prop, entries);
    }
  }

  const owners = new Map();
  const conflicts = [];
  for (const [prop, entries] of byProp.entries()) {
    const autoCandidates = entries
      .filter((entry) => entry.category.id !== "aggressive")
      .sort((left, right) => riskRank(left.category.id) - riskRank(right.category.id));
    const owner = autoCandidates[0] || entries.sort((left, right) => riskRank(left.category.id) - riskRank(right.category.id))[0];
    owners.set(prop, owner.item.id);
    if (entries.length > 1) {
      conflicts.push({
        prop,
        owner: owner.item.id,
        ownerRisk: owner.category.id,
        reason: "auto-owner-prefers-lowest-risk-non-aggressive-rule",
        candidates: entries.map((entry) => ({
          id: entry.item.id,
          risk: entry.category.id,
          defaultEnabled: Boolean(entry.item.defaultEnabled)
        }))
      });
    }
  }
  return { owners, conflicts };
}

async function syncMetadata() {
  const moduleProp = [
    `id=${version.id}`,
    `name=${version.name}`,
    `version=${version.version}`,
    `versionCode=${version.versionCode}`,
    `author=${version.author}`,
    `description=${version.description} | 🟩 OK`,
    `updateJson=${version.updateJson}`,
    ""
  ].join("\n");
  const updateJson = `${JSON.stringify({
    version: version.version,
    versionCode: version.versionCode,
    zipUrl: version.zipUrl,
    changelog: version.changelog
  }, null, 2)}\n`;
  const appMeta = `${JSON.stringify({
    moduleName: version.name,
    version: version.version,
    versionCode: version.versionCode,
    author: version.author,
    githubUrl: version.githubUrl,
    architecture: version.architecture,
    description: "Dex2oat Lock 是一个基于规则库生成 ART / dex2oat 配置并通过统一状态展示运行健康度的模块。"
  }, null, 2)}\n`;
  await writeFile(path.join(root, "module.prop"), moduleProp, "utf8");
  await writeFile(path.join(root, "update.json"), updateJson, "utf8");
  await writeFile(path.join(srcRoot, "data", "app-meta.json"), appMeta, "utf8");
}

async function buildRules() {
  const optionsPath = path.join(srcRoot, "data", "options.json");
  const options = JSON.parse(await readFile(optionsPath, "utf8"));
  options.schemaVersion = version.schemaVersion;
  options.rulesVersion = version.rulesVersion;
  const { owners, conflicts } = resolveRuleOwners(options);
  options.ruleConflicts = conflicts;

  const rows = [
    [
      "id",
      "label",
      "prop",
      "defaultEnabled",
      "defaultValue",
      "risk",
      "owner",
      "ownerReason",
      "explainTitle",
      "explainReason",
      "confidence",
      "values"
    ].join("\t")
  ];

  for (const category of options.categories || []) {
    for (const item of category.items || []) {
      const owner = owners.get(item.prop) || item.id;
      if (category.id === "aggressive") item.defaultEnabled = false;
      const autoEnabled = category.id === "aggressive" ? false : Boolean(item.defaultEnabled);
      rows.push([
        item.id,
        item.label,
        item.prop,
        autoEnabled ? "true" : "false",
        item.defaultValue,
        category.id,
        owner,
        owner === item.id ? "owner" : "shadowed-by-owner",
        item.explain?.title || item.label || item.id,
        item.explain?.reason || item.description || "",
        item.explain?.confidence || "medium",
        (item.values || []).join("|")
      ].map(tsvValue).join("\t").replace(/\t+$/g, ""));
    }
  }

  const normalizedOptions = `${JSON.stringify(options, null, 2)}\n`;
  await writeFile(optionsPath, normalizedOptions, "utf8");
  await rm(path.join(outRoot, "data"), { recursive: true, force: true });
  await mkdir(path.join(outRoot, "data"), { recursive: true });
  await writeFile(path.join(outRoot, "data", "rule-props.tsv"), `${rows.join("\n")}\n`, "utf8");
  return { options, conflicts, protectedData: await buildProtectedData(normalizedOptions) };
}

async function buildJs(protectedData) {
  const builders = [
    wrapModule({
      fileName: "utils.js",
      varName: "__utils",
      exports: ["parseKeyValue", "shellQuote", "resultMessage", "parseKeyValueLines", "parseStateFile"]
    }),
    wrapModule({
      fileName: "bridge.js",
      varName: "__bridge",
      imports: [["__utils", ["shellQuote"]]],
      exports: ["MODULE_DIR", "STATE_DIR", "exec", "readText", "writeBase64"]
    }),
    wrapModule({
      fileName: "ui.js",
      varName: "__ui",
      exports: ["$", "createElement", "metric", "setStatus", "showConfirm"]
    }),
    wrapModule({
      fileName: "m3-theme.js",
      varName: "__m3Theme",
      exports: ["generateColorScheme", "applyScheme", "applySourceColor", "restoreSourceColor", "setTheme", "getTheme", "initTheme"]
    }),
    wrapModule({
      fileName: "system-info.js",
      varName: "__systemInfo",
      imports: [["__bridge", ["exec"]], ["__utils", ["parseKeyValue"]]],
      exports: ["readSystemInfo"]
    }),
    wrapModule({
      fileName: "config.js",
      varName: "__config",
      imports: [
        ["__bridge", ["MODULE_DIR", "STATE_DIR", "exec", "readText", "writeBase64"]],
        ["__utils", ["shellQuote", "resultMessage", "parseKeyValueLines", "parseStateFile"]]
      ],
      exports: ["countChanged", "countEnabled", "countHighRiskEnabled", "decodeProtectedBytes", "decodeProtectedText", "loadJson", "loadUserConfig", "mergeConfig", "readGeneratedSystemProp", "saveConfig"]
    }),
    appModule
  ];
  const chunks = [];
  for (const buildChunk of builders) {
    chunks.push(await buildChunk());
  }
  const protectedDataScript = `globalThis.__DEX2OAT_WEBUI_DATA=${JSON.stringify(protectedData)};\n`;
  const banner = `/* ${version.name} ${version.version} protected bundle. Built from webroot-src. */\n`;
  const bundled = `${banner}${protectedDataScript}${chunks.join("\n").trimEnd()}\n`;
  const assetName = "dex2oat-ui.protected.js";
  await mkdir(path.join(outRoot, "assets"), { recursive: true });
  await writeFile(path.join(outRoot, "assets", assetName), bundled, "utf8");
  return { assetName, hash: sha256(bundled), content: bundled };
}

async function buildCss() {
  const cssFiles = [
    "m3-tokens.css",
    "m3-theme.css",
    "m3-components.css",
    "m3-utils.css",
    "app.css"
  ];
  const cssParts = [];
  for (const fileName of cssFiles) {
    cssParts.push(await readFile(path.join(srcRoot, "css", fileName), "utf8"));
  }
  const css = cssParts.join("\n");
  const minified = `${minifyCss(css)}\n`;
  const assetName = "dex2oat-ui.protected.css";
  await mkdir(path.join(outRoot, "assets"), { recursive: true });
  await writeFile(path.join(outRoot, "assets", assetName), minified, "utf8");
  return { assetName, hash: sha256(minified), content: minified };
}

async function cleanAssets() {
  await rm(path.join(outRoot, "assets"), { recursive: true, force: true });
  await mkdir(path.join(outRoot, "assets"), { recursive: true });
}

async function writeIndex(jsAsset, cssAsset) {
  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="light dark" />
    <title>${version.name}</title>
    <link rel="stylesheet" href="./assets/${cssAsset}" />
  </head>
  <body>
    <div id="app" class="app-shell">
      <main class="boot-screen">
        <h1>${version.name}</h1>
        <p>&#27491;&#22312;&#21152;&#36733; WebUI...</p>
      </main>
    </div>
    <script charset="utf-8" src="./assets/${jsAsset}"></script>
  </body>
</html>
`;
  await writeFile(path.join(outRoot, "index.html"), protectHtml(html), "utf8");
}

async function listReleaseFiles(dir, prefix = "") {
  const entries = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.name === ".git" || item.name === ".webui-src-temp" || item.name === "webroot-src" || item.name === "tools") continue;
    if (item.name === "发布版" || item.name === "源码版" || item.name === "releases" || item.name === "backups") continue;
    if (item.name.startsWith("legacy-artifacts-") || item.name.startsWith("修复前备份-")) continue;
    const rel = prefix ? `${prefix}/${item.name}` : item.name;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      entries.push(...await listReleaseFiles(full, rel));
    } else {
      entries.push(rel);
    }
  }
  return entries.sort();
}

async function writeIntegrityBaseline() {
  await generateIntegrityBaseline({ staging: path.join(root, "temp", "webui-integrity-staging") });
}

async function verifyBuild(js, css) {
  const jsPath = path.join(outRoot, "assets", js.assetName);
  const cssPath = path.join(outRoot, "assets", css.assetName);
  const [jsBuilt, cssBuilt] = await Promise.all([readFile(jsPath), readFile(cssPath)]);
  if (sha256(jsBuilt) !== js.hash) throw new Error("JS protected bundle hash mismatch");
  if (sha256(cssBuilt) !== css.hash) throw new Error("CSS protected bundle hash mismatch");
  const index = await readFile(path.join(outRoot, "index.html"), "utf8");
  const decodedIndex = decodeProtectedHtml(index);
  if (!decodedIndex.includes(js.assetName) || !decodedIndex.includes(css.assetName)) {
    throw new Error("index.html does not reference generated protected assets");
  }
  const dataFiles = await readdir(path.join(outRoot, "data"));
  for (const forbidden of ["options.json", "app-meta.json", "easter-lyrics.txt", "easter-cover.jpg", "rule-conflicts.json"]) {
    if (dataFiles.includes(forbidden)) {
      throw new Error(`protected WebUI data leaked as plain file: ${forbidden}`);
    }
  }
  if (!dataFiles.includes("rule-props.tsv")) {
    throw new Error("rule-props.tsv missing from release WebUI data");
  }
}

await syncMetadata();
await cleanAssets();
const { conflicts, protectedData } = await buildRules();
const js = await buildJs(protectedData);
const css = await buildCss();
await writeIndex(js.assetName, css.assetName);
await writeIntegrityBaseline();
await verifyBuild(js, css);

console.log(JSON.stringify({
  version: version.version,
  versionCode: version.versionCode,
  js: js.assetName,
  jsHash: js.hash,
  css: css.assetName,
  cssHash: css.hash,
  conflictCount: conflicts.length
}, null, 2));
