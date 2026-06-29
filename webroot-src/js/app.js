import { MODULE_DIR, STATE_DIR, exec, readText, writeBase64 } from "./bridge.js";
import { countChanged, countEnabled, countHighRiskEnabled, decodeProtectedBytes, decodeProtectedText, loadJson, loadUserConfig, mergeConfig, readGeneratedSystemProp, saveConfig } from "./config.js";
import { readSystemInfo } from "./system-info.js";
import { $, createElement, metric, setStatus, showConfirm } from "./ui.js";
import { shellQuote, resultMessage, parseKeyValueLines, parseStateFile } from "./utils.js";
import { MATERIAL_YOU_THEMES, applyMaterialTheme, getMaterialTheme, initTheme } from "./m3-theme.js";
import { applyBrandPillLogo, createBrandPillMarkup, setBrandPillVersion } from "./brand-pill.js";

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
  agreementChallenge: null,
  agreementReadyAt: 0,
  agreementTimer: null,
  customSearch: "",
  customDraftDirty: false
};

const RISK_AGREEMENT_VERSION = 2;
const RISK_WAIT_SECONDS = 30;
const CONFIG_BACKUP_PATH = "/storage/emulated/0/Download/dex2oat-lock-config-backup.json";
const DIAGNOSTIC_EXPORT_PATH = `${STATE_DIR}/dex2oat-lock-diagnostic.txt`;
const BACKGROUND_STORAGE_KEY = "dex2oat-lock.background.v1";
const TOPBAR_LOGO_STORAGE_KEY = "dex2oat-lock.topbar.logo.v1";
const CARD_OPACITY_STORAGE_KEY = "dex2oat-lock.card.opacity.v1";
const CARD_BLUR_STORAGE_KEY = "dex2oat-lock.card.blur.v1";
const TELEMETRY_ENABLED_STORAGE_KEY = "dex2oat-lock.telemetry.enabled.v1";
const TELEMETRY_INSTALL_ID_STORAGE_KEY = "dex2oat-lock.telemetry.install-id.v1";
const TELEMETRY_LAST_SENT_STORAGE_KEY = "dex2oat-lock.telemetry.last-sent.v1";
const RULE_EVIDENCE_LAST_SENT_STORAGE_KEY = "dex2oat-lock.rule-evidence.last-sent.v1";
const LEGACY_BACKGROUND_OPACITY_STORAGE_KEY = "dex2oat-lock.background.opacity.v1";
const BONUS_TEXT_PATH = "";
const BONUS_ART_PATH = "";
const BACKGROUND_MAX_SIZE = 1600;
const TOPBAR_LOGO_MAX_SIZE = 512;
const BACKGROUND_JPEG_QUALITY = 0.82;
const TOPBAR_LOGO_JPEG_QUALITY = 0.88;
const CARD_DEFAULT_OPACITY = 0.94;
const CARD_DEFAULT_BLUR = 0;
const BOOT_SCREEN_MIN_MS = 3000;
const BOOT_EXIT_MS = 680;
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
let telemetryInFlight = null;
let ruleEvidenceInFlight = null;
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
  prop: { name: "data_object", fallback: "{}", path: "M8 7 4 12l4 5 1.5-1.3L6.6 12l2.9-3.7L8 7Zm8 0-1.5 1.3 2.9 3.7-2.9 3.7L16 17l4-5-4-5Zm-4.3 11 2.6-12h-2l-2.6 12h2Z" },
  edit: { name: "edit", fallback: "✎", path: "M5 17.3V21h3.7L18.9 10.8l-3.7-3.7L5 17.3ZM20.7 8.9a1 1 0 0 0 0-1.4l-2.2-2.2a1 1 0 0 0-1.4 0l-1.2 1.2 3.7 3.7 1.1-1.3Z" },
  sync: { name: "sync", fallback: "↻", path: "M7.1 7.1A7 7 0 0 1 19 12h-2.2a4.8 4.8 0 0 0-8.2-3.4L11 11H5V5l2.1 2.1ZM17 16.9A7 7 0 0 1 5 12h2.2a4.8 4.8 0 0 0 8.2 3.4L13 13h6v6l-2-2.1Z" },
  refresh: { name: "refresh", fallback: "⟳", path: "M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h8V3l-3.3 3.3Z" },
  safe: { name: "verified_user", fallback: "✓", path: "M12 3 5 6v5c0 4.4 2.9 8.4 7 10 4.1-1.6 7-5.6 7-10V6l-7-3Zm-1 12.5-3-3 1.4-1.4 1.6 1.6 4-4 1.4 1.4-5.4 5.4Z" },
  caution: { name: "rule_settings", fallback: "!", path: "M4 7h10M18 7h2M14 7a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM4 17h2M10 17h10M6 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z" },
  aggressive: { name: "warning", fallback: "!", path: "M12 3 22 20H2L12 3Zm-1 6v5h2V9h-2Zm0 7v2h2v-2h-2Z" }
};
const riskModes = {
  safe: {
    label: "安全",
    title: "安全模式",
    description: "优先展示低风险配置，适合日常长期使用。",
    suitableFor: "日常使用、稳定优先、首次安装后观察状态。",
    impact: "主要压制后台 dexopt、预读和厂商私有触发项，尽量降低发热、耗电和后台 I/O。",
    caution: "通常不改变全局编译强度；如果追求极限性能，需要切到更高档位逐项确认。",
    tooltip: "安全：低风险、长期启用优先，主要减少后台编译负载。",
    categories: ["safe"]
  },
  caution: {
    label: "谨慎",
    title: "谨慎模式",
    description: "加入高级 ART / dex2oat 调优项，保存前需要确认配置影响。",
    suitableFor: "知道 dex2oat filter、线程、JIT、profile 含义的进阶用户。",
    impact: "会展示全局编译强度、编译线程、CPU 绑定、JIT/profile 与 runtime/device_config 项。",
    caution: "可能改变安装耗时、后台维护负载、发热和部分 ROM 的调度行为，建议逐项启用后重启验证。",
    tooltip: "谨慎：进阶调优项，可能影响编译耗时、发热和 ROM 调度。",
    categories: ["caution"]
  },
  aggressive: {
    label: "危险",
    title: "危险模式",
    description: "展示更激进的配置项，可能影响性能、功耗、兼容性或系统稳定性。",
    suitableFor: "愿意承担高编译量、高耗时和兼容性变化的测试用户。",
    impact: "会展示全量 AOT、ART Service/JIT、堆参数、ISA、GC、runtime 深层开关等进阶项。",
    caution: "可能导致安装明显变慢、发热升高、空间占用增加、应用兼容异常或系统维护任务异常。",
    tooltip: "危险：测试向配置，可能影响稳定性、功耗、安装速度和兼容性。",
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

function parseModuleProp(content) {
  const result = {};
  for (const entry of parseKeyValueLines(content)) {
    result[entry.prop] = entry.value;
  }
  return result;
}

function commandUrl(value) {
  const url = new URL(String(value || ""));
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("unsupported URL protocol");
  }

  return shellQuote(url.href);
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
  if (["warning", "warn", "missing", "changed", "pending"].includes(value)) return "mismatch";
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
    cloudBaseUrl: meta.cloudBaseUrl || "",
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

async function loadOptionsForDevice(device) {
  return loadJson("./data/options.json", { categories: [] });
}

async function loadUnifiedState() {
  return parseStateFile(await readText(`${STATE_DIR}/state.prop`));
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
          powerTitle: "重启"
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
  page.classList.remove("is-transitioning");
  void page.offsetWidth;
  page.classList.add("is-transitioning");
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
  setStatus("已打开隐藏彩蛋", "ok");
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
    applyTopbarLogo(customLogo);
    return;
  }
  if (!homeLogoUrl) homeLogoUrl = protectedImageUrl(globalThis.__DEX2OAT_WEBUI_DATA?.g);
  applyTopbarLogo(homeLogoUrl);
}

function applyTopbarLogo(value) {
  applyBrandPillLogo("#topBrandPill", value);
}

function readCustomTopbarLogo() {
  try {
    return globalThis.localStorage?.getItem(TOPBAR_LOGO_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function saveCustomTopbarLogo(value) {
  try {
    if (value) {
      globalThis.localStorage?.setItem(TOPBAR_LOGO_STORAGE_KEY, value);
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
  const htmlIconUrl = protectedImageUrl(globalThis.__DEX2OAT_WEBUI_DATA?.h, logo.getAttribute("src") || "");
  if (htmlIconUrl) logo.src = htmlIconUrl;
}

function parseBonusMeta(lyrics) {
  if (bonusMeta) return bonusMeta;
  const firstLine = String(lyrics || "").split(/\r?\n/).find((line) => line.trim()) || "隐藏曲目";
  const parts = firstLine.split(/\s*-\s*/);
  bonusMeta = {
    title: parts[0]?.trim() || "隐藏曲目",
    artist: parts.slice(1).join(" - ").trim() || "Dex2oat Lock"
  };
  return bonusMeta;
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
  showDialog("隐藏彩蛋", lyrics, createBonusHeader(lyrics), {
    className: "bonus-dialog",
    copyLabel: "复制歌词"
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
    if (value) applyCustomBackground(value);
    applyCardOpacity(readCardOpacity());
    applyCardBlur(readCardBlur());
  } catch {
    // Some WebUI hosts disable localStorage; the default theme remains unchanged.
  }
}

function applyCustomBackground(value) {
  if (!value) {
    document.body.classList.remove("has-custom-background");
    document.documentElement.style.removeProperty("--custom-bg-image");
    return;
  }
  document.body.classList.add("has-custom-background");
  document.documentElement.style.setProperty("--custom-bg-image", `url("${String(value).replace(/"/g, '\\"')}")`);
  applyCardOpacity(readCardOpacity());
}

function saveCustomBackground(value) {
  try {
    if (value) {
      globalThis.localStorage?.setItem(BACKGROUND_STORAGE_KEY, value);
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
    } catch (error) {
      setStatus(`背景重置失败：${error.message}`, "warn");
    }
  });
  const resetLogo = createButton("恢复默认 Logo", "wide-button", () => {
    try {
      saveCustomTopbarLogo("");
      applyTopbarLogo(homeLogoUrl || protectedImageUrl(globalThis.__DEX2OAT_WEBUI_DATA?.g));
      setStatus("已恢复默认 Logo", "ok");
    } catch (error) {
      setStatus(`Logo 重置失败：${error.message}`, "warn");
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
  section.append(createElement("p", "save-hint", "背景图会压缩后保存在当前 WebView 本地；透明度和模糊只作用于内容卡片背景，文字保持清晰。"));
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
    throw new Error("当前 WebView 不允许保存通信开关");
  }
}

function createTelemetryPanel() {
  const section = createSection("模块通信", "可关闭");
  section.classList.add("about-section", "telemetry-panel");
  const row = createElement("div", "telemetry-toggle-row");
  const copy = createElement("div", "telemetry-copy");
  copy.append(createElement("strong", "", "允许模块与云端服务通信"));
  copy.append(createElement("span", "", "用于更新检查、规则证据同步和兼容性改进；不上传日志、应用列表、账号或设备唯一标识。"));
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
        setStatus("模块通信已开启", "ok");
        void submitTelemetry({ force: true });
      } else {
        setStatus("模块通信已关闭", "ok");
      }
    } catch (error) {
      input.checked = !input.checked;
      setStatus(`通信设置失败：${error.message}`, "warn");
    }
  });
  row.append(copy, toggle);
  const actions = createElement("div", "backup-action-row");
  actions.append(createButton("立即同步一次", "wide-button", () => submitTelemetry({ force: true, userVisible: true })));
  const evidence = createElement("div", "rule-evidence-row");
  const evidenceCopy = createElement("div", "telemetry-copy");
  evidenceCopy.append(createElement("strong", "", "上传规则证据"));
  evidenceCopy.append(createElement("span", "", "手动上传脱敏后的 ART / dexopt / ROM 属性样本，用于扩展规则库；不会上传完整日志、应用列表或个人标识。"));
  evidence.append(evidenceCopy, createButton("上传规则证据", "wide-button", submitRuleEvidence));
  section.append(row, actions, evidence, createElement("p", "save-hint", "模块通信保持可控；规则证据仅在你手动确认后上传。"));
  return section;
}

function cloudBaseUrl() {
  return String(state.meta?.cloudBaseUrl || "").replace(/\/+$/, "");
}

function telemetryEndpoint() {
  const base = cloudBaseUrl();
  return base ? `${base}/api/telemetry` : "";
}

function ruleEvidenceEndpoint() {
  const base = cloudBaseUrl();
  return base ? `${base}/api/rule-evidence` : "";
}

function fetchWithTimeout(url, options = {}, timeoutMs = CLOUD_REQUEST_TIMEOUT_MS) {
  if (typeof fetch !== "function") return Promise.reject(new Error("当前 WebView 不支持网络请求"));

  let timer = null;
  let controller = null;
  const requestOptions = { ...options };
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (controller) {
        try {
          controller.abort();
        } catch {
          // Older WebView hosts may expose a partial AbortController.
        }
      }
      reject(new Error("网络请求超时"));
    }, timeoutMs);
  });

  if (typeof AbortController === "function") {
    controller = new AbortController();
    requestOptions.signal = controller.signal;
  }

  return Promise.race([fetch(url, requestOptions), timeoutPromise]).then(
    (response) => {
      if (timer) clearTimeout(timer);
      return response;
    },
    (error) => {
      if (timer) clearTimeout(timer);
      throw error;
    }
  );
}

function shouldSubmitTelemetry(force = false) {
  if (!isTelemetryEnabled()) return false;
  if (force) return true;
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
  const installId = getOrCreateTelemetryInstallId();
  return {
    installHash: hashTelemetryId(installId),
    moduleVersion: state.meta?.version || "",
    versionCode: Number(state.meta?.versionCode || 0),
    deviceModel: state.systemInfo?.model || state.device?.["ro.product.model"] || "",
    manufacturer: state.systemInfo?.manufacturer || state.device?.["ro.product.manufacturer"] || "",
    brand: state.systemInfo?.brand || state.device?.["ro.product.brand"] || "",
    androidVersion: state.systemInfo?.android || state.device?.["ro.build.version.release"] || "",
    sdk: Number(state.systemInfo?.sdk || state.device?.["ro.build.version.sdk"] || 0),
    manager: state.systemInfo?.root || "",
    kernelVersion: state.systemInfo?.kernel || "",
    webviewVersion: detectWebViewVersion(),
    locale: navigator.language || "",
    timezone: String(new Date().getTimezoneOffset()),
    ruleMode: state.config?.riskMode || "safe",
    rulesVersion: state.options?.rulesVersion || state.meta?.version || "",
    installSource: "webui"
  };
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
  const installId = getOrCreateTelemetryInstallId();
  const props = parseCapturedProps(capturedContent);
  return {
    installHash: hashTelemetryId(installId),
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
    ruleMode: state.config?.riskMode || "safe",
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
      if (userVisible) setStatus("正在同步模块通信...");
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
      if (userVisible) setStatus("模块通信已同步", "ok");
      return true;
    } catch (error) {
      if (userVisible) setStatus(`模块通信失败：${error.message}`, "warn");
      return false;
    } finally {
      telemetryInFlight = null;
    }
  })();
  return telemetryInFlight;
}

async function refreshCapturedPropsForEvidence() {
  const result = await exec(`sh ${shellQuote(`${MODULE_DIR}/scripts/capture-props.sh`)} ${shellQuote(`${STATE_DIR}/captured-props.txt`)} ""`);
  if (result.code !== 0) {
    throw new Error(resultMessage(result));
  }
  return readText(`${STATE_DIR}/captured-props.txt`);
}

async function submitRuleEvidence() {
  const endpoint = ruleEvidenceEndpoint();
  if (!endpoint || typeof fetch !== "function") {
    setStatus("当前环境暂不支持规则证据上传", "warn");
    return false;
  }
  if (ruleEvidenceInFlight) return ruleEvidenceInFlight;

  const confirmed = await showConfirm("将上传脱敏后的 ART / dexopt / ROM 相关属性样本，用于扩展规则库；不会上传完整日志、应用列表、账号或设备唯一标识。确定继续吗？");
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
        throw new Error(data.error || data.message || `HTTP ${response.status}`);
      }
      try {
        globalThis.localStorage?.setItem(RULE_EVIDENCE_LAST_SENT_STORAGE_KEY, String(Date.now()));
      } catch {
        // Evidence upload is user initiated and remains best-effort.
      }
      setStatus(`规则证据已上传：${data.acceptedProps || payload.capturedTotal} 项`, "ok");
      return true;
    } catch (error) {
      setStatus(`规则证据上传失败：${error.message}`, "warn");
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
  if (!/^image\//.test(file.type || "")) {
    setStatus("请选择图片文件", "warn");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    setStatus("图片过大，建议选择 8MB 以内的背景", "warn");
    return;
  }
  if (typeof FileReader !== "function") {
    setStatus("当前 WebView 不支持相册读取", "warn");
    return;
  }
  setStatus("正在处理背景图...");
  try {
    const original = await readFileDataUrl(file);
    const value = await compressBackgroundImage(original);
    saveCustomBackground(value);
    applyCustomBackground(value);
    setStatus("背景图已更新", "ok");
  } catch (error) {
    setStatus(`背景保存失败：${error.message}`, "warn");
  }
}

async function handleTopbarLogoFile(file) {
  if (!file) return;
  if (!/^image\//.test(file.type || "")) {
    setStatus("请选择图片文件", "warn");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    setStatus("图片过大，建议选择 8MB 以内的 Logo", "warn");
    return;
  }
  if (typeof FileReader !== "function") {
    setStatus("当前 WebView 不支持相册读取", "warn");
    return;
  }
  setStatus("正在处理左上角 Logo...");
  try {
    const original = await readFileDataUrl(file);
    const value = await compressTopbarLogoImage(original);
    saveCustomTopbarLogo(value);
    applyTopbarLogo(value);
    setStatus("左上角 Logo 已更新", "ok");
  } catch (error) {
    setStatus(`Logo 保存失败：${error.message}`, "warn");
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
    if (conflictTotal) items.push({ level: "warning", message: `检测到 ${conflictTotal} 项模块间属性冲突` });
    if (failedTotal) items.push({ level: "error", message: `运行时应用失败 ${failedTotal} 项` });
    if (state.health?.status === "error") items.push({ level: "error", message: `健康检查异常：${state.health.status}` });
  }
  return items;
}

function currentSummary() {
  const rawStatus = state.unifiedState?.["summary.status"] || (buildAttentionItems().length ? "warning" : "ok");
  const rebootState = state.config.rebootState || {};
  const isPendingReboot = rebootState.label === "待重启";
  const status = isPendingReboot ? "pending" : ["partial", "fallback"].includes(rawStatus) ? "ok" : rawStatus;
  const legacyTitleKey = String(state.unifiedState?.["summary.title"] || "").toLowerCase().replace(/\s+/g, "-");
  const hasLegacyRuleTitle = legacyTitleKey === ["partial", "rule", "match"].join("-")
    || legacyTitleKey === ["fallback", "strategy"].join("-");
  const labels = {
    ok: "Dex2oat-Lock",
    warning: "存在警告",
    error: "需要处理",
    pending: "待重启",
    recovery: "恢复中"
  };
  const rawTitle = state.unifiedState?.["summary.title"] || "";
  const rawMessage = state.unifiedState?.["summary.message"] || "";
  const translatedTitle = friendlySummaryTitle(rawTitle || labels[status], status);
  const translatedMessage = friendlySummaryMessage(rawMessage, status);
  const title = isPendingReboot
    ? "待重启"
    : ["partial", "fallback"].includes(rawStatus) || hasLegacyRuleTitle
      ? "Dex2oat-Lock"
      : translatedTitle;
  const message = isPendingReboot
    ? (rebootState.reason || "配置已保存，重启后完成应用。")
    : ["partial", "fallback"].includes(rawStatus) || /conservative defaults|safe defaults/i.test(rawMessage)
    ? ""
    : translatedMessage;
  return {
    status,
    title,
    message,
    tone: status === "error" ? "is-error" : status === "ok" ? "is-working" : status === "recovery" ? "is-recovery" : "is-warn"
  };
}

function createStatusCard() {
  const rebootState = state.config.rebootState || {};
  const summary = currentSummary();
  const chips = buildStatusChips(summary, rebootState);
  const installPercent = normalizedInstallPercent();
  const message = hasDisplayValue(summary.message) ? summary.message : "";
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

  if (summary.status === "pending") chips.push({ label: "待重启", tone: "chip-warn" });
  if (summary.status === "error") chips.push({ label: "需要查看", tone: "chip-error" });
  if (installPercent && installPercent < 100) chips.push({ label: `安装 ${installPercent}%`, tone: "chip-warn" });
  if (failedTotal || mismatchTotal) chips.push({ label: `应用异常 ${failedTotal + mismatchTotal} 项`, tone: "chip-error" });
  if (conflictTotal) chips.push({ label: `冲突 ${conflictTotal} 项`, tone: "chip-error" });
  return chips;
}

function createAttentionSection() {
  const items = buildAttentionItems();
  if (!items.length) return null;
  const section = createSection("需要关注", items.length ? `${items.length} 项` : "无异常置顶");
  section.classList.add(items.length ? "attention-section" : "attention-section", items.length ? "has-items" : "is-empty");
  const list = createElement("div", "attention-list m3-list");
  for (const item of items) {
    list.append(createElement("div", `attention-item m3-list-item ${item.level === "error" ? "error" : item.level === "info" ? "info" : "warn"}`, item.message));
  }
  section.append(list);
  return section;
}

function createSummaryBand() {
  const summary = createElement("section", "summary-band");
  summary.append(metric("设备", displayValue(state.device?.["ro.product.model"])));
  summary.append(metric("系统", displayValue(state.device?.["ro.build.version.release"])));
  const configSummary = metric("配置摘要", shortHash(state.configSource?.prop_hash));
  configSummary.classList.add("metric-button");
  configSummary.tabIndex = 0;
  configSummary.setAttribute("role", "button");
  configSummary.addEventListener("click", showConfigSummaryDialog);
  configSummary.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      showConfigSummaryDialog();
    }
  });
  summary.append(configSummary);
  return summary;
}

function showConfigSummaryDialog() {
  const rows = [
    ["配置来源", sourceLabel(state.configSource)],
    ["生成状态", displayValue(state.unifiedState?.["config.status"], "正常")],
    ["生成原因", displayValue(state.unifiedState?.["config.reason"] || state.configSource?.reason, "自动规则")],
    ["最终 prop 数", state.configSource?.prop_count || state.unifiedState?.["config.prop_count"] || "0"],
    ["完整 Hash", state.configSource?.prop_hash || state.unifiedState?.["config.prop_hash"] || "暂不可用"],
    ["匹配状态", `${displayValue(state.unifiedState?.["match.status"], "正常")} · ${state.unifiedState?.["match.matched_total"] || 0} 项`],
    ["抓取数量", state.unifiedState?.["match.captured_total"] || "0"],
    ["默认数量", state.unifiedState?.["match.default_total"] || "0"],
    ["未命中", state.unifiedState?.["match.unmatched_total"] || "0"],
    ["更新时间", state.configSource?.updated_at || state.unifiedState?.["config.updated_at"] || "暂不可用"]
  ];
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
  return (riskModes[mode] || riskModes.safe).label;
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
  const rawStatus = state.unifiedState?.["match.status"] || "pending";
  const matchStatus = ["partial", "fallback"].includes(rawStatus) ? "ok" : rawStatus;
  const matchedTotal = state.unifiedState?.["match.matched_total"] || 0;
  const meta = Number(matchedTotal) ? `${matchedTotal} 项` : "";
  const section = createSection("规则命中", meta);
  section.classList.add("home-state-card", `state-${matchStatus}`);
  section.append(createMetricGrid([
    ["命中", `${matchedTotal} 项`],
    ["默认", `${state.unifiedState?.["match.default_total"] || 0} 项`],
    ["模式", "自动规则"]
  ], "home-metric-grid"));
  const note = ["partial", "fallback"].includes(rawStatus) ? "" : friendlySummaryMessage(state.unifiedState?.["match.reason"] || state.configSource?.reason || "", matchStatus);
  const noteNode = createCardNote(note);
  if (noteNode) section.append(noteNode);
  return section;
}

function createHealthSection() {
  const health = state.health || {};
  const rawStatus = health.status || state.unifiedState?.["health.status"] || "ok";
  const status = rawStatus === "error" ? "error" : "ok";
  const section = createSection("完整性与冲突", status === "error" ? "需要查看" : "");
  section.classList.add("home-state-card", "health-section", `health-${status}`, `state-${status}`);
  section.append(createMetricGrid([
    ["完整性", integrityLabel()],
    ["冲突", conflictSummaryLabel()],
    ["自愈", displayValue(health.auto_fixed || state.unifiedState?.["health.auto_fixed"], "无")]
  ], "home-metric-grid"));
  const noteNode = status === "error"
    ? createCardNote(health.reason || state.unifiedState?.["health.reason"] || state.unifiedState?.["integrity.reason"])
    : null;
  if (noteNode) section.append(noteNode);
  return section;
}

function createModuleStateSection() {
  const rebootState = state.config.rebootState || {};
  const rawStatus = state.unifiedState?.["apply.last_status"] || state.unifiedState?.["apply.status"] || state.unifiedState?.["service.status"] || rebootState.status || "ok";
  const failedTotal = Number(rebootState.serviceFailedTotal || state.unifiedState?.["apply.failed_total"] || 0);
  const applyStatus = failedTotal ? "error" : rebootState.label === "待重启" || rawStatus === "pending" || rawStatus === "runtime-apply-running" ? "pending" : "ok";
  const section = createSection("应用结果", applyStatus === "pending" ? "待重启" : applyStatus === "error" ? "需要查看" : "");
  section.classList.add("home-state-card", `state-${applyStatus}`);
  section.append(createMetricGrid([
    ["失败", `${rebootState.serviceFailedTotal || state.unifiedState?.["apply.failed_total"] || 0} 项`],
    ["未粘住", `${rebootState.serviceMismatchTotal || state.unifiedState?.["apply.mismatch_total"] || 0} 项`],
    ["阶段", statusLabel(state.unifiedState?.["service.phase"] || state.unifiedState?.["apply.phase"], { settled: "已稳定", boot: "启动中", apply: "应用中" })]
  ], "home-metric-grid"));
  const note = applyStatus === "ok" ? "" : friendlySummaryMessage(state.unifiedState?.["apply.last_reason"] || rebootState.reason || "", applyStatus);
  const noteNode = createCardNote(note);
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

function conflictSummaryLabel() {
  const total = Number(state.unifiedState?.["conflict.total"] || 0);
  return total ? `${total} 项` : "无冲突";
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
  `;
  button.addEventListener("click", onClick);
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

function createStateOverviewSection() {
  const section = createSection("状态分类", "");
  section.classList.add("state-overview-section");
  const grid = createElement("div", "state-overview-grid");
  grid.append(createHealthSection(), createRuleStateSection(), createModuleStateSection());
  section.append(grid);
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
  main.append(createStatusCard(), createSummaryBand());
  const tools = createHomeToolSection();
  tools.classList.add("home-dashboard-tools");
  dashboard.append(main, tools);
  return dashboard;
}

function renderHome() {
  const page = $("#page");
  page.innerHTML = "";
  page.append(createHomeDashboard());
  const attention = createAttentionSection();
  if (attention) page.append(attention);
  page.append(createStateOverviewSection());
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
  button.addEventListener("click", async (event) => {
    if (button.disabled) return;
    try {
      await onClick?.(event);
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
  const workbench = createElement("div", "custom-workbench", "");
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
  const mode = state.config.riskMode || "safe";
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
  if (mode === "aggressive" && !hasAcceptedAggressiveAgreement()) {
    state.config.riskMode = "caution";
    state.customDraftDirty = true;
    state.customSearch = "";
    renderCustom();
    showAgreementDialog("aggressive");
    return;
  }
  state.config.riskMode = mode;
  state.customDraftDirty = true;
  state.customSearch = "";
  renderCustom();
}

function createSaveSummary() {
  const section = createSection("保存与生成", "");
  section.classList.add("save-summary");
  const grid = createElement("div", "metric-grid compact");
  grid.append(metric("启用项", countEnabled(state.config, state.options)));
  grid.append(metric("变更项", countChanged(state.options, state.config)));
  grid.append(metric("当前档位", modeLabel(state.config.riskMode || "safe")));
  grid.append(metric("进阶项", countHighRiskEnabled(state.options, state.config)));
  grid.append(metric("配置来源", sourceLabel(state.configSource)));
  section.append(grid);
  const hint = createElement("p", "save-hint", "保存会重新生成 system.prop，并更新统一状态；重启后完成运行时验证。");
  const actions = createElement("div", "save-action-row");
  actions.append(createButton("保存并生成 system.prop", `primary-button ${state.config.riskMode || "safe"}`, saveCurrentConfig));
  section.append(hint, actions);
  return section;
}

function createConfigBackupPanel() {
  const section = createSection("配置备份", "导出 / 恢复");
  section.classList.add("config-backup-panel");
  const actions = createElement("div", "backup-action-row");
  actions.append(createButton("导出配置备份", "wide-button", exportConfigBackup));
  actions.append(createButton("从备份恢复到工作台", "wide-button", restoreConfigBackup));
  const note = createElement("p", "save-hint", `备份路径：${CONFIG_BACKUP_PATH}。恢复只更新 WebUI 工作台，确认无误后再点击保存并生成 system.prop。`);
  section.append(actions, note);
  return section;
}

function createCustomOptionsList() {
  const list = createElement("section", "option-list custom-options-panel");
  const mode = state.config.riskMode || "safe";
  const modeMeta = riskModes[mode] || riskModes.safe;
  const orderedIds = [...modeMeta.categories].reverse();
  const categoriesById = new Map(state.options.categories.map((category) => [category.id, category]));
  const categories = orderedIds.map((id) => categoriesById.get(id)).filter(Boolean);
  list.dataset.riskMode = mode;
  const intro = createElement("section", `profile-header active-mode-header ${mode}`);
  intro.innerHTML = `<h2>${escapeHtml(modeMeta.title)}规则库</h2><p>${escapeHtml(modeMeta.impact)}</p>`;
  list.append(intro, createCustomToolbar(list));
  for (const category of categories) {
    const header = createElement("section", `profile-header ${category.tone}`);
    header.dataset.categoryHeader = category.id;
    header.innerHTML = `<h2>${escapeHtml(category.title)}</h2><p>${escapeHtml(category.description)}</p>`;
    list.append(header);
    for (const item of category.items) list.append(createOptionRow(category, item));
  }
  list.append(createElement("p", "custom-empty", "没有匹配的配置项"));
  applyCustomOptionsFilter(list);
  return list;
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

function createOptionRow(category, item) {
  const itemState = state.config.items[item.id] || { enabled: item.defaultEnabled, value: item.defaultValue };
  const row = createElement("article", `option-row ${category.tone}`);
  const safeValue = item.values.includes(itemState.value) ? itemState.value : item.defaultValue;
  row.dataset.optionId = item.id;
  row.dataset.category = category.id;
  row.dataset.risk = category.id;
  row.dataset.search = `${item.label} ${item.description} ${item.prop} ${safeValue}`.toLowerCase();
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
    option.textContent = value;
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
    row.dataset.search = `${item.label} ${item.description} ${item.prop} ${select.value}`.toLowerCase();
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
  const section = createSection("配置提示", "继续前请先确认");
  section.classList.add("agreement-gate");
  const row = createElement("div", "agreement-gate-row");
  row.append(createElement("p", "risk-note", "调整配置前请先阅读说明。"));
  row.append(createButton("阅读提示", "primary-button", () => showAgreementDialog(scope)));
  section.append(row);
  return section;
}

function agreementText(scope) {
  const modeText = scope === "aggressive" ? "危险模式" : "自定义配置";
  return [
    "Dex2oat Lock 配置提示",
    "",
    `你正在开启 ${modeText}。本模块会生成并应用 ART、dexopt、runtime 相关系统属性，这些配置可能改变系统编译、应用安装、后台维护、启动优化和运行时行为。`,
    "自定义配置、规则修改、手动覆盖自动匹配结果或启用危险模式，可能导致性能异常、发热、耗电、应用兼容性问题、系统不稳定、启动异常、卡顿、闪退、功能异常，或与 ROM、Magisk/KernelSU/APatch、内核、其它模块和厂商实现产生冲突。",
    "作者无法验证所有设备、系统版本、ROM、Root 框架、内核和模块组合，也不保证任何自定义配置适用于你的具体环境。你应在理解配置含义和风险后再保存或启用。",
    "如果出现异常，应优先恢复默认配置、重新抓取匹配、禁用冲突模块、重启验证，必要时卸载模块并回滚。自定义配置、危险模式和手动覆盖自动匹配结果造成的后果，由使用者自行评估并承担。"
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
          <h2>配置提示</h2>
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
        <label class="agreement-check"><input type="checkbox" data-agree disabled /> 我已了解风险</label>
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
    countdown.textContent = remaining ? `请阅读提示，${remaining} 秒后可确认。` : "请完成计算验证后继续。";
    const solved = Number(input.value) === state.agreementChallenge.answer;
    agree.disabled = remaining > 0 || !solved;
    confirm.disabled = !agree.checked || agree.disabled;
  };
  input.addEventListener("input", updateAgreementState);
  agree.addEventListener("change", updateAgreementState);
  confirm.addEventListener("click", async () => {
    acceptAgreement(scope);
    await persistWebConfig();
    clearInterval(state.agreementTimer);
    closeDialog(dialog);
    renderPage();
    setStatus(scope === "aggressive" ? "危险模式已开启" : "自定义配置已开启", "ok");
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
  if (scope === "aggressive") state.config.riskMode = "aggressive";
}

async function persistWebConfig() {
  const config = { ...state.config };
  delete config.rebootState;
  await writeBase64(`${STATE_DIR}/config.json`, JSON.stringify(config, null, 2) + "\n");
  await exec(`sh ${shellQuote(`${MODULE_DIR}/core/statectl.sh`)} update ${
    [
      `risk.mode=${state.config.riskMode || "safe"}`,
      `risk.agreement_version=${RISK_AGREEMENT_VERSION}`,
      `risk.agreed_at=${state.config.riskAgreement?.agreedAt || ""}`,
      `risk.custom_unlocked=${state.config.riskAgreement?.customUnlocked ? "yes" : "no"}`,
      `risk.aggressive_unlocked=${state.config.riskAgreement?.aggressiveUnlocked ? "yes" : "no"}`
    ].map(shellQuote).join(" ")
  }`);
  state.unifiedState = await loadUnifiedState();
}

function renderAbout() {
  const page = $("#page");
  page.innerHTML = "";

  const paths = createSection("路径与配置文件", "排查常用");
  paths.classList.add("about-section", "about-path-section");
  const pathList = createElement("div", "about-path-list");
  pathList.append(createAboutPathItem("模块路径", MODULE_DIR));
  pathList.append(createAboutPathItem("数据路径", STATE_DIR));
  pathList.append(createAboutPathItem("system.prop", `${MODULE_DIR}/system.prop`, "最终写入模块的属性配置"));
  pathList.append(createAboutPathItem("config.json", `${STATE_DIR}/config.json`, "WebUI 自定义配置"));
  pathList.append(createAboutPathItem("state.prop", `${STATE_DIR}/state.prop`, "统一状态源"));
  pathList.append(createAboutPathItem("prop-lock.list", `${STATE_DIR}/prop-lock.list`, "运行时锁定快照"));
  paths.append(pathList);

  const backup = createConfigBackupPanel();
  backup.classList.add("about-section");
  const background = createBackgroundPanel();
  const telemetry = createTelemetryPanel();

  const project = createSection("项目", "GitHub / License / Author");
  project.classList.add("about-section", "about-project-section");
  const projectGrid = createElement("div", "about-info-grid compact");
  projectGrid.append(createAboutInfoCard("作者", state.meta.author || "pakhozako", "维护与发布"));
  projectGrid.append(createAboutInfoCard("License", "GPL / Open", "遵循项目开源许可"));
  projectGrid.append(createAboutInfoCard("版本", displayValue(state.meta.version), `versionCode ${displayValue(state.meta.versionCode)}`));
  project.append(projectGrid);
  const githubRow = createElement("div", "about-github-row");
  githubRow.append(createButton("Github项目地址", "wide-button about-github-button", () => openUrl(state.meta.githubUrl)));
  project.append(githubRow);

  page.append(paths, backup, background, telemetry, project);
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

function createAboutPathItem(label, path, detail) {
  const item = createElement("article", "about-path-item");
  item.innerHTML = `
    <span>${escapeHtml(label)}</span>
    <code>${escapeHtml(path || "暂不可用")}</code>
    ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
  `;
  return item;
}

function updateOption(id, patch) {
  state.customDraftDirty = true;
  if (patch.enabled) {
    const current = state.options.categories.flatMap((category) => category.items).find((item) => item.id === id);
    const activeMode = state.config.riskMode || "safe";
    if (current && current.prop) {
      for (const category of state.options.categories) {
        if (category.id !== activeMode) continue;
        for (const item of category.items) {
          if (item.id !== id && item.prop === current.prop && state.config.items[item.id]) {
            state.config.items[item.id].enabled = false;
          }
        }
      }
    }
  }

  state.config.items[id] = {
    ...state.config.items[id],
    ...patch
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
      if (!(state.page === "custom" && state.customDraftDirty)) {
        state.config = await loadUserConfig(state.options);
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
    riskMode: state.config?.riskMode || "safe",
    config: exportableConfig(),
    systemProp: await readGeneratedSystemProp()
  };
}

async function exportConfigBackup() {
  try {
    const backup = await buildConfigBackup();
    const content = JSON.stringify(backup, null, 2) + "\n";
    const result = await writeBase64(CONFIG_BACKUP_PATH, content);
    if (result.code !== 0) throw new Error(resultMessage(result));
    showDialog("配置备份", content, null, { savePath: CONFIG_BACKUP_PATH, copyLabel: "复制备份" });
    setStatus(`配置备份已导出到 ${CONFIG_BACKUP_PATH}`, "ok");
  } catch (error) {
    setStatus(`配置备份失败：${error.message}`, "warn");
  }
}

async function restoreConfigBackup() {
  try {
    const raw = await readText(CONFIG_BACKUP_PATH);
    if (!raw) throw new Error(`未找到备份文件：${CONFIG_BACKUP_PATH}`);
    const backup = JSON.parse(raw);
    const incoming = backup.config || backup;
    if (!incoming.items || typeof incoming.items !== "object") throw new Error("备份格式不包含配置项");
    const currentAgreement = state.config.riskAgreement || {};
    const restored = mergeConfig(state.config, incoming);
    restored.riskAgreement = currentAgreement;
    restored.pendingReboot = true;
    restored.pendingSavedAt = 0;
    restored.pendingBootId = "";
    state.config = restored;
    state.customDraftDirty = true;
    setPage("custom");
    setStatus("配置已恢复到工作台，确认后请保存并生成 system.prop", "warn");
  } catch (error) {
    setStatus(`恢复失败：${error.message}`, "warn");
  }
}

async function saveCurrentConfig() {
  if (saveInFlight) return saveInFlight;
  if (!hasAcceptedCustomAgreement()) {
    showAgreementDialog("custom");
    return;
  }
  if ((state.config.riskMode === "aggressive" || countHighRiskEnabled(state.options, state.config) > 0) && !hasAcceptedAggressiveAgreement()) {
    showAgreementDialog("aggressive");
    return;
  }
  const highRiskCount = countHighRiskEnabled(state.options, state.config);
  if (highRiskCount > 0 && !(await showConfirm(`当前启用了 ${highRiskCount} 项进阶配置。保存会生成新的 system.prop，通常需要重启后验证。确定继续吗？`))) {
    return;
  }
  saveInFlight = (async () => {
    setSaveButtonsDisabled(true);
    setStatus("正在保存配置...");
    await nextFrame();
    const nextConfig = {
      ...state.config,
      profile: state.config.riskMode || "safe"
    };
    try {
      state.config = await saveConfig(state.options, nextConfig);
      state.customDraftDirty = false;
      await nextFrame();
      state.unifiedState = await loadUnifiedState();
      state.configSource = await loadConfigSource();
      updateTopbarRealtime();
      if (state.page !== "custom") {
        renderPage();
      }
      setStatus("保存成功，重启后生效", "ok");
    } catch (error) {
      const detail = buildSaveErrorMessage(error);
      setStatus(detail, "warn");
      showDialog("保存失败", detail, null, { className: "config-summary-dialog", copyLabel: "复制原因" });
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
    }
  });
}

async function showSystemProp() {
  const content = await readGeneratedSystemProp();
  showDialog("system.prop", content || "暂不可用");
}

async function rerunDex2oatMatch() {
  const ok = await showConfirm("重新抓取匹配将在后台触发 service 执行，完成后需要重启生效。确定继续吗？");
  if (!ok) return;

  setStatus("已写入触发文件，等待 service 处理...");
  await writeBase64(`${STATE_DIR}/trigger-rematch`, `requested_at=${formatTimestamp(new Date())}\n`);
  await exec(`sh ${shellQuote(`${MODULE_DIR}/service.sh`)} >/dev/null 2>&1 &`);

  let completed = false;
  for (let i = 0; i < 45; i += 1) {
    await delay(2000);
    const trigger = await readText(`${STATE_DIR}/trigger-rematch`);
    if (!trigger) {
      completed = true;
      break;
    }
  }

  await refreshAll();
  setStatus(completed ? "重新匹配完成，重启后生效" : "重新匹配仍在后台执行，请稍后查看诊断", "warn");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const segments = buildDiagnosticSegments();
  const outputs = [];
  let finalCode = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    setStatus(`正在读取诊断 ${index + 1}/${segments.length}：${segment.title}`);
    const result = await exec(segment.command);
    if (result.code !== 0 && finalCode === 0) finalCode = result.code;
    outputs.push(`--- diagnostic segment: ${segment.title} ---\nerrno=${result.code}\n${result.stdout || ""}\n${result.stderr || ""}`);
    await delay(20);
  }
  const result = {
    code: finalCode,
    stdout: outputs.join("\n\n"),
    stderr: ""
  };

  await showDiagnosticsDialog(`errno=${result.code}\n\n${result.stdout || ""}\n${result.stderr || ""}`);
  setStatus(result.code === 0 ? "诊断输出已生成" : `诊断命令异常：${resultMessage(result)}`, result.code === 0 ? "ok" : "warn");
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
    copyLabel: "复制诊断",
    savePath: DIAGNOSTIC_EXPORT_PATH
  });
}

function createDiagnosticSummary(applyLog, diagnosticState, rebootState, installState, uninstallState, originalPropsContent, currentSystemProp, healthState, conflictState, unifiedState, integrityState) {
  const section = createElement("section", "diagnostic-stack");
  section.append(createUnifiedStateSummary(unifiedState));
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
  chips.append(createDiagnosticChip("档位", modeLabel(unifiedState["risk.mode"] || "safe"), "applied"));
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
  summary.append(createElement("strong", "", "属性上下对比"));
  summary.append(createElement("span", "", `${changed.length} 项差异，可展开查看 original-props.conf 与当前 system.prop`));
  details.append(summary);

  const originalBlock = createElement("pre", "prop-compare-block", originalContent || "original-props.conf 暂无内容");
  const currentBlock = createElement("pre", "prop-compare-block", systemContent || "system.prop 暂无内容");
  details.append(createElement("strong", "", "original-props.conf（安装前原始值）"));
  details.append(originalBlock);
  details.append(createElement("strong", "", "当前 system.prop（模块生成值）"));
  details.append(currentBlock);

  const list = createElement("div", "diagnostic-problems");
  for (const key of changed.slice(0, 120)) {
    const item = createElement("div", "diagnostic-problem mismatch");
    item.append(createElement("strong", "", key));
    item.append(createElement("span", "", `${original[key] || "<unset>"} -> ${current[key] || "<unset>"}`));
    list.append(item);
  }
  details.append(list);
  return details;
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
  chips.append(createDiagnosticChip("settled", rebootState.settledAt ? "已记录" : "未记录", rebootState.settledAt ? "applied" : "matched"));
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
    return "服务已完成 settled，若首页仍显示待重启，优先检查 config.json 的 pendingSavedAt 或管理器缓存。";
  }

  if (!rebootState.bootId && rebootState.status !== "settled") {
    return "未读到 boot_id，且服务未记录 settled；状态仍待重启是合理的。";
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
    } else {
      setStatus(`保存失败：${result.stderr || result.stdout || result.code}`, "warn");
    }
  } catch (error) {
    setStatus(`保存失败：${error.message || error}`, "warn");
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
    await rebootDevice(action);
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
    setStatus(`打开链接失败：${resultMessage(result)}`, "warn");
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
  state.options = await loadOptionsForDevice(state.device);
  state.config = await loadUserConfig(state.options);

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
