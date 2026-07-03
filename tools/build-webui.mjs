import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { gzip, brotliCompress, constants as zlibConstants } from "node:zlib";
import path from "node:path";
import { promisify } from "node:util";
import { build as viteBuild } from "vite";
import { minify as minifyHtml } from "html-minifier-terser";
import postcss from "postcss";
import cssnano from "cssnano";
import { minify as terserMinify } from "terser";
import JavaScriptObfuscator from "javascript-obfuscator";

const require = createRequire(import.meta.url);
const { generateIntegrityBaseline } = require("./generate-integrity");
const { readSkinCssAssets } = require("./skin-assets");
const root = process.cwd();
const srcRoot = path.join(root, "webroot-src");
const outRoot = path.join(root, "webroot");
const distRoot = path.join(root, "dist", "webui-protected");
const versionPath = path.join(root, "tools", "version.json");
const version = JSON.parse(await readFile(versionPath, "utf8"));
const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);
const TYPE_FALLBACK = {
  boolean: "false",
  limit: "9999",
  count: "0",
  enum: "all",
  dexoptEnum: "everything"
};

const OBFUSCATOR_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,
  disableConsoleOutput: true,
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: false,
  rotateStringArray: true,
  selfDefending: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 6,
  stringArray: true,
  stringArrayEncoding: ["base64"],
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  transformObjectKeys: true,
  unicodeEscapeSequence: false
};

function sha256(textOrBuffer) {
  return createHash("sha256").update(textOrBuffer).digest("hex");
}

function shortHash(textOrBuffer) {
  return sha256(textOrBuffer).slice(0, 10);
}

function byteLength(value) {
  return Buffer.isBuffer(value) ? value.length : Buffer.byteLength(String(value), "utf8");
}

async function writeCompressedVariants(filePath, content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8");
  const [gz, br] = await Promise.all([
    gzipAsync(buffer, { level: 9 }),
    brotliAsync(buffer, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11
      }
    })
  ]);
  await Promise.all([
    writeFile(`${filePath}.gz`, gz),
    writeFile(`${filePath}.br`, br)
  ]);
  return {
    gzip: { file: path.basename(`${filePath}.gz`), bytes: gz.length, sha256: sha256(gz) },
    brotli: { file: path.basename(`${filePath}.br`), bytes: br.length, sha256: sha256(br) }
  };
}

async function runViteBuild() {
  const entry = path.join(srcRoot, "js", "app.js");
  await rm(distRoot, { recursive: true, force: true });
  await mkdir(distRoot, { recursive: true });
  await viteBuild({
    root: srcRoot,
    logLevel: "silent",
    configFile: false,
    publicDir: false,
    build: {
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      target: "es2017",
      outDir: distRoot,
      lib: {
        entry,
        name: "Dex2oatLockWebui",
        formats: ["iife"],
        fileName: () => "vite-entry.js"
      },
      rollupOptions: {
        treeshake: false,
        output: {
          inlineDynamicImports: true
        }
      }
    }
  });
  const output = await readFile(path.join(distRoot, "vite-entry.js"), "utf8");
  return {
    outDir: distRoot,
    entry: path.join(distRoot, "vite-entry.js"),
    bytes: byteLength(output),
    sha256: sha256(output),
    code: output
  };
}

async function minifyJs(source) {
  const result = await terserMinify(source, {
    ecma: 2017,
    compress: {
      drop_debugger: true,
      passes: 2
    },
    mangle: {
      toplevel: false
    },
    format: {
      ascii_only: false,
      comments: false
    }
  });
  if (!result.code) throw new Error("Terser returned empty JavaScript output");
  return result.code;
}

function obfuscatorSeed(source) {
  const hash = sha256(`${version.version}:${version.versionCode}:obfuscator:${sha256(source)}`);
  return parseInt(hash.slice(0, 8), 16) >>> 0;
}

function obfuscateJs(source) {
  return JavaScriptObfuscator.obfuscate(source, {
    ...OBFUSCATOR_OPTIONS,
    seed: obfuscatorSeed(source)
  }).getObfuscatedCode();
}

async function minifyCssWithPostcss(css) {
  const result = await postcss([
    cssnano({
      preset: ["default", {
        discardComments: { removeAll: true }
      }]
    })
  ]).process(css, { from: undefined });
  return `${result.css.trim()}\n`;
}

async function minifyHtmlDocument(html) {
  return `${await minifyHtml(html, {
    collapseBooleanAttributes: true,
    collapseWhitespace: true,
    decodeEntities: false,
    html5: true,
    minifyCSS: false,
    minifyJS: false,
    removeAttributeQuotes: false,
    removeComments: true,
    removeEmptyAttributes: false,
    removeOptionalTags: false,
    removeRedundantAttributes: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
    sortAttributes: true,
    sortClassName: false
  })}\n`;
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

function protectedScriptLoader(name, source) {
  const payload = protectBuffer(name, Buffer.from(source, "utf8"), "application/javascript;charset=utf-8");
  return [
    `/* ${version.name} ${version.version} protected loader. */`,
    "(function(p){",
    "function m(s,i,n){return (Math.imul((s^(i+0x9e3779b9)^n),1664525)+1013904223)>>>0}",
    "function d(p){var a=p.c.slice().reverse(),r=(+p.r||0)%a.length;if(p.v>=2&&a.length)a.unshift.apply(a,a.splice(a.length-r,r));var b=atob(a.join('')),o=new Uint8Array(p.l),n=p.n||'data',s=(p.s^p.l^n.charCodeAt(0))>>>0;for(var i=0;i<p.l;i++){var c=n.charCodeAt(i%n.length);s=m(s,i,c);var k=(s^(s>>>8)^(s>>>16)^(p.s>>>((i&3)*8)))&255;o[p.l-1-i]=b.charCodeAt(i)^k}var t='',z=32768;for(i=0;i<o.length;i+=z)t+=String.fromCharCode.apply(null,o.subarray(i,i+z));try{return decodeURIComponent(escape(t))}catch(e){return t}}",
    "try{(0,eval)(d(p))}catch(e){setTimeout(function(){throw e},0)}})",
    `(${JSON.stringify(payload)});\n`
  ].join("");
}

async function buildProtectedData(optionsJson) {
  const appMeta = await readFile(path.join(srcRoot, "data", "app-meta.json"));
  const propPolicy = await readFile(path.join(srcRoot, "data", "prop-policy.tsv"));
  const lyrics = await readFile(path.join(srcRoot, "data", "easter-lyrics.txt"));
  const cover = await readFile(path.join(srcRoot, "data", "easter-cover.jpg"));
  const logo = await readFile(path.join(srcRoot, "data", "logo.jpg"));
  return {
    a: protectBuffer("a", appMeta, "application/json"),
    o: protectBuffer("o", Buffer.from(optionsJson, "utf8"), "application/json"),
    p: protectBuffer("p", propPolicy, "text/tab-separated-values;charset=utf-8"),
    l: protectBuffer("l", lyrics, "text/plain;charset=utf-8"),
    c: protectBuffer("c", cover, "image/jpeg"),
    g: protectBuffer("g", logo, "image/jpeg")
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
${destructure("__config", ["countChangedForMatched", "countEnabledForMatched", "countHighRiskEnabledForMatched", "decodeProtectedBytes", "decodeProtectedText", "displayFallbackValueForItem", "fallbackValueForItem", "loadJson", "loadUserConfig", "mergeConfig", "readGeneratedSystemProp", "saveConfigForMatched"])}
${destructure("__systemInfo", ["readSystemInfo"])}
${destructure("__ui", ["$", "createElement", "metric", "setStatus", "showConfirm", "showToast"])}
${destructure("__utils", ["shellQuote", "resultMessage", "parseKeyValueLines", "parseStateFile"])}
${destructure("__m3Theme", ["MATERIAL_YOU_THEMES", "applyMaterialTheme", "getMaterialTheme", "initTheme"])}
${destructure("__brandPill", ["BRAND_PILL_NAME", "applyBrandPillLogo", "createBrandPillMarkup", "setBrandPillVersion"])}
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
  const base64 = Buffer.from(html, "utf8").toString("base64");
  const chunks = [];
  for (let index = 0; index < base64.length; index += 2048) {
    chunks.push(base64.slice(index, index + 2048));
  }
  return `<!doctype html><meta charset="utf-8"><script charset="utf-8">(function(c){var b=c.join(''),h='';try{h=decodeURIComponent(escape(atob(b)))}catch(e){h=atob(b)}document.write(h)})(${JSON.stringify(chunks)});</script>\n`;
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
  const base64Match = protectedHtml.match(/\}\)\((\[[\s\S]*?\])\);<\/script>/);
  if (base64Match) {
    try {
      return Buffer.from(JSON.parse(base64Match[1]).join(""), "base64").toString("utf8");
    } catch {
      return protectedHtml;
    }
  }
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

function runtimeRuleText(value, fallback = "") {
  const source = String(value ?? fallback ?? "")
    .replace(/\t/g, " ")
    .replace(/\r?\n/g, " ")
    .trim();
  return source.replace(/[^A-Za-z0-9_.,:@%+*/| -]/g, "") || String(fallback || "");
}

function protectRulesTable(text) {
  const buffer = Buffer.from(text, "utf8");
  const seed = protectedSeed("rule-props", buffer);
  const masked = Buffer.alloc(buffer.length);
  for (let index = 0; index < buffer.length; index += 1) {
    const sourceIndex = buffer.length - 1 - index;
    const mask = (seed + ((index + 1) * 73) + (((sourceIndex + 1) % 251) * 17) + buffer.length) & 0xff;
    masked[index] = (buffer[sourceIndex] + mask) & 0xff;
  }
  const hex = masked.toString("hex").toUpperCase();
  const lines = [];
  for (let index = 0; index < hex.length; index += 96) {
    lines.push(hex.slice(index, index + 96));
  }
  return [
    "# Dex2oat Lock protected rule table",
    "version=1",
    `seed=${seed}`,
    `length=${buffer.length}`,
    `sha256=${sha256(buffer)}`,
    "data=",
    ...lines,
    ""
  ].join("\n");
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

function summarizeRuleConflicts(conflicts) {
  return conflicts.map((conflict) => ({
    prop: conflict.prop,
    owner: conflict.owner,
    ownerRisk: conflict.ownerRisk,
    candidates: conflict.candidates.map((candidate) => `${candidate.id}:${candidate.risk}`)
  }));
}

async function readPropPolicy() {
  const policyPath = path.join(srcRoot, "data", "prop-policy.tsv");
  const fallbackDefaults = { ...TYPE_FALLBACK };
  try {
    const text = await readFile(policyPath, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trimEnd();
      if (!line || line.startsWith("#")) continue;
      const [section, key, value = ""] = line.split("\t");
      if (section === "fallback" && key) fallbackDefaults[key] = value;
    }
  } catch {
    // Keep the build usable for older source trees; runtime validation catches a missing copied file.
  }
  return { fallbackDefaults, policyPath };
}

function inferValueType(item) {
  const values = (item.values || []).map(String);
  const subject = `${item.id || ""} ${item.prop || ""}`;
  if (values.includes("false") && values.includes("true") && values.length <= 3) return "boolean";
  if (values.includes("everything")) return "dexoptEnum";
  if (values.includes("9999")) return "limit";
  if (values.includes("0")) return "count";
  if (values.includes("all")) return "enum";
  if (/limit|max|cap|upper|downgrade_after_inactive_days/i.test(subject)) return "limit";
  if (/count|num|threads|percent|threshold|size/i.test(subject)) return "count";
  return "enum";
}

function fallbackDefaultForItem(item, fallbackDefaults) {
  const values = (item.values || []).map(String);
  const displayFallback = String(fallbackDefaults[inferValueType(item)] ?? item.defaultValue ?? "");
  if (values.includes(displayFallback)) return displayFallback;
  if (values.includes("")) return "";
  return String(item.defaultValue ?? "");
}

function displayFallbackDefaultForItem(item, fallbackDefaults) {
  return String(fallbackDefaults[inferValueType(item)] ?? item.defaultValue ?? "");
}

function webSafeUrl(value, { allowHttp = false } = {}) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const isLoopback = host === "localhost"
      || host === "127.0.0.1"
      || host === "::1"
      || host === "[::1]"
      || host.endsWith(".localhost");
    if (url.protocol === "https:" || (url.protocol === "http:" && (allowHttp || isLoopback))) {
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

async function syncMetadata() {
  const moduleProp = [
    `id=${version.id}`,
    `name=${version.name}`,
    `version=${version.version}`,
    `versionCode=${version.versionCode}`,
    `author=${version.author}`,
    `description=${version.description} | 🟩 正常`,
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
    githubUrl: webSafeUrl(version.githubUrl),
    supportUrl: webSafeUrl(version.supportUrl),
    feedbackUrl: webSafeUrl(version.feedbackUrl, { allowHttp: true }),
    supporterVerifyUrl: webSafeUrl(version.supporterVerifyUrl, { allowHttp: true }),
    supporterDirectoryUrl: webSafeUrl(version.supporterDirectoryUrl, { allowHttp: true }),
    cloudBaseUrl: webSafeUrl(version.cloudBaseUrl, { allowHttp: true }),
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
  const { fallbackDefaults, policyPath } = await readPropPolicy();
  options.schemaVersion = version.schemaVersion;
  options.rulesVersion = version.rulesVersion;
  for (const category of options.categories || []) {
    for (const item of category.items || []) {
      item.defaultEnabled = false;
      item.valueType = inferValueType(item);
      item.displayFallbackValue = displayFallbackDefaultForItem(item, fallbackDefaults);
      item.fallbackValue = fallbackDefaultForItem(item, fallbackDefaults);
    }
  }
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
      const autoEnabled = false;
      rows.push([
        runtimeRuleText(item.id),
        runtimeRuleText(item.id),
        runtimeRuleText(item.prop),
        autoEnabled ? "true" : "false",
        runtimeRuleText(item.defaultValue),
        runtimeRuleText(category.id),
        runtimeRuleText(owner),
        owner === item.id ? "owner" : "shadowed-by-owner",
        runtimeRuleText(item.id),
        "",
        runtimeRuleText(item.explain?.confidence || "medium", "medium"),
        runtimeRuleText((item.values || []).join("|"))
      ].map(tsvValue).join("\t").replace(/\t+$/g, ""));
    }
  }

  const normalizedOptions = `${JSON.stringify(options, null, 2)}\n`;
  const runtimeRules = `${rows.join("\n")}\n`;
  await writeFile(optionsPath, normalizedOptions, "utf8");
  await rm(path.join(outRoot, "data"), { recursive: true, force: true });
  await mkdir(path.join(outRoot, "data"), { recursive: true });
  await writeFile(path.join(outRoot, "data", "rule-props.pack"), protectRulesTable(runtimeRules), "utf8");
  await copyFile(policyPath, path.join(outRoot, "data", "prop-policy.tsv"));
  return { options, conflicts, protectedData: await buildProtectedData(normalizedOptions) };
}

async function buildJs(protectedData) {
  const vite = await runViteBuild();
  const protectedDataScript = `globalThis.__DEX2OAT_WEBUI_DATA=${JSON.stringify(protectedData)};\n`;
  const banner = `/* ${version.name} ${version.version} protected bundle. Built from webroot-src. */\n`;
  const bundled = `${banner}${protectedDataScript}${vite.code}\n`;
  const minified = await minifyJs(bundled);
  const obfuscated = obfuscateJs(minified);
  const protectedBundle = protectedScriptLoader("ui", obfuscated);
  const assetName = "dex2oat-ui.protected.js";
  await mkdir(path.join(outRoot, "assets"), { recursive: true });
  const filePath = path.join(outRoot, "assets", assetName);
  await writeFile(filePath, protectedBundle, "utf8");
  const compressed = await writeCompressedVariants(filePath, protectedBundle);
  return {
    assetName,
    hash: sha256(protectedBundle),
    content: protectedBundle,
    sourceBytes: byteLength(bundled),
    vite,
    terserBytes: byteLength(minified),
    obfuscatedBytes: byteLength(obfuscated),
    protectedBytes: byteLength(protectedBundle),
    compressed
  };
}

async function buildCss() {
  const cssFiles = [
    "m3-tokens.css",
    "m3-theme.css",
    "m3-components.css",
    "m3-utils.css",
    "layout.css",
    "custom.css",
    "dialogs.css",
    "app.css"
  ];
  const cssParts = [];
  for (const fileName of cssFiles) {
    cssParts.push(await readFile(path.join(srcRoot, "css", fileName), "utf8"));
  }
  const css = cssParts.join("\n");
  const minified = await minifyCssWithPostcss(css);
  const assetName = "dex2oat-ui.protected.css";
  await mkdir(path.join(outRoot, "assets"), { recursive: true });
  const filePath = path.join(outRoot, "assets", assetName);
  await writeFile(filePath, minified, "utf8");
  const compressed = await writeCompressedVariants(filePath, minified);
  return {
    assetName,
    hash: sha256(minified),
    content: minified,
    sourceBytes: byteLength(css),
    protectedBytes: byteLength(minified),
    compressed
  };
}

async function buildOnDemandCss() {
  const cssFiles = readSkinCssAssets();
  const cssOutDir = path.join(outRoot, "css");
  await rm(cssOutDir, { recursive: true, force: true });
  await mkdir(cssOutDir, { recursive: true });
  const assets = [];
  for (const fileName of cssFiles) {
    const source = await readFile(path.join(srcRoot, "css", fileName), "utf8");
    const minified = await minifyCssWithPostcss(source);
    const filePath = path.join(cssOutDir, fileName);
    await writeFile(filePath, minified, "utf8");
    const compressed = await writeCompressedVariants(filePath, minified);
    assets.push({
      assetName: `css/${fileName}`,
      hash: sha256(minified),
      sourceBytes: byteLength(source),
      protectedBytes: byteLength(minified),
      compressed
    });
  }
  return assets;
}

async function cleanAssets() {
  await rm(path.join(outRoot, "assets"), { recursive: true, force: true });
  await mkdir(path.join(outRoot, "assets"), { recursive: true });
}

async function writeIndex(jsAsset, cssAsset) {
  const logo = await readFile(path.join(srcRoot, "data", "logo.jpg"));
  const bootLogoSrc = `data:image/jpeg;base64,${logo.toString("base64")}`;
  const bootCriticalCss = [
    ":root{color-scheme:light dark;--boot-surface:#fffbfe;--boot-surface-low:#f7f2fa;--boot-surface-high:rgba(236,230,240,.62);--boot-on-surface:#1d1b20;--boot-on-variant:#49454f;--boot-primary-container:#eaddff;--boot-shadow:rgba(29,27,32,.10)}",
    "@media (prefers-color-scheme:dark){:root{--boot-surface:#141218;--boot-surface-low:#1d1b20;--boot-surface-high:rgba(43,41,48,.62);--boot-on-surface:#e6e0e9;--boot-on-variant:#cac4d0;--boot-primary-container:#4f378b;--boot-shadow:rgba(0,0,0,.24)}}",
    "html,body{min-height:100%;margin:0;background:var(--boot-surface);color:var(--boot-on-surface);font-family:Roboto,'Noto Sans SC','HarmonyOS Sans SC','MiSans',system-ui,sans-serif}",
    ".app-shell.is-booting{min-height:100vh;padding:0;overflow:hidden}",
    ".boot-screen{position:fixed;inset:0;z-index:80;display:grid;min-height:100vh;place-items:center;padding:24px 20px;overflow:hidden;background:linear-gradient(135deg,rgba(234,221,255,.18),transparent 44%),linear-gradient(180deg,var(--boot-surface-low),var(--boot-surface));color:var(--boot-on-surface);text-align:center}",
    ".boot-card{width:min(100%,320px);display:grid;justify-items:center;gap:22px;padding:30px 24px 28px;border-radius:28px;background:var(--boot-surface-high);box-shadow:0 6px 18px var(--boot-shadow);animation:bootCardIn 520ms cubic-bezier(.2,0,0,1) both}",
    ".boot-logo-stage{width:104px;height:104px;display:grid;place-items:center}",
    ".boot-logo-image{width:88px;height:88px;object-fit:cover;border-radius:26px;background:var(--boot-primary-container);box-shadow:0 2px 6px var(--boot-shadow);transform-origin:center center;animation:bootLogoIn 820ms cubic-bezier(.2,0,0,1) 80ms both}",
    ".boot-copy{display:grid;gap:22px;animation:bootCopyIn 620ms cubic-bezier(.2,0,0,1) 160ms both}.boot-screen h1{margin:0;color:var(--boot-on-surface);font:500 28px/36px system-ui,sans-serif;letter-spacing:0}.boot-screen p{max-width:260px;margin:0;color:var(--boot-on-variant);font:400 14px/20px system-ui,sans-serif;letter-spacing:0}.boot-lyric{color:var(--boot-on-surface);opacity:.72;font-weight:500}.boot-status-text{display:inline-flex;justify-content:center;white-space:nowrap;opacity:.78}.boot-status-dots{display:inline-block;width:3ch;overflow:hidden;text-align:left}.boot-status-dots::after{content:'...';animation:bootDots 1.6s steps(4,end) infinite}@keyframes bootCardIn{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}@keyframes bootLogoIn{from{opacity:0;transform:translateY(8px) scale(.92)}58%{opacity:1;transform:translateY(0) scale(1.012)}to{opacity:1;transform:translateY(0) scale(1)}}@keyframes bootCopyIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}@keyframes bootDots{0%,24.99%{width:0}25%,49.99%{width:1ch}50%,74.99%{width:2ch}75%,100%{width:3ch}}"
  ].join("");
  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="light dark" />
    <title>${version.name}</title>
    <style>${bootCriticalCss}</style>
    <link rel="stylesheet" href="./assets/${cssAsset}" />
  </head>
  <body>
    <div id="app" class="app-shell is-booting">
      <main class="boot-screen" id="bootScreen" aria-live="polite">
        <section class="boot-card" aria-label="${version.name} 正在启动">
          <div class="boot-logo-stage">
            <img class="boot-logo-image" src="${bootLogoSrc}" width="88" height="88" decoding="sync" fetchpriority="high" alt="" />
          </div>
          <div class="boot-copy">
            <h1>${version.name}</h1>
            <p class="boot-lyric">可以愛的話 不退縮</p>
            <p class="boot-status-text"><span>正在同步设备状态与配置缓存</span><span class="boot-status-dots" aria-hidden="true"></span></p>
          </div>
        </section>
      </main>
    </div>
    <script charset="utf-8" src="./assets/${jsAsset}"></script>
  </body>
</html>
`;
  const minified = await minifyHtmlDocument(html);
  const protectedIndex = protectHtml(minified);
  const filePath = path.join(outRoot, "index.html");
  await writeFile(filePath, protectedIndex, "utf8");
  const compressed = await writeCompressedVariants(filePath, protectedIndex);
  return {
    assetName: "index.html",
    hash: sha256(protectedIndex),
    sourceBytes: byteLength(html),
    minifiedBytes: byteLength(minified),
    protectedBytes: byteLength(protectedIndex),
    compressed
  };
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

async function verifyBuild(js, css, onDemandCss = []) {
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
  for (const forbidden of ["options.json", "app-meta.json", "easter-lyrics.txt", "easter-cover.jpg", "rule-conflicts.json", "rule-props.tsv"]) {
    if (dataFiles.includes(forbidden)) {
      throw new Error(`protected WebUI data leaked as plain file: ${forbidden}`);
    }
  }
  if (!dataFiles.includes("rule-props.pack")) {
    throw new Error("protected rule-props.pack missing from release WebUI data");
  }
  if (!dataFiles.includes("prop-policy.tsv")) {
    throw new Error("shared prop-policy.tsv missing from release WebUI data");
  }
  const assetFiles = await readdir(path.join(outRoot, "assets"));
  for (const item of [
    `${js.assetName}.gz`,
    `${js.assetName}.br`,
    `${css.assetName}.gz`,
    `${css.assetName}.br`
  ]) {
    if (!assetFiles.includes(item)) throw new Error(`compressed WebUI asset missing: ${item}`);
  }
  for (const item of onDemandCss) {
    const filePath = path.join(outRoot, item.assetName);
    const built = await readFile(filePath);
    if (sha256(built) !== item.hash) throw new Error(`on-demand CSS hash mismatch: ${item.assetName}`);
    await readFile(`${filePath}.gz`);
    await readFile(`${filePath}.br`);
  }
}

function protectedManifest({ js, css, onDemandCss, html, conflicts }) {
  return {
    version: version.version,
    versionCode: version.versionCode,
    generatedAt: new Date().toISOString(),
    pipeline: [
      "vite",
      "html-minifier-terser",
      "postcss",
      "cssnano",
      "terser",
      "javascript-obfuscator",
      "protected-loader",
      "sha256",
      "gzip",
      "brotli"
    ],
    assets: [
      { path: `assets/${js.assetName}`, sha256: js.hash, bytes: js.protectedBytes },
      { path: `assets/${css.assetName}`, sha256: css.hash, bytes: css.protectedBytes },
      { path: html.assetName, sha256: html.hash, bytes: html.protectedBytes },
      ...onDemandCss.map((item) => ({ path: item.assetName, sha256: item.hash, bytes: item.protectedBytes }))
    ],
    js: js.assetName,
    jsHash: js.hash,
    jsBytes: js.protectedBytes,
    jsGzipBytes: js.compressed.gzip.bytes,
    jsBrotliBytes: js.compressed.brotli.bytes,
    css: css.assetName,
    cssHash: css.hash,
    cssBytes: css.protectedBytes,
    cssGzipBytes: css.compressed.gzip.bytes,
    cssBrotliBytes: css.compressed.brotli.bytes,
    onDemandCss: onDemandCss.map((item) => item.assetName),
    html: html.assetName,
    htmlHash: html.hash,
    htmlBytes: html.protectedBytes,
    htmlGzipBytes: html.compressed.gzip.bytes,
    htmlBrotliBytes: html.compressed.brotli.bytes,
    conflictCount: conflicts.length,
    ruleConflictPolicy: conflicts.length
      ? "resolved-by-lowest-risk-non-aggressive-owner"
      : "none",
    ruleConflicts: summarizeRuleConflicts(conflicts)
  };
}

async function writeProtectedManifest(manifest) {
  const manifestPath = path.join(distRoot, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

await syncMetadata();
await cleanAssets();
const { conflicts, protectedData } = await buildRules();
const js = await buildJs(protectedData);
const css = await buildCss();
const onDemandCss = await buildOnDemandCss();
const html = await writeIndex(js.assetName, css.assetName);
await writeIntegrityBaseline();
await verifyBuild(js, css, onDemandCss);
const manifest = await writeProtectedManifest(protectedManifest({ js, css, onDemandCss, html, conflicts }));

console.log(JSON.stringify(manifest, null, 2));
