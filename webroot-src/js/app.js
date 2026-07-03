import { MODULE_DIR, STATE_DIR, exec, readText, writeBase64 } from "./bridge.js";
import { applyRiskModeForMatched, countChangedForMatched, countEnabledForMatched, countHighRiskEnabledForMatched, decodeProtectedBytes, decodeProtectedText, displayFallbackValueForItem, fallbackValueForItem, loadJson, loadUserConfig, mergeConfig, readGeneratedSystemProp, saveConfigForMatched } from "./config.js";
import { readSystemInfo } from "./system-info.js";
import { $, createElement, metric, setStatus, showConfirm, showToast } from "./ui.js";
import { shellQuote, resultMessage, parseKeyValueLines, parseStateFile } from "./utils.js";
import { MATERIAL_YOU_THEMES, applyMaterialTheme, getMaterialTheme, initTheme } from "./m3-theme.js";
import { applyBrandPillLogo, createBrandPillMarkup, setBrandPillVersion } from "./brand-pill.js";
import { DEFAULT_SKIN_ID, SKINS, SKIN_ORDER, normalizeSkinId } from "./skin-manifest.js";

const state = {
  meta: null,
  options: null,
  config: null,
  device: null,
  configSource: null,
  health: null,
  unifiedState: null,
  page: "home",
  systemInfo: null,
  supporterInstallId: "",
  agreementChallenge: null,
  agreementReadyAt: 0,
  agreementTimer: null,
  customSearch: "",
  customDraftDirty: false,
  matchedProps: null,
  unlockedSkins: new Set(["default"]),
  skinUnlockInvalidCount: 0,
  skinUnlockError: "",
  dismissedAttentionKeys: new Set(),
  lastAttentionSignature: ""
};

const RISK_AGREEMENT_VERSION = 2;
const RISK_WAIT_SECONDS = 30;
const CONFIG_BACKUP_PATH = "/storage/emulated/0/Download/dex2oat-lock-config-backup.json";
const CONFIG_BACKUP_MAX_BYTES = 1024 * 1024;
const DIAGNOSTIC_EXPORT_PATH = `${STATE_DIR}/dex2oat-lock-diagnostic.txt`;
const BACKGROUND_STORAGE_KEY = "dex2oat-lock.background.v1";
const TOPBAR_LOGO_STORAGE_KEY = "dex2oat-lock.topbar.logo.v1";
const CARD_OPACITY_STORAGE_KEY = "dex2oat-lock.card.opacity.v1";
const CARD_BLUR_STORAGE_KEY = "dex2oat-lock.card.blur.v1";
const TELEMETRY_ENABLED_STORAGE_KEY = "dex2oat-lock.telemetry.enabled.v1";
const TELEMETRY_INSTALL_ID_STORAGE_KEY = "dex2oat-lock.telemetry.install-id.v1";
const TELEMETRY_LAST_SENT_STORAGE_KEY = "dex2oat-lock.telemetry.last-sent.v1";
const RULE_EVIDENCE_LAST_SENT_STORAGE_KEY = "dex2oat-lock.rule-evidence.last-sent.v1";
const SUPPORTER_ENABLED_STORAGE_KEY = "dex2oat-lock.supporter.enabled.v1";
const SUPPORTER_NAME_STORAGE_KEY = "dex2oat-lock.supporter.name.v1";
const SUPPORTER_PASS_STORAGE_KEY = "dex2oat-lock.supporter.pass.v1";
const LEGACY_BACKGROUND_OPACITY_STORAGE_KEY = "dex2oat-lock.background.opacity.v1";
const SKIN_BADGE_STYLESHEET_ID = "dex2oat-skin-badges";
const SKIN_THEME_STYLESHEET_ID = "dex2oat-skin-theme";
const SKIN_CSS_BASE = "./css/";
const BONUS_TEXT_PATH = "";
const BONUS_ART_PATH = "";
const BACKGROUND_MAX_SIZE = 1600;
const TOPBAR_LOGO_MAX_SIZE = 512;
const BACKGROUND_JPEG_QUALITY = 0.82;
const TOPBAR_LOGO_JPEG_QUALITY = 0.88;
const LOCAL_IMAGE_MIME_RE = /^image\/(?:png|jpe?g|webp|gif)$/i;
const LOCAL_IMAGE_DATA_URL_RE = /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i;
const CARD_DEFAULT_OPACITY = 0.94;
const CARD_DEFAULT_BLUR = 0;
const BOOT_SCREEN_MIN_MS = 1800;
const BOOT_EXIT_MS = 540;
const TELEMETRY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CLOUD_REQUEST_TIMEOUT_MS = 12000;
const CLOUD_EVIDENCE_TIMEOUT_MS = 20000;
const RULE_EVIDENCE_MAX_PROPS = 420;
const RULE_EVIDENCE_ALLOWED_PREFIXES = [
  "dalvik.",
  "dalvik.vm.",
  "pm.dexopt.",
  "persist.device_config.runtime",
  "persist.device_config.runtime_native",
  "persist.device_config.runtime_native_boot",
  "persist.dalvik.",
  "persist.miui.",
  "persist.oplus.",
  "persist.sys.app_dexfile_preload.",
  "persist.sys.art_startup_class_preload.",
  "persist.sys.dexpreload.",
  "persist.sys.feature.compile.",
  "persist.sys.oplus.",
  "persist.sys.precache.",
  "ro.build.version.",
  "ro.odm.",
  "ro.product.",
  "ro.system.",
  "ro.vendor.",
  "runtime.",
  "sys.gcsupression.",
  "sys.heap.",
  "sys.furtherHeapEnlarge.",
  "sys.oplus.",
  "system_perf_init.",
  "vendor.oplus.dalvik.",
  "oplus."
];
const RULE_EVIDENCE_SENSITIVE_RE = /(android_id|imei|meid|serial|phone|account|email|token|password|passwd|credential|auth|cookie|secret)/i;
let refreshInFlight = null;
let saveInFlight = null;
let matchRefreshController = null;
let riskModeInFlight = null;
let telemetryInFlight = null;
let ruleEvidenceInFlight = null;
let feedbackInFlight = null;
let skinStyleLoadPromise = null;
let skinSelectionInFlight = false;
let bonusTapCount = 0;
let bonusTapTimer = null;
let bonusArtUrl = "";
let homeLogoUrl = "";
let bonusMeta = null;
const MATERIAL_SYMBOLS = {
  home: { name: "home", fallback: "⌂", path: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-9.5Z" },
  custom: { name: "tune", fallback: "≡", path: "M4 7h10M18 7h2M14 7a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM4 17h2M10 17h10M6 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z" },
  about: { name: "info", fallback: "i", path: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM11 10h2v7h-2v-7Zm0-3h2v2h-2V7Z" },
  diagnostic: { name: "health_and_safety", fallback: "+", path: "M12 3 5 6v5c0 4.4 2.9 8.4 7 10 4.1-1.6 7-5.6 7-10V6l-7-3Zm-1 6h2v3h3v2h-3v3h-2v-3H8v-2h3V9Z" },
  history: { name: "history", fallback: "◷", path: "M12 5a7 7 0 1 1-6.3 4H3l3.2-3.2L9.5 9H7.8A5 5 0 1 0 12 7v4l3 2-1 1.7-4-2.7V5h2Z" },
  copy: { name: "content_copy", fallback: "⧉", path: "M8 5h8a2 2 0 0 1 2 2v10h-2V7H8V5Zm-3 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9Zm2 0v10h8V9H7Z" },
  send: { name: "send", fallback: "↗", path: "M3.7 20.3 21 12 3.7 3.7 4.5 10l9.5 2-9.5 2-.8 6.3Zm5.2-5.5 7.4-2.8-7.4-2.8L9 12l-.1 2.8Z" },
  feedback: { name: "feedback", fallback: "!", path: "M12 3a9 9 0 1 0 0 18h5l4 2-1.2-4.1A9 9 0 0 0 12 3Zm-1 4h2v6h-2V7Zm0 8h2v2h-2v-2Z" },
  prop: { name: "data_object", fallback: "{}", path: "M8 7 4 12l4 5 1.5-1.3L6.6 12l2.9-3.7L8 7Zm8 0-1.5 1.3 2.9 3.7-2.9 3.7L16 17l4-5-4-5Zm-4.3 11 2.6-12h-2l-2.6 12h2Z" },
  edit: { name: "edit", fallback: "✎", path: "M5 17.3V21h3.7L18.9 10.8l-3.7-3.7L5 17.3ZM20.7 8.9a1 1 0 0 0 0-1.4l-2.2-2.2a1 1 0 0 0-1.4 0l-1.2 1.2 3.7 3.7 1.1-1.3Z" },
  sync: { name: "sync", fallback: "↻", path: "M7.1 7.1A7 7 0 0 1 19 12h-2.2a4.8 4.8 0 0 0-8.2-3.4L11 11H5V5l2.1 2.1ZM17 16.9A7 7 0 0 1 5 12h2.2a4.8 4.8 0 0 0 8.2 3.4L13 13h6v6l-2-2.1Z" },
  refresh: { name: "refresh", fallback: "⟳", path: "M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h8V3l-3.3 3.3Z" },
  supporter: { name: "favorite", fallback: "♥", path: "M12 21s-7.2-4.4-9.2-9.1C1.3 8.2 3.5 5 7 5c2 0 3.5 1 5 2.8C13.5 6 15 5 17 5c3.5 0 5.7 3.2 4.2 6.9C19.2 16.6 12 21 12 21Z" },
  lock: { name: "lock", fallback: "锁", path: "M7 10V8a5 5 0 0 1 10 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1Zm2 0h6V8a3 3 0 0 0-6 0v2Zm2 4v3h2v-3h-2Z" },
  crown: { name: "workspace_premium", fallback: "冠", path: "M4 19h16v2H4v-2Zm1-9 4 3 3-7 3 7 4-3v7H5v-7Z" },
  clock: { name: "history", fallback: "时", path: "M12 4a8 8 0 1 1-7.2 4.5H3l2.8-2.8L8.7 8.6H6.4A6 6 0 1 0 12 6v5l4 2-.9 1.8L10 12V4h2Z" },
  safe: { name: "verified_user", fallback: "✓", path: "M12 3 5 6v5c0 4.4 2.9 8.4 7 10 4.1-1.6 7-5.6 7-10V6l-7-3Zm-1 12.5-3-3 1.4-1.4 1.6 1.6 4-4 1.4 1.4-5.4 5.4Z" },
  caution: { name: "rule_settings", fallback: "!", path: "M4 7h10M18 7h2M14 7a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM4 17h2M10 17h10M6 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z" },
  aggressive: { name: "warning", fallback: "!", path: "M12 3 22 20H2L12 3Zm-1 6v5h2V9h-2Zm0 7v2h2v-2h-2Z" }
};

const riskModes = {
  safe: {
    label: "安全",
    title: "安全模式",
    description: "日常稳定。",
    suitableFor: "长期使用",
    impact: "降低后台编译负载",
    caution: "改动少",
    tooltip: "安全：低风险，适合长期使用。",
    categories: ["safe"]
  },
  caution: {
    label: "谨慎",
    title: "谨慎模式",
    description: "进阶调优。",
    suitableFor: "了解 ART / dexopt",
    impact: "影响编译与维护任务",
    caution: "逐项启用",
    tooltip: "谨慎：进阶调优，保存前确认。",
    categories: ["caution"]
  },
  aggressive: {
    label: "危险",
    title: "危险模式",
    description: "测试向配置。",
    suitableFor: "测试设备",
    impact: "可能影响稳定性",
    caution: "先备份",
    tooltip: "危险：测试向，先备份。",
    categories: ["aggressive"]
  }
};

const rebootModes = {
  normal: {
    label: "重启",
    confirm: "确定现在重启设备吗？",
    pending: "正在请求重启...",
    command: "reboot"
  },
  recovery: {
    label: "重启到 Recovery",
    confirm: "确定现在重启到 Recovery 吗？",
    pending: "正在请求重启到 Recovery...",
    command: "reboot recovery"
  },
  bootloader: {
    label: "重启到 BootLoader",
    confirm: "确定现在重启到 BootLoader 吗？",
    pending: "正在请求重启到 BootLoader...",
    command: "reboot bootloader"
  }
};

function getDiagnosticSections() {
  const staticSections = [
    {
      title: "--- getprop ---",
      props: ["ro.product.model", "ro.build.version.release", "ro.build.version.oplusrom", "ro.oplus.version"]
    },
    {
      title: "--- ART services ---",
      props: ["init.svc.artd", "init.svc.art_boot", "init.svc_debug_pid.artd", "init.svc_debug_pid.art_boot"]
    }
  ];

  const allProps = [];
  if (state.options) {
    const seen = new Set();
    for (const category of state.options.categories) {
      for (const item of category.items) {
        if (item.prop && !seen.has(item.prop)) {
          seen.add(item.prop);
          allProps.push(item.prop);
        }
      }
    }
  }

  const managedSections = [];
  for (let index = 0; index < allProps.length; index += 32) {
    managedSections.push({
      title: `--- managed props ${Math.floor(index / 32) + 1} ---`,
      props: allProps.slice(index, index + 32)
    });
  }

  return [
    ...staticSections,
    ...managedSections
  ];
}


function buildDiagnosticShell(sections = getDiagnosticSections()) {
  const lines = [
    "echo '--- bridge ---'",
    "echo shell_ok",
    "GETPROP=/system/bin/getprop",
    "[ -x \"$GETPROP\" ] || GETPROP=getprop"
  ];
  for (const section of sections) {
    lines.push(`echo '${section.title.replace(/'/g, "'\"'\"'")}'`);
    for (const prop of section.props) {
      lines.push(`"$GETPROP" ${prop}`);
    }
  }
  return lines.join("\n");
}

function buildDiagnosticSegments() {
  const sections = getDiagnosticSections();
  return [
    ...sections.map((section) => ({
      title: section.title.replace(/---/g, "").trim(),
      command: buildDiagnosticShell([section])
    })),
    { title: "runtime logs", command: buildStaticDiagnosticShell() }
  ];
}

async function collectDiagnosticTranscript({ reportProgress = false } = {}) {
  const segments = buildDiagnosticSegments();
  const outputs = [];
  let finalCode = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (reportProgress) setStatus(`正在读取诊断 ${index + 1}/${segments.length}：${segment.title}`);
    const result = await exec(segment.command);
    if (result.code !== 0 && finalCode === 0) finalCode = result.code;
    outputs.push(`--- diagnostic segment: ${segment.title} ---\nerrno=${result.code}\n${result.stdout || ""}\n${result.stderr || ""}`);
    if (reportProgress) await delay(20);
  }
  return {
    code: finalCode,
    content: outputs.join("\n\n")
  };
}

function parseModuleProp(content) {
  const result = {};
  for (const entry of parseKeyValueLines(content)) {
    result[entry.prop] = entry.value;
  }
  return result;
}

function commandUrl(value) {
  const href = safeRemoteEndpoint(value);
  if (!href) {
    throw new Error("unsupported URL protocol");
  }

  return shellQuote(href);
}

function safeRemoteEndpoint(value, { allowHttpLoopback = true, allowHttp = false } = {}) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!["https:", "http:"].includes(url.protocol)) return "";
    const host = url.hostname.toLowerCase();
    const isLoopback = host === "localhost"
      || host === "127.0.0.1"
      || host === "::1"
      || host === "[::1]"
      || host.endsWith(".localhost");
    if (url.protocol === "http:" && !(allowHttp || (allowHttpLoopback && isLoopback))) return "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    if (url.pathname === "/" && !url.search) return `${url.origin}`;
    return url.href;
  } catch {
    return "";
  }
}

function safeLocalImageUrl(value, { allowBlob = false } = {}) {
  const source = String(value || "").trim();
  if (!source) return "";
  if (LOCAL_IMAGE_DATA_URL_RE.test(source)) return source;
  if (allowBlob && source.startsWith("blob:")) return source;
  return "";
}

function isSupportedLocalImageFile(file) {
  const mime = String(file?.type || "").toLowerCase();
  if (mime) return LOCAL_IMAGE_MIME_RE.test(mime);
  return /\.(png|jpe?g|webp|gif)$/i.test(String(file?.name || ""));
}

function cssImageUrl(value) {
  return `url(${JSON.stringify(value)})`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function symbolMarkup(symbol, extraClass = "") {
  const meta = typeof symbol === "string" ? { name: symbol, fallback: symbol } : symbol || {};
  const name = String(meta.name || meta.fallback || "circle").replace(/[^a-z0-9_]/gi, "") || "circle";
  const fallback = String(meta.fallback || "•").slice(0, 3);
  if (meta.path) {
    return `<svg class="m3-symbol m3-svg-symbol ${escapeHtml(extraClass)}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-symbol="${escapeHtml(name)}"><path d="${escapeHtml(meta.path)}"></path></svg>`;
  }
  return `<span class="m3-symbol ${escapeHtml(extraClass)}" data-symbol="${escapeHtml(name)}" data-fallback="${escapeHtml(fallback)}">${escapeHtml(name)}</span>`;
}

function hasDisplayValue(value) {
  const text = String(value ?? "").trim();
  return Boolean(text) && !["unknown", "null", "undefined", "nan"].includes(text.toLowerCase());
}

function displayValue(value, fallback = "暂不可用") {
  return hasDisplayValue(value) ? String(value).trim() : fallback;
}

function normalizeTone(status) {
  const value = String(status || "").toLowerCase();
  if (["ok", "partial", "fallback", "matched"].includes(value)) return "applied";
  if (["error", "failed", "fail"].includes(value)) return "failed";
  if (["running", "pending", "progress", "syncing"].includes(value)) return "running";
  if (["warning", "warn", "missing", "changed"].includes(value)) return "mismatch";
  return "applied";
}

function friendlySummaryTitle(title, status) {
  const value = String(title || "").trim();
  const normalized = value.toLowerCase().replace(/\s+/g, "-");
  const map = {
    "状态正常": "Dex2oat-Lock",
    "需要关注": "需要关注",
    "需要处理": "需要处理",
    "安装中": "安装中",
    "恢复中": "恢复中",
    "status-ok": "Dex2oat-Lock",
    "passed": "Dex2oat-Lock",
    "warnings-present": "需要关注",
    "action-required": "需要处理",
    "install-in-progress": "安装中",
    "recovery-in-progress": "恢复中",
    "runtime-apply-ok": "Dex2oat-Lock",
    "runtime-apply-running": "正在同步",
    "partial-rule-match": "Dex2oat-Lock",
    "fallback-strategy": "Dex2oat-Lock"
  };
  return map[normalized] || displayValue(value, {
    ok: "Dex2oat-Lock",
    warning: "需要关注",
    error: "需要处理",
    pending: "待重启",
    recovery: "恢复中"
  }[status] || "Dex2oat-Lock");
}

function friendlySummaryMessage(message, status) {
  const value = String(message || "").trim();
  if (!hasDisplayValue(value)) return "";
  if (value === "当前没有发现需要处理的问题。") return "";
  if (value === "模块可用，诊断中有少量细节可查看。") return value;
  if (value === "安装流程正在写入进度和最终状态。") return value;
  if (/no blocking issue/i.test(value)) return "";
  if (/warnings present|diagnostics need attention/i.test(value)) return "模块可用，诊断中有少量细节可查看。";
  if (/installer is still writing/i.test(value)) return "安装流程正在写入最终状态。";
  if (/runtime-apply-running/i.test(value)) return "正在同步。";
  if (/runtime-apply-ok|passed/i.test(value)) return "";
  if (/conservative defaults|safe defaults/i.test(value)) return "";
  return value;
}

async function loadMeta() {
  const meta = await loadJson("./data/app-meta.json", {
    moduleName: "Dex2oat Lock",
    version: "v3.4.1",
    versionCode: 341,
    author: "pakhozako",
    architecture: "规则驱动 / 统一状态",
    githubUrl: ""
  });
  const moduleProp = parseModuleProp(await readText(`${MODULE_DIR}/module.prop`));

  return {
    ...meta,
    moduleName: moduleProp.name || meta.moduleName,
    version: moduleProp.version || meta.version,
    versionCode: moduleProp.versionCode || meta.versionCode,
    author: moduleProp.author || meta.author,
    description: moduleProp.description || meta.description || "",
    githubUrl: safeRemoteEndpoint(meta.githubUrl),
    cloudBaseUrl: safeRemoteEndpoint(meta.cloudBaseUrl, { allowHttp: true }),
    supportUrl: safeRemoteEndpoint(meta.supportUrl || meta.sponsorUrl),
    sponsorUrl: safeRemoteEndpoint(meta.sponsorUrl || meta.supportUrl),
    feedbackUrl: safeRemoteEndpoint(meta.feedbackUrl, { allowHttp: true }),
    supporterVerifyUrl: safeRemoteEndpoint(meta.supporterVerifyUrl, { allowHttp: true }),
    supporterDirectoryUrl: safeRemoteEndpoint(meta.supporterDirectoryUrl, { allowHttp: true }),
    architecture: meta.architecture || "规则驱动 / 统一状态"
  };
}

async function loadDeviceState() {
  const unified = state.unifiedState || await loadUnifiedState();
  const device = parseStateFile(await readText(`${STATE_DIR}/device.prop`));
  return {
    ...device,
    "ro.product.model": device["ro.product.model"] || unified["device.model"] || "",
    "ro.product.manufacturer": device["ro.product.manufacturer"] || unified["device.manufacturer"] || "",
    "ro.product.brand": device["ro.product.brand"] || unified["device.brand"] || "",
    "ro.build.version.release": device["ro.build.version.release"] || unified["device.android"] || "",
    schema: device.schema || "rule-driven"
  };
}

async function loadConfigSource() {
  const unified = state.unifiedState || await loadUnifiedState();
  if (unified["config.source"]) {
    return {
      source: unified["config.source"],
      reason: unified["config.reason"],
      updated_at: unified["config.updated_at"],
      matched_total: unified["match.matched_total"] || unified["config.matched_total"] || "0",
      prop_count: unified["config.prop_count"],
      prop_hash: unified["config.prop_hash"],
      version: unified.module_version || state.meta?.version || ""
    };
  }
  return parseStateFile(await readText(`${STATE_DIR}/config-source.prop`));
}

async function loadHealthState() {
  const unified = state.unifiedState || await loadUnifiedState();
  if (unified["health.status"]) {
    return denormalizeState(unified, "health.");
  }
  return parseStateFile(await readText(`${STATE_DIR}/health.log`));
}

async function loadOptions() {
  return loadJson("./data/options.json", { categories: [] });
}

async function loadUnifiedState() {
  return parseStateFile(await readText(`${STATE_DIR}/state.prop`));
}

async function loadSupporterInstallId() {
  const result = await exec(`sh ${shellQuote(`${MODULE_DIR}/core/supporter-install-id.sh`)} ${shellQuote(MODULE_DIR)}`);
  if (result.code !== 0) {
    console.warn(`[dex2oat] supporter install id unavailable: ${resultMessage(result)}`);
    state.supporterInstallId = "";
    return "";
  }
  const data = parseJsonObject(result.stdout);
  const installId = String(data?.installId || "").trim();
  if (!data?.ok || !/^[a-f0-9-]{8,96}$/i.test(installId)) {
    console.warn("[dex2oat] supporter install id response is invalid");
    state.supporterInstallId = "";
    return "";
  }
  state.supporterInstallId = installId;
  state.unifiedState = {
    ...(state.unifiedState || {}),
    "supporter.install_id": installId
  };
  return installId;
}

async function loadMatchedProps() {
  const path = `${STATE_DIR}/matched-props.txt`;
  const exists = await exec(`test -f ${shellQuote(path)}`);
  if (exists.code !== 0) return null;
  const text = await readText(path);
  return new Set(String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => line.slice(0, line.indexOf("="))));
}

function denormalizeState(values, prefix) {
  const result = {};
  for (const [key, value] of Object.entries(values || {})) {
    if (key.startsWith(prefix)) result[key.slice(prefix.length)] = value;
  }
  return result;
}

function renderShell(options = {}) {
  const app = $("#app");
  const bootScreen = options.keepBoot ? $("#bootScreen", app) : null;
  const initialLogo = homeLogoUrl || protectedImageUrl(globalThis.__DEX2OAT_WEBUI_DATA?.g);
  if (initialLogo) homeLogoUrl = initialLogo;
  app.className = options.keepBoot ? "app-shell is-booting is-preparing-shell" : "app-shell";
  app.innerHTML = `
    <header class="topbar">
      <div class="topbar-brand-slot">
        ${createBrandPillMarkup({
          id: "topBrandPill",
          name: "Dex2oat-Lock",
          showRefresh: true,
          refreshButtonId: "refreshButton",
          refreshLabel: "刷新设备状态",
          refreshTitle: "刷新",
          showPower: true,
          powerButtonId: "rebootButton",
          powerLabel: "打开重启菜单",
          powerTitle: "重启",
          logoSrc: safeLocalImageUrl(initialLogo, { allowBlob: true })
        })}
        <span class="topbar-status" id="statusMessage" data-tone="neutral">已同步</span>
      </div>
    </header>
    <div class="reboot-menu" id="rebootMenu" role="menu" aria-label="重启菜单" hidden>
      <button type="button" role="menuitem" data-reboot-action="normal">
        <span class="reboot-menu-label">重启</span>
        <span class="reboot-menu-meta">Restart</span>
      </button>
      <button type="button" role="menuitem" data-reboot-action="recovery">
        <span class="reboot-menu-label">重启到 Recovery</span>
        <span class="reboot-menu-meta">Reboot to Recovery</span>
      </button>
      <button type="button" role="menuitem" data-reboot-action="bootloader">
        <span class="reboot-menu-label">重启到 BootLoader</span>
        <span class="reboot-menu-meta">Reboot to BootLoader</span>
      </button>
    </div>
    <main id="page"></main>
    <nav class="bottom-nav m3-nav-bar" aria-label="主导航">
      <button data-page="home" aria-label="首页">
        ${symbolMarkup(MATERIAL_SYMBOLS.home, "nav-icon")}
        <span class="nav-label">首页</span>
      </button>
      <button data-page="custom" aria-label="自定义">
        ${symbolMarkup(MATERIAL_SYMBOLS.custom, "nav-icon")}
        <span class="nav-label">自定义</span>
      </button>
      <button data-page="about" aria-label="关于">
        ${symbolMarkup(MATERIAL_SYMBOLS.about, "nav-icon")}
        <span class="nav-label">关于</span>
      </button>
    </nav>
  `;
  if (bootScreen) app.append(bootScreen);

  updateTopbarRealtime();
  updateTopbarVersion();
  setupRebootMenu();
  setupTopbarRefresh();
  setupTopbarScrollState();
  setupMaterialFeedback();
  setupOfflineMaterialSymbols();
  $(".brand-logo")?.addEventListener("click", triggerLogoEasterEgg);
  applyHomeLogo();
  restoreCustomBackground();
  applySupporterMode();

  document.querySelectorAll(".bottom-nav button").forEach((button) => {
    button.addEventListener("click", () => setPage(button.dataset.page));
  });
}

function setupTopbarScrollState() {
  if (setupTopbarScrollState.installed) return;
  setupTopbarScrollState.installed = true;
  let ticking = false;
  const update = () => {
    ticking = false;
    document.body.classList.toggle("has-scrolled", (globalThis.scrollY || 0) > 8);
  };
  globalThis.addEventListener?.("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }, { passive: true });
  update();
}

function setupTopbarRefresh() {
  const button = $("#refreshButton");
  if (!button) return;
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    button.classList.add("is-spinning");
    try {
      await refreshAll();
    } finally {
      setTimeout(() => button.classList.remove("is-spinning"), 260);
    }
  });
}

function setupMaterialFeedback() {
  if (setupMaterialFeedback.installed) return;
  setupMaterialFeedback.installed = true;
  const selector = [
    "button",
    ".theme-swatch",
    ".option-row",
    ".metric-button",
    "summary"
  ].join(",");
  document.addEventListener("pointerdown", (event) => {
    const target = event.target?.closest?.(selector);
    if (!target || target.disabled || target.closest(".dialog")?.classList.contains("is-closing")) return;
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ripple = document.createElement("span");
    ripple.className = "m3-ripple";
    const size = Math.max(rect.width, rect.height) * 1.8;
    ripple.style.width = `${Math.round(size)}px`;
    ripple.style.height = `${Math.round(size)}px`;
    ripple.style.left = `${Math.round(event.clientX - rect.left - size / 2)}px`;
    ripple.style.top = `${Math.round(event.clientY - rect.top - size / 2)}px`;
    target.append(ripple);
    ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
  }, { passive: true });
}

function setupOfflineMaterialSymbols() {
  const root = document.documentElement;
  if (!document.body) {
    root.classList.remove("has-material-symbols");
    return;
  }
  try {
    if (!document.fonts || !document.fonts.check("24px 'Material Symbols Rounded'")) {
      root.classList.remove("has-material-symbols");
      return;
    }
    const probe = document.createElement("span");
    const fallback = document.createElement("span");
    const text = "home";
    const baseStyle = "position:absolute;left:-9999px;top:-9999px;visibility:hidden;font-size:24px;line-height:1;white-space:nowrap;";
    probe.style.cssText = `${baseStyle}font-family:'Material Symbols Rounded';font-feature-settings:'liga';`;
    fallback.style.cssText = `${baseStyle}font-family:system-ui,sans-serif;`;
    probe.textContent = text;
    fallback.textContent = text;
    document.body.append(probe, fallback);
    const iconWidth = probe.getBoundingClientRect().width;
    const textWidth = fallback.getBoundingClientRect().width;
    probe.remove();
    fallback.remove();
    root.classList.toggle("has-material-symbols", iconWidth > 0 && textWidth > 0 && iconWidth < textWidth * 0.72);
  } catch (_error) {
    root.classList.remove("has-material-symbols");
  }
}

function updateTopbarVersion() {
  const version = state.meta?.version ? `v${String(state.meta.version).replace(/^v/i, "")}` : "";
  setBrandPillVersion("#topBrandPill", version);
}

function setPage(page) {
  const changed = state.page !== page;
  state.page = page;
  document.querySelectorAll(".bottom-nav button").forEach((button) => {
    const active = button.dataset.page === page;
    button.classList.toggle("active", active);
    if (active) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });
  if (changed || !$("#page")?.hasChildNodes()) {
    renderPage();
  }
}

function renderPage() {
  if (state.page === "home") {
    renderHome();
  } else if (state.page === "custom") {
    renderCustom();
  } else if (state.page === "about") {
    renderAbout();
  } else {
    renderHome();
  }
  animatePageTransition();
}

function animatePageTransition() {
  const page = $("#page");
  if (!page) return;
  const app = $("#app");
  if (app?.classList.contains("is-booting") || app?.classList.contains("is-preparing-shell")) return;
  if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
  page.classList.remove("is-transitioning");
  requestAnimationFrame(() => page.classList.add("is-transitioning"));
  clearTimeout(page.__m3TransitionTimer);
  page.__m3TransitionTimer = setTimeout(() => {
    page.classList.remove("is-transitioning");
  }, 620);
}

function triggerLogoEasterEgg() {
  bonusTapCount += 1;
  if (bonusTapTimer) clearTimeout(bonusTapTimer);
  bonusTapTimer = setTimeout(() => {
    bonusTapCount = 0;
  }, 1200);
  if (bonusTapCount < 5) return;
  bonusTapCount = 0;
  document.body.classList.add("bonus-pulse");
  setStatus("已打開隱藏彩蛋", "ok");
  void showBonusDialog();
  setTimeout(() => document.body.classList.remove("bonus-pulse"), 1200);
}

async function loadBonusText() {
  const protectedLyrics = globalThis.__DEX2OAT_WEBUI_DATA?.l;
  if (protectedLyrics) return decodeProtectedText(protectedLyrics);

  try {
    if (!BONUS_TEXT_PATH) throw new Error("protected text unavailable");
    const response = await fetch(BONUS_TEXT_PATH, { cache: "no-store" });
    if (response.ok) return response.text();
  } catch {
    // Keep the hidden dialog usable in WebUI hosts with restricted fetch behavior.
  }
  return "内容暂不可用，请重新构建 WebUI。";
}

function loadBonusArt() {
  if (bonusArtUrl) return bonusArtUrl;
  const protectedCover = globalThis.__DEX2OAT_WEBUI_DATA?.c;
  if (!protectedCover) return BONUS_ART_PATH;
  try {
    if (typeof Blob !== "function" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return BONUS_ART_PATH;
    const bytes = decodeProtectedBytes(protectedCover);
    const blob = new Blob([bytes], { type: protectedCover.m || "image/jpeg" });
    bonusArtUrl = URL.createObjectURL(blob);
    return bonusArtUrl;
  } catch {
    return BONUS_ART_PATH;
  }
}

function protectedImageUrl(item, fallback = "") {
  if (!item) return fallback;
  try {
    if (typeof Blob !== "function" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return fallback;
    const bytes = decodeProtectedBytes(item);
    const blob = new Blob([bytes], { type: item.m || "image/jpeg" });
    return URL.createObjectURL(blob);
  } catch {
    return fallback;
  }
}

function applyHomeLogo() {
  const logo = $(".brand-logo");
  if (!logo) return;
  const customLogo = readCustomTopbarLogo();
  if (customLogo) {
    const safeLogo = safeLocalImageUrl(customLogo, { allowBlob: true });
    if (safeLogo) {
      applyTopbarLogo(safeLogo);
      return;
    }
    try {
      saveCustomTopbarLogo("");
    } catch {
      // Ignore storage cleanup failures and fall back to the bundled logo.
    }
  }
  if (!homeLogoUrl) homeLogoUrl = protectedImageUrl(globalThis.__DEX2OAT_WEBUI_DATA?.g);
  applyTopbarLogo(homeLogoUrl);
}

function applyTopbarLogo(value) {
  applyBrandPillLogo("#topBrandPill", safeLocalImageUrl(value, { allowBlob: true }));
}

function sponsorUrl() {
  return String(state.meta?.supportUrl || state.meta?.sponsorUrl || "https://www.ifdian.net/a/pakhozako?utm_source=copylink&utm_medium=link").trim();
}


function skinById(id) {
  return SKINS[normalizeSkinId(id)];
}

function skinLabel(id) {
  return skinById(id).label;
}

function ensureConfigUi() {
  if (!state.config) return { skin: DEFAULT_SKIN_ID, skinMotion: true };
  if (!state.config.ui || typeof state.config.ui !== "object") {
    state.config.ui = { skin: DEFAULT_SKIN_ID, skinMotion: true };
  }
  state.config.ui.skin = normalizeSkinId(state.config.ui.skin);
  if (typeof state.config.ui.skinMotion !== "boolean") state.config.ui.skinMotion = state.config.ui.skinMotion !== false;
  return state.config.ui;
}

function selectedSkinId() {
  const ui = ensureConfigUi();
  const id = normalizeSkinId(ui.skin);
  return isSkinUnlocked(id) ? id : DEFAULT_SKIN_ID;
}

function skinMotionEnabled() {
  return ensureConfigUi().skinMotion !== false;
}

function currentInstallHash() {
  const installId = getStableInstallId();
  return installId ? hashTelemetryId(installId) : "";
}

function legacySupporterUnlocksMemorial() {
  return false;
}

function isSkinUnlocked(id) {
  const skinId = normalizeSkinId(id);
  return skinId === DEFAULT_SKIN_ID || state.unlockedSkins?.has(skinId);
}

function unlockedSkinIds() {
  const ids = new Set(["default"]);
  for (const id of state.unlockedSkins || []) ids.add(normalizeSkinId(id));
  return ids;
}

function loadStylesheet(id, href) {
  const existing = document.getElementById(id);
  if (existing?.getAttribute("href") === href) return Promise.resolve(existing);
  existing?.remove();
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => resolve(link);
    link.onerror = () => reject(new Error(`加载样式失败：${href}`));
    document.head.append(link);
  });
}

function ensureSkinBadgeStyles() {
  if (!skinStyleLoadPromise) {
    skinStyleLoadPromise = loadStylesheet(SKIN_BADGE_STYLESHEET_ID, `${SKIN_CSS_BASE}skin-badges.css`)
      .catch((error) => {
        skinStyleLoadPromise = null;
        console.warn(`[dex2oat] skin badge styles failed: ${error.message}`);
      });
  }
  return skinStyleLoadPromise;
}

async function applySelectedSkin() {
  const id = selectedSkinId();
  const skin = skinById(id);
  const themeLink = document.getElementById(SKIN_THEME_STYLESHEET_ID);
  document.documentElement.dataset.skin = id;
  document.documentElement.dataset.skinMotion = skinMotionEnabled() ? "on" : "off";
  document.body?.setAttribute("data-skin", id);
  document.body?.setAttribute("data-skin-motion", skinMotionEnabled() ? "on" : "off");
  document.documentElement.classList.toggle("skin-motion-disabled", !skinMotionEnabled());
  document.body?.classList.toggle("skin-motion-disabled", !skinMotionEnabled());
  if (id !== DEFAULT_SKIN_ID) {
    await ensureSkinBadgeStyles();
  }
  if (skin.themeHref) {
    try {
      await loadStylesheet(SKIN_THEME_STYLESHEET_ID, `${SKIN_CSS_BASE}${skin.themeHref}`);
    } catch (error) {
      console.warn(`[dex2oat] skin theme failed: ${error.message}`);
      document.documentElement.dataset.skin = DEFAULT_SKIN_ID;
      document.body?.setAttribute("data-skin", DEFAULT_SKIN_ID);
    }
  } else {
    themeLink?.remove();
  }
  updateSupporterBadge();
  updateBootSupporterSignature();
}

async function loadUnlockedSkins() {
  const script = `${MODULE_DIR}/core/skin-unlock.sh`;
  const ids = new Set(["default"]);
  const installHash = currentInstallHash();
  let invalid = 0;
  state.skinUnlockError = "";

  if (!installHash) {
    state.unlockedSkins = ids;
    state.skinUnlockInvalidCount = 0;
    state.skinUnlockError = "无法读取解锁状态，请稍后重试";
    return ids;
  }

  const result = await exec(`sh ${shellQuote(script)} ${shellQuote(MODULE_DIR)} list ${shellQuote(installHash)}`);
  if (result.code !== 0) {
    state.unlockedSkins = ids;
    state.skinUnlockInvalidCount = 0;
    state.skinUnlockError = `无法读取解锁状态：${resultMessage(result)}`;
    return ids;
  }

  if (result.stdout) {
    try {
      const data = JSON.parse(result.stdout);
      invalid = Number(data.invalid || 0);
      if (data.ok === false) {
        state.skinUnlockError = friendlyCloudError(data.error || data.message || "read_unlock_failed", "无法读取解锁状态，请稍后重试");
      } else {
        for (const id of data.skins || []) {
          const skinId = normalizeSkinId(id, "");
          if (skinId) ids.add(skinId);
        }
      }
    } catch {
      state.skinUnlockError = "解锁状态数据异常，请稍后重试";
      invalid = 0;
    }
  }

  state.unlockedSkins = ids;
  state.skinUnlockInvalidCount = invalid;
  return ids;
}

async function persistSkinPreferences() {
  await persistWebConfig();
  state.unifiedState = await loadUnifiedState();
}

async function selectSkin(skinId, options = {}) {
  const id = normalizeSkinId(skinId);
  if (!isSkinUnlocked(id)) {
    if (state.skinUnlockError) {
      setStatus(state.skinUnlockError, "warn");
      showToast(state.skinUnlockError, "warn");
      return false;
    }
    showSponsorDialog(id);
    return false;
  }
  if (id === selectedSkinId() && ensureConfigUi().skin === id && options.persist !== false) {
    setStatus(`${skinById(id).label} 已在使用`, "ok");
    return true;
  }
  if (skinSelectionInFlight) return false;
  skinSelectionInFlight = true;
  try {
    ensureConfigUi().skin = id;
    await applySelectedSkin();
    if (options.persist !== false) {
      await persistSkinPreferences();
      const message = `${skinById(id).label} 已应用`;
      setStatus(message, "ok");
      if (options.toast !== false) showToast(message, "ok");
    }
    if (state.page === "about") renderAbout();
    return true;
  } catch (error) {
    const message = `皮肤切换失败：${error.message || error}`;
    setStatus(message, "warn");
    if (options.toast !== false) showToast(message, "warn");
    throw error;
  } finally {
    skinSelectionInFlight = false;
  }
}

async function setSkinMotionEnabled(enabled) {
  ensureConfigUi().skinMotion = Boolean(enabled);
  await applySelectedSkin();
  await persistSkinPreferences();
  const message = enabled ? "徽章动态效果已开启" : "徽章动态效果已关闭";
  setStatus(message, "ok");
  showToast(message, "ok");
  if (state.page === "about") renderAbout();
}

function isSupporterModeEnabled() {
  try {
    return globalThis.localStorage?.getItem(SUPPORTER_ENABLED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function readSupporterName() {
  try {
    return sanitizeSupporterText(globalThis.localStorage?.getItem(SUPPORTER_NAME_STORAGE_KEY) || "", 24);
  } catch {
    return "";
  }
}

function saveSupporterName(value) {
  const name = sanitizeSupporterText(value, 24);
  try {
    if (name) {
      globalThis.localStorage?.setItem(SUPPORTER_NAME_STORAGE_KEY, name);
    } else {
      globalThis.localStorage?.removeItem(SUPPORTER_NAME_STORAGE_KEY);
    }
  } catch {
    throw new Error("当前 WebView 不允许保存支持者称呼");
  }
  return name;
}

function readSupporterPass() {
  try {
    const raw = globalThis.localStorage?.getItem(SUPPORTER_PASS_STORAGE_KEY);
    if (!raw) return null;
    const pass = JSON.parse(raw);
    if (!pass || typeof pass !== "object") return null;
    const verifiedAt = Number(pass.verifiedAt || 0);
    const expiresAt = Number(pass.expiresAt || 0);
    if (expiresAt && expiresAt < Date.now()) {
      try {
        globalThis.localStorage?.removeItem(SUPPORTER_PASS_STORAGE_KEY);
      } catch {
        // Expired supporter passes are ignored even if old WebView storage cleanup fails.
      }
      return null;
    }
    const normalized = {
      verified: pass.verified === true,
      name: sanitizeSupporterText(pass.name || "", 24),
      tier: sanitizeSupporterText(pass.tier || "支持者", 18),
      badge: "纪念版",
      verifiedAt,
      expiresAt
    };
    if (raw !== JSON.stringify(normalized)) {
      try {
        globalThis.localStorage?.setItem(SUPPORTER_PASS_STORAGE_KEY, JSON.stringify(normalized));
      } catch {
        // Keep the normalized in-memory pass; cleanup can succeed on a later read.
      }
    }
    return normalized;
  } catch {
    return null;
  }
}

function saveSupporterPass(pass) {
  try {
    if (!pass) {
      globalThis.localStorage?.removeItem(SUPPORTER_PASS_STORAGE_KEY);
      return null;
    }
    const normalized = {
      verified: pass.verified === true,
      name: sanitizeSupporterText(pass.name || "", 24),
      tier: sanitizeSupporterText(pass.tier || "支持者", 18),
      badge: "纪念版",
      verifiedAt: Number(pass.verifiedAt || Date.now()),
      expiresAt: Number(pass.expiresAt || 0)
    };
    globalThis.localStorage?.setItem(SUPPORTER_PASS_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    throw new Error("当前 WebView 不允许保存支持者通行证");
  }
}

function setSupporterModeEnabled(enabled) {
  if (enabled) {
    if (!isSkinUnlocked("memorial-amber")) throw new Error("请先验证兑换码");
    void selectSkin("memorial-amber").catch(() => {});
    return;
  }
  void selectSkin("default").catch(() => {});
}

function sanitizeSupporterText(value, maxLength = 32) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f<>`"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, maxLength);
}

function canonicalRedeemCode(value) {
  const text = String(value || "").trim().toUpperCase();
  const grouped = text.match(/[A-Z0-9]{6}[\s-]*[A-Z0-9]{6}[\s-]*[A-Z0-9]{6}/);
  if (grouped) return grouped[0].replace(/[^A-Z0-9]/g, "");
  const compact = text.replace(/[^A-Z0-9]/g, "");
  const numbered = compact.match(/^\d{1,4}([A-Z0-9]{18})$/);
  if (numbered) return numbered[1];
  return compact;
}

function supporterProfile() {
  const pass = readSupporterPass();
  const localName = readSupporterName();
  const verified = Boolean(pass?.verified);
  const skinId = selectedSkinId();
  const skin = skinById(skinId);
  return {
    enabled: skinId !== DEFAULT_SKIN_ID,
    verified,
    name: pass?.name || localName || "",
    tier: pass?.tier || "支持者",
    badge: skin.label,
    expiresAt: pass?.expiresAt || 0,
    skinId,
    skin
  };
}

function applySupporterMode() {
  void applySelectedSkin();
}

function updateSupporterBadge(profile = supporterProfile()) {
  const host = $("#topBrandPill .brand-pill-text");
  if (!host) return;
  host.querySelector("[data-supporter-badge]")?.remove();
  if (!profile.enabled) return;
  const badge = createElement("span", "skin-inline-badge brand-pill-supporter");
  badge.dataset.supporterBadge = "1";
  badge.textContent = profile.skin?.title || profile.badge;
  host.append(badge);
}

function updateBootSupporterSignature(profile = supporterProfile()) {
  const copy = $(".boot-copy");
  if (!copy) return;
  copy.querySelector("[data-boot-supporter]")?.remove();
  if (!profile.enabled) return;
  const signature = createElement("p", "skin-inline-badge boot-supporter-signature");
  signature.dataset.bootSupporter = "1";
  signature.textContent = profile.skin?.label || profile.badge;
  copy.append(signature);
}

function readCustomTopbarLogo() {
  try {
    return globalThis.localStorage?.getItem(TOPBAR_LOGO_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function saveCustomTopbarLogo(value) {
  const safeValue = value ? safeLocalImageUrl(value) : "";
  if (value && !safeValue) throw new Error("仅支持保存本地图片 Logo");
  try {
    if (safeValue) {
      globalThis.localStorage?.setItem(TOPBAR_LOGO_STORAGE_KEY, safeValue);
    } else {
      globalThis.localStorage?.removeItem(TOPBAR_LOGO_STORAGE_KEY);
    }
  } catch {
    throw new Error("当前 WebView 不允许保存左上角 Logo");
  }
}

function applyBootLogo() {
  const logo = $(".boot-logo-image");
  if (!logo) return;
  const bootLogoUrl = protectedImageUrl(globalThis.__DEX2OAT_WEBUI_DATA?.g, logo.getAttribute("src") || "");
  if (bootLogoUrl) logo.src = bootLogoUrl;
}

function parseBonusMeta(lyrics) {
  if (bonusMeta) return bonusMeta;
  const lines = String(lyrics || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const metadata = {};
  for (const line of lines.slice(0, 8)) {
    const match = /^(标题|標題|歌名|曲名|艺术家|藝術家|歌手|演唱)\s*[:：]?\s*(.+)$/.exec(line);
    if (!match) continue;
    const key = ["艺术家", "藝術家", "歌手", "演唱"].includes(match[1]) ? "artist" : "title";
    metadata[key] = match[2].trim();
  }
  const firstLine = metadata.title || lines.find((line) => !/^(专辑|專輯|年份|流派)\s*[:：]?/.test(line)) || "隱藏曲目";
  const parts = firstLine.split(/\s*-\s*/);
  bonusMeta = {
    title: parts[0]?.trim() || "隱藏曲目",
    artist: metadata.artist || parts.slice(1).join(" - ").trim() || "周柏豪"
  };
  return bonusMeta;
}

function bonusLyricsBody(lyrics) {
  const lines = String(lyrics || "").split(/\r?\n/);
  const metadataPattern = /^(标题|標題|歌名|曲名|艺术家|藝術家|歌手|演唱|专辑|專輯|年份|流派)\s*[:：]?/;
  let firstLyricIndex = 0;
  while (firstLyricIndex < lines.length) {
    const line = lines[firstLyricIndex].trim();
    if (!line || metadataPattern.test(line)) {
      firstLyricIndex += 1;
      continue;
    }
    break;
  }
  return lines.slice(firstLyricIndex).join("\n").trim() || String(lyrics || "").trim();
}

function createBonusHeader(lyrics) {
  const meta = parseBonusMeta(lyrics);
  const header = createElement("div", "bonus-dialog-header");
  const copy = createElement("div", "bonus-dialog-copy");
  copy.append(createElement("strong", "", meta.title));
  copy.append(createElement("span", "", meta.artist));
  const cover = document.createElement("img");
  cover.className = "bonus-art";
  cover.src = loadBonusArt();
  cover.alt = meta.artist ? `${meta.title} - ${meta.artist}` : meta.title;
  header.append(copy, cover);
  return header;
}

async function showBonusDialog() {
  const lyrics = await loadBonusText();
  showDialog("隱藏彩蛋", bonusLyricsBody(lyrics), createBonusHeader(lyrics), {
    className: "bonus-dialog",
    copyLabel: "複製歌詞"
  });
}

function reportUiError(error, context = "WebUI") {
  const message = error?.message || String(error || "未知错误");
  console.warn(`[dex2oat] ${context}: ${message}`);
  setStatus(`${context} 异常：${message}`, "warn");
}

function restoreCustomBackground() {
  try {
    const value = globalThis.localStorage?.getItem(BACKGROUND_STORAGE_KEY);
    if (value) {
      if (safeLocalImageUrl(value, { allowBlob: true })) {
        applyCustomBackground(value);
      } else {
        saveCustomBackground("");
        applyCustomBackground("");
      }
    }
    applyCardOpacity(readCardOpacity());
    applyCardBlur(readCardBlur());
  } catch {
    // Some WebUI hosts disable localStorage; the default theme remains unchanged.
  }
}

function applyCustomBackground(value) {
  const safeValue = safeLocalImageUrl(value, { allowBlob: true });
  if (!safeValue) {
    document.body.classList.remove("has-custom-background");
    document.documentElement.style.removeProperty("--custom-bg-image");
    return;
  }
  document.body.classList.add("has-custom-background");
  document.documentElement.style.setProperty("--custom-bg-image", cssImageUrl(safeValue));
  applyCardOpacity(readCardOpacity());
}

function saveCustomBackground(value) {
  const safeValue = value ? safeLocalImageUrl(value) : "";
  if (value && !safeValue) throw new Error("仅支持保存本地图片背景");
  try {
    if (safeValue) {
      globalThis.localStorage?.setItem(BACKGROUND_STORAGE_KEY, safeValue);
    } else {
      globalThis.localStorage?.removeItem(BACKGROUND_STORAGE_KEY);
    }
  } catch {
    throw new Error("当前 WebView 不允许保存本地背景");
  }
}

function readCardOpacity() {
  try {
    const stored = globalThis.localStorage?.getItem(CARD_OPACITY_STORAGE_KEY)
      ?? globalThis.localStorage?.getItem(LEGACY_BACKGROUND_OPACITY_STORAGE_KEY);
    const value = Number(stored);
    if (Number.isFinite(value)) return Math.min(1, Math.max(0, value > 1 ? value / 100 : value));
  } catch {
    // Keep default opacity when storage is unavailable.
  }
  return CARD_DEFAULT_OPACITY;
}

function saveCardOpacity(value) {
  const raw = Number(value);
  const opacity = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : CARD_DEFAULT_OPACITY;
  try {
    globalThis.localStorage?.setItem(CARD_OPACITY_STORAGE_KEY, String(opacity));
  } catch {
    throw new Error("当前 WebView 不允许保存卡片透明度");
  }
  applyCardOpacity(opacity);
  return opacity;
}

function applyCardOpacity(opacity) {
  const raw = Number(opacity);
  const normalized = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : CARD_DEFAULT_OPACITY;
  document.documentElement.style.setProperty("--card-surface-mix", `${Math.round(normalized * 100)}%`);
}

function readCardBlur() {
  try {
    const value = Number(globalThis.localStorage?.getItem(CARD_BLUR_STORAGE_KEY));
    if (Number.isFinite(value)) return Math.min(100, Math.max(0, value));
  } catch {
    // Keep default blur when storage is unavailable.
  }
  return CARD_DEFAULT_BLUR;
}

function saveCardBlur(value) {
  const raw = Number(value);
  const blur = Number.isFinite(raw) ? Math.min(100, Math.max(0, Math.round(raw))) : CARD_DEFAULT_BLUR;
  try {
    globalThis.localStorage?.setItem(CARD_BLUR_STORAGE_KEY, String(blur));
  } catch {
    throw new Error("当前 WebView 不允许保存卡片模糊强度");
  }
  applyCardBlur(blur);
  return blur;
}

function applyCardBlur(value) {
  const raw = Number(value);
  const blur = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : CARD_DEFAULT_BLUR;
  document.documentElement.style.setProperty("--card-blur-strength", `${Math.round(blur)}%`);
  document.documentElement.style.setProperty("--card-blur", `${(blur * 0.24).toFixed(1)}px`);
}

function createBackgroundPanel() {
  const section = createSection("外观", "本地背景");
  section.classList.add("about-section", "background-panel");
  const actions = createElement("div", "backup-action-row");
  const picker = document.createElement("input");
  const logoPicker = document.createElement("input");
  picker.type = "file";
  picker.accept = "image/*";
  picker.className = "background-file-input";
  logoPicker.type = "file";
  logoPicker.accept = "image/*";
  logoPicker.className = "background-file-input";
  const choose = createButton("更换背景图", "wide-button", () => picker.click());
  const chooseLogo = createButton("更换左上角 Logo", "wide-button", () => logoPicker.click());
  const reset = createButton("恢复默认背景", "wide-button", () => {
    try {
      saveCustomBackground("");
      applyCustomBackground("");
      saveCardOpacity(CARD_DEFAULT_OPACITY);
      saveCardBlur(CARD_DEFAULT_BLUR);
      setStatus("已恢复默认背景", "ok");
      showToast("已恢复默认背景", "ok");
    } catch (error) {
      const message = `背景重置失败：${error.message}`;
      setStatus(message, "warn");
      showToast(message, "warn");
    }
  });
  const resetLogo = createButton("恢复默认 Logo", "wide-button", () => {
    try {
      saveCustomTopbarLogo("");
      applyTopbarLogo(homeLogoUrl || protectedImageUrl(globalThis.__DEX2OAT_WEBUI_DATA?.g));
      setStatus("已恢复默认 Logo", "ok");
      showToast("已恢复默认 Logo", "ok");
    } catch (error) {
      const message = `Logo 重置失败：${error.message}`;
      setStatus(message, "warn");
      showToast(message, "warn");
    }
  });
  picker.addEventListener("change", () => {
    handleBackgroundFile(picker.files?.[0]).finally(() => {
      picker.value = "";
    });
  });
  logoPicker.addEventListener("change", () => {
    handleTopbarLogoFile(logoPicker.files?.[0]).finally(() => {
      logoPicker.value = "";
    });
  });
  actions.append(choose, chooseLogo, reset, resetLogo, picker, logoPicker);
  section.append(createMaterialThemeControl());
  section.append(actions);
  section.append(createCardOpacityControl());
  section.append(createCardBlurControl());
  return section;
}

function createMaterialThemeControl() {
  const wrap = createElement("div", "material-theme-control");
  const current = getMaterialTheme();
  for (const theme of MATERIAL_YOU_THEMES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-swatch";
    button.dataset.themeId = theme.id;
    button.style.setProperty("--swatch-color", theme.swatch || theme.seed);
    button.setAttribute("aria-label", theme.label);
    button.setAttribute("title", theme.label);
    button.setAttribute("aria-pressed", String(theme.id === current));
    button.innerHTML = `
      <span class="theme-swatch-dot" aria-hidden="true"></span>
      <span class="theme-swatch-label">${escapeHtml(theme.label.replace(/^Material You\s*/i, ""))}</span>
    `;
    button.addEventListener("click", () => {
      document.documentElement.classList.add("is-theme-changing");
      const applied = applyMaterialTheme(theme.id);
      wrap.querySelectorAll(".theme-swatch").forEach((item) => {
        item.setAttribute("aria-pressed", String(item.dataset.themeId === applied));
      });
      setStatus(`${theme.label} 已应用`, "ok");
      setTimeout(() => document.documentElement.classList.remove("is-theme-changing"), 360);
    });
    wrap.append(button);
  }
  return wrap;
}

function createCardOpacityControl() {
  const wrap = createElement("div", "background-opacity-control");
  const label = createElement("label", "", "卡片透明度");
  const valueLabel = createElement("span", "background-opacity-value");
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.step = "1";
  const current = Math.round(readCardOpacity() * 100);
  slider.value = String(current);
  valueLabel.textContent = `${current}%`;
  slider.addEventListener("input", () => {
    const opacity = saveCardOpacity(Number(slider.value) / 100);
    valueLabel.textContent = `${Math.round(opacity * 100)}%`;
  });
  wrap.append(label, slider, valueLabel);
  return wrap;
}

function createCardBlurControl() {
  const wrap = createElement("div", "background-opacity-control");
  const label = createElement("label", "", "卡片模糊强度");
  const valueLabel = createElement("span", "background-opacity-value");
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.step = "1";
  const current = readCardBlur();
  slider.value = String(current);
  valueLabel.textContent = `${current}%`;
  slider.addEventListener("input", () => {
    const blur = saveCardBlur(Number(slider.value));
    valueLabel.textContent = `${blur}%`;
  });
  wrap.append(label, slider, valueLabel);
  return wrap;
}

function isTelemetryEnabled() {
  try {
    return globalThis.localStorage?.getItem(TELEMETRY_ENABLED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function setTelemetryEnabled(enabled) {
  try {
    globalThis.localStorage?.setItem(TELEMETRY_ENABLED_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    throw new Error("当前 WebView 不允许保存匿名搜集计划开关");
  }
}

function createCloudWorkspacePanel() {
  const section = createSection("云端工作台", "");
  section.classList.add("about-section", "cloud-workspace-panel");
  void ensureSkinBadgeStyles();

  const list = createElement("div", "cloud-workspace-list");
  list.append(
    createCloudWorkspaceItem("反馈", "", createButton("提交反馈", "wide-button", showFeedbackDialog)),
    createCloudWorkspaceItem("规则证据", "", createButton("上传", "wide-button", submitRuleEvidence)),
    createSkinWorkspaceItem(),
    createCloudWorkspaceItem("匿名搜集计划", "", createAnonymousCollectionToggle())
  );
  section.append(list);
  return section;
}

function createCloudWorkspaceItem(title, detail, action) {
  const item = createElement("article", "cloud-workspace-item");
  const copy = createElement("div", "telemetry-copy");
  copy.append(createElement("strong", "", title));
  if (detail?.nodeType) copy.append(detail);
  else if (detail) copy.append(createElement("span", "", detail));
  item.append(copy, action);
  return item;
}

function createSupporterGoldBadge() {
  const skin = skinById(selectedSkinId());
  return createElement("span", "skin-inline-badge", skin.label);
}

function createSupporterActions() {
  const actions = createElement("div", "cloud-workspace-actions");
  actions.append(
    createButton("兑换码", "wide-button", showSponsorDialog),
    createButton("爱发电", "wide-button", () => openUrl(sponsorUrl()))
  );
  return actions;
}

function createSkinWorkspaceItem() {
  const item = createElement("article", "cloud-workspace-item skin-workspace-item");
  const copy = createElement("div", "telemetry-copy");
  const current = skinById(selectedSkinId());
  copy.append(createElement("strong", "", "兑换码与皮肤"));
  copy.append(createSupporterGoldBadge());
  if (state.skinUnlockInvalidCount > 0) {
    copy.append(createElement("span", "", "检测到无效解锁记录，已自动忽略"));
  } else {
    copy.append(createElement("span", "", current.description));
  }
  item.append(copy, createSupporterActions());
  item.append(createSkinSelector());
  return item;
}

function createSkinSelector() {
  const grid = createElement("div", "skin-grid");
  const unlocked = unlockedSkinIds();
  for (const id of SKIN_ORDER) {
    const skin = SKINS[id];
    const available = unlocked.has(id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "skin-card";
    button.dataset.skinOption = id;
    button.dataset.locked = available ? "false" : "true";
    button.setAttribute("aria-pressed", String(selectedSkinId() === id));
    button.setAttribute("aria-label", available ? `应用 ${skin.label}` : `${skin.label} 未解锁`);
    button.innerHTML = `
      ${skinBadgeMarkup(skin, { locked: !available })}
      <span class="skin-card-copy">
        <strong>${escapeHtml(skin.label)}</strong>
        <small>${escapeHtml(available ? skin.description : "输入兑换码后解锁")}</small>
      </span>
      ${available ? "" : `<span class="skin-lock">${symbolMarkup(MATERIAL_SYMBOLS.lock, "skin-lock-icon")}</span>`}
    `;
    button.addEventListener("click", async () => {
      if (button.disabled || skinSelectionInFlight) return;
      if (!available) {
        showSponsorDialog(id);
        return;
      }
      if (id === selectedSkinId()) {
        setStatus(`${skin.label} 已在使用`, "ok");
        return;
      }
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.classList.add("is-busy");
      try {
        await selectSkin(id);
      } catch (error) {
        setStatus(`皮肤切换失败：${error.message}`, "warn");
      } finally {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.classList.remove("is-busy");
      }
    });
    grid.append(button);
  }
  grid.append(createSkinMotionToggle());
  return grid;
}

function createSkinMotionToggle() {
  const row = createElement("label", "skin-motion-toggle");
  const copy = createElement("span", "skin-motion-copy");
  copy.append(createElement("strong", "", "徽章动态效果"));
  copy.append(createElement("small", "", "关闭后只保留静态皮肤配色"));
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = skinMotionEnabled();
  const track = createElement("span", "skin-motion-track");
  input.addEventListener("change", async () => {
    input.disabled = true;
    try {
      await setSkinMotionEnabled(input.checked);
    } catch (error) {
      input.checked = !input.checked;
      const message = `动态效果设置失败：${error.message}`;
      setStatus(message, "warn");
      showToast(message, "warn");
    } finally {
      input.disabled = false;
    }
  });
  row.append(copy, input, track);
  return row;
}

function skinBadgeMarkup(skin, options = {}) {
  const locked = options.locked ? " data-locked=\"true\"" : "";
  if (skin.badge === "amber") {
    return `
      <span class="skin-badge skin-badge--amber"${locked} aria-hidden="true">
        <span class="amber-blob"></span>
        <span class="amber-blob-inner"></span>
        <span class="skin-badge-symbol">${symbolMarkup(MATERIAL_SYMBOLS.clock, "skin-badge-icon")}</span>
      </span>
    `;
  }
  if (skin.badge === "founder") {
    return `
      <span class="skin-badge skin-badge--founder"${locked} aria-hidden="true">
        <svg viewBox="0 0 56 56" focusable="false">
          <polygon class="founder-ring-base" points="28,4 50,16 50,40 28,52 6,40 6,16"></polygon>
          <polygon class="founder-ring" points="28,4 50,16 50,40 28,52 6,40 6,16" stroke-dasharray="18 208" stroke-linecap="round"></polygon>
          <path class="founder-core" d="M18 35h20v3H18v-3Zm1.5-15 7 5 3.5-10 3.5 10 7-5v12h-21V20Z"></path>
        </svg>
      </span>
    `;
  }
  return `
    <span class="skin-badge skin-badge--default"${locked} aria-hidden="true">
      <span class="skin-badge-symbol">${symbolMarkup(MATERIAL_SYMBOLS.supporter, "skin-badge-icon")}</span>
    </span>
  `;
}

function createAnonymousCollectionToggle() {
  const toggle = document.createElement("label");
  toggle.className = "switch";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = isTelemetryEnabled();
  const track = document.createElement("span");
  toggle.append(input, track);
  input.addEventListener("change", () => {
    try {
      setTelemetryEnabled(input.checked);
      if (input.checked) {
        setStatus("匿名搜集计划已开启", "ok");
        showToast("匿名搜集计划已开启", "ok");
        void submitTelemetry({ force: true });
      } else {
        setStatus("匿名搜集计划已关闭", "ok");
        showToast("匿名搜集计划已关闭", "ok");
      }
    } catch (error) {
      input.checked = !input.checked;
      const message = `匿名搜集计划设置失败：${error.message}`;
      setStatus(message, "warn");
      showToast(message, "warn");
    }
  });
  return toggle;
}

function cloudBaseUrl() {
  return safeRemoteEndpoint(state.meta?.cloudBaseUrl, { allowHttp: true });
}

function telemetryEndpoint() {
  const base = cloudBaseUrl();
  return base ? `${base}/api/telemetry` : "";
}

function ruleEvidenceEndpoint() {
  const base = cloudBaseUrl();
  return base ? `${base}/api/rule-evidence` : "";
}

function supporterVerifyEndpoint() {
  return safeRemoteEndpoint(state.meta?.supporterVerifyUrl, { allowHttp: true }) || endpointFromCloudBase("/api/supporter/verify");
}

function endpointFromCloudBase(path) {
  const base = cloudBaseUrl();
  return base ? `${base}${path}` : "";
}

function friendlyCloudError(error, fallback = "网络请求失败") {
  const raw = String(error?.message || error || "").trim();
  const map = {
    credential_required: "请填写兑换码",
    invalid_credential: "兑换码无效或尚未在服务器登记",
    install_hash_required: "设备标识缺失，无法绑定兑换码",
    code_used: "该兑换码已绑定其他设备",
    code_expired: "该兑换码已过期",
    device_not_allowed: "该兑换码不允许在当前设备启用",
    skin_scope_missing: "无法识别该兑换码对应的皮肤范围，请稍后重试或联系维护者",
    local_unlock_failed: "云端验证已通过，但本地解锁记录写入失败，请重试或检查模块状态",
    "skin-scope-required": "云端验证已通过，但本地没有收到可写入的皮肤范围",
    network: "网络连接失败，请稍后重试",
    server_error: "服务端暂时不可用，请稍后重试",
    http_error: "服务端未返回成功状态，请稍后重试",
    rate_limited: "服务器请求过快，请稍后再试",
    invalid_size: "上传内容过大",
    invalid_content_type: "服务器拒绝了当前请求格式"
  };
  if (map[raw]) return map[raw];
  if (/Failed to fetch|NetworkError|Load failed|TypeError/i.test(raw)) {
    return "网络请求被拦截或无法连接，请检查网络后重试";
  }
  return raw || fallback;
}

function cloudErrorFromPayload(data, fallback = "网络请求失败") {
  const error = String(data?.error || "").trim();
  const message = String(data?.message || "").trim();
  if (error) {
    const mapped = friendlyCloudError(error, "");
    if (mapped && mapped !== error) return mapped;
  }
  if (message && !/^HTTP\s+\d+$/i.test(message)) return friendlyCloudError(message, message);
  return friendlyCloudError(error || message, fallback);
}

function parseJsonObject(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        return parsed && typeof parsed === "object" ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function fetchWithTimeout(url, options = {}, timeoutMs = CLOUD_REQUEST_TIMEOUT_MS) {
  if (typeof fetch !== "function") return Promise.reject(new Error("当前 WebView 不支持网络请求"));

  let timer = null;
  let controller = null;
  const requestOptions = { ...options };

  if (typeof AbortController === "function") {
    controller = new AbortController();
    requestOptions.signal = controller.signal;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (controller) {
        try {
          controller.abort();
        } catch {
          // Older WebView hosts may expose a partial AbortController.
        }
      }
      reject(new Error("网络请求超时"));
    }, timeoutMs);

    fetch(url, requestOptions).then(
      (response) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(response);
      },
      (error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function shouldSubmitTelemetry(force = false) {
  if (force) return true;
  if (!isTelemetryEnabled()) return false;
  try {
    const last = Number(globalThis.localStorage?.getItem(TELEMETRY_LAST_SENT_STORAGE_KEY) || 0);
    return !last || Date.now() - last >= TELEMETRY_INTERVAL_MS;
  } catch {
    return false;
  }
}

function getOrCreateTelemetryInstallId() {
  try {
    let value = globalThis.localStorage?.getItem(TELEMETRY_INSTALL_ID_STORAGE_KEY);
    if (value && /^[a-f0-9-]{24,80}$/i.test(value)) return value;
    value = generateRandomId();
    globalThis.localStorage?.setItem(TELEMETRY_INSTALL_ID_STORAGE_KEY, value);
    return value;
  } catch {
    return "";
  }
}

function getStableInstallId() {
  const candidates = [
    state.supporterInstallId,
    state.unifiedState?.["supporter.install_id"],
    state.unifiedState?.["telemetry.install_id"],
    state.unifiedState?.["install.id"],
    state.systemInfo?.installId
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (/^[a-f0-9-]{8,96}$/i.test(value)) return value;
  }
  return "";
}

function generateRandomId() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hashTelemetryId(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function detectWebViewVersion() {
  const ua = String(navigator.userAgent || "");
  const match = ua.match(/(?:Chrome|Chromium|Version)\/([0-9.]+)/i);
  return match ? match[1].slice(0, 32) : "";
}

function buildTelemetryPayload() {
  const installHash = currentInstallHash();
  return {
    installHash,
    moduleVersion: state.meta?.version || "",
    versionCode: Number(state.meta?.versionCode || 0),
    deviceModel: state.systemInfo?.model || state.device?.["ro.product.model"] || "",
    manufacturer: state.systemInfo?.manufacturer || state.device?.["ro.product.manufacturer"] || "",
    brand: state.systemInfo?.brand || state.device?.["ro.product.brand"] || "",
    androidVersion: state.systemInfo?.android || state.device?.["ro.build.version.release"] || "",
    sdk: Number(state.systemInfo?.sdk || state.device?.["ro.build.version.sdk"] || 0),
    manager: state.systemInfo?.root || "",
    webviewVersion: detectWebViewVersion(),
    locale: navigator.language || "",
    timezone: String(new Date().getTimezoneOffset()),
    ruleMode: currentRiskMode(),
    rulesVersion: state.options?.rulesVersion || state.meta?.version || ""
  };
}

function buildSupporterPayload(credential) {
  return {
    ...buildTelemetryPayload(),
    credential: canonicalRedeemCode(credential),
    displayName: readSupporterName(),
    source: "webui"
  };
}

function skinScopeToken(value) {
  return String(value ?? "").trim();
}

function addSkinScopeToken(ids, value) {
  const token = skinScopeToken(value);
  if (!token) return;
  const direct = normalizeSkinId(token, "");
  if (direct && direct !== DEFAULT_SKIN_ID && !ids.includes(direct)) {
    ids.push(direct);
    return;
  }
  if (/founder|fnd|elaina|创始人|倾慕/i.test(token)) {
    if (!ids.includes("founder-qingmu")) ids.push("founder-qingmu");
    return;
  }
  if (/memorial|mem|amber|纪念|琥珀/i.test(token)) {
    if (!ids.includes("memorial-amber")) ids.push("memorial-amber");
  }
}

function unlockedSkinIdsFromRedeemResult(data, requestedSkinId = "") {
  const ids = [];
  const add = (value) => {
    if (Array.isArray(value)) {
      value.forEach(add);
      return;
    }
    addSkinScopeToken(ids, value);
  };
  if (Array.isArray(data?.unlockedSkins)) data.unlockedSkins.forEach(add);
  if (Array.isArray(data?.skins)) data.skins.forEach(add);
  if (Array.isArray(data?.skinIds)) data.skinIds.forEach(add);
  if (Array.isArray(data?.skin_ids)) data.skin_ids.forEach(add);
  add(data?.skinId);
  add(data?.skin_id);
  add(data?.codeId);
  add(data?.code_id);
  add(data?.id);
  add(data?.tier);
  add(data?.badge);
  add(data?.note);
  const requested = normalizeSkinId(requestedSkinId, "");
  if (requested && ids.includes(requested)) return [requested, ...ids.filter((id) => id !== requested)];
  return ids;
}

async function unlockSkinsLocally(installHash, verifiedAt, skinIds) {
  const ids = Array.from(new Set((skinIds || []).map((id) => normalizeSkinId(id, "")).filter((id) => id && id !== DEFAULT_SKIN_ID)));
  if (!ids.length) throw new Error(friendlyCloudError("skin-scope-required"));
  const result = await exec(`sh ${shellQuote(`${MODULE_DIR}/core/skin-unlock.sh`)} ${shellQuote(MODULE_DIR)} unlock-many ${shellQuote(installHash)} ${shellQuote(String(verifiedAt || Date.now()))} ${ids.map(shellQuote).join(" ")}`);
  const data = parseJsonObject(result.stdout)
    || parseJsonObject(`${result.stdout || ""}\n${result.stderr || ""}`)
    || {};
  if (result.code !== 0 || data.ok === false) {
    throw new Error(cloudErrorFromPayload(data, resultMessage(result) || "本地解锁记录写入失败"));
  }
  return data;
}

async function verifySupporterCodeOnline(credential, requestedSkinId = "memorial-amber") {
  const requestedSkin = normalizeSkinId(requestedSkinId, "memorial-amber");
  const code = canonicalRedeemCode(credential);
  if (!code) throw new Error("请输入兑换码");
  if (code.length !== 18) throw new Error("兑换码应为 18 位");
  const endpoint = supporterVerifyEndpoint();
  if (!endpoint) throw new Error("需要连接云端验证兑换码");
  const installHash = currentInstallHash();
  if (!installHash) throw new Error(friendlyCloudError("install_hash_required"));
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildSupporterPayload(code))
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok || data.ok !== true) {
    throw new Error(cloudErrorFromPayload(data, `HTTP ${response.status}`));
  }
  const scope = unlockedSkinIdsFromRedeemResult(data, requestedSkin);
  if (!scope.length) {
    throw new Error(friendlyCloudError("skin_scope_missing"));
  }
  const verifiedAt = Number(data.verifiedAt || Date.now());
  const unlockResult = await unlockSkinsLocally(installHash, verifiedAt, scope);
  const displayName = saveSupporterName(data.name || "");
  const pass = saveSupporterPass({
    verified: true,
    name: displayName,
    tier: data.tier || "支持者",
    badge: scope.map(skinLabel).join("、") || "支持者",
    verifiedAt,
    expiresAt: Number(data.expiresAt || 0)
  });
  const unlocked = scope.map((id) => ({ id, result: { status: unlockResult.status || data.status || "unlocked" } }));
  for (const item of unlocked) state.unlockedSkins.add(item.id);
  return { pass, data: { ...data, skins: scope, localUnlock: unlockResult }, unlocked, requestedSkin };
}

function isRuleEvidencePropAllowed(key) {
  const prop = String(key || "").trim();
  if (!prop || prop.length > 128) return false;
  if (RULE_EVIDENCE_SENSITIVE_RE.test(prop)) return false;
  return RULE_EVIDENCE_ALLOWED_PREFIXES.some((prefix) => prop === prefix.slice(0, -1) || prop.startsWith(prefix));
}

function sanitizeRuleEvidenceValue(value) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!text || RULE_EVIDENCE_SENSITIVE_RE.test(text)) return "";
  return text.slice(0, 192);
}

function parseCapturedProps(content) {
  const props = {};
  for (const line of String(content || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let key = "";
    let value = "";
    const getpropMatch = trimmed.match(/^\[([^\]]+)\]:\s*\[(.*)\]$/);
    if (getpropMatch) {
      key = getpropMatch[1];
      value = getpropMatch[2];
    } else {
      const index = trimmed.indexOf("=");
      if (index <= 0) continue;
      key = trimmed.slice(0, index);
      value = trimmed.slice(index + 1);
    }

    key = key.trim();
    if (!isRuleEvidencePropAllowed(key)) continue;
    const safeValue = sanitizeRuleEvidenceValue(value);
    if (!safeValue && safeValue !== "0") continue;
    props[key] = safeValue;
    if (Object.keys(props).length >= RULE_EVIDENCE_MAX_PROPS) break;
  }
  return props;
}

function collectEnabledRuleProps() {
  const props = [];
  const itemStateById = state.config?.items || {};
  for (const category of state.options?.categories || []) {
    for (const item of category.items || []) {
      if (itemStateById[item.id]?.enabled && item.prop && isRuleEvidencePropAllowed(item.prop)) props.push(item.prop);
    }
  }
  return Array.from(new Set(props)).slice(0, RULE_EVIDENCE_MAX_PROPS);
}

function buildRuleEvidencePayload(capturedContent, source = "webui") {
  const props = parseCapturedProps(capturedContent);
  return {
    installHash: currentInstallHash(),
    moduleVersion: state.meta?.version || "",
    versionCode: Number(state.meta?.versionCode || 0),
    rulesVersion: state.options?.rulesVersion || state.meta?.version || "",
    schemaVersion: Number(state.options?.schemaVersion || state.meta?.schemaVersion || 0),
    deviceModel: state.systemInfo?.model || state.device?.["ro.product.model"] || "",
    manufacturer: state.systemInfo?.manufacturer || state.device?.["ro.product.manufacturer"] || "",
    brand: state.systemInfo?.brand || state.device?.["ro.product.brand"] || "",
    androidVersion: state.systemInfo?.android || state.device?.["ro.build.version.release"] || "",
    sdk: Number(state.systemInfo?.sdk || state.device?.["ro.build.version.sdk"] || 0),
    manager: state.systemInfo?.root || "",
    kernelVersion: state.systemInfo?.kernel || "",
    ruleMode: currentRiskMode(),
    matchedTotal: Number(state.unifiedState?.["match.matched_total"] || state.configSource?.matched_total || 0),
    propCount: Number(state.unifiedState?.["config.prop_count"] || 0),
    configStatus: state.unifiedState?.["config.status"] || "",
    matchStatus: state.unifiedState?.["match.status"] || "",
    enabledProps: collectEnabledRuleProps(),
    capturedProps: props,
    capturedTotal: Object.keys(props).length,
    source
  };
}

async function submitTelemetry(options = {}) {
  const force = Boolean(options.force);
  const userVisible = Boolean(options.userVisible);
  if (!shouldSubmitTelemetry(force)) return false;
  const endpoint = telemetryEndpoint();
  if (!endpoint || typeof fetch !== "function") {
    if (userVisible) setStatus("当前环境暂不支持云端通信", "warn");
    return false;
  }
  if (telemetryInFlight) return telemetryInFlight;

  telemetryInFlight = (async () => {
    try {
      if (userVisible) setStatus("正在同步匿名搜集计划...");
      const response = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildTelemetryPayload())
      }, CLOUD_REQUEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      try {
        globalThis.localStorage?.setItem(TELEMETRY_LAST_SENT_STORAGE_KEY, String(Date.now()));
      } catch {
        // Keep telemetry best-effort only.
      }
      if (userVisible) setStatus("匿名搜集计划已同步", "ok");
      return true;
    } catch (error) {
      if (userVisible) setStatus(`匿名搜集计划失败：${error.message}`, "warn");
      return false;
    } finally {
      telemetryInFlight = null;
    }
  })();
  return telemetryInFlight;
}

async function refreshCapturedPropsForEvidence() {
  const result = await exec(`sh ${shellQuote(`${MODULE_DIR}/scripts/capture-props.sh`)} ${shellQuote(`${STATE_DIR}/captured-props.txt`)} "" ${shellQuote(`${STATE_DIR}/rule-props.tsv`)}`);
  if (result.code !== 0) {
    throw new Error(resultMessage(result));
  }
  return readText(`${STATE_DIR}/captured-props.txt`);
}

async function submitRuleEvidence() {
  const endpoint = ruleEvidenceEndpoint();
  if (!endpoint || typeof fetch !== "function") {
    const message = "当前环境暂不支持规则证据上传";
    setStatus(message, "warn");
    showToast(message, "warn");
    return false;
  }
  if (ruleEvidenceInFlight) return ruleEvidenceInFlight;

  const confirmed = await showConfirm("上传规则证据？");
  if (!confirmed) return false;

  ruleEvidenceInFlight = (async () => {
    try {
      setStatus("正在抓取规则证据...");
      const captured = await refreshCapturedPropsForEvidence();
      const payload = buildRuleEvidencePayload(captured, "webui-manual");
      if (!payload.capturedTotal) {
        throw new Error("没有抓取到可用于规则库的属性样本");
      }

      setStatus(`正在上传 ${payload.capturedTotal} 项规则证据...`);
      const response = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }, CLOUD_EVIDENCE_TIMEOUT_MS);
      const text = await response.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }
      if (!response.ok || data.ok === false) {
        throw new Error(friendlyCloudError(data.error || data.message || `HTTP ${response.status}`, "规则证据上传失败"));
      }
      try {
        globalThis.localStorage?.setItem(RULE_EVIDENCE_LAST_SENT_STORAGE_KEY, String(Date.now()));
      } catch {
        // Evidence upload is user initiated and remains best-effort.
      }
      const message = `规则证据已上传：${data.acceptedProps || payload.capturedTotal} 项`;
      setStatus(message, "ok");
      showToast(message, "ok");
      return true;
    } catch (error) {
      const message = `规则证据上传失败：${error.message}`;
      setStatus(message, "warn");
      showToast(message, "warn");
      return false;
    } finally {
      ruleEvidenceInFlight = null;
    }
  })();
  return ruleEvidenceInFlight;
}

function readFileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("背景读取失败"));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片解码失败"));
    image.src = dataUrl;
  });
}

function compressBackgroundImage(dataUrl) {
  return compressSquareImage(dataUrl, BACKGROUND_MAX_SIZE, BACKGROUND_JPEG_QUALITY);
}

function compressTopbarLogoImage(dataUrl) {
  return compressSquareImage(dataUrl, TOPBAR_LOGO_MAX_SIZE, TOPBAR_LOGO_JPEG_QUALITY);
}

function compressSquareImage(dataUrl, maxSize, quality) {
  if (typeof document.createElement !== "function") return Promise.resolve(dataUrl);
  return loadImage(dataUrl).then((image) => {
    const width = image.naturalWidth || image.width || 0;
    const height = image.naturalHeight || image.height || 0;
    if (!width || !height) return dataUrl;

    const canvas = document.createElement("canvas");
    const sourceSize = Math.min(width, height);
    const sourceX = Math.max(0, Math.floor((width - sourceSize) / 2));
    const sourceY = Math.max(0, Math.floor((height - sourceSize) / 2));
    const targetSize = Math.min(maxSize, sourceSize);

    canvas.width = targetSize;
    canvas.height = targetSize;
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, targetSize, targetSize);
    try {
      return canvas.toDataURL("image/jpeg", quality);
    } catch {
      return dataUrl;
    }
  });
}

async function handleBackgroundFile(file) {
  if (!file) return;
  if (!isSupportedLocalImageFile(file)) {
    const message = "请选择 PNG、JPEG、WebP 或 GIF 图片";
    setStatus(message, "warn");
    showToast(message, "warn");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    const message = "图片过大，建议选择 8MB 以内的背景";
    setStatus(message, "warn");
    showToast(message, "warn");
    return;
  }
  if (typeof FileReader !== "function") {
    const message = "当前 WebView 不支持相册读取";
    setStatus(message, "warn");
    showToast(message, "warn");
    return;
  }
  setStatus("正在处理背景图...");
  try {
    const original = await readFileDataUrl(file);
    const value = await compressBackgroundImage(original);
    saveCustomBackground(value);
    applyCustomBackground(value);
    setStatus("背景图已更新", "ok");
    showToast("背景图已更新", "ok");
  } catch (error) {
    const message = `背景保存失败：${error.message}`;
    setStatus(message, "warn");
    showToast(message, "warn");
  }
}

async function handleTopbarLogoFile(file) {
  if (!file) return;
  if (!isSupportedLocalImageFile(file)) {
    const message = "请选择 PNG、JPEG、WebP 或 GIF 图片";
    setStatus(message, "warn");
    showToast(message, "warn");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    const message = "图片过大，建议选择 8MB 以内的 Logo";
    setStatus(message, "warn");
    showToast(message, "warn");
    return;
  }
  if (typeof FileReader !== "function") {
    const message = "当前 WebView 不支持相册读取";
    setStatus(message, "warn");
    showToast(message, "warn");
    return;
  }
  setStatus("正在处理左上角 Logo...");
  try {
    const original = await readFileDataUrl(file);
    const value = await compressTopbarLogoImage(original);
    saveCustomTopbarLogo(value);
    applyTopbarLogo(value);
    setStatus("左上角 Logo 已更新", "ok");
    showToast("左上角 Logo 已更新", "ok");
  } catch (error) {
    const message = `Logo 保存失败：${error.message}`;
    setStatus(message, "warn");
    showToast(message, "warn");
  }
}

function buildAttentionItems() {
  const items = [];
  const total = Number(state.unifiedState?.["summary.attention_total"] || 0);
  for (let index = 1; index <= total; index += 1) {
    const value = state.unifiedState?.[`summary.attention.${index}`];
    const level = state.unifiedState?.[`summary.attention.${index}.level`] || String(value || "").split("|")[0] || "warning";
    if (level === "info" || level === "note" || level === "debug") continue;
    const message = state.unifiedState?.[`summary.attention.${index}.message`] || String(value || "").split("|").slice(2).join("|") || value;
    if (message) items.push({ level, message });
  }
  if (!items.length) {
    const conflictTotal = Number(state.unifiedState?.["conflict.total"] || 0);
    const failedTotal = Number(state.unifiedState?.["service.failed_total"] || 0);
    const mismatchTotal = Number(state.unifiedState?.["service.mismatch_total"] || 0);
    const applyFailedTotal = Number(state.unifiedState?.["apply.failed_total"] || 0);
    const applyMismatchTotal = Number(state.unifiedState?.["apply.mismatch_total"] || 0);
    if (conflictTotal) items.push({ level: "warning", message: `检测到 ${conflictTotal} 项模块间属性冲突` });
    if (failedTotal || applyFailedTotal) items.push({ level: "error", message: `运行时应用失败 ${failedTotal || applyFailedTotal} 项` });
    if (mismatchTotal || applyMismatchTotal) items.push({ level: "warning", message: `运行时应用偏差 ${mismatchTotal || applyMismatchTotal} 项` });
    if (state.health?.status === "error") items.push({ level: "error", message: `健康检查异常：${state.health.status}` });
  }
  return items;
}

function isActionableHealthWarning(reason = state.unifiedState?.["health.reason"], status = state.unifiedState?.["health.status"]) {
  const normalizedStatus = String(status || "").toLowerCase();
  if (!["warning", "warn"].includes(normalizedStatus)) return false;
  return !["files-or-runtime-props-warning", "runtime-props-not-yet-applied"].includes(String(reason || ""));
}

function currentSummary() {
  const attentionItems = buildAttentionItems();
  const rawStatus = state.unifiedState?.["summary.status"] || (attentionItems.length ? "warning" : "ok");
  const rebootState = state.config.rebootState || {};
  const isPendingReboot = rebootState.label === "待重启";
  const isSyncing = rebootState.label === "同步中";
  const matchStatus = state.unifiedState?.["match.status"] || "";
  const conflictStatus = state.unifiedState?.["conflict.status"] || "";
  const conflictTotal = Number(state.unifiedState?.["conflict.total"] || 0);
  const serviceHealth = state.unifiedState?.["service.health"] || "";
  const applyStatus = state.unifiedState?.["apply.status"] || "";
  const healthStatus = state.unifiedState?.["health.status"] || "";
  const healthReason = state.unifiedState?.["health.reason"] || "";
  const serviceFailedTotal = Number(state.unifiedState?.["service.failed_total"] || 0);
  const serviceMismatchTotal = Number(state.unifiedState?.["service.mismatch_total"] || 0);
  const applyFailedTotal = Number(state.unifiedState?.["apply.failed_total"] || 0);
  const applyMismatchTotal = Number(state.unifiedState?.["apply.mismatch_total"] || 0);
  const hasActionableWarning =
    [applyStatus, serviceHealth, conflictStatus].some((value) => ["warning", "warn"].includes(String(value || "").toLowerCase()))
    || isActionableHealthWarning(healthReason, healthStatus)
    || conflictTotal > 0
    || serviceFailedTotal > 0
    || serviceMismatchTotal > 0
    || applyFailedTotal > 0
    || applyMismatchTotal > 0;
  let status = rawStatus;
  if (["error", "failed"].includes(rawStatus)) status = "error";
  else if (isSyncing) status = "running";
  else if (isPendingReboot) status = "pending";
  else if (matchStatus === "running") status = "running";
  else if (conflictStatus === "error" || ["error", "failed"].includes(conflictStatus)) status = "error";
  else if (hasActionableWarning) status = "warning";
  else if (["partial", "fallback", "warning", "warn"].includes(rawStatus)) status = "ok";
  const legacyTitleKey = String(state.unifiedState?.["summary.title"] || "").toLowerCase().replace(/\s+/g, "-");
  const hasLegacyRuleTitle = legacyTitleKey === ["partial", "rule", "match"].join("-")
    || legacyTitleKey === ["fallback", "strategy"].join("-");
  const labels = {
    ok: "Dex2oat-Lock",
    warning: "存在警告",
    error: "需要处理",
    pending: "待重启",
    running: "正在匹配",
    recovery: "恢复中"
  };
  const rawTitle = state.unifiedState?.["summary.title"] || "";
  const rawMessage = state.unifiedState?.["summary.message"] || "";
  const translatedTitle = friendlySummaryTitle(rawTitle || labels[status], status);
  const translatedMessage = friendlySummaryMessage(rawMessage, status);
  let title = translatedTitle;
  let message = translatedMessage;
  if (isPendingReboot) {
    title = "待重启";
    message = rebootState.reason || "配置已保存，重启后完成应用。";
  } else if (isSyncing) {
    title = "正在同步";
    message = rebootState.reason || "服务正在同步运行时属性。";
  } else if (matchStatus === "running") {
    title = "正在匹配";
    message = "正在重新抓取规则，完成后会继续写入运行状态。";
  } else if (status === "warning") {
    title = "需要关注";
    message = rebootState.reason || friendlySummaryMessage(rawMessage, status) || "运行时应用或健康检查存在少量偏差。";
  } else if (["partial", "fallback"].includes(rawStatus) || hasLegacyRuleTitle) {
    title = "Dex2oat-Lock";
  }
  if (!isPendingReboot && !isSyncing && matchStatus !== "running" && (["partial", "fallback"].includes(rawStatus) || /conservative defaults|safe defaults/i.test(rawMessage))) {
    message = "";
  }
  return {
    status,
    title,
    message,
    tone: status === "error" ? "is-error" : status === "ok" ? "is-working" : status === "recovery" ? "is-recovery" : status === "running" ? "is-running" : "is-warn"
  };
}

function createStatusCard() {
  const rebootState = state.config.rebootState || {};
  const summary = currentSummary();
  const chips = buildStatusChips(summary, rebootState);
  const installPercent = normalizedInstallPercent();
  const message = hasDisplayValue(summary.message)
    ? summary.message
    : summary.status === "ok"
      ? ""
      : summary.status === "pending"
        ? "重启后生效。"
        : summary.status === "running"
          ? "正在处理。"
          : "";
  const hero = createElement("section", `module-status-card ${summary.tone}`);
  hero.innerHTML = `
    <div class="status-fluid-cloud" aria-hidden="true">
      <span></span>
      <span></span>
      <span></span>
    </div>
    <div class="module-status-content">
      <div class="module-status-title">${escapeHtml(summary.title)}</div>
      <div class="module-status-meta"${chips.length ? "" : " hidden"}>
        ${chips.map((chip) => `<span class="m3-chip ${escapeHtml(chip.tone)}">${escapeHtml(chip.label)}</span>`).join("")}
      </div>
      ${installPercent > 0 && installPercent < 100 ? `<div class="m3-linear-progress status-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${installPercent}"><span class="m3-linear-progress-bar" style="width:${installPercent}%"></span></div>` : ""}
      ${message ? `<div class="module-status-reboot">${escapeHtml(message)}</div>` : ""}
    </div>
    <div class="module-status-mark" aria-hidden="true"></div>
  `;
  return hero;
}

function normalizedInstallPercent() {
  const raw = Number(state.unifiedState?.["install.progress"] || state.unifiedState?.["install.percent"] || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function buildStatusChips(summary, rebootState) {
  const chips = [];
  const conflictTotal = Number(state.unifiedState?.["conflict.total"] || 0);
  const failedTotal = Number(rebootState.serviceFailedTotal || state.unifiedState?.["apply.failed_total"] || 0);
  const mismatchTotal = Number(rebootState.serviceMismatchTotal || state.unifiedState?.["apply.mismatch_total"] || 0);
  const installPercent = normalizedInstallPercent();

  if (summary.status === "ok") chips.push({ label: "运行正常", tone: "" });
  if (rebootState.label === "同步中") chips.push({ label: "同步中", tone: "chip-running" });
  else if (summary.status === "running") chips.push({ label: "匹配中", tone: "chip-running" });
  if (summary.status === "pending") chips.push({ label: "待重启", tone: "chip-warn" });
  if (summary.status === "warning") chips.push({ label: "需关注", tone: "chip-warn" });
  if (summary.status === "error") chips.push({ label: "需要查看", tone: "chip-error" });
  if (installPercent && installPercent < 100) chips.push({ label: `安装 ${installPercent}%`, tone: "chip-warn" });
  if (failedTotal) chips.push({ label: "应用失败", tone: "chip-error" });
  if (mismatchTotal) chips.push({ label: "应用偏差", tone: "chip-warn" });
  if (conflictTotal) chips.push({ label: "发现冲突", tone: failedTotal ? "chip-error" : "chip-warn" });
  return chips;
}

function attentionItemKey(item) {
  return `${item.level || "warning"}:${item.message || ""}`;
}

function visibleAttentionItems(items = buildAttentionItems()) {
  const signature = items.map(attentionItemKey).join("\n");
  if (signature !== state.lastAttentionSignature) {
    state.dismissedAttentionKeys = new Set();
    state.lastAttentionSignature = signature;
  }
  return items.filter((item) => !state.dismissedAttentionKeys.has(attentionItemKey(item)));
}

function createDismissButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button agreement-close attention-dismiss";
  button.setAttribute("aria-label", label);
  button.innerHTML = symbolMarkup({ name: "close", fallback: "×", path: "M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6 6.4 5Z" }, "action-symbol");
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick?.();
  });
  return button;
}

function createAttentionSection() {
  const items = buildAttentionItems();
  const visibleItems = visibleAttentionItems(items);
  if (!visibleItems.length) return null;
  const section = createSection("需要关注", visibleItems.length ? `${visibleItems.length} 项` : "无异常置顶");
  section.classList.add("attention-section", "has-items");
  const title = section.querySelector(".section-title");
  title?.append(createDismissButton("忽略本次报错", () => {
    for (const item of visibleItems) state.dismissedAttentionKeys.add(attentionItemKey(item));
    renderHome();
    setStatus("本次会话已忽略当前报错", "ok");
  }));
  const list = createElement("div", "attention-list m3-list");
  for (const item of visibleItems) {
    const row = createElement("div", `attention-item m3-list-item ${item.level === "error" ? "error" : item.level === "info" ? "info" : "warn"}`, item.message);
    row.append(createDismissButton("忽略此项", () => {
      state.dismissedAttentionKeys.add(attentionItemKey(item));
      renderHome();
      setStatus("本次会话已忽略此项", "ok");
    }));
    list.append(row);
  }
  section.append(list);
  return section;
}

function createConfigSummarySection() {
  const status = String(state.unifiedState?.["config.status"] || "ok").toLowerCase();
  const tone = ["error", "failed"].includes(status)
    ? "error"
    : ["warn", "warning", "partial", "fallback"].includes(status)
      ? "warning"
      : "ok";
  const section = createSection("设备系统配置摘要", "");
  section.classList.add("home-state-card", "config-summary-section", `state-${tone}`);
  const rows = createElement("dl", "config-summary-lines");
  for (const [label, value] of getConfigSummaryRows()) {
    const row = createElement("div", "config-summary-row");
    row.append(createElement("dt", "", label), createElement("dd", "", value));
    rows.append(row);
  }
  section.append(rows);
  return section;
}

function getConfigSummaryRows() {
  return [
    ["配置来源", sourceLabel(state.configSource)],
    ["生成状态", displayValue(state.unifiedState?.["config.status"], "正常")],
    ["生成原因", displayValue(state.unifiedState?.["config.reason"] || state.configSource?.reason, "自动规则")],
    ["更新时间", state.configSource?.updated_at || state.unifiedState?.["config.updated_at"] || "暂不可用"]
  ];
}

function showConfigSummaryDialog() {
  const rows = getConfigSummaryRows();
  showDialog("配置摘要", rows.map(([label, value]) => `${label}: ${value}`).join("\n"), null, {
    className: "config-summary-dialog",
    copyLabel: "复制摘要"
  });
}

function shortHash(value) {
  return value ? `${String(value).slice(0, 10)}...` : "暂不可用";
}

function sourceLabel(source) {
  switch (source?.source) {
    case "dex2oat-match":
      return `dex2oat 属性抓取匹配 · ${source.matched_total || 0} 项`;
    case "auto-rules":
      return `自动规则匹配 · ${source.matched_total || 0} 项`;
    case "webui-custom":
      return "WebUI 自定义";
    case "template":
      return "旧模板配置";
    case "template-fallback":
      return "旧模板回退";
    default:
      return "自动规则";
  }
}

function statusLabel(status, labels = {}) {
  const value = displayValue(status, "未知");
  const normalized = String(value).toLowerCase().replace(/\s+/g, "-");
  const builtIn = {
    ok: "",
    passed: "",
    partial: "",
    fallback: "",
    running: "进行中",
    pending: "待处理",
    warning: "需关注",
    warn: "需关注",
    error: "异常",
    failed: "异常",
    "runtime-apply-ok": "",
    "runtime-apply-running": "同步中"
  };
  if (Object.prototype.hasOwnProperty.call(labels, value)) return labels[value];
  if (Object.prototype.hasOwnProperty.call(builtIn, normalized)) return builtIn[normalized];
  return value;
}

function modeLabel(mode) {
  return riskModes[normalizeRiskModeId(mode)].label;
}

function normalizeRiskModeId(mode) {
  return riskModes[mode] ? mode : "safe";
}

function currentRiskMode() {
  for (const candidate of [
    state.config?.riskMode,
    state.config?.profile,
    state.unifiedState?.["risk.mode"]
  ]) {
    const mode = String(candidate || "").trim();
    if (riskModes[mode]) return mode;
  }
  return "safe";
}

function syncRiskMode(mode) {
  const normalized = normalizeRiskModeId(mode);
  state.config.riskMode = normalized;
  state.config.profile = normalized;
  return normalized;
}

function createMetricGrid(rows, className = "") {
  const grid = createElement("div", `metric-grid compact ${className}`.trim());
  for (const [label, value] of rows) grid.append(metric(label, value));
  return grid;
}

function createCardNote(text) {
  if (!hasDisplayValue(text)) return null;
  return createElement("p", "card-note", text);
}

function createRuleStateSection() {
  const rawStatus = String(state.unifiedState?.["match.status"] || "").trim();
  const matchedTotal = Number(state.unifiedState?.["match.matched_total"] || state.configSource?.matched_total || 0);
  const hasMatchStatus = hasDisplayValue(rawStatus);
  const hasMatchData = hasMatchStatus
    || hasDisplayValue(state.unifiedState?.["match.matched_total"])
    || hasDisplayValue(state.configSource?.matched_total);
  const matchStatus = ["partial", "fallback"].includes(rawStatus)
    ? "ok"
    : hasMatchStatus
      ? rawStatus
      : "idle";
  const meta = hasMatchData ? `${matchedTotal} 项` : "待刷新";
  const section = createSection("规则命中", meta);
  section.classList.add("home-state-card", `state-${matchStatus}`);
  section.append(createMetricGrid([
    ["状态", matchStatus === "ok" ? "正常" : statusLabel(matchStatus, { idle: "未检测" })],
    ["命中", hasMatchData ? `${matchedTotal} 项` : "待刷新"],
    ["模式", "自动规则"]
  ], "home-metric-grid"));
  const note = !hasMatchStatus
    ? "待刷新。"
    : ["partial", "fallback"].includes(rawStatus)
      ? ""
      : friendlySummaryMessage(state.unifiedState?.["match.reason"] || state.configSource?.reason || "", matchStatus);
  const noteNode = createCardNote(note);
  if (noteNode) section.append(noteNode);
  return section;
}

function createHealthSection() {
  const health = state.health || {};
  const rawStatus = health.status || state.unifiedState?.["health.status"] || "ok";
  const healthReason = health.reason || state.unifiedState?.["health.reason"] || "";
  const conflictTotal = Number(state.unifiedState?.["conflict.total"] || 0);
  const integrityStatus = displayValue(state.unifiedState?.["integrity.status"], "ok");
  const blockingMissing = Number(state.unifiedState?.["integrity.blocking_missing_total"] || 0);
  const blockingChanged = Number(state.unifiedState?.["integrity.blocking_changed_total"] || 0);
  const hasBlockingIntegrity = integrityStatus === "error"
    || (integrityStatus === "missing" && blockingMissing)
    || (integrityStatus === "changed" && blockingChanged);
  const status = rawStatus === "error" || hasBlockingIntegrity
    ? "error"
    : isActionableHealthWarning(healthReason, rawStatus) || conflictTotal || ["warn", "warning"].includes(integrityStatus)
      ? "warning"
      : "ok";
  const section = createSection("完整性与冲突", status === "error" ? "需要查看" : status === "warning" ? "需关注" : "正常");
  section.classList.add("home-state-card", "health-section", `health-${status}`, `state-${status}`);
  section.append(createMetricGrid([
    ["完整性", integrityLabel()],
    ["冲突", conflictTotal ? `${conflictTotal} 项` : "无"],
    ["自愈", displayValue(health.auto_fixed || state.unifiedState?.["health.auto_fixed"], "无")]
  ], "home-metric-grid"));
  const noteNode = status !== "ok"
    ? createCardNote(health.reason || state.unifiedState?.["health.reason"] || state.unifiedState?.["integrity.reason"] || (conflictTotal ? `检测到 ${conflictTotal} 项属性冲突。` : ""))
    : null;
  if (noteNode) section.append(noteNode);
  return section;
}

function integrityLabel() {
  const status = displayValue(state.unifiedState?.["integrity.status"], "ok");
  const blockingMissing = Number(state.unifiedState?.["integrity.blocking_missing_total"] || 0);
  const blockingChanged = Number(state.unifiedState?.["integrity.blocking_changed_total"] || 0);
  if (status === "ok") return "通过";
  if (status === "error") return "异常";
  if (["warn", "warning"].includes(status)) return "已记录";
  if (status === "missing") return blockingMissing ? "缺失" : "已记录";
  if (status === "changed") return blockingChanged ? "变更" : "已记录";
  return "未检测";
}

function createActionCard(title, detail, onClick, icon = actionIcon(title), tone = "") {
  const button = createElement("button", `action-card ${tone}`.trim());
  button.type = "button";
  button.innerHTML = `
    <span class="action-icon" aria-hidden="true">${symbolMarkup(icon, "action-symbol")}</span>
    <span class="action-copy">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(detail)}</span>
    </span>
    <span class="button-busy-indicator" aria-hidden="true"></span>
  `;
  button.addEventListener("click", (event) => {
    if (button.disabled) return;
    let result;
    try {
      result = onClick?.(event);
    } catch (error) {
      reportUiError(error, title || "操作");
      return;
    }
    if (!result || typeof result.then !== "function") return;
    button.disabled = true;
    button.classList.add("is-busy");
    button.setAttribute("aria-busy", "true");
    Promise.resolve(result).catch((error) => {
      reportUiError(error, title || "操作");
    }).finally(() => {
      button.disabled = false;
      button.classList.remove("is-busy");
      button.removeAttribute("aria-busy");
    });
  });
  return button;
}

function actionIcon(title) {
  const map = {
    "诊断": MATERIAL_SYMBOLS.diagnostic,
    "system.prop": MATERIAL_SYMBOLS.prop,
    "重匹配": MATERIAL_SYMBOLS.sync,
    "安装历史": MATERIAL_SYMBOLS.history
  };
  return map[title] || { name: "circle", fallback: "•" };
}

function createFeatureGrid() {
  const grid = createElement("section", "feature-groups");
  grid.append(
    createActionGroup("", [
      createActionCard("诊断", "健康与冲突证据", showDiagnostics, actionIcon("诊断"), "primary"),
      createActionCard("安装历史", "查看最近日志", renderHistory, actionIcon("安装历史"), "tonal"),
      createActionCard("system.prop", "查看当前配置", showSystemProp, actionIcon("system.prop"), "tonal"),
      createActionCard("重匹配", "重新抓取规则", rerunDex2oatMatch, actionIcon("重匹配"), "tonal")
    ])
  );
  return grid;
}

function createActionGroup(title, cards) {
  const group = createElement("div", "action-group");
  if (title) group.append(createElement("h3", "action-group-title", title));
  const list = createElement("div", "action-group-list");
  list.append(...cards);
  group.append(list);
  return group;
}

function ruleStateInfo() {
  const rawStatus = String(state.unifiedState?.["match.status"] || "").trim();
  const matchedTotal = Number(state.unifiedState?.["match.matched_total"] || state.configSource?.matched_total || 0);
  const hasMatchStatus = hasDisplayValue(rawStatus);
  const hasMatchData = hasMatchStatus
    || hasDisplayValue(state.unifiedState?.["match.matched_total"])
    || hasDisplayValue(state.configSource?.matched_total);
  const status = ["partial", "fallback"].includes(rawStatus)
    ? "ok"
    : hasMatchStatus
      ? rawStatus
      : "idle";
  return { rawStatus, status, matchedTotal, hasMatchData };
}

function healthStateInfo() {
  const health = state.health || {};
  const rawStatus = health.status || state.unifiedState?.["health.status"] || "ok";
  const healthReason = health.reason || state.unifiedState?.["health.reason"] || "";
  const conflictTotal = Number(state.unifiedState?.["conflict.total"] || 0);
  const integrityStatus = displayValue(state.unifiedState?.["integrity.status"], "ok");
  const blockingMissing = Number(state.unifiedState?.["integrity.blocking_missing_total"] || 0);
  const blockingChanged = Number(state.unifiedState?.["integrity.blocking_changed_total"] || 0);
  const hasBlockingIntegrity = integrityStatus === "error"
    || (integrityStatus === "missing" && blockingMissing)
    || (integrityStatus === "changed" && blockingChanged);
  const status = rawStatus === "error" || hasBlockingIntegrity
    ? "error"
    : isActionableHealthWarning(healthReason, rawStatus) || conflictTotal || ["warn", "warning"].includes(integrityStatus)
      ? "warning"
      : "ok";
  return { health, rawStatus, healthReason, conflictTotal, integrityStatus, status };
}

function autoFixLabel(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized || ["0", "false", "no", "none", "null", "undefined"].includes(normalized)) return "未触发";
  if (["1", "true", "yes", "ok", "fixed", "repaired"].includes(normalized)) return "已触发";
  return displayValue(value, "未触发");
}

function createStateOverviewSection() {
  const summary = currentSummary();
  const rule = ruleStateInfo();
  const health = healthStateInfo();
  const configStatus = String(state.unifiedState?.["config.status"] || "ok").toLowerCase();
  const tone = summary.status === "error" || health.status === "error" || ["error", "failed"].includes(configStatus)
    ? "error"
    : summary.status === "warning" || health.status === "warning" || ["warn", "warning"].includes(configStatus)
      ? "warning"
      : summary.status === "running" || rule.status === "running"
        ? "running"
        : rule.status === "idle"
          ? "idle"
          : "ok";
  const matchedText = rule.hasMatchData ? `${rule.matchedTotal} 项规则命中` : "规则待刷新";
  const conflictText = health.conflictTotal ? `${health.conflictTotal} 项冲突` : "无冲突";
  const headline = tone === "error"
    ? `配置异常 · ${matchedText} · ${conflictText}`
    : tone === "warning"
      ? `需要关注 · ${matchedText} · ${conflictText}`
      : tone === "running"
        ? `正在处理 · ${matchedText}`
        : `配置正常 · ${matchedText} · ${conflictText}`;
  const section = createSection("状态概览", "");
  section.classList.add("home-state-card", "state-overview-section", "state-overview-card", `state-${tone}`);
  const header = createElement("div", "state-overview-head");
  header.append(createElement("strong", "state-overview-summary", headline));
  const updatedAt = state.configSource?.updated_at || state.unifiedState?.["config.updated_at"] || "";
  if (updatedAt) header.append(createElement("span", "state-overview-time", updatedAt));
  const integrityText = `${integrityLabel()} · ${health.conflictTotal ? `${health.conflictTotal} 项冲突` : "无冲突"} · 自愈 ${autoFixLabel(health.health.auto_fixed || state.unifiedState?.["health.auto_fixed"])}`;
  const ruleText = rule.status === "ok" ? "规则状态正常" : statusLabel(rule.status, { idle: "未检测" });
  const generationText = `${displayValue(state.unifiedState?.["config.status"], "正常")} · ${displayValue(state.unifiedState?.["config.reason"] || state.configSource?.reason, "自动规则")}`;
  const rows = [
    ["完整性", integrityText],
    ["规则", ruleText],
    ["配置来源", sourceLabel(state.configSource)],
    ["生成", generationText]
  ];
  const lines = createElement("div", "state-overview-lines");
  for (const [label, value] of rows) {
    const line = createElement("div", "state-overview-line");
    line.append(createElement("span", "state-overview-line-label", label));
    line.append(createElement("strong", "state-overview-line-value", value));
    lines.append(line);
  }
  section.append(header, lines);
  return section;
}

function createHomeCardGrid() {
  const grid = createElement("section", "home-card-grid");
  grid.append(createStateOverviewSection(), createHomeToolSection());
  return grid;
}

function createHomeToolSection() {
  const section = createSection("功能中心", "");
  section.classList.add("home-tool-section");
  section.append(createFeatureGrid());
  return section;
}

function createHomeDashboard() {
  const dashboard = createElement("section", "home-dashboard");
  const main = createElement("div", "home-dashboard-main");
  main.append(createStatusCard());
  dashboard.append(main);
  return dashboard;
}

function renderHome() {
  const page = $("#page");
  page.innerHTML = "";
  page.append(createHomeDashboard());
  const attention = createAttentionSection();
  if (attention) page.append(attention);
  page.append(createHomeCardGrid());
}

function createSection(title, meta) {
  const section = createElement("section", "section");
  const safeMeta = hasDisplayValue(meta) ? String(meta).trim() : "";
  section.innerHTML = `
    <div class="section-title">
      <h2>${escapeHtml(title)}</h2>
      ${safeMeta ? `<span>${escapeHtml(safeMeta)}</span>` : ""}
    </div>
  `;
  return section;
}

function createButton(text, className, onClick) {
  const button = createElement("button", className, text);
  button.type = "button";
  button.append(createElement("span", "button-busy-indicator"));
  button.addEventListener("click", (event) => {
    if (button.disabled) return;
    try {
      const result = onClick?.(event);
      if (result && typeof result.then === "function") {
        button.disabled = true;
        button.classList.add("is-busy");
        button.setAttribute("aria-busy", "true");
        Promise.resolve(result).catch((error) => {
          reportUiError(error, text || "操作");
        }).finally(() => {
          button.disabled = false;
          button.classList.remove("is-busy");
          button.removeAttribute("aria-busy");
        });
      }
    } catch (error) {
      reportUiError(error, text || "操作");
    }
  });
  return button;
}

function renderCustom() {
  const page = $("#page");
  page.innerHTML = "";

  if (!hasAcceptedCustomAgreement()) {
    page.append(createAgreementGate("custom"));
    return;
  }

  page.append(createRiskModePanel());
  const workbench = createElement("div", "custom-workbench");
  workbench.append(createSaveSummary(), createCustomOptionsList());
  page.append(workbench);
}

function hasAcceptedCustomAgreement() {
  const agreement = state.config.riskAgreement || {};
  return agreement.agreed && agreement.version === RISK_AGREEMENT_VERSION && agreement.customUnlocked;
}

function hasAcceptedAggressiveAgreement() {
  const agreement = state.config.riskAgreement || {};
  return hasAcceptedCustomAgreement() && agreement.aggressiveUnlocked;
}

function createRiskModePanel() {
  const mode = currentRiskMode();
  const meta = riskModes[mode] || riskModes.safe;
  const section = createSection("规则档位", "安全 / 谨慎 / 危险");
  section.classList.add("risk-workbench", mode);
  const selector = createElement("div", "risk-mode-grid");
  for (const [id, item] of Object.entries(riskModes)) {
    const active = id === mode;
    const button = createElement("button", `risk-mode-card ${id} ${active ? "active" : ""}`.trim());
    button.type = "button";
    button.title = item.tooltip;
    button.setAttribute("aria-label", item.tooltip);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.innerHTML = `
      <span class="risk-mode-icon" aria-hidden="true">${symbolMarkup(riskModeIcon(id), "risk-mode-symbol")}</span>
      <span class="risk-mode-copy">
        <strong>${escapeHtml(item.label)}</strong>
        <span>${escapeHtml(item.description)}</span>
      </span>
      <span class="risk-mode-count">${escapeHtml(String(countRiskModeItems(id)))} 项</span>
    `;
    button.addEventListener("click", () => setRiskMode(id));
    selector.append(button);
  }
  const note = createElement("p", "risk-note", meta.description);
  const details = createElement("div", "mode-detail-grid");
  details.append(modeDetail("适合", meta.suitableFor));
  details.append(modeDetail("影响", meta.impact));
  details.append(modeDetail("注意", meta.caution));
  section.append(selector, note, details);
  return section;
}

function riskModeIcon(mode) {
  return MATERIAL_SYMBOLS[mode] || { name: "circle", fallback: "•" };
}

function countRiskModeItems(mode) {
  const category = state.options?.categories?.find((item) => item.id === mode);
  return category?.items?.length || 0;
}

function modeDetail(label, text) {
  const item = createElement("div", "mode-detail-card");
  item.innerHTML = `<strong>${escapeHtml(label)}</strong><span>${escapeHtml(text)}</span>`;
  return item;
}

function setRiskMode(mode) {
  if (riskModeInFlight) return riskModeInFlight;
  const nextMode = normalizeRiskModeId(mode);
  if (nextMode === "aggressive" && !hasAcceptedAggressiveAgreement()) {
    showAgreementDialog("aggressive");
    return;
  }
  const previousConfig = JSON.parse(JSON.stringify(state.config));
  const previousSearch = state.customSearch;
  const previousDraftDirty = state.customDraftDirty;
  syncRiskMode(nextMode);
  state.config = applyRiskModeForMatched(state.options, state.config, state.matchedProps);
  syncRiskMode(nextMode);
  state.customSearch = "";
  state.customDraftDirty = true;
  renderCustom();
  const message = `已切换到${modeLabel(nextMode)}模式`;
  setStatus("正在保存档位...");
  riskModeInFlight = (async () => {
    try {
      if (state.matchedProps && state.matchedProps.size > 0) {
        // Full save: regenerates system.prop so the riskMode switch actually
        // takes effect on next boot. This is the fix for the "档位切换后重启
        // 无效" bug — persistWebConfig only updated config.json and left the
        // old system.prop in place, causing applySystemPropState to re-enable
        // stale items on the next refresh.
        const saved = await saveConfigForMatched(
          state.options, state.config, state.matchedProps,
          (msg) => setStatus(msg)
        );
        state.config = saved;
        syncRiskMode(nextMode);
      } else {
        // Fallback when matchedProps is unavailable (e.g. first-boot or
        // mid-rematch): persist config only; system.prop will be regenerated
        // on the next successful rematch + save.
        await persistWebConfig(nextMode);
      }
      state.customDraftDirty = false;
      renderCustom();
      setStatus(message, "ok");
      showToast(message, "ok");
    } catch (error) {
      state.config = previousConfig;
      state.customSearch = previousSearch;
      state.customDraftDirty = previousDraftDirty;
      renderCustom();
      const detail = `档位保存失败：${error.message}`;
      setStatus(detail, "warn");
      showToast(detail, "warn");
    } finally {
      riskModeInFlight = null;
    }
  })();
  return riskModeInFlight;
}

function createSaveSummary() {
  const section = createSection("保存与生成", "");
  section.classList.add("save-summary");
  const mode = currentRiskMode();
  const grid = createElement("div", "metric-grid compact");
  grid.append(metric("启用项", countEnabledForMatched(state.options, state.config, state.matchedProps)));
  grid.append(metric("变更项", countChangedForMatched(state.options, state.config, state.matchedProps)));
  grid.append(metric("当前档位", modeLabel(mode)));
  grid.append(metric("危险项", countHighRiskEnabledForMatched(state.options, state.config, state.matchedProps)));
  grid.append(metric("配置来源", sourceLabel(state.configSource)));
  section.append(grid);
  const actions = createElement("div", "save-action-row");
  actions.append(createButton("保存并生成 system.prop", `primary-button ${mode}`, saveCurrentConfig));
  section.append(actions);
  return section;
}

function createConfigBackupPanel() {
  const section = createSection("配置备份", "导出 / 恢复");
  section.classList.add("config-backup-panel");
  const actions = createElement("div", "backup-action-row");
  const restorePicker = document.createElement("input");
  restorePicker.type = "file";
  restorePicker.accept = "application/json,.json,text/json,text/plain";
  restorePicker.className = "background-file-input";
  actions.append(createButton("导出配置备份", "wide-button", exportConfigBackup));
  actions.append(createButton("从备份恢复到工作台", "wide-button", () => restorePicker.click()));
  const note = createElement("p", "save-hint", `备份路径：${CONFIG_BACKUP_PATH}`);
  restorePicker.addEventListener("change", () => {
    const file = restorePicker.files?.[0];
    restoreConfigBackupFromFile(file).finally(() => {
      restorePicker.value = "";
    });
  });
  section.append(actions, note, restorePicker);
  return section;
}

function createCustomOptionsList() {
  const list = createElement("section", "option-list custom-options-panel");
  const mode = currentRiskMode();
  const modeMeta = riskModes[mode] || riskModes.safe;
  list.dataset.riskMode = mode;
  const intro = createElement("section", `profile-header active-mode-header ${mode}`);
  intro.innerHTML = `<h2>${escapeHtml(modeMeta.title)}规则库</h2><p>${escapeHtml(modeMeta.impact)}</p>`;
  list.append(intro, createCustomToolbar(list));
  if (!state.matchedProps) {
    list.append(createCustomMatchEmptyState(
      "尚未完成设备属性匹配",
      "请先执行一次重新匹配/扫描。自定义视图只展示当前设备真实抓取并命中规则的属性，不展示预设全量列表。"
    ));
    return list;
  }
  if (state.matchedProps.size === 0) {
    list.append(createCustomMatchEmptyState(
      "没有匹配到可配置属性",
      "当前设备抓取结果没有命中规则；可以重新匹配，或查看诊断确认属性抓取是否正常。"
    ));
    return list;
  }
  const categories = state.options.categories
    .map((category) => ({
      ...category,
      items: category.items.filter((item) => shouldRenderCustomItem(item))
    }))
    .filter((category) => category.items.length > 0);
  for (const category of categories) {
    const header = createElement("section", `profile-header ${category.tone}`);
    header.dataset.categoryHeader = category.id;
    header.innerHTML = `<h2>${escapeHtml(category.title)}</h2><p>${escapeHtml(category.description)}</p>`;
    list.append(header);
    for (const item of category.items) {
      list.append(createOptionRow(category, item));
    }
  }
  list.append(createElement("p", "custom-empty", "没有匹配的配置项"));
  applyCustomOptionsFilter(list);
  return list;
}

function createCustomMatchEmptyState(title, message) {
  const empty = createElement("section", "custom-empty-state");
  empty.innerHTML = `
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(message)}</p>
  `;
  empty.append(createButton("重新匹配", "wide-button", rerunDex2oatMatch));
  return empty;
}

function createCustomToolbar(list) {
  const toolbar = createElement("div", "custom-toolbar");
  const search = document.createElement("input");
  search.type = "search";
  search.className = "custom-search";
  search.placeholder = "搜索配置、属性或取值";
  search.value = state.customSearch;
  search.addEventListener("input", () => {
    state.customSearch = search.value;
    applyCustomOptionsFilter(list);
  });
  toolbar.append(search);
  return toolbar;
}

function applyCustomOptionsFilter(list) {
  const query = state.customSearch.trim().toLowerCase();
  let visibleTotal = 0;
  for (const row of list.querySelectorAll(".option-row")) {
    const matchesQuery = !query || row.dataset.search.includes(query);
    const visible = matchesQuery;
    row.hidden = !visible;
    if (visible) visibleTotal += 1;
  }
  for (const header of list.querySelectorAll("[data-category-header]")) {
    const hasVisibleRow = Array.from(list.querySelectorAll(`.option-row[data-category=\"${header.dataset.categoryHeader}\"]`)).some((row) => !row.hidden);
    header.hidden = !hasVisibleRow;
  }
  const empty = list.querySelector(".custom-empty");
  if (empty) empty.hidden = visibleTotal > 0;
}

function shouldRenderCustomItem(item) {
  return Boolean(state.matchedProps?.has(item.prop));
}

function createOptionRow(category, item) {
  const fallbackValue = fallbackValueForItem(item);
  const displayFallbackValue = displayFallbackValueForItem(item);
  const itemState = state.config.items[item.id] || { enabled: false, value: fallbackValue, explicit: false, matched: false };
  const row = createElement("article", `option-row ${category.tone}`);
  const safeValue = item.values.includes(itemState.value) ? itemState.value : fallbackValue;
  row.dataset.optionId = item.id;
  row.dataset.category = category.id;
  row.dataset.risk = category.id;
  const displayValueText = item.valueLabels?.[safeValue] || safeValue || displayFallbackValue;
  row.dataset.search = `${item.label} ${item.description} ${item.prop} ${safeValue} ${displayValueText} ${displayFallbackValue}`.toLowerCase();
  row.innerHTML = `
    <div class="option-copy">
      <h3>${escapeHtml(item.label)}</h3>
      <p>${escapeHtml(item.description)}</p>
      <code>${escapeHtml(item.prop)}</code>
    </div>
    <label class="switch">
      <input type="checkbox" ${itemState.enabled ? "checked" : ""} />
      <span></span>
    </label>
    <select></select>
  `;
  const checkbox = row.querySelector("input");
  const select = row.querySelector("select");
  for (const value of item.values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = item.valueLabels?.[value] || value;
    option.title = value;
    option.selected = value === safeValue;
    select.append(option);
  }
  checkbox.addEventListener("click", (event) => event.stopPropagation());
  checkbox.addEventListener("change", (event) => {
    event.stopPropagation();
    if (category.id === "aggressive" && checkbox.checked && !hasAcceptedAggressiveAgreement()) {
      checkbox.checked = false;
      showAgreementDialog("aggressive");
      return;
    }
    updateOption(item.id, { enabled: checkbox.checked });
    row.classList.add("just-updated");
    setTimeout(() => row.classList.remove("just-updated"), 420);
    syncCustomWorkbench(row.closest(".custom-options-panel"));
  });
  select.addEventListener("click", (event) => event.stopPropagation());
  select.addEventListener("change", (event) => {
    event.stopPropagation();
    updateOption(item.id, { value: select.value });
    row.dataset.search = `${item.label} ${item.description} ${item.prop} ${select.value} ${item.valueLabels?.[select.value] || select.value} ${displayFallbackValue}`.toLowerCase();
    row.classList.add("just-updated");
    setTimeout(() => row.classList.remove("just-updated"), 420);
    syncCustomWorkbench(row.closest(".custom-options-panel"));
  });
  row.addEventListener("click", (event) => {
    if (event.target.closest("input, select, label")) return;
    row.classList.toggle("expanded");
  });
  return row;
}

function syncCustomWorkbench(list = $(".custom-options-panel")) {
  syncCustomOptionRows(list);
  updateSaveSummary();
}

function syncCustomOptionRows(list = $(".custom-options-panel")) {
  if (!list) return;
  for (const row of list.querySelectorAll(".option-row[data-option-id]")) {
    const itemState = state.config.items[row.dataset.optionId];
    if (!itemState) continue;
    const checkbox = row.querySelector('input[type="checkbox"]');
    const select = row.querySelector("select");
    if (checkbox) checkbox.checked = Boolean(itemState.enabled);
    if (select) select.value = String(itemState.value ?? select.value);
  }
}

function updateSaveSummary() {
  const current = $(".save-summary");
  if (!current) return;
  current.replaceWith(createSaveSummary());
}

function createAgreementGate(scope) {
  const section = createSection("配置确认", "");
  section.classList.add("agreement-gate");
  const row = createElement("div", "agreement-gate-row");
  row.append(createElement("p", "risk-note", "阅读并确认完整协议后才能继续。"));
  row.append(createButton("确认", "primary-button", () => showAgreementDialog(scope)));
  section.append(row);
  return section;
}

function agreementText(scope) {
  const modeText = scope === "aggressive" ? "危险模式" : "自定义配置";
  const extra = scope === "aggressive"
    ? [
        "危险模式会开放更激进的 ART / dex2oat / dexopt 相关配置，可能绕过保守规则、扩大系统属性影响范围，且更容易触发厂商 ROM、系统服务、应用安装器或后台编译任务的兼容问题。",
        "危险模式仅适合具备恢复能力的测试设备。若这是主力设备、生产设备、工作设备，或设备内保存重要资料，请不要启用危险模式。"
      ]
    : [
        "自定义配置会改变自动规则给出的默认结果，可能让当前设备进入未经充分验证的 ART / dex2oat / dexopt 行为组合。"
      ];
  return [
    "Dex2oat Lock 配置确认与风险协议",
    "",
    `你正在进入 ${modeText}。继续操作前，请完整阅读并确认以下条款。点击确认不代表模块保证结果安全，只代表你已经理解并自愿承担相关风险。`,
    "本模块会依据规则库与用户选择生成或修改 ART / dex2oat / dexopt 相关系统属性，并通过 Magisk / KernelSU / APatch 等模块环境影响系统运行时行为。不同 Android 版本、厂商 ROM、补丁级别、Root 管理器、WebView、内核和已有模块组合都可能造成不同结果。",
    "启用自定义配置、危险模式或任何非默认项后，可能出现应用安装变慢或失败、应用首次启动变慢、后台编译异常、系统发热、耗电增加、应用兼容性下降、系统服务重启、配置不生效、配置被系统覆盖、开机等待时间变长、模块冲突、Root 管理器 WebUI 异常、甚至需要进入 Recovery 或安全模式处理的稳定性问题。",
    "本模块不承诺提升性能、降低功耗、缩短安装时间、增强兼容性或适配所有设备。规则库、诊断输出和状态提示只能作为辅助判断，不构成对设备状态、系统稳定性或数据安全的保证。",
    "继续操作前，你应确认已经备份重要数据，知道如何禁用或卸载模块，知道如何恢复默认配置，并保留可用的刷机、Recovery、ADB、Root 管理器或模块目录访问手段。若你无法接受恢复成本，请停止操作。",
    "如果出现异常，应优先在 WebUI 恢复默认配置、重新匹配规则、保存并生成 system.prop、重启设备；仍无法恢复时，可通过 Root 管理器禁用模块，或删除 /data/adb/modules/dex2oat-lock 后重启。必要时请回传完整诊断，而不是继续叠加更多危险项。",
    "你应自行确认当地法律、设备保修、平台规则和数据安全要求。本模块作者、维护者和分发渠道不对因启用、修改、传播或误用配置造成的直接或间接损失承担承诺之外的责任。",
    ...extra,
    "勾选并确认后，表示你已阅读、理解并接受以上风险，愿意对当前设备上的后续配置变更负责。"
  ].join("\n");
}

function makeChallenge() {
  const operators = ["+", "-", "*"];
  const op = operators[Math.floor(Math.random() * operators.length)];
  let left = 2 + Math.floor(Math.random() * 8);
  let right = 2 + Math.floor(Math.random() * 8);
  if (op === "-" && right > left) [left, right] = [right, left];
  const answer = op === "+" ? left + right : op === "-" ? left - right : left * right;
  return { prompt: `${left} ${op} ${right} = ?`, answer };
}

function showAgreementDialog(scope = "custom") {
  state.agreementChallenge = makeChallenge();
  state.agreementReadyAt = Date.now() + RISK_WAIT_SECONDS * 1000;
  const dialog = createElement("div", "dialog agreement-dialog");
  const paragraphs = agreementText(scope)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  dialog.innerHTML = `
      <div class="dialog-panel agreement-panel">
        <div class="agreement-title">
          <h2>配置确认</h2>
          <button class="icon-button agreement-close" data-action="close" aria-label="关闭">${symbolMarkup({ name: "close", fallback: "×", path: "M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6 6.4 5Z" }, "action-symbol")}</button>
      </div>
      <div class="agreement-copy">
        ${paragraphs.map((line, index) => index === 0
          ? `<strong>${escapeHtml(line)}</strong>`
          : `<p>${escapeHtml(line)}</p>`).join("")}
      </div>
      <div class="agreement-controls">
        <div class="agreement-countdown" data-countdown></div>
        <label class="challenge-row">计算验证：<strong>${escapeHtml(state.agreementChallenge.prompt)}</strong><input type="number" inputmode="numeric" data-answer /></label>
        <label class="agreement-check"><input type="checkbox" data-agree disabled /> 已了解风险</label>
        <button class="primary-button" data-confirm disabled>${scope === "aggressive" ? "进入危险模式" : "继续自定义"}</button>
      </div>
    </div>
  `;
  const countdown = dialog.querySelector("[data-countdown]");
  const input = dialog.querySelector("[data-answer]");
  const agree = dialog.querySelector("[data-agree]");
  const confirm = dialog.querySelector("[data-confirm]");
  const updateAgreementState = () => {
    const remaining = Math.max(0, Math.ceil((state.agreementReadyAt - Date.now()) / 1000));
    countdown.textContent = remaining ? `${remaining} 秒后可确认` : "完成计算验证";
    const solved = Number(input.value) === state.agreementChallenge.answer;
    agree.disabled = remaining > 0 || !solved;
    confirm.disabled = !agree.checked || agree.disabled;
  };
  input.addEventListener("input", updateAgreementState);
  agree.addEventListener("change", updateAgreementState);
  confirm.addEventListener("click", async () => {
    if (confirm.disabled) return;
    const previousAgreement = state.config.riskAgreement ? { ...state.config.riskAgreement } : null;
    const previousRiskMode = currentRiskMode();
    confirm.disabled = true;
    confirm.classList.add("is-busy");
    confirm.setAttribute("aria-busy", "true");
    try {
      acceptAgreement(scope);
      if (scope === "aggressive") {
        syncRiskMode("aggressive");
        state.config = applyRiskModeForMatched(state.options, state.config, state.matchedProps);
        syncRiskMode("aggressive");
        // Aggressive mode acceptance enables new items — regenerate system.prop
        // so the change actually takes effect on next boot.
        if (state.matchedProps && state.matchedProps.size > 0) {
          const saved = await saveConfigForMatched(
            state.options, state.config, state.matchedProps,
            (msg) => setStatus(msg)
          );
          state.config = saved;
          syncRiskMode("aggressive");
        } else {
          await persistWebConfig("aggressive");
        }
      } else {
        await persistWebConfig("");
      }
      clearInterval(state.agreementTimer);
      closeDialog(dialog);
      renderPage();
      const message = scope === "aggressive" ? "已切换到危险模式" : "自定义配置已开启";
      setStatus(message, "ok");
      if (scope === "aggressive") showToast(message, "ok");
    } catch (error) {
      if (error.phase === "write-config") {
        if (previousAgreement) state.config.riskAgreement = previousAgreement;
        else delete state.config.riskAgreement;
        syncRiskMode(previousRiskMode);
      }
      setStatus(`配置确认保存失败：${error.message}`, "warn");
      showToast(`配置确认保存失败：${error.message}`, "warn");
    } finally {
      confirm.classList.remove("is-busy");
      confirm.removeAttribute("aria-busy");
      updateAgreementState();
    }
  });
  dialog.querySelector('[data-action="close"]').addEventListener("click", () => {
    clearInterval(state.agreementTimer);
    closeDialog(dialog);
  });
  state.agreementTimer = setInterval(updateAgreementState, 500);
  updateAgreementState();
  document.body.append(dialog);
}

function acceptAgreement(scope) {
  const now = formatTimestamp(new Date());
  state.config.riskAgreement = {
    ...(state.config.riskAgreement || {}),
    version: RISK_AGREEMENT_VERSION,
    agreed: true,
    agreedAt: now,
    customUnlocked: true,
    aggressiveUnlocked: scope === "aggressive" ? true : Boolean(state.config.riskAgreement?.aggressiveUnlocked)
  };
  if (scope === "aggressive") syncRiskMode("aggressive");
}

async function persistWebConfig(riskModeOverride = "") {
  const persistedRiskMode = syncRiskMode(riskModeOverride || currentRiskMode());
  const config = {
    ...state.config,
    riskMode: persistedRiskMode,
    profile: persistedRiskMode
  };
  delete config.rebootState;
  const stageDir = `${STATE_DIR}/stage-webui-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const createStage = await exec(`rm -rf ${shellQuote(stageDir)} && mkdir -p ${shellQuote(stageDir)}`);
  if (createStage.code !== 0) {
    const error = new Error(`创建配置暂存目录失败：${resultMessage(createStage)}`);
    error.phase = "create-config-stage";
    throw error;
  }
  try {
    const writeResult = await writeBase64(`${stageDir}/config.json`, JSON.stringify(config, null, 2) + "\n");
    if (writeResult.code !== 0) {
      const error = new Error(`写入 config.json 失败：${resultMessage(writeResult)}`);
      error.phase = "write-config";
      throw error;
    }
    const commitResult = await exec(`sh ${shellQuote(`${MODULE_DIR}/core/webui-config-save.sh`)} ${shellQuote(MODULE_DIR)} ${shellQuote(stageDir)}`);
    if (commitResult.code !== 0) {
      const error = new Error(`提交 config.json 失败：${resultMessage(commitResult)}`);
      error.phase = "commit-config";
      throw error;
    }
  } finally {
    await exec(`rm -rf ${shellQuote(stageDir)}`);
  }
  const stateResult = await exec(`sh ${shellQuote(`${MODULE_DIR}/core/statectl.sh`)} update ${
    [
      `risk.mode=${persistedRiskMode}`,
      `risk.agreement_version=${RISK_AGREEMENT_VERSION}`,
      `risk.agreed_at=${state.config.riskAgreement?.agreedAt || ""}`,
      `risk.custom_unlocked=${state.config.riskAgreement?.customUnlocked ? "yes" : "no"}`,
      `risk.aggressive_unlocked=${state.config.riskAgreement?.aggressiveUnlocked ? "yes" : "no"}`
    ].map(shellQuote).join(" ")
  }`);
  if (stateResult.code !== 0) {
    throw new Error(`更新状态失败：${resultMessage(stateResult)}`);
  }
  state.unifiedState = {
    ...(await loadUnifiedState()),
    "risk.mode": persistedRiskMode,
    "risk.agreement_version": String(RISK_AGREEMENT_VERSION),
    "risk.custom_unlocked": state.config.riskAgreement?.customUnlocked ? "yes" : "no",
    "risk.aggressive_unlocked": state.config.riskAgreement?.aggressiveUnlocked ? "yes" : "no"
  };
}

function renderAbout() {
  const page = $("#page");
  page.innerHTML = "";

  const backup = createConfigBackupPanel();
  backup.classList.add("about-section");
  const background = createBackgroundPanel();
  const cloudWorkspace = createCloudWorkspacePanel();

  const project = createSection("项目", "GitHub / License / Author");
  project.classList.add("about-section", "about-project-section");
  const projectLayout = createElement("div", "about-project-layout");
  const authorStack = createElement("div", "about-author-stack");
  authorStack.append(createAboutInfoCard("作者", state.meta.author || "pakhozako"));
  authorStack.append(createAboutContactCard("QQ", "2413474391"));
  const projectGrid = createElement("div", "about-info-grid compact about-project-meta-grid");
  projectGrid.append(createAboutInfoCard("License", "GPL / Open"));
  projectGrid.append(createAboutInfoCard("版本", displayValue(state.meta.version), `versionCode ${displayValue(state.meta.versionCode)}`));
  projectLayout.append(authorStack, projectGrid);
  project.append(projectLayout);
  const githubRow = createElement("div", "about-github-row");
  githubRow.append(createButton("Github项目地址", "wide-button about-github-button", () => openUrl(state.meta.githubUrl)));
  project.append(githubRow);

  page.append(backup, background, cloudWorkspace, project);
}

function createAboutInfoCard(label, value, detail) {
  const card = createElement("article", "about-info-card");
  card.innerHTML = `
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(String(value || "暂不可用"))}</strong>
    ${detail ? `<small>${escapeHtml(String(detail))}</small>` : ""}
  `;
  return card;
}

function createAboutContactCard(label, value) {
  const card = createElement("article", "about-info-card about-contact-card");
  const valueText = String(value || "暂不可用");
  card.innerHTML = `
    <span>${escapeHtml(label)}</span>
    <div class="about-contact-row">
      <strong>${escapeHtml(valueText)}</strong>
      <button type="button" class="icon-button about-contact-copy" aria-label="复制 ${escapeHtml(label)}">${symbolMarkup(MATERIAL_SYMBOLS.copy, "about-contact-copy-icon")}</button>
    </div>
  `;
  const copyButton = card.querySelector(".about-contact-copy");
  copyButton?.addEventListener("click", async () => {
    try {
      await copyTextToClipboard(valueText);
      setStatus(`${label} 已复制`, "ok");
    } catch (error) {
      setStatus(`${label} 复制失败：${error.message}`, "warn");
    }
  });
  return card;
}

function supporterDisplayTitle(profile = supporterProfile()) {
  return profile.skin?.label || (profile.verified ? "纪念版・琥珀纪元" : "支持者");
}

function showSponsorDialog(targetSkinId = "memorial-amber") {
  void ensureSkinBadgeStyles();
  const requestedSkin = skinById(normalizeSkinId(targetSkinId, "memorial-amber"));
  setStatus("已打开兑换码", "ok");
  const dialog = createElement("div", "dialog sponsor-dialog");
  dialog.innerHTML = `
    <div class="dialog-panel sponsor-panel">
      <div class="agreement-title">
        <h2>兑换码</h2>
        <button class="icon-button agreement-close" data-action="close" aria-label="关闭">${symbolMarkup({ name: "close", fallback: "×", path: "M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6 6.4 5Z" }, "action-symbol")}</button>
      </div>
      <div class="skin-redeem-preview" data-skin-redeem-preview>
        ${skinBadgeMarkup(requestedSkin)}
        <div class="telemetry-copy">
          <strong>${escapeHtml(requestedSkin.label)}</strong>
          <span>${escapeHtml(requestedSkin.description)}</span>
        </div>
      </div>
      <label class="feedback-field">
        <span>目标皮肤</span>
        <select data-skin-target>
          ${SKIN_ORDER.filter((id) => id !== DEFAULT_SKIN_ID).map((id) => `<option value="${escapeHtml(id)}" ${id === requestedSkin.id ? "selected" : ""}>${escapeHtml(SKINS[id].label)}</option>`).join("")}
        </select>
      </label>
      <label class="feedback-field">
        <span>兑换码</span>
        <input type="text" maxlength="64" data-supporter-code inputmode="latin" autocomplete="off" autocapitalize="characters" placeholder="ABC123-DEF456-GHJ789" />
      </label>
      <p class="redeem-status" data-redeem-status role="status" aria-live="polite"></p>
      <div class="dialog-actions">
        <button class="text-button" data-action="verify">兑换并应用</button>
        <button class="primary-button" data-action="close">关闭</button>
      </div>
    </div>
  `;
  const close = () => closeDialog(dialog);
  const codeInput = dialog.querySelector("[data-supporter-code]");
  const targetInput = dialog.querySelector("[data-skin-target]");
  const preview = dialog.querySelector("[data-skin-redeem-preview]");
  const statusLine = dialog.querySelector("[data-redeem-status]");
  const verifyButton = dialog.querySelector('[data-action="verify"]');
  const setRedeemStatus = (message, tone = "neutral") => {
    if (!statusLine) return;
    statusLine.textContent = message || "";
    statusLine.dataset.tone = tone;
  };
  dialog.querySelectorAll('[data-action="close"]').forEach((button) => button.addEventListener("click", close));
  targetInput?.addEventListener("change", () => {
    const skin = skinById(targetInput.value);
    if (!preview) return;
    preview.innerHTML = `
      ${skinBadgeMarkup(skin)}
      <div class="telemetry-copy">
        <strong>${escapeHtml(skin.label)}</strong>
        <span>${escapeHtml(skin.description)}</span>
      </div>
    `;
  });
  verifyButton?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    button.classList.add("is-busy");
    button.setAttribute("aria-busy", "true");
    setRedeemStatus("正在验证兑换码...", "neutral");
    setStatus("正在验证兑换码...");
    try {
      const target = normalizeSkinId(targetInput?.value, "memorial-amber");
      const { data, unlocked } = await verifySupporterCodeOnline(codeInput.value, target);
      await loadUnlockedSkins();
      if (!isSkinUnlocked(target)) {
        const unlockedLabels = unlocked.map((item) => skinLabel(item.id)).join("、") || "无";
        const message = `此兑换码未授予「${skinLabel(target)}」，已解锁：${unlockedLabels}`;
        setRedeemStatus(message, "warn");
        setStatus(message, "warn");
        showToast(message, "warn");
        return;
      }
      await selectSkin(target, { toast: false });
      const message = data.reused ? "已解锁，可继续使用" : "兑换成功，皮肤已应用";
      setRedeemStatus(message, "ok");
      setStatus(message, "ok");
      showToast(message, "ok");
      close();
      renderAbout();
    } catch (error) {
      const detail = String(error?.message || "").trim() || friendlyCloudError(error, "兑换码验证失败");
      const message = `验证失败：${detail}`;
      setRedeemStatus(message, "warn");
      setStatus(message, "warn");
      showToast(message, "warn");
    } finally {
      button.disabled = false;
      button.classList.remove("is-busy");
      button.removeAttribute("aria-busy");
    }
  });
  codeInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    verifyButton?.click();
  });
  document.body.append(dialog);
  codeInput?.focus();
}

function getFeedbackCategories() {
  return [
    { value: "bug", label: "Bug" },
    { value: "ui", label: "界面" },
    { value: "logic", label: "逻辑" },
    { value: "compat", label: "兼容性" },
    { value: "perf", label: "性能" },
    { value: "rule", label: "规则库" },
    { value: "other", label: "其他" }
  ];
}

function getFeedbackSeverities() {
  return [
    { value: "low", label: "轻微" },
    { value: "normal", label: "一般" },
    { value: "high", label: "严重" }
  ];
}

function showFeedbackDialog() {
  setStatus("已打开反馈", "ok");
  const dialog = createElement("div", "dialog feedback-dialog");
  const categories = getFeedbackCategories();
  const severities = getFeedbackSeverities();
  const feedbackOnline = Boolean(feedbackEndpoint());
  dialog.innerHTML = `
    <div class="dialog-panel feedback-panel">
      <div class="agreement-title">
        <h2>反馈</h2>
        <button class="icon-button agreement-close" data-action="close" aria-label="关闭">${symbolMarkup({ name: "close", fallback: "×", path: "M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6 6.4 5Z" }, "action-symbol")}</button>
      </div>
      <div class="feedback-grid">
        <label class="feedback-field">
          <span>标题</span>
          <input type="text" maxlength="80" data-feedback-title placeholder="简要说明问题" />
        </label>
        <label class="feedback-field">
          <span>分类</span>
          <select data-feedback-category>
            ${categories.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join("")}
          </select>
        </label>
        <label class="feedback-field">
          <span>严重程度</span>
          <select data-feedback-severity>
            ${severities.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join("")}
          </select>
        </label>
        <label class="feedback-field feedback-field-wide">
          <span>复现步骤</span>
          <textarea rows="4" maxlength="2000" data-feedback-steps placeholder="1. ..."></textarea>
        </label>
        <label class="feedback-field feedback-field-wide">
          <span>期望结果</span>
          <textarea rows="3" maxlength="1000" data-feedback-expected placeholder="希望看到什么"></textarea>
        </label>
        <label class="feedback-field feedback-field-wide">
          <span>实际结果</span>
          <textarea rows="3" maxlength="1000" data-feedback-actual placeholder="实际发生了什么"></textarea>
        </label>
      </div>
      <div class="feedback-checks">
        <label class="agreement-check"><input type="checkbox" data-feedback-diag /> 附加诊断输出</label>
        <label class="agreement-check"><input type="checkbox" data-feedback-config checked /> 附加配置摘要</label>
      </div>
      <div class="agreement-controls feedback-controls">
        <div class="dialog-actions">
          <button class="text-button" data-action="copy">复制反馈包</button>
          <button class="primary-button" data-action="submit">${feedbackOnline ? "提交到服务器" : "复制并关闭"}</button>
        </div>
      </div>
    </div>
  `;
  const close = () => closeDialog(dialog);
  const title = dialog.querySelector("[data-feedback-title]");
  const category = dialog.querySelector("[data-feedback-category]");
  const severity = dialog.querySelector("[data-feedback-severity]");
  const steps = dialog.querySelector("[data-feedback-steps]");
  const expected = dialog.querySelector("[data-feedback-expected]");
  const actual = dialog.querySelector("[data-feedback-actual]");
  const includeDiag = dialog.querySelector("[data-feedback-diag]");
  const includeConfig = dialog.querySelector("[data-feedback-config]");
  const copyButton = dialog.querySelector('[data-action="copy"]');
  const submitButton = dialog.querySelector('[data-action="submit"]');

  copyButton.addEventListener("click", async () => {
    try {
      copyButton.disabled = true;
      const payload = await buildFeedbackPayloadFromDialog({
        title: title.value,
        category: category.value,
        severity: severity.value,
        steps: steps.value,
        expected: expected.value,
        actual: actual.value,
        includeDiagnostics: includeDiag.checked,
        includeConfig: includeConfig.checked
      }, { shareDiagnostics: false });
      await copyTextToClipboard(JSON.stringify(payload, null, 2));
      setStatus("反馈包已复制", "ok");
      showToast("反馈包已复制", "ok");
    } catch (error) {
      const message = `复制反馈包失败：${error.message}`;
      setStatus(message, "warn");
      showToast(message, "warn");
    } finally {
      copyButton.disabled = false;
    }
  });

  submitButton.addEventListener("click", async () => {
    try {
      submitButton.disabled = true;
      submitButton.classList.add("is-busy");
      const payload = await buildFeedbackPayloadFromDialog({
        title: title.value,
        category: category.value,
        severity: severity.value,
        steps: steps.value,
        expected: expected.value,
        actual: actual.value,
        includeDiagnostics: includeDiag.checked,
        includeConfig: includeConfig.checked
      }, { shareDiagnostics: true });
      await submitFeedback(payload);
      close();
    } catch (error) {
      const message = `反馈提交失败：${error.message}`;
      setStatus(message, "warn");
      showToast(message, "warn");
    } finally {
      submitButton.disabled = false;
      submitButton.classList.remove("is-busy");
    }
  });
  dialog.querySelector('[data-action="close"]').addEventListener("click", close);
  document.body.append(dialog);
  title.focus();
}

async function buildFeedbackPayloadFromDialog(input, options = {}) {
  const payload = buildFeedbackPayload(input);
  if (input.includeDiagnostics) {
    const diagnostic = await collectDiagnosticTranscript();
    payload.diagnosticExitCode = diagnostic.code;
    if (options.shareDiagnostics) {
      payload.diagnosticSummary = summarizeDiagnosticTranscript(diagnostic.content);
    } else {
      payload.diagnosticOutput = diagnostic.content;
    }
  }
  return payload;
}

function summarizeDiagnosticTranscript(content) {
  const lines = [];
  const summaryPattern = /^(?:errno=|status=|reason=|phase=|total=|applied=|matched=|mismatch=|failed=|updated_at=|settled_at=|boot_id=)/;
  const resultPattern = /^(?:Applied|Matched|Mismatch|Failed):\b/;
  let runtimeSection = false;
  for (const line of String(content || "").split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    if (trimmed.startsWith("--- diagnostic segment: ")) {
      lines.push(trimmed);
      runtimeSection = trimmed.includes("runtime logs");
      continue;
    }
    if (trimmed.startsWith("errno=")) {
      lines.push(trimmed);
      continue;
    }
    if (!runtimeSection) continue;
    if (summaryPattern.test(trimmed) || resultPattern.test(trimmed) || trimmed === "--- bridge ---" || trimmed === "shell_ok") {
      lines.push(trimmed);
    }
  }
  return lines.join("\n");
}

function buildFeedbackPayload(input = {}) {
  const installId = getOrCreateTelemetryInstallId();
  const payload = {
    issueType: sanitizeFeedbackText(input.category || "other", 32),
    severity: sanitizeFeedbackText(input.severity || "normal", 16),
    title: sanitizeFeedbackText(input.title || "", 80),
    steps: sanitizeFeedbackText(input.steps || "", 2000),
    expected: sanitizeFeedbackText(input.expected || "", 1000),
    actual: sanitizeFeedbackText(input.actual || "", 1000),
    moduleVersion: state.meta?.version || "",
    versionCode: Number(state.meta?.versionCode || 0),
    installHash: hashTelemetryId(installId),
    deviceModel: state.systemInfo?.model || state.device?.["ro.product.model"] || "",
    manufacturer: state.systemInfo?.manufacturer || state.device?.["ro.product.manufacturer"] || "",
    brand: state.systemInfo?.brand || state.device?.["ro.product.brand"] || "",
    androidVersion: state.systemInfo?.android || state.device?.["ro.build.version.release"] || "",
    sdk: Number(state.systemInfo?.sdk || state.device?.["ro.build.version.sdk"] || 0),
    manager: state.systemInfo?.root || "",
    webviewVersion: detectWebViewVersion(),
    locale: navigator.language || "",
    timezone: String(new Date().getTimezoneOffset()),
    ruleMode: currentRiskMode(),
    rulesVersion: state.options?.rulesVersion || state.meta?.version || "",
    configStatus: state.unifiedState?.["config.status"] || "",
    matchStatus: state.unifiedState?.["match.status"] || "",
    integrityStatus: state.unifiedState?.["integrity.status"] || "",
    conflictTotal: Number(state.unifiedState?.["conflict.total"] || 0),
    configSummary: input.includeConfig ? buildFeedbackConfigSummary() : null,
    page: state.page || "",
    source: "webui"
  };
  if (!input.includeConfig) delete payload.configSummary;
  return payload;
}

function buildFeedbackConfigSummary() {
  return {
    source: sourceLabel(state.configSource),
    matchedTotal: Number(state.configSource?.matched_total || state.unifiedState?.["match.matched_total"] || 0),
    propCount: Number(state.configSource?.prop_count || state.unifiedState?.["config.prop_count"] || 0),
    propHash: state.configSource?.prop_hash || state.unifiedState?.["config.prop_hash"] || "",
    updatedAt: state.configSource?.updated_at || state.unifiedState?.["config.updated_at"] || "",
    configStatus: state.unifiedState?.["config.status"] || "",
    matchStatus: state.unifiedState?.["match.status"] || "",
    ruleMode: currentRiskMode()
  };
}

function sanitizeFeedbackText(value, maxLength = 256) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, maxLength);
}

async function copyFeedbackBundle(options = {}) {
  const payload = await buildFeedbackPayloadFromDialog({
    title: "反馈包",
    category: "other",
    severity: "normal",
    steps: "",
    expected: "",
    actual: "",
    includeDiagnostics: Boolean(options.includeDiagnostics),
    includeConfig: true
  });
  await copyTextToClipboard(JSON.stringify(payload, null, 2));
  setStatus(options.includeDiagnostics ? "诊断反馈包已复制" : "反馈包已复制", "ok");
  showToast(options.includeDiagnostics ? "诊断反馈包已复制" : "反馈包已复制", "ok");
}

function feedbackEndpoint() {
  return safeRemoteEndpoint(state.meta?.feedbackUrl, { allowHttp: true });
}

async function submitFeedback(payload) {
  const endpoint = feedbackEndpoint();
  if (!endpoint || typeof fetch !== "function") {
    await copyTextToClipboard(JSON.stringify(payload, null, 2));
    setStatus("当前服务器暂未开放反馈接口，已复制反馈包", "warn");
    showToast("反馈接口不可用，已复制反馈包", "warn");
    return false;
  }
  if (feedbackInFlight) return feedbackInFlight;

  feedbackInFlight = (async () => {
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }, CLOUD_REQUEST_TIMEOUT_MS);
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    if (!response.ok || data.ok === false) {
      throw new Error(friendlyCloudError(data.error || data.message || `HTTP ${response.status}`, "反馈提交失败"));
    }
    const message = data.issueId ? `反馈已提交：#${data.issueId}` : "反馈已提交";
    setStatus(message, "ok");
    showToast(message, "ok");
    return true;
  })();
  try {
    return await feedbackInFlight;
  } finally {
    feedbackInFlight = null;
  }
}

async function copyTextToClipboard(value) {
  const text = String(value ?? "");
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch (error) {
    console.warn(`[dex2oat] clipboard write failed: ${error.message || error}`);
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.append(textarea);
  textarea.select();
  const success = document.execCommand?.("copy");
  textarea.remove();
  if (!success) throw new Error("复制失败");
}

function updateOption(id, patch) {
  state.customDraftDirty = true;
  if (patch.enabled) {
    const current = state.options.categories.flatMap((category) => category.items).find((item) => item.id === id);
    if (current && current.prop) {
      for (const category of state.options.categories) {
        for (const item of category.items) {
          if (item.id !== id && item.prop === current.prop && state.config.items[item.id]) {
            state.config.items[item.id].enabled = false;
            state.config.items[item.id].explicit = true;
          }
        }
      }
    }
  }

  state.config.items[id] = {
    ...state.config.items[id],
    ...patch,
    explicit: true
  };
}

async function refreshAll() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    setStatus("正在刷新设备信息...");
    try {
      state.unifiedState = await loadUnifiedState();
      state.device = await loadDeviceState();
      state.systemInfo = await readSystemInfo();
      state.health = await loadHealthState();
      state.configSource = await loadConfigSource();
      state.matchedProps = await loadMatchedProps();
      if (!(state.page === "custom" && state.customDraftDirty)) {
        state.config = await loadUserConfig(state.options);
        syncRiskMode(currentRiskMode());
      }
      updateTopbarRealtime();
      renderPage();
      setStatus("已同步", "ok");
    } catch (error) {
      setStatus(`刷新失败：${error.message}`, "warn");
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

function exportableConfig() {
  const config = { ...state.config };
  delete config.rebootState;
  return config;
}

async function buildConfigBackup() {
  return {
    schema: "dex2oat-lock-config-backup/v1",
    exportedAt: formatTimestamp(new Date()),
    module: state.meta?.moduleName || "Dex2oat Lock",
    version: displayValue(state.meta?.version, "未知"),
    riskMode: currentRiskMode(),
    config: exportableConfig(),
    systemProp: await readGeneratedSystemProp()
  };
}

async function exportConfigBackup() {
  try {
    setStatus("正在导出配置备份...");
    const backup = await buildConfigBackup();
    const content = JSON.stringify(backup, null, 2) + "\n";
    const result = await writeBase64(CONFIG_BACKUP_PATH, content);
    if (result.code !== 0) throw new Error(resultMessage(result));
    showDialog("配置备份", content, null, { savePath: CONFIG_BACKUP_PATH, copyLabel: "复制备份" });
    setStatus(`配置备份已导出到 ${CONFIG_BACKUP_PATH}`, "ok");
    showToast(`配置备份已导出到 ${CONFIG_BACKUP_PATH}`, "ok");
  } catch (error) {
    const message = `配置备份失败：${error.message}`;
    setStatus(message, "warn");
    showToast(message, "warn");
  }
}

async function restoreConfigBackupFromFile(file) {
  try {
    if (!file) return;
    if (file.size > CONFIG_BACKUP_MAX_BYTES) throw new Error("备份文件过大，请选择 1MB 以内的 JSON 备份");
    const ok = await showConfirm("从备份恢复会覆盖当前工作台草稿，尚未保存的修改会被替换。确定继续吗？");
    if (!ok) {
      setStatus("已取消恢复备份", "neutral");
      return;
    }
    setStatus(`正在读取备份文件：${file.name || "未命名文件"}...`);
    const raw = await readFileAsText(file);
    await restoreConfigBackupFromText(raw, file.name || "所选文件");
  } catch (error) {
    const message = `恢复失败：${error.message}`;
    setStatus(message, "warn");
    showToast(message, "warn");
  }
}

async function restoreConfigBackupFromText(raw, sourceLabel = "备份文件") {
  try {
    if (!hasDisplayValue(raw)) throw new Error(`未读取到 ${sourceLabel} 内容`);
    const backup = JSON.parse(raw);
    const incoming = backup.config || backup;
    if (!incoming.items || typeof incoming.items !== "object") throw new Error("备份格式不包含配置项");
    const currentAgreement = state.config.riskAgreement || {};
    const restored = mergeConfig(state.config, incoming, state.options);
    restored.riskAgreement = currentAgreement;
    let strippedAggressive = false;
    if (!currentAgreement.aggressiveUnlocked) {
      if (restored.riskMode === "aggressive") {
        restored.riskMode = "caution";
        strippedAggressive = true;
      }
      for (const category of state.options?.categories || []) {
        if (category.id !== "aggressive") continue;
        for (const item of category.items || []) {
          if (restored.items?.[item.id]?.enabled) strippedAggressive = true;
          if (restored.items?.[item.id]) restored.items[item.id].enabled = false;
        }
      }
    }
    restored.pendingReboot = true;
    restored.pendingSavedAt = 0;
    restored.pendingBootId = "";
    state.config = restored;
    state.customDraftDirty = true;
    setPage("custom");
    const message = strippedAggressive
      ? "配置已恢复到工作台；未重新确认危险模式，已移除危险项"
      : "配置已恢复到工作台，确认后请保存并生成 system.prop";
    setStatus(message, "warn");
    showToast(strippedAggressive ? "配置已恢复，危险项已移除" : "配置已恢复到工作台", strippedAggressive ? "warn" : "ok");
  } catch (error) {
    const message = `恢复失败：${error.message}`;
    setStatus(message, "warn");
    showToast(message, "warn");
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(reader.error || new Error("读取文件失败")));
    reader.readAsText(file, "utf-8");
  });
}

async function saveCurrentConfig() {
  if (saveInFlight) return saveInFlight;
  if (!hasAcceptedCustomAgreement()) {
    showAgreementDialog("custom");
    return;
  }
  if (!state.matchedProps || state.matchedProps.size === 0) {
    setStatus("请先执行重新匹配/扫描，再保存自定义配置", "warn");
    showToast("需要先重新匹配", "warn");
    return;
  }
  if ((currentRiskMode() === "aggressive" || countHighRiskEnabledForMatched(state.options, state.config, state.matchedProps) > 0) && !hasAcceptedAggressiveAgreement()) {
    showAgreementDialog("aggressive");
    return;
  }
  const highRiskCount = countHighRiskEnabledForMatched(state.options, state.config, state.matchedProps);
  if (highRiskCount > 0 && !(await showConfirm(`当前工作台里还有 ${highRiskCount} 项危险配置，保存会保留这些选择，并按当前档位生成 system.prop。确定继续吗？`))) {
    return;
  }
  saveInFlight = (async () => {
    setSaveButtonsDisabled(true);
    setStatus("正在保存配置...");
    showToast("正在保存", "neutral");
    await nextFrame();
    const nextConfig = {
      ...state.config,
      riskMode: currentRiskMode(),
      profile: currentRiskMode()
    };
    try {
      state.config = await saveConfigForMatched(state.options, nextConfig, state.matchedProps, (message) => setStatus(message, "warn"));
      state.customDraftDirty = false;
      await nextFrame();
      state.unifiedState = await loadUnifiedState();
      state.configSource = await loadConfigSource();
      state.matchedProps = await loadMatchedProps();
      updateTopbarRealtime();
      renderPage();
      setStatus("保存成功，重启后生效", "ok");
      showToast("保存成功", "ok");
    } catch (error) {
      const detail = buildSaveErrorMessage(error);
      setStatus(detail, "warn");
      showDialog("保存失败", detail, null, { className: "config-summary-dialog", copyLabel: "复制原因" });
      showToast("保存失败", "warn");
    } finally {
      saveInFlight = null;
      setSaveButtonsDisabled(false);
    }
  })();
  return saveInFlight;
}

function buildSaveErrorMessage(error) {
  const message = String(error?.message || error || "未知错误");
  if (/Unauthorized WebUI write path/i.test(message)) return `保存失败：写入路径未授权。${message}`;
  if (/create staging directory/i.test(message)) return `保存失败：无法创建临时目录，请检查 ${STATE_DIR} 权限。`;
  if (/stage WebUI config|invalid-config/i.test(message)) return "保存失败：配置校验未通过，已阻止写入损坏配置。";
  if (/commit staged config|webui-save/i.test(message)) return "保存失败：提交配置失败，请检查模块目录权限和 state 目录锁。";
  if (/No WebUI shell bridge/i.test(message)) return "保存失败：当前管理器没有提供可用的 WebUI Shell Bridge。";
  return `保存失败：${message}`;
}

function updateTopbarRealtime() {
  if (!$("#statusMessage")) return;
  const summary = currentSummary();
  if (summary.status === "pending") {
    setStatus("配置待重启生效", "warn");
  } else if (summary.status === "error") {
    setStatus("需要查看诊断", "warn");
  } else {
    setStatus("已同步", "ok");
  }
}

function setSaveButtonsDisabled(disabled) {
  document.querySelectorAll(".primary-button").forEach((button) => {
    if (button.textContent?.includes("保存并生成")) {
      button.disabled = disabled;
      button.classList.toggle("is-busy", disabled);
      if (disabled) button.setAttribute("aria-busy", "true");
      else button.removeAttribute("aria-busy");
    }
  });
}

async function showSystemProp() {
  const content = await readGeneratedSystemProp();
  setStatus("已打开 system.prop", "ok");
  showDialog("system.prop", content || "暂不可用");
}

async function rerunDex2oatMatch() {
  const ok = await showConfirm("重新抓取匹配将在后台触发 service 执行，完成后需要重启生效。确定继续吗？");
  if (!ok) return;

  setStatus("正在提交重匹配请求...");
  showToast("正在提交重匹配", "neutral");
  const triggerResult = await writeBase64(`${STATE_DIR}/trigger-rematch`, `requested_at=${formatTimestamp(new Date())}\n`);
  if (triggerResult.code !== 0) {
    throw new Error(`写入重匹配触发文件失败：${resultMessage(triggerResult)}`);
  }

  await exec(`sh ${shellQuote(`${MODULE_DIR}/core/statectl.sh`)} update ${[
    "match.status=running",
    "match.reason=webui-rematch-requested",
    `match.updated_at=${formatTimestamp(new Date())}`
  ].map(shellQuote).join(" ")}`);

  const serviceResult = await exec(`sh ${shellQuote(`${MODULE_DIR}/service.sh`)} >/dev/null 2>&1 &`);
  if (serviceResult.code !== 0) {
    await exec(`rm -f ${shellQuote(`${STATE_DIR}/trigger-rematch`)}`);
    throw new Error(`启动重匹配服务失败：${resultMessage(serviceResult)}`);
  }

  state.unifiedState = await loadUnifiedState();
  updateTopbarRealtime();
  setStatus("重新匹配已提交，后台完成后重启生效", "ok");
  showToast("重新匹配已提交", "ok");
  refreshAfterMatch().catch((error) => {
    const message = `重新匹配刷新失败：${error.message}`;
    setStatus(message, "warn");
    showToast(message, "warn");
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRefreshController() {
  if (typeof AbortController === "function") return new AbortController();
  let aborted = false;
  return {
    signal: {
      get aborted() {
        return aborted;
      }
    },
    abort() {
      aborted = true;
    }
  };
}

async function refreshAfterMatch() {
  matchRefreshController?.abort();
  const controller = createRefreshController();
  matchRefreshController = controller;

  for (let index = 0; index < 20; index += 1) {
    await delay(1500);
    if (controller.signal.aborted) return;
    state.unifiedState = await loadUnifiedState();
    if (state.unifiedState["match.status"] !== "running") break;
  }

  if (controller.signal.aborted) return;
  state.matchedProps = await loadMatchedProps();
  if (!(state.page === "custom" && state.customDraftDirty)) {
    state.config = await loadUserConfig(state.options);
    syncRiskMode(currentRiskMode());
  }
  state.configSource = await loadConfigSource();
  updateTopbarRealtime();
  renderPage();
  const matchStatus = state.unifiedState?.["match.status"];
  if (matchStatus === "running") {
    setStatus("重新匹配仍在运行，稍后刷新查看", "warn");
    showToast("重新匹配仍在运行", "warn");
    return;
  }
  const matchedTotal = state.matchedProps instanceof Set
    ? state.matchedProps.size
    : Number(state.unifiedState?.["match.matched_total"] || state.configSource?.matched_total || 0);
  showToast(`匹配完成，命中 ${matchedTotal} 项`, "ok");
}

function nextFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function renderHistory() {
  const logResult = await exec(`tail -n 260 ${shellQuote(`${STATE_DIR}/install.log`)} 2>/dev/null`);
  const log = logResult.code === 0 ? logResult.stdout : await readText(`${STATE_DIR}/install.log`);
  const entries = parseInstallLog(log || "");
  if (!entries.length) {
    showDialog("安装历史", "暂无安装历史", null, { copyLabel: "复制" });
    setStatus("安装历史暂无记录", "warn");
    return;
  }
  const content = entries.slice(0, 20).map((entry, index) => [
    `#${index + 1}`,
    `时间：${displayValue(entry.time, "未知")}`,
    `来源：${sourceLabel({ source: entry.source, matched_total: entry.matched_total })}`,
    `匹配数量：${displayValue(entry.matched_total, "0")}`,
    `版本：${displayValue(entry.version, "未知")}`
  ].join("\n")).join("\n\n");
  showDialog("安装历史", content, null, {
    className: "history-dialog",
    copyLabel: "复制记录"
  });
  setStatus("已打开安装历史", "ok");
}

function parseInstallLog(content) {
  const entries = [];
  let current = null;
  for (const line of content.split(/\r?\n/)) {
    if (line.trim() === "--- install ---") {
      if (current) entries.push(current);
      current = {};
      continue;
    }
    if (!current) continue;
    const index = line.indexOf("=");
    if (index > 0) current[line.slice(0, index)] = line.slice(index + 1);
  }
  if (current) entries.push(current);
  return entries.reverse();
}


function buildStaticDiagnosticShell() {
  return [
    "echo '--- meminfo ---'",
    "cat /proc/meminfo | head -n 8",
    "echo '--- battery ---'",
    "ls -l /sys/class/power_supply/battery 2>/dev/null",
    "cat /sys/class/power_supply/battery/capacity 2>/dev/null",
    "cat /sys/class/power_supply/battery/status 2>/dev/null",
    "cat /sys/class/power_supply/battery/temp 2>/dev/null",
    "echo '--- storage ---'",
    "df -k /data 2>/dev/null",
    "echo '--- install state ---'",
    "cat /data/adb/dex2oat-lock/install-state.prop 2>/dev/null",
    "echo '--- unified state ---'",
    "cat /data/adb/dex2oat-lock/state.prop 2>/dev/null",
    "echo '--- device state ---'",
    "cat /data/adb/dex2oat-lock/device.prop 2>/dev/null",
    "echo '--- current system.prop ---'",
    "cat /data/adb/modules/dex2oat-lock/system.prop 2>/dev/null",
    "echo '--- config source ---'",
    "cat /data/adb/dex2oat-lock/config-source.prop 2>/dev/null",
    "echo '--- dex2oat match report ---'",
    "cat /data/adb/dex2oat-lock/match-report.txt 2>/dev/null",
    "echo '--- captured props ---'",
    "cat /data/adb/dex2oat-lock/captured-props.txt 2>/dev/null",
    "echo '--- reboot state ---'",
    "cat /proc/sys/kernel/random/boot_id 2>/dev/null",
    "cat /data/adb/dex2oat-lock/service-state.prop 2>/dev/null",
    "echo '--- health log ---'",
    "cat /data/adb/dex2oat-lock/health.log 2>/dev/null",
    "echo '--- conflict report ---'",
    "cat /data/adb/dex2oat-lock/conflict-report.txt 2>/dev/null",
    "echo '--- integrity report ---'",
    "cat /data/adb/dex2oat-lock/integrity-report.txt 2>/dev/null",
    "echo '--- uninstall state ---'",
    "cat /data/adb/dex2oat-lock-uninstall.prop 2>/dev/null",
    "echo '--- apply log ---'",
    "tail -n 120 /data/adb/dex2oat-lock/service.log 2>/dev/null || true"
  ].join("\n");
}

async function showDiagnostics() {
  setStatus("正在读取诊断输出...");
  const result = await collectDiagnosticTranscript({ reportProgress: true });
  await showDiagnosticsDialog(`errno=${result.code}\n\n${result.content || ""}`);
  setStatus(result.code === 0 ? "诊断输出已生成" : `诊断命令异常：errno=${result.code}`, result.code === 0 ? "ok" : "warn");
}

function parseApplyLog(content) {
  const groups = {
    failed: [],
    mismatch: [],
    applied: [],
    matched: []
  };
  const passSummaries = [];
  let summary = "";
  const pattern = /\b(Applied|Matched|Mismatch|Failed): (?:phase=([^ ]+) )?key=([^ ]+) desired=([^ ]*) old=([^ ]*) new=([^ ]*) tool=([^ ]*) code=([0-9]+)/;
  const passPattern = /Runtime property apply pass completed: phase=([^ ]+) total=([0-9]+) applied=([0-9]+) matched=([0-9]+) mismatch=([0-9]+) failed=([0-9]+)/;

  for (const line of content.split(/\r?\n/)) {
    if (line.includes("Runtime property apply completed.")) {
      summary = line;
      continue;
    }

    const pass = line.match(passPattern);
    if (pass) {
      passSummaries.push({
        phase: pass[1],
        total: Number(pass[2]),
        applied: Number(pass[3]),
        matched: Number(pass[4]),
        mismatch: Number(pass[5]),
        failed: Number(pass[6])
      });
      continue;
    }

    const match = line.match(pattern);
    if (!match) continue;

    const entry = {
      status: match[1].toLowerCase(),
      phase: match[2] || "",
      prop: match[3],
      desired: match[4],
      oldValue: match[5],
      newValue: match[6],
      tool: match[7],
      code: match[8]
    };

    groups[entry.status].push(entry);
  }

  return { groups, passSummaries, summary };
}

function parseActiveSystemProp(content) {
  const props = {};
  for (const entry of parseKeyValueLines(content)) {
    props[entry.prop] = entry.value;
  }
  return props;
}

function parseDiagnosticGetprop(content) {
  const props = {};
  const sectionByTitle = new Map(getDiagnosticSections().map((section) => [section.title, section]));
  let activeSection = null;
  let activeIndex = 0;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (sectionByTitle.has(trimmed)) {
      activeSection = sectionByTitle.get(trimmed);
      activeIndex = 0;
      continue;
    }

    if (trimmed.startsWith("--- ")) {
      activeSection = null;
      activeIndex = 0;
      continue;
    }

    if (!activeSection || activeIndex >= activeSection.props.length) continue;
    props[activeSection.props[activeIndex]] = trimmed;
    activeIndex += 1;
  }

  return props;
}

function parseDiagnosticRebootState(content) {
  const lines = [];
  let bootId = "";
  let inSection = false;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "--- reboot state ---") {
      inSection = true;
      continue;
    }
    if (inSection && trimmed.startsWith("--- ")) break;
    if (!inSection) continue;
    if (!trimmed) continue;

    if (!trimmed.includes("=") && !bootId) {
      bootId = trimmed;
      continue;
    }

    lines.push(line);
  }

  const state = parseStateFile(lines.join("\n"));

  return {
    bootId,
    status: state.status || "",
    phase: state.phase || "",
    health: state.health || "",
    reason: state.reason || "",
    updatedAt: Number(state.updated_at || 0),
    settledAt: Number(state.settled_at || 0),
    serviceBootId: state.boot_id || "",
    phaseTotal: Number(state.phase_total || 0),
    phaseApplied: Number(state.phase_applied || 0),
    phaseMatched: Number(state.phase_matched || 0),
    phaseMismatch: Number(state.phase_mismatch || 0),
    phaseFailed: Number(state.phase_failed || 0),
    propTotal: Number(state.prop_total || 0),
    appliedTotal: Number(state.applied_total || 0),
    matchedTotal: Number(state.matched_total || 0),
    mismatchTotal: Number(state.mismatch_total || 0),
    failedTotal: Number(state.failed_total || 0)
  };
}

function parseDiagnosticSection(content, title) {
  const sectionLines = [];
  let inSection = false;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === title) {
      inSection = true;
      continue;
    }
    if (inSection && trimmed.startsWith("--- ")) break;
    if (inSection) sectionLines.push(line);
  }

  return parseStateFile(sectionLines.join("\n"));
}

function latestApplyByProp(groups) {
  const result = new Map();

  for (const entry of [...groups.applied, ...groups.matched, ...groups.mismatch, ...groups.failed]) {
    result.set(entry.prop, entry);
  }

  return result;
}

function buildDiagnosticState(content, applyLog, desiredProps) {
  const actualProps = parseDiagnosticGetprop(content);
  const latestByProp = latestApplyByProp(applyLog.groups);
  const mismatches = [];
  const missing = [];

  for (const [prop, expected] of Object.entries(desiredProps)) {
    if (!Object.prototype.hasOwnProperty.call(actualProps, prop)) {
      missing.push({ prop, expected });
    } else if (actualProps[prop] !== expected) {
      const latest = latestByProp.get(prop);
      mismatches.push({ prop, expected, actual: actualProps[prop], latest });
    }
  }

  const postApplyOverrides = mismatches.filter(({ expected, latest }) =>
    latest && ["applied", "matched"].includes(latest.status) && latest.newValue === expected
  );
  const unresolved = mismatches.filter(({ expected, latest }) =>
    !latest || ["mismatch", "failed"].includes(latest.status) || latest.newValue !== expected
  );

  return {
    actualProps,
    desiredProps,
    mismatches,
    missing,
    matchedCount: Math.max(Object.keys(desiredProps).length - mismatches.length - missing.length, 0),
    postApplyOverrides,
    unresolved
  };
}

async function showDiagnosticsDialog(content) {
  const applyLog = parseApplyLog(content);
  const installState = parseDiagnosticSection(content, "--- install state ---");
  const rebootState = parseDiagnosticRebootState(content);
  const uninstallState = parseDiagnosticSection(content, "--- uninstall state ---");
  const desiredProps = parseActiveSystemProp(await readGeneratedSystemProp());
  const originalPropsContent = await readText(`${STATE_DIR}/original-props.conf`);
  const currentSystemProp = await readGeneratedSystemProp();
  const diagnosticState = buildDiagnosticState(content, applyLog, desiredProps);
  const healthState = parseDiagnosticSection(content, "--- health log ---");
  const conflictState = parseDiagnosticSection(content, "--- conflict report ---");
  const unifiedState = parseDiagnosticSection(content, "--- unified state ---");
  const integrityState = parseDiagnosticSection(content, "--- integrity report ---");
  showDialog("诊断输出", content, createDiagnosticSummary(applyLog, diagnosticState, rebootState, installState, uninstallState, originalPropsContent, currentSystemProp, healthState, conflictState, unifiedState, integrityState), {
    className: "diagnostic-dialog",
    copyLabel: "复制诊断",
    savePath: DIAGNOSTIC_EXPORT_PATH
  });
}

function createDiagnosticSummary(applyLog, diagnosticState, rebootState, installState, uninstallState, originalPropsContent, currentSystemProp, healthState, conflictState, unifiedState, integrityState) {
  const section = createElement("section", "diagnostic-stack");
  section.append(createUnifiedStateSummary(unifiedState));
  section.append(createDiagnosticPathSummary());
  section.append(createRuleMatchSummary(unifiedState));
  section.append(createConfigGenerationSummary(unifiedState));
  section.append(createIntegritySummary(integrityState, unifiedState));
  section.append(createConflictBanner(conflictState));
  section.append(createHealthLogSummary(healthState, conflictState));
  section.append(createLifecycleStateSummary(installState, uninstallState));
  section.append(createRebootStateSummary(rebootState, applyLog.passSummaries));
  section.append(createPropCompareSection(originalPropsContent, currentSystemProp));
  section.append(createFinalPropSummary(diagnosticState));
  section.append(createApplyLogSummary(applyLog, diagnosticState, rebootState));
  return section;
}

function createDiagnosticPathSummary() {
  const section = createElement("section", "diagnostic-summary diagnostic-path-summary");
  const header = createElement("div", "diagnostic-summary-head");
  header.append(createElement("strong", "", "常用排障入口"));
  section.append(header);

  const list = createElement("div", "diagnostic-path-list");
  list.append(createDiagnosticPathItem("模块目录", MODULE_DIR));
  list.append(createDiagnosticPathItem("数据目录", STATE_DIR));
  list.append(createDiagnosticPathItem("system.prop", `${MODULE_DIR}/system.prop`));
  list.append(createDiagnosticPathItem("config.json", `${STATE_DIR}/config.json`));
  section.append(list);
  return section;
}

function createDiagnosticPathItem(label, path) {
  const item = createElement("div", "diagnostic-path-item");
  item.append(createElement("span", "", label));
  item.append(createElement("code", "", path || "暂不可用"));
  return item;
}

function createUnifiedStateSummary(unifiedState) {
  const status = displayValue(unifiedState["summary.status"], "ok");
  const attentionTotal = Number(unifiedState["summary.attention_total"] || 0);
  const alertTotal = Number(unifiedState["summary.attention_alert_total"] || 0);
  const section = createElement("section", "diagnostic-summary");
  const header = createElement("div", "diagnostic-summary-head");
  header.append(createElement("strong", "", "统一状态结论"));
  header.append(createElement("span", "", friendlySummaryMessage(unifiedState["summary.message"], status)));
  section.append(header);
  const chips = createElement("div", "diagnostic-chip-row");
  chips.append(createDiagnosticChip("状态", friendlySummaryTitle(unifiedState["summary.title"], status), normalizeTone(status)));
  chips.append(createDiagnosticChip(alertTotal ? "关注项" : "细节", attentionTotal, alertTotal ? "mismatch" : "applied"));
  chips.append(createDiagnosticChip("配置", displayValue(unifiedState["config.source"], "自动规则"), "applied"));
  chips.append(createDiagnosticChip("档位", modeLabel(currentRiskMode() || unifiedState["risk.mode"] || "safe"), "applied"));
  section.append(chips);
  const attention = createElement("div", "diagnostic-problems");
  for (let index = 1; index <= attentionTotal; index += 1) {
    const text = unifiedState[`summary.attention.${index}`];
    const level = unifiedState[`summary.attention.${index}.level`] || String(text || "").split("|")[0] || "info";
    const tone = level === "error" ? "failed" : level === "warning" || level === "warn" ? "mismatch" : "applied";
    if (text) attention.append(createElement("div", `diagnostic-problem ${tone}`, text));
  }
  if (attentionTotal) section.append(attention);
  return section;
}

function createRuleMatchSummary(unifiedState) {
  const rawStatus = displayValue(unifiedState["match.status"], "ok");
  const statusTone = normalizeTone(rawStatus);
  const section = createElement("section", "diagnostic-summary");
  const header = createElement("div", "diagnostic-summary-head");
  header.append(createElement("strong", "", "规则匹配"));
  header.append(createElement("span", "", `模式 ${displayValue(unifiedState["match.mode"], "rule-driven")} · 更新时间 ${displayValue(unifiedState["match.updated_at"])}`));
  section.append(header);
  const chips = createElement("div", "diagnostic-chip-row");
  chips.append(createDiagnosticChip("状态", rawStatus === "partial" || rawStatus === "fallback" ? "正常" : rawStatus, statusTone));
  chips.append(createDiagnosticChip("抓取", unifiedState["match.captured_total"] || 0, "applied"));
  chips.append(createDiagnosticChip("命中", unifiedState["match.matched_total"] || 0, "applied"));
  chips.append(createDiagnosticChip("默认补全", unifiedState["match.default_total"] || 0, "matched"));
  section.append(chips);
  return section;
}

function createConfigGenerationSummary(unifiedState) {
  const updatedAt = displayValue(unifiedState["config.updated_at"]);
  const status = displayValue(unifiedState["config.status"], "ok");
  const statusTone = normalizeTone(status);
  const section = createElement("section", "diagnostic-summary");
  const header = createElement("div", "diagnostic-summary-head");
  header.append(createElement("strong", "", "配置生成"));
  header.append(createElement("span", "", `来源 ${displayValue(unifiedState["config.source"], "自动规则")} · 更新时间 ${updatedAt}`));
  section.append(header);
  const chips = createElement("div", "diagnostic-chip-row");
  chips.append(createDiagnosticChip("状态", status === "ok" ? "正常" : status, statusTone));
  chips.append(createDiagnosticChip("prop 数", unifiedState["config.prop_count"] || 0, "applied"));
  chips.append(createDiagnosticChip("来源", displayValue(unifiedState["config.source"], "自动规则"), "matched"));
  chips.append(createDiagnosticChip("Hash", shortHash(unifiedState["config.prop_hash"]), "applied"));
  section.append(chips);
  return section;
}

function createIntegritySummary(integrityState, unifiedState) {
  const status = displayValue(integrityState.status || unifiedState["integrity.status"], "ok");
  const blockingMissing = Number(integrityState.blocking_missing_total || unifiedState["integrity.blocking_missing_total"] || 0);
  const blockingChanged = Number(integrityState.blocking_changed_total || unifiedState["integrity.blocking_changed_total"] || 0);
  const statusTone = status === "ok" || (["warning", "warn"].includes(status)) || (status === "missing" && !blockingMissing) || (status === "changed" && !blockingChanged)
    ? "applied"
    : status === "error" ? "failed" : "mismatch";
  const section = createElement("section", "diagnostic-summary");
  const header = createElement("div", "diagnostic-summary-head");
  header.append(createElement("strong", "", "完整性 / 防篡改"));
  header.append(createElement("span", "", `原因：${displayValue(integrityState.reason || unifiedState["integrity.reason"], "未发现关键文件异常")}`));
  section.append(header);
  const chips = createElement("div", "diagnostic-chip-row");
  chips.append(createDiagnosticChip("状态", status === "ok" ? "通过" : status, statusTone));
  chips.append(createDiagnosticChip("检查", integrityState.checked_total || unifiedState["integrity.checked_total"] || 0, "applied"));
  chips.append(createDiagnosticChip("缺失", integrityState.missing_total || unifiedState["integrity.missing_total"] || 0, blockingMissing ? "failed" : "applied"));
  chips.append(createDiagnosticChip("变更", integrityState.changed_total || unifiedState["integrity.changed_total"] || 0, blockingChanged ? "failed" : "applied"));
  section.append(chips);
  return section;
}

function createConflictBanner(conflictState) {
  const total = Number(conflictState.conflict_total || 0);
  const banner = createElement("div", `diagnostic-conflict-banner ${total > 0 ? "show" : "hide"}`);
  banner.textContent = total > 0 ? `检测到 ${total} 项属性冲突，请查看 conflict-report.txt` : "";
  return banner;
}

function createHealthLogSummary(healthState, conflictState) {
  const status = displayValue(healthState.status, "ok");
  const statusTone = status === "error" ? "failed" : "applied";
  const section = createElement("section", "diagnostic-summary");
  const header = createElement("div", "diagnostic-summary-head");
  header.append(createElement("strong", "", "自愈监控"));
  header.append(createElement("span", "", `健康 ${status === "ok" ? "正常" : status} · 冲突 ${conflictState.conflict_total || 0} 项`));
  section.append(header);
  const chips = createElement("div", "diagnostic-chip-row");
  chips.append(createDiagnosticChip("健康", status === "ok" ? "正常" : status, statusTone));
  chips.append(createDiagnosticChip("文件", displayValue(healthState.files_ok, "正常"), healthState.files_ok === "no" && status === "error" ? "failed" : "applied"));
  chips.append(createDiagnosticChip("属性", displayValue(healthState.props_ok, "正常"), healthState.props_ok === "no" && status === "error" ? "failed" : "applied"));
  chips.append(createDiagnosticChip("冲突", conflictState.conflict_total || 0, Number(conflictState.conflict_total || 0) > 0 ? "failed" : "applied"));
  section.append(chips);
  return section;
}

function createPropCompareSection(originalContent, systemContent) {
  const original = parseOriginalProps(originalContent || "");
  const current = parseActiveSystemProp(systemContent || "");
  const keys = [...new Set([...Object.keys(original), ...Object.keys(current)])].sort();
  const changed = keys.filter((key) => (original[key] || "<unset>") !== (current[key] || "<unset>"));
  const details = createElement("details", "diagnostic-summary prop-compare");
  details.open = false;
  const summary = createElement("summary", "diagnostic-summary-head");
  summary.append(createElement("strong", "", "属性差异"));
  summary.append(createElement("span", "", changed.length ? `${changed.length} 项差异` : "无差异"));
  details.append(summary);

  const stats = createElement("div", "prop-compare-stats");
  stats.append(createPropCompareStat("差异", changed.length));
  stats.append(createPropCompareStat("原始", Object.keys(original).length));
  stats.append(createPropCompareStat("生成", Object.keys(current).length));
  details.append(stats);

  if (!changed.length) {
    details.append(createElement("p", "prop-compare-empty", "当前生成配置与记录值没有发现差异。"));
    return details;
  }

  const list = createElement("div", "prop-compare-list");
  for (const key of changed.slice(0, 120)) {
    list.append(createPropCompareRow(key, original[key] || "<unset>", current[key] || "<unset>"));
  }
  if (changed.length > 120) {
    list.append(createElement("p", "prop-compare-empty", `其余 ${changed.length - 120} 项可在下方完整诊断文本中查看。`));
  }
  details.append(list);
  return details;
}

function createPropCompareStat(label, value) {
  const item = createElement("span", "prop-compare-stat");
  item.append(createElement("small", "", label));
  item.append(createElement("strong", "", String(value)));
  return item;
}

function createPropCompareRow(key, originalValue, currentValue) {
  const item = createElement("div", "prop-compare-row");
  item.append(createElement("strong", "prop-compare-key", key));
  const values = createElement("div", "prop-compare-values");
  values.append(createPropCompareValue("原始", originalValue));
  values.append(createPropCompareValue("生成", currentValue));
  item.append(values);
  return item;
}

function createPropCompareValue(label, value) {
  const item = createElement("span", "prop-compare-value");
  item.append(createElement("small", "", label));
  item.append(createElement("code", "", value));
  return item;
}

function parseOriginalProps(content) {
  const props = {};
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("@unset:")) {
      props[line.slice(7)] = "<unset>";
    } else {
      const index = line.indexOf("=");
      if (index > 0) props[line.slice(0, index)] = line.slice(index + 1);
    }
  }
  return props;
}

function createLifecycleStateSummary(installState, uninstallState) {
  const section = createElement("section", "diagnostic-summary");
  const header = createElement("div", "diagnostic-summary-head");
  const installStatus = installState.status || "未知";
  const uninstallStatus = uninstallState.status || "未记录";
  header.append(createElement("strong", "", "安装/卸载状态"));
  header.append(createElement("span", "", buildLifecycleDiagnosticText(installState, uninstallState)));
  section.append(header);

  const chips = createElement("div", "diagnostic-chip-row");
  chips.append(createDiagnosticChip("安装", installStatus, installStatus === "ok" ? "applied" : "mismatch"));
  chips.append(createDiagnosticChip("备份", installState.backup_ready || "未知", installState.backup_ready === "1" ? "applied" : "mismatch"));
  chips.append(createDiagnosticChip("卸载", uninstallStatus, uninstallStatus === "ok" ? "applied" : "mismatch"));
  chips.append(createDiagnosticChip("卸载失败", uninstallState.failed || "0", Number(uninstallState.failed || 0) ? "failed" : "applied"));
  section.append(chips);

  return section;
}

function buildLifecycleDiagnosticText(installState, uninstallState) {
  if (installState.status === "failed") {
    return `安装状态文件报告失败：${installState.reason || "未记录原因"}。`;
  }

  if (installState.status === "ok" && uninstallState.status === "ok") {
    return "安装和卸载状态都记录为 ok；若模块仍显示异常，请回传完整日志。";
  }

  if (installState.status === "ok") {
    return "安装状态已记录为 ok；未记录卸载状态属于正常运行中的模块。";
  }

  if (uninstallState.status) {
    return `已读取卸载状态：${uninstallState.status}，failed=${uninstallState.failed || 0}。`;
  }

  return "未读取到安装状态文件；请确认刷入包为最新构建并回传 install.log。";
}

function createRebootStateSummary(rebootState, passSummaries) {
  const section = createElement("section", "diagnostic-summary");
  const header = createElement("div", "diagnostic-summary-head");
  header.append(createElement("strong", "", "重启状态"));
  header.append(createElement("span", "", buildRebootDiagnosticText(rebootState, passSummaries)));
  section.append(header);

  const chips = createElement("div", "diagnostic-chip-row");
  const serviceTone = rebootState.status === "error" ? "failed" : "applied";
  const phaseTone = rebootState.phase === "settled" || !rebootState.phase ? "applied" : "matched";
  chips.append(createDiagnosticChip("服务", rebootState.status || "未知", serviceTone));
  chips.append(createDiagnosticChip("健康", rebootState.health || "未知", rebootState.health === "problem" ? "failed" : "applied"));
  chips.append(createDiagnosticChip("阶段", rebootState.phase || "未知", phaseTone));
  chips.append(createDiagnosticChip("异常", `${rebootState.failedTotal || 0}/${rebootState.mismatchTotal || 0}`, rebootState.failedTotal ? "failed" : "applied"));
  chips.append(createDiagnosticChip("已完成", rebootState.settledAt ? "已记录" : "未记录", rebootState.settledAt ? "applied" : "matched"));
  section.append(chips);

  return section;
}

function buildRebootDiagnosticText(rebootState, passSummaries) {
  const hasSettledPass = passSummaries.some((pass) => pass.phase === "settled");
  const problemTotal = (rebootState.failedTotal || 0) + (rebootState.mismatchTotal || 0);

  if (rebootState.status === "error" || rebootState.health === "problem") {
    return rebootState.reason
      ? `服务异常：${rebootState.reason}。`
      : "服务状态为异常；请检查 apply.log 与模块文件是否完整。";
  }

  if (rebootState.status === "skipped" || rebootState.health === "skipped") {
    return rebootState.reason
      ? `服务已跳过：${rebootState.reason}。`
      : "服务已跳过运行时属性应用；设备可能未匹配到可应用的运行时属性。";
  }

  if (problemTotal) {
    return `服务状态已记录 ${problemTotal} 项写入异常；请优先检查 apply.log 的 Failed/Mismatch。`;
  }

  if (rebootState.status === "settled" && rebootState.settledAt && hasSettledPass) {
    return "服务已完成 settled，若首页仍显示待重启或同步中，优先检查 config.json 的 pendingSavedAt 或管理器缓存。";
  }

  if (!rebootState.bootId && rebootState.status !== "settled") {
    return "未读到 boot_id，且服务未记录 settled；如果当前仍在同步或待重启，这通常是合理的。";
  }

  if (rebootState.status === "settled" && !rebootState.settledAt) {
    return "服务状态为 settled，但缺少 settled_at；建议重新刷入当前包后重启。";
  }

  if (!hasSettledPass) {
    return "apply.log 没有 settled 阶段；开机后需至少等待 3 分钟再判断。";
  }

  return "重启状态证据不完整；请回传完整诊断文本和 apply.log。";
}

function createFinalPropSummary(diagnosticState) {
  const section = createElement("section", "diagnostic-summary");
  const header = createElement("div", "diagnostic-summary-head");
  header.append(createElement("strong", "", "最终属性"));
  header.append(createElement("span", "", buildFinalPropDiagnosticText(diagnosticState)));
  section.append(header);

  const chips = createElement("div", "diagnostic-chip-row");
  chips.append(createDiagnosticChip("匹配", diagnosticState.matchedCount, "applied"));
  chips.append(createDiagnosticChip("后置覆盖", diagnosticState.postApplyOverrides.length, diagnosticState.postApplyOverrides.length ? "mismatch" : "applied"));
  chips.append(createDiagnosticChip("未解决", diagnosticState.unresolved.length, diagnosticState.unresolved.length ? "failed" : "applied"));
  chips.append(createDiagnosticChip("缺失", diagnosticState.missing.length, diagnosticState.missing.length ? "mismatch" : "applied"));
  section.append(chips);

  return section;
}

function buildFinalPropDiagnosticText(diagnosticState) {
  if (diagnosticState.unresolved.length || diagnosticState.missing.length) {
    return `${diagnosticState.unresolved.length + diagnosticState.missing.length} 项最终 getprop 仍未证明生效，需要结合完整 apply.log 继续查。`;
  }

  if (diagnosticState.postApplyOverrides.length) {
    return `${diagnosticState.postApplyOverrides.length} 项已由模块写入，但之后被系统改回；这是 ColorOS 后置覆盖，不等同于刷入失败。`;
  }

  return "最终 getprop 与当前 system.prop 启用项一致。";
}

function createApplyLogSummary({ groups, passSummaries, summary }, diagnosticState, rebootState) {
  const total = Object.values(groups).reduce((count, rows) => count + rows.length, 0);
  const section = createElement("section", "diagnostic-summary");

  const header = createElement("div", "diagnostic-summary-head");
  header.append(createElement("strong", "", "apply.log 摘要"));
  header.append(createElement("span", "", summary || (total ? `${total} 条记录` : "未读取到 apply.log 摘要")));
  section.append(header);
  section.append(createDiagnosticConclusion(groups, passSummaries, total, summary, diagnosticState, rebootState));

  const chips = createElement("div", "diagnostic-chip-row");
  chips.append(createDiagnosticChip("失败", groups.failed.length, "failed"));
  chips.append(createDiagnosticChip("未粘住", groups.mismatch.length, "mismatch"));
  chips.append(createDiagnosticChip("已应用", groups.applied.length, "applied"));
  chips.append(createDiagnosticChip("已匹配", groups.matched.length, "matched"));
  section.append(chips);

  const problems = [...groups.failed, ...groups.mismatch].slice(0, 8);
  if (problems.length) {
    const list = createElement("div", "diagnostic-problems");
    for (const entry of problems) {
      const item = createElement("div", `diagnostic-problem ${entry.status}`);
      item.append(createElement("strong", "", entry.prop));
      item.append(createElement("span", "", `${entry.status}${entry.phase ? ` · phase=${entry.phase}` : ""} · desired=${entry.desired} · new=${entry.newValue || "<empty>"} · ${entry.tool}`));
      list.append(item);
    }
    section.append(list);
  }

  const finalProblems = [...diagnosticState.postApplyOverrides, ...diagnosticState.unresolved, ...diagnosticState.missing].slice(0, 8);
  if (finalProblems.length) {
    const list = createElement("div", "diagnostic-problems");
    for (const entry of finalProblems) {
      const item = createElement("div", "diagnostic-problem mismatch");
      item.append(createElement("strong", "", entry.prop));
      item.append(createElement("span", "", `expected=${entry.expected} 路 final=${entry.actual || "<missing>"}`));
      list.append(item);
    }
    section.append(list);
  }

  return section;
}

function createDiagnosticConclusion(groups, passSummaries, total, summary, diagnosticState, rebootState) {
  const failed = groups.failed.length;
  const mismatch = groups.mismatch.length;
  const hasSettled = passSummaries.some((pass) => pass.phase === "settled");
  const latestPass = passSummaries[passSummaries.length - 1];
  const conclusion = createElement("div", "diagnostic-conclusion");
  let tone = "mismatch";
  let title = "等待开机应用";
  let detail = "没有读取到 apply.log 记录，暂时不能证明模块服务已在开机后运行。";

  if (rebootState.status === "error") {
    tone = "failed";
    title = "服务异常";
    detail = rebootState.reason
      ? `service-state 报告服务异常：${rebootState.reason}。`
      : "service-state 报告服务异常；请检查模块文件和 apply.log。";
  } else if (rebootState.status === "skipped") {
    tone = "mismatch";
    title = "运行时应用已跳过";
    detail = rebootState.reason
      ? `service-state 报告已跳过运行时应用：${rebootState.reason}。`
        : "service-state 报告已跳过运行时应用；设备可能未匹配到可应用的运行时属性。";
  } else if (total || summary) {
    if (failed || mismatch) {
      tone = "failed";
      title = "应用存在异常";
      detail = `${failed + mismatch} 项写入失败或未粘住，优先查看下方问题列表。`;
    } else if (!hasSettled) {
      tone = "mismatch";
      title = "等待 settled 阶段";
      detail = "apply.log 存在，但没有 settled 阶段；请确认已刷入最新包并开机等待至少 3 分钟。";
    } else if (diagnosticState.postApplyOverrides.length && !diagnosticState.unresolved.length && !diagnosticState.missing.length) {
      tone = "mismatch";
      title = "系统后置覆盖";
      detail = `apply.log 已写入成功，但 ${diagnosticState.postApplyOverrides.length} 项最终 getprop 被系统后置覆盖。`;
    } else if (diagnosticState.mismatches.length || diagnosticState.missing.length) {
      tone = "mismatch";
      title = "需要进一步确认";
      detail = `${diagnosticState.mismatches.length + diagnosticState.missing.length} 项最终 getprop 与 system.prop 不一致，需要回传完整诊断。`;
    } else {
      tone = "applied";
      title = "应用正常";
      detail = "initial/recheck/settled 均已记录，system.prop 启用项与最终 getprop 一致，且 apply.log 未发现失败项。";
    }
  }

  conclusion.classList.add(tone);
  conclusion.append(createElement("strong", "", title));
  conclusion.append(createElement("span", "", latestPass ? `${detail} 最新阶段：${latestPass.phase}` : detail));
  return conclusion;
}

function createDiagnosticChip(label, value, tone) {
  const chip = createElement("span", `diagnostic-chip ${tone}`);
  chip.append(createElement("strong", "", String(value)));
  chip.append(createElement("small", "", label));
  return chip;
}

function closeDialog(dialog) {
  if (!dialog || dialog.classList.contains("is-closing")) return;
  dialog.classList.add("is-closing");
  setTimeout(() => dialog.remove(), 220);
}

function showDialog(title, content, beforeContent, options = {}) {
  const dialog = createElement("div", "dialog");
  if (options.className) dialog.classList.add(options.className);
  const saveButton = options.savePath ? '<button class="text-button" data-action="save">保存</button>' : "";
  dialog.innerHTML = `
    <div class="dialog-panel">
      <div class="section-title">
        <h2>${escapeHtml(title)}</h2>
        <div class="dialog-actions">
          ${saveButton}
          <button class="text-button" data-action="copy">${escapeHtml(options.copyLabel || "复制")}</button>
          <button class="text-button" data-action="close">关闭</button>
        </div>
      </div>
      <pre></pre>
    </div>
  `;
  if (beforeContent) {
    dialog.querySelector("pre").before(beforeContent);
  }
  const pre = dialog.querySelector("pre");
  pre.textContent = String(content || "");
  dialog.querySelector('[data-action="close"]').addEventListener("click", () => closeDialog(dialog));
  dialog.querySelector('[data-action="copy"]').addEventListener("click", () => copyDialogContent(content, pre));
  dialog.querySelector('[data-action="save"]')?.addEventListener("click", (event) => saveDialogContent(content, options.savePath, event.currentTarget));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog && options.closeOnBackdrop === true) closeDialog(dialog);
  });
  document.body.append(dialog);
}

async function saveDialogContent(content, savePath, button = null) {
  if (button?.disabled) return;
  if (button) {
    button.disabled = true;
    button.classList.add("is-busy");
  }
  try {
    const result = await writeBase64(savePath, content);
    if (result.code === 0) {
      setStatus(`已保存到 ${savePath}`, "ok");
      showToast(`已保存到 ${savePath}`, "ok");
    } else {
      const message = `保存失败：${result.stderr || result.stdout || result.code}`;
      setStatus(message, "warn");
      showToast(message, "warn");
    }
  } catch (error) {
    const message = `保存失败：${error.message || error}`;
    setStatus(message, "warn");
    showToast(message, "warn");
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove("is-busy");
    }
  }
}

async function copyDialogContent(content, pre) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(content);
      setStatus("内容已复制", "ok");
      showToast("内容已复制", "ok");
      return;
    }
  } catch {
    // Fall back to selecting the text so WebUI hosts without clipboard support remain usable.
  }

  const range = document.createRange();
  range.selectNodeContents(pre);
  const selection = globalThis.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  setStatus("已选中文本，请手动复制", "warn");
  showToast("已选中文本，请手动复制", "warn");
}

function setupRebootMenu() {
  const button = $("#rebootButton");
  const menu = $("#rebootMenu");
  if (!button || !menu) return;

  const close = () => closeRebootMenu(button, menu);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (button.getAttribute("aria-expanded") === "true") {
      close();
    } else {
      openRebootMenu(button, menu);
    }
  });

  menu.addEventListener("click", async (event) => {
    const item = event.target?.closest?.("[data-reboot-action]");
    if (!item) return;
    event.stopPropagation();
    const action = item.dataset.rebootAction;
    close();
    try {
      await rebootDevice(action);
    } catch (error) {
      setStatus(`重启命令失败：${error.message || error}`, "warn");
    }
  });
  menu.addEventListener("keydown", (event) => {
    const items = Array.from(menu.querySelectorAll("[data-reboot-action]"));
    const current = Math.max(0, items.indexOf(document.activeElement));
    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(current + 1) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(current - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  });

  document.addEventListener("click", (event) => {
    if (menu.hidden || button.contains(event.target) || menu.contains(event.target)) return;
    close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
  globalThis.addEventListener?.("resize", () => {
    if (button.getAttribute("aria-expanded") === "true") positionRebootMenu(button, menu);
  });
}

function openRebootMenu(button, menu) {
  positionRebootMenu(button, menu);
  menu.hidden = false;
  button.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => {
    menu.classList.add("is-open");
    menu.querySelector("[data-reboot-action]")?.focus();
  });
}

function closeRebootMenu(button = $("#rebootButton"), menu = $("#rebootMenu")) {
  if (!button || !menu || menu.hidden) return;
  button.setAttribute("aria-expanded", "false");
  menu.classList.remove("is-open");
  setTimeout(() => {
    if (!menu.classList.contains("is-open")) menu.hidden = true;
  }, 210);
}

function positionRebootMenu(button, menu) {
  const rect = button.getBoundingClientRect();
  const width = Math.max(196, menu.offsetWidth || 196);
  const margin = 12;
  const left = Math.min(globalThis.innerWidth - width - margin, Math.max(margin, rect.right - width));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(rect.bottom + 8)}px`;
  menu.style.minWidth = `${Math.round(width)}px`;
}

async function rebootDevice(mode = "normal") {
  const rebootMode = rebootModes[mode] || rebootModes.normal;
  const ok = await showConfirm(rebootMode.confirm);
  if (!ok) return;
  setStatus(rebootMode.pending);
  const result = await exec(rebootMode.command);
  if (result.code !== 0) {
    setStatus(`${rebootMode.label}失败：${resultMessage(result)}`, "warn");
  }
}

async function openUrl(url) {
  if (!url) {
    setStatus("链接还没有填写", "warn");
    return;
  }
  let quotedUrl;
  try {
    quotedUrl = commandUrl(url);
  } catch (error) {
    setStatus(`链接无效：${error.message}`, "warn");
    return;
  }

  const result = await exec(`am start -a android.intent.action.VIEW -d ${quotedUrl}`);
  if (result.code !== 0) {
    console.warn(`[dex2oat] openUrl failed: ${result.stderr || result.stdout}`);
    const message = `打开链接失败：${resultMessage(result)}`;
    setStatus(message, "warn");
    showToast(message, "warn");
  }
}

async function start() {
  const bootStartedAt = Date.now();
  const minimumBoot = delay(BOOT_SCREEN_MIN_MS);
  applyBootLogo();
  const [meta, unifiedState] = await Promise.all([loadMeta(), loadUnifiedState()]);
  state.meta = meta;
  state.unifiedState = unifiedState;
  const [device, configSource, health, systemInfo] = await Promise.all([
    loadDeviceState(),
    loadConfigSource(),
    loadHealthState(),
    readSystemInfo()
  ]);
  state.device = device;
  state.configSource = configSource;
  state.health = health;
  state.systemInfo = systemInfo;
  state.options = await loadOptions();
  state.matchedProps = await loadMatchedProps();
  state.config = await loadUserConfig(state.options);
  syncRiskMode(currentRiskMode());
  await loadSupporterInstallId();
  await loadUnlockedSkins();
  await applySelectedSkin();
  renderShell({ keepBoot: true });
  setPage("home");
  await nextFrame();
  const remainingBootMs = Math.max(0, BOOT_SCREEN_MIN_MS - (Date.now() - bootStartedAt));
  if (remainingBootMs) await minimumBoot;
  const app = $("#app");
  app?.classList.remove("is-booting", "is-preparing-shell");
  app?.classList.add("is-boot-leaving", "is-shell-entering");
  await delay(BOOT_EXIT_MS);
  $("#bootScreen")?.remove();
  app?.classList.remove("is-boot-leaving", "is-shell-entering");
  setStatus("已同步", "ok");
  void submitTelemetry();
}

// Failsafe: if boot state remains after the page is already populated, clear it without changing the normal path.
globalThis.addEventListener?.("DOMContentLoaded", () => {
  setTimeout(() => {
    const app = $("#app");
    const boot = $("#bootScreen");
    if (app && boot && app.classList.contains("is-booting") && !document.querySelector(".dialog")) {
      app.classList.remove("is-booting", "is-preparing-shell");
      app.classList.add("is-boot-leaving", "is-shell-entering");
      setTimeout(() => {
        boot.remove();
        app.classList.remove("is-boot-leaving", "is-shell-entering");
      }, BOOT_EXIT_MS);
    }
  }, BOOT_SCREEN_MIN_MS + 300);
});

globalThis.addEventListener?.("error", (event) => {
  reportUiError(event.error || event.message, "WebUI");
});

globalThis.addEventListener?.("unhandledrejection", (event) => {
  reportUiError(event.reason, "异步任务");
});

try {
  initTheme();
} catch (error) {
  console.warn(`[dex2oat] theme init failed: ${error.message}`);
}

start().catch((error) => {
  const app = $("#app");
  if (app) {
    app.innerHTML = "";
    const screen = createElement("main", "boot-screen");
    screen.append(createElement("h1", "", "Dex2oat Lock"));
    screen.append(createElement("p", "", `WebUI 初始化失败：${error.message}`));
    app.append(screen);
  }
});
