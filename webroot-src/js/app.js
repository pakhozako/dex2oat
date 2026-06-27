import { MODULE_DIR, STATE_DIR, exec, readText, writeBase64 } from "./bridge.js";
import { countChanged, countEnabled, countHighRiskEnabled, decodeProtectedBytes, decodeProtectedText, loadJson, loadUserConfig, mergeConfig, readGeneratedSystemProp, saveConfig } from "./config.js";
import { readSystemInfo } from "./system-info.js";
import { $, createElement, metric, setStatus, showConfirm } from "./ui.js";
import { shellQuote, resultMessage, parseKeyValueLines, parseStateFile } from "./utils.js";
import { initTheme } from "./m3-theme.js";

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
  customFilter: "all",
  customSearch: "",
  customDraftDirty: false
};

const RISK_AGREEMENT_VERSION = 2;
const RISK_WAIT_SECONDS = 30;
const CONFIG_BACKUP_PATH = "/storage/emulated/0/Download/dex2oat-lock-config-backup.json";
const DIAGNOSTIC_EXPORT_PATH = "/storage/emulated/0/Download/dex2oat-lock-diagnostic.txt";
const BONUS_TEXT_PATH = "";
const BONUS_ART_PATH = "";
const PULL_REFRESH_THRESHOLD = 76;
const PULL_REFRESH_MAX = 112;
const PULL_REFRESH_COMBO_WINDOW_MS = 45000;
let refreshInFlight = null;
let pullRefreshBound = false;
let bonusTapCount = 0;
let bonusTapTimer = null;
let bonusArtUrl = "";
let bonusMeta = null;
let pullRefreshComboCount = 0;
let pullRefreshLastAt = 0;
const pullRefreshState = {
  tracking: false,
  refreshing: false,
  startY: 0,
  distance: 0
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
    description: "展示高风险配置项，可能影响性能、功耗、兼容性或系统稳定性。",
    suitableFor: "愿意承担高编译量、高耗时和兼容性风险的测试用户。",
    impact: "会展示全量 AOT、ART Service/JIT、堆参数、ISA、GC、runtime 深层开关等高风险项。",
    caution: "可能导致安装明显变慢、发热升高、空间占用增加、应用兼容异常或系统维护任务异常。",
    tooltip: "危险：高风险/测试向，可能影响稳定性、功耗、安装速度和兼容性。",
    categories: ["aggressive"]
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

function categoryById(id) {
  return state.options.categories.find((category) => category.id === id);
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

function renderShell() {
  $("#app").innerHTML = `
    <header class="topbar">
      <div class="brand">
        <span class="brand-logo" aria-hidden="true">D</span>
        <div class="brand-text">
          <h1>${escapeHtml(state.meta.moduleName)}</h1>
          <p><span>${escapeHtml(state.meta.version)}</span></p>
        </div>
      </div>
      <div class="topbar-center"><span class="topbar-status" id="statusMessage" data-tone="neutral">准备就绪</span></div>
      <div class="top-actions">
        <button class="icon-button" id="rebootButton" title="重启">⏻</button>
      </div>
    </header>
    <div class="pull-refresh-indicator" id="pullRefreshIndicator" role="status" aria-live="polite">
      <span class="pull-refresh-spinner" aria-hidden="true"></span>
      <span id="pullRefreshText">下拉刷新</span>
    </div>
    <main id="page"></main>
    <nav class="bottom-nav">
      <button data-page="home"><span class="nav-label">首页</span></button>
      <button data-page="custom"><span class="nav-label">自定义</span></button>
      <button data-page="about"><span class="nav-label">关于</span></button>
    </nav>
  `;

  $("#rebootButton").addEventListener("click", rebootDevice);
  $(".brand-logo")?.addEventListener("click", triggerLogoEasterEgg);
  setupPullRefresh();

  document.querySelectorAll(".bottom-nav button").forEach((button) => {
    button.addEventListener("click", () => setPage(button.dataset.page));
  });
}

function setPage(page) {
  const changed = state.page !== page;
  state.page = page;
  document.querySelectorAll(".bottom-nav button").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === page);
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
    const bytes = decodeProtectedBytes(protectedCover);
    const blob = new Blob([bytes], { type: protectedCover.m || "image/jpeg" });
    bonusArtUrl = URL.createObjectURL(blob);
    return bonusArtUrl;
  } catch {
    return BONUS_ART_PATH;
  }
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

function showPullRefreshBonus() {
  showDialog("提示", "你这么无聊吗，老弟？", null, {
    className: "bonus-dialog pull-bonus-dialog",
    copyLabel: "复制"
  });
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
    ok: "状态正常",
    warning: "存在警告",
    error: "需要处理",
    pending: "待重启",
    recovery: "恢复中"
  };
  const rawTitle = state.unifiedState?.["summary.title"] || "";
  const rawMessage = state.unifiedState?.["summary.message"] || "";
  const matchedTotal = state.unifiedState?.["match.matched_total"] || state.configSource?.matched_total || "0";
  const normalizedRuleMessage = `自动规则匹配完成，已根据设备属性生成配置。命中 ${matchedTotal} 项，未匹配项使用保守默认值。`;
  const title = isPendingReboot
    ? "待重启"
    : ["partial", "fallback"].includes(rawStatus) || hasLegacyRuleTitle
      ? "状态正常"
      : rawTitle || labels[status] || "状态正常";
  const message = isPendingReboot
    ? (rebootState.reason || "配置已保存，重启后完成应用。")
    : ["partial", "fallback"].includes(rawStatus) || /conservative defaults|safe defaults/i.test(rawMessage)
    ? normalizedRuleMessage
    : rawMessage || "正在等待完整状态证据";
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
  const conflictTotal = Number(state.unifiedState?.["conflict.total"] || 0);
  const installStatus = state.unifiedState?.["install.status"] || "unknown";
  const installPercent = state.unifiedState?.["install.progress"] || state.unifiedState?.["install.percent"] || "0";
  const applyStatus = state.unifiedState?.["apply.last_status"] || state.unifiedState?.["apply.status"] || state.unifiedState?.["service.status"] || "unknown";
  const rebootLabel = rebootState.label || (summary.status === "pending" ? "待重启" : "已生效");
  const hero = createElement("section", `module-status-card ${summary.tone}`);
  hero.innerHTML = `
    <div class="module-status-content">
      <div class="module-status-title">${escapeHtml(summary.title)}</div>
      <div class="module-status-version">${escapeHtml(sourceLabel(state.configSource))}</div>
      <div class="module-status-meta">
        <span>已启用 ${countEnabled(state.config, state.options)} 项属性</span>
        <span>最终 prop ${escapeHtml(state.configSource?.prop_count || "0")} 项</span>
        <span>安装 ${escapeHtml(installStatus)} · ${escapeHtml(installPercent)}%</span>
        <span>应用 ${escapeHtml(applyStatus)}</span>
        <span>重启 ${escapeHtml(rebootLabel)}</span>
        <span>冲突 ${conflictTotal} 项</span>
      </div>
      <div class="module-status-reboot">${escapeHtml(summary.message || rebootState.reason || "状态已汇总到 state.prop")}</div>
    </div>
    <div class="module-status-mark" aria-hidden="true"></div>
  `;
  return hero;
}

function createAttentionSection() {
  const items = buildAttentionItems();
  if (!items.length) return null;
  const section = createSection("需要关注", items.length ? `${items.length} 项` : "无异常置顶");
  section.classList.add(items.length ? "attention-section" : "attention-section", items.length ? "has-items" : "is-empty");
  const list = createElement("div", "attention-list");
  for (const item of items) list.append(createElement("div", `attention-item ${item.level === "error" ? "error" : item.level === "info" ? "info" : "warn"}`, item.message));
  section.append(list);
  return section;
}

function createSummaryBand() {
  const info = state.systemInfo || {};
  const summary = createElement("section", "summary-band");
  summary.append(metric("设备", state.device?.["ro.product.model"] || "暂不可用"));
  summary.append(metric("规则体系", "规则驱动"));
  summary.append(metric("配置来源", sourceLabel(state.configSource)));
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
  summary.append(metric("系统", state.device?.["ro.build.version.release"] || "暂不可用"));
  summary.append(metric("Root", info.root || "暂不可用"));
  summary.append(metric("安装进度", `${state.unifiedState?.["install.step"] || state.unifiedState?.["install.stage"] || "未知"} · ${state.unifiedState?.["install.progress"] || state.unifiedState?.["install.percent"] || "0"}%`));
  summary.append(metric("规则匹配", `${state.unifiedState?.["match.status"] || "unknown"} · ${state.unifiedState?.["match.matched_total"] || 0} 项`));
  summary.append(metric("最近应用", state.unifiedState?.["apply.updated_at"] || state.unifiedState?.["service.updated_at"] || state.configSource?.updated_at || "暂不可用"));
  return summary;
}

function showConfigSummaryDialog() {
  const rows = [
    ["配置来源", sourceLabel(state.configSource)],
    ["生成状态", state.unifiedState?.["config.status"] || "unknown"],
    ["生成原因", state.unifiedState?.["config.reason"] || state.configSource?.reason || "unknown"],
    ["最终 prop 数", state.configSource?.prop_count || state.unifiedState?.["config.prop_count"] || "0"],
    ["完整 Hash", state.configSource?.prop_hash || state.unifiedState?.["config.prop_hash"] || "暂不可用"],
    ["匹配状态", `${state.unifiedState?.["match.status"] || "unknown"} · ${state.unifiedState?.["match.matched_total"] || 0} 项`],
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
  const value = String(status || "unknown");
  return labels[value] || value;
}

function createMetricGrid(rows) {
  const grid = createElement("div", "metric-grid compact");
  for (const [label, value] of rows) grid.append(metric(label, value));
  return grid;
}

function createCardNote(text) {
  return createElement("p", "card-note", text || "状态依据等待下一次刷新写入。");
}

function createRuleStateSection() {
  const rawStatus = state.unifiedState?.["match.status"] || "pending";
  const matchStatus = ["partial", "fallback"].includes(rawStatus) ? "ok" : rawStatus;
  const labels = { ok: "正常", warning: "警告", error: "异常", pending: "待匹配" };
  const matchedTotal = state.unifiedState?.["match.matched_total"] || 0;
  const section = createSection("规则匹配", `${statusLabel(matchStatus, labels)} · ${matchedTotal} 项`);
  section.classList.add("home-state-card", `state-${matchStatus}`);
  section.append(createMetricGrid([
    ["命中", `${matchedTotal} 项`],
    ["默认", `${state.unifiedState?.["match.default_total"] || 0} 项`],
    ["规则", sourceLabel(state.configSource)]
  ]));
  section.append(createCardNote(["partial", "fallback"].includes(rawStatus)
    ? "已使用设备可用证据完成匹配；未覆盖的项目保持保守默认值。"
    : state.unifiedState?.["match.reason"] || state.configSource?.reason || "规则结果来自统一状态 state.prop。"));
  return section;
}

function createHealthSection() {
  const health = state.health || {};
  const rawStatus = health.status || state.unifiedState?.["health.status"] || "ok";
  const status = rawStatus === "error" ? "error" : "ok";
  const labels = { ok: "正常", error: "异常" };
  const section = createSection("健康状态", statusLabel(status, labels));
  section.classList.add("home-state-card", "health-section", `health-${status}`, `state-${status}`);
  section.append(createMetricGrid([
    ["完整性", integrityLabel()],
    ["冲突", `${state.unifiedState?.["conflict.total"] || "0"} 项`],
    ["自愈", health.auto_fixed || state.unifiedState?.["health.auto_fixed"] || "unknown"]
  ]));
  section.append(createCardNote(health.reason || state.unifiedState?.["health.reason"] || state.unifiedState?.["integrity.reason"] || "健康、冲突和完整性摘要已收口到 state.prop。"));
  return section;
}

function createModuleStateSection() {
  const rebootState = state.config.rebootState || {};
  const rawStatus = state.unifiedState?.["apply.last_status"] || state.unifiedState?.["apply.status"] || state.unifiedState?.["service.status"] || rebootState.status || "ok";
  const failedTotal = Number(rebootState.serviceFailedTotal || state.unifiedState?.["apply.failed_total"] || 0);
  const applyStatus = failedTotal ? "error" : rebootState.label === "待重启" || rawStatus === "pending" ? "pending" : "ok";
  const labels = { ok: "正常", pending: "待重启", error: "异常" };
  const section = createSection("运行应用", statusLabel(applyStatus, labels));
  section.classList.add("home-state-card", `state-${applyStatus}`);
  section.append(createMetricGrid([
    ["失败", `${rebootState.serviceFailedTotal || state.unifiedState?.["apply.failed_total"] || 0} 项`],
    ["未粘住", `${rebootState.serviceMismatchTotal || state.unifiedState?.["apply.mismatch_total"] || 0} 项`],
    ["最近", state.unifiedState?.["apply.last_updated_at"] || state.unifiedState?.["service.updated_at"] || "暂无"]
  ]));
  section.append(createCardNote(state.unifiedState?.["apply.last_reason"] || rebootState.reason || "开机服务会持续校验 system.prop 的运行态应用结果。"));
  return section;
}

function integrityLabel() {
  const status = state.unifiedState?.["integrity.status"] || "unknown";
  const blockingMissing = Number(state.unifiedState?.["integrity.blocking_missing_total"] || 0);
  const blockingChanged = Number(state.unifiedState?.["integrity.blocking_changed_total"] || 0);
  if (status === "ok") return "通过";
  if (status === "error") return "异常";
  if (["warn", "warning"].includes(status)) return "已记录";
  if (status === "missing") return blockingMissing ? "缺失" : "已记录";
  if (status === "changed") return blockingChanged ? "变更" : "已记录";
  return "未检测";
}

function createActionCard(title, detail, onClick) {
  const button = createElement("button", "action-card");
  button.type = "button";
  button.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span>`;
  button.addEventListener("click", onClick);
  return button;
}

function createLinkRow() {
  const links = createElement("div", "action-grid");
  links.append(createActionCard("诊断", "查看证据卡片", showDiagnostics));
  links.append(createActionCard("system.prop", "查看当前生成配置", showSystemProp));
  links.append(createActionCard("重匹配", "重新抓取并生成", rerunDex2oatMatch));
  return links;
}

function createHomeCardGrid() {
  const grid = createElement("section", "home-card-grid");
  grid.append(createHealthSection(), createRuleStateSection(), createModuleStateSection());
  return grid;
}

function createHomeToolSection() {
  const section = createSection("工具", "诊断 / 输出 / 重匹配");
  section.classList.add("home-tool-section");
  section.append(createLinkRow());
  return section;
}

function renderHome() {
  const page = $("#page");
  page.innerHTML = "";
  page.append(createStatusCard());
  page.append(createAttentionSection());
  page.append(createHomeCardGrid());
  page.append(createSummaryBand());
  page.append(createHomeToolSection());
}

function createSection(title, meta) {
  const section = createElement("section", "section");
  section.innerHTML = `
    <div class="section-title">
      <h2>${escapeHtml(title)}</h2>
      ${meta ? `<span>${escapeHtml(meta)}</span>` : ""}
    </div>
  `;
  return section;
}

function createButton(text, className, onClick) {
  const button = createElement("button", className, text);
  button.type = "button";
  button.addEventListener("click", onClick);
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
  const section = createSection("自定义工作台", meta.title);
  section.classList.add("risk-workbench", mode);
  const selector = createElement("div", "risk-mode-row");
  for (const [id, item] of Object.entries(riskModes)) {
    const button = createElement("button", `risk-mode-button ${id === mode ? "active" : ""}`, item.label);
    button.type = "button";
    button.title = item.tooltip;
    button.setAttribute("aria-label", item.tooltip);
    button.addEventListener("click", () => setRiskMode(id));
    selector.append(button);
  }
  const note = createElement("p", "risk-note", meta.description);
  const status = createElement("div", "risk-status", `自定义 ${hasAcceptedCustomAgreement() ? "已确认" : "待确认"} · 危险模式 ${hasAcceptedAggressiveAgreement() ? "已确认" : "待确认"}`);
  const details = createElement("div", "mode-detail-grid");
  details.append(modeDetail("适合", meta.suitableFor));
  details.append(modeDetail("影响", meta.impact));
  details.append(modeDetail("注意", meta.caution));
  section.append(selector, note, details, status);
  return section;
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
    renderCustom();
    showAgreementDialog("aggressive");
    return;
  }
  state.config.riskMode = mode;
  state.customDraftDirty = true;
  renderCustom();
}

function createSaveSummary() {
  const section = createSection("保存与生成", "保存前确认");
  section.classList.add("save-summary");
  const grid = createElement("div", "metric-grid compact");
  grid.append(metric("启用项", countEnabled(state.config, state.options)));
  grid.append(metric("变更项", countChanged(state.options, state.config)));
  grid.append(metric("风险模式", riskModes[state.config.riskMode || "safe"].label));
  grid.append(metric("高风险项", countHighRiskEnabled(state.options, state.config)));
  grid.append(metric("配置来源", sourceLabel(state.configSource)));
  grid.append(metric("覆盖自动匹配", state.configSource?.source === "webui-custom" ? "已自定义" : "保存后会覆盖"));
  section.append(grid);
  const hint = createElement("p", "save-hint", "保存会重新生成 system.prop，并更新统一状态；通常需要重启后由 service 完成运行时应用验证。");
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
  toolbar.append(search, createCustomFilterTabs(list));
  return toolbar;
}

function createCustomFilterTabs(list) {
  const tabs = createElement("div", "custom-filter-tabs");
  const filters = [
    ["all", "全部"],
    ["enabled", "已启用"],
    ["changed", "已变更"],
    ["recommended", "推荐"],
    ["safe", "安全"],
    ["caution", "谨慎"],
    ["aggressive", "高风险"]
  ];
  for (const [id, label] of filters) {
    const button = createElement("button", `filter-chip ${state.customFilter === id ? "active" : ""}`, label);
    button.type = "button";
    button.dataset.filter = id;
    button.addEventListener("click", () => {
      state.customFilter = id;
      tabs.querySelectorAll("[data-filter]").forEach((tab) => tab.classList.toggle("active", tab === button));
      applyCustomOptionsFilter(list);
    });
    tabs.append(button);
  }
  return tabs;
}

function applyCustomOptionsFilter(list) {
  const query = state.customSearch.trim().toLowerCase();
  const filter = state.customFilter || "all";
  let visibleTotal = 0;
  for (const row of list.querySelectorAll(".option-row")) {
    const matchesQuery = !query || row.dataset.search.includes(query);
    const matchesFilter = filter === "all"
      || (filter === "enabled" && row.dataset.enabled === "yes")
      || (filter === "changed" && row.dataset.changed === "yes")
      || (filter === "recommended" && row.dataset.recommended === "yes")
      || row.dataset.risk === filter;
    const visible = matchesQuery && matchesFilter;
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

function isOptionChanged(item, itemState) {
  return Boolean(itemState.enabled) !== Boolean(item.defaultEnabled) || String(itemState.value ?? "") !== String(item.defaultValue ?? "");
}

function createOptionRow(category, item) {
  const itemState = state.config.items[item.id] || { enabled: item.defaultEnabled, value: item.defaultValue };
  const row = createElement("article", `option-row ${category.tone}`);
  const safeValue = item.values.includes(itemState.value) ? itemState.value : item.defaultValue;
  row.dataset.category = category.id;
  row.dataset.risk = category.id;
  row.dataset.enabled = itemState.enabled ? "yes" : "no";
  row.dataset.changed = isOptionChanged(item, itemState) ? "yes" : "no";
  row.dataset.recommended = item.defaultEnabled ? "yes" : "no";
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
    renderPage();
  });
  select.addEventListener("click", (event) => event.stopPropagation());
  select.addEventListener("change", (event) => {
    event.stopPropagation();
    updateOption(item.id, { value: select.value });
    renderPage();
  });
  row.addEventListener("click", (event) => {
    if (event.target.closest("input, select, label")) return;
    row.classList.toggle("expanded");
  });
  return row;
}

function createAgreementGate(scope) {
  const section = createSection("风险提示", "继续前请先确认");
  section.classList.add("agreement-gate");
  section.append(createElement("p", "risk-note", "首页和诊断可直接查看；调整配置前请先阅读风险提示。"));
  section.append(createButton("阅读风险提示", "primary-button", () => showAgreementDialog(scope)));
  return section;
}

function agreementText(scope) {
  const modeText = scope === "aggressive" ? "危险模式" : "自定义配置";
  return [
    "Dex2oat Lock 风险提示",
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
  dialog.innerHTML = `
      <div class="dialog-panel agreement-panel">
        <div class="section-title">
        <h2>风险提示</h2>
        <div class="dialog-actions"><button class="text-button" data-action="close">关闭</button></div>
      </div>
      <pre>${escapeHtml(agreementText(scope))}</pre>
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
  const ruleTotal = countOptionItems();
  const categoryTotal = state.options?.categories?.length || 0;
  const finalPropCount = state.configSource?.prop_count || state.unifiedState?.["config.prop_count"] || "0";
  const status = currentSummary();

  const overview = createSection("关于", `${state.meta.version} / ${state.meta.versionCode || "unknown"}`);
  overview.classList.add("about-section");
  const overviewGrid = createElement("div", "about-info-grid");
  overviewGrid.append(createAboutInfoCard("规则数量", `${ruleTotal} 项`, `${categoryTotal} 个分类`));
  overviewGrid.append(createAboutInfoCard("配置来源", sourceLabel(state.configSource), `最终 prop ${finalPropCount} 项`));
  overviewGrid.append(createAboutInfoCard("规则版本", state.options?.rulesVersion || state.meta.version || "unknown", `数据格式 ${state.options?.schemaVersion || "32"}`));
  overviewGrid.append(createAboutInfoCard("状态", status.title, status.message));
  overviewGrid.append(createAboutInfoCard("工作方式", state.meta.architecture || "规则驱动 / 统一状态", "自动生成配置并汇总运行状态"));
  overviewGrid.append(createAboutInfoCard("WebUI", "本地管理", "配置保存在设备本机"));
  overview.append(overviewGrid);
  overview.append(createElement("p", "risk-note", state.meta.description || "规则驱动生成 system.prop，并以统一状态模型汇总安装、匹配、应用、健康、冲突和完整性结果。"));

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

  const project = createSection("项目", "GitHub / License / Author");
  project.classList.add("about-section", "about-project-section");
  const projectGrid = createElement("div", "about-info-grid compact");
  projectGrid.append(createAboutInfoCard("作者", state.meta.author || "pakhozako", "维护与发布"));
  projectGrid.append(createAboutInfoCard("License", "GPL / Open", "遵循项目开源许可"));
  projectGrid.append(createAboutInfoCard("版本", state.meta.version || "unknown", `versionCode ${state.meta.versionCode || "unknown"}`));
  project.append(projectGrid);
  const githubRow = createElement("div", "about-github-row");
  githubRow.append(createButton("Github项目地址", "wide-button about-github-button", () => openUrl(state.meta.githubUrl)));
  project.append(githubRow);

  page.append(overview, paths, backup, project);
}

function countOptionItems() {
  return (state.options?.categories || []).reduce((sum, category) => sum + (category.items?.length || 0), 0);
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

function renderCategory(categoryId) {
  const category = categoryById(categoryId);
  const page = $("#page");
  page.innerHTML = "";
  if (!category) {
    page.append(createSection("配置不可用", "options 文件为空或损坏"));
    return;
  }

  const header = createElement("section", `profile-header ${category.tone}`);
  header.innerHTML = `<h2>${escapeHtml(category.title)}</h2><p>${escapeHtml(category.description)}</p>`;
  page.append(header);

  const list = createElement("section", "option-list");

  for (const item of category.items) {
    const itemState = state.config.items[item.id] || { enabled: item.defaultEnabled, value: item.defaultValue };
    const row = createElement("article", "option-row");
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

    const safeValue = item.values.includes(itemState.value) ? itemState.value : item.defaultValue;
    for (const value of item.values) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      option.selected = value === safeValue;
      select.append(option);
    }

    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    checkbox.addEventListener("change", async (event) => {
      event.stopPropagation();
      if (categoryId === "aggressive" && checkbox.checked) {
        const ok = await showConfirm("危险选项可能影响性能、兼容性、安装耗时或 OTA 后维护流程。确定启用吗？");
        if (!ok) {
          checkbox.checked = false;
          return;
        }
      }
      updateOption(item.id, { enabled: checkbox.checked });
    });

    select.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    select.addEventListener("change", (event) => {
      event.stopPropagation();
      updateOption(item.id, { value: select.value });
    });

    row.addEventListener("click", (e) => {
      if (e.target.closest("input, select")) return;
      row.classList.toggle("expanded");
    });

    list.append(row);
  }

  page.append(list);

  const actions = createElement("section", "sticky-actions");
  actions.append(createButton("保存并生成 system.prop", `primary-button ${category.tone}`, saveCurrentConfig));
  page.append(actions);
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
      renderPage();
      setStatus("设备信息已刷新", "ok");
    } catch (error) {
      setStatus(`刷新失败：${error.message}`, "warn");
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

function setupPullRefresh() {
  if (pullRefreshBound) return;
  pullRefreshBound = true;
  document.addEventListener("touchstart", onPullRefreshStart, { passive: true });
  document.addEventListener("touchmove", onPullRefreshMove, { passive: false });
  document.addEventListener("touchend", onPullRefreshEnd, { passive: true });
  document.addEventListener("touchcancel", onPullRefreshEnd, { passive: true });
}

function pageScrollTop() {
  return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
}

function canStartPullRefresh(event) {
  const target = event.target;
  const interactive = target?.closest?.("button,input,select,textarea,a,.dialog");
  return !interactive && !pullRefreshState.refreshing && pageScrollTop() <= 0;
}

function onPullRefreshStart(event) {
  if (!event.touches?.length || !canStartPullRefresh(event)) return;
  pullRefreshState.tracking = true;
  pullRefreshState.startY = event.touches[0].clientY;
  pullRefreshState.distance = 0;
  updatePullRefreshIndicator(0, "下拉刷新");
}

function onPullRefreshMove(event) {
  if (!pullRefreshState.tracking || !event.touches?.length) return;
  const delta = event.touches[0].clientY - pullRefreshState.startY;
  if (delta <= 0 || pageScrollTop() > 0) {
    resetPullRefreshIndicator();
    return;
  }
  pullRefreshState.distance = Math.min(PULL_REFRESH_MAX, Math.round(delta * 0.55));
  if (pullRefreshState.distance > 6) event.preventDefault();
  updatePullRefreshIndicator(
    pullRefreshState.distance,
    pullRefreshState.distance >= PULL_REFRESH_THRESHOLD ? "松开刷新" : "下拉刷新"
  );
}

function onPullRefreshEnd() {
  if (!pullRefreshState.tracking) return;
  const shouldRefresh = pullRefreshState.distance >= PULL_REFRESH_THRESHOLD;
  pullRefreshState.tracking = false;
  if (shouldRefresh) {
    recordPullRefreshCombo();
    triggerPullRefresh();
  } else {
    resetPullRefreshIndicator();
  }
}

function updatePullRefreshIndicator(distance, label) {
  const indicator = $("#pullRefreshIndicator");
  if (!indicator) return;
  const clamped = Math.max(0, Math.min(PULL_REFRESH_MAX, distance));
  const eased = Math.round(PULL_REFRESH_MAX * (1 - Math.pow(1 - clamped / PULL_REFRESH_MAX, 2)));
  const scale = 0.92 + (clamped / PULL_REFRESH_MAX) * 0.08;
  indicator.style.transform = `translate3d(-50%, ${eased - 72}px, 0) scale(${scale.toFixed(3)})`;
  indicator.style.setProperty("--pull-progress", String(clamped / PULL_REFRESH_MAX));
  const spinner = indicator.querySelector(".pull-refresh-spinner");
  if (spinner && !pullRefreshState.refreshing) {
    spinner.style.transform = `rotate(${Math.round((clamped / PULL_REFRESH_MAX) * 180)}deg)`;
  }
  indicator.classList.toggle("is-visible", clamped > 8);
  indicator.classList.toggle("is-ready", clamped >= PULL_REFRESH_THRESHOLD);
  indicator.classList.toggle("is-refreshing", pullRefreshState.refreshing);
  const text = $("#pullRefreshText");
  if (text) text.textContent = label;
}

function resetPullRefreshIndicator() {
  pullRefreshState.tracking = false;
  pullRefreshState.distance = 0;
  updatePullRefreshIndicator(0, "下拉刷新");
}

async function triggerPullRefresh() {
  pullRefreshState.refreshing = true;
  updatePullRefreshIndicator(72, "正在刷新");
  await refreshAll();
  setTimeout(() => {
    pullRefreshState.refreshing = false;
    resetPullRefreshIndicator();
  }, 240);
}

function recordPullRefreshCombo() {
  const now = Date.now();
  pullRefreshComboCount = now - pullRefreshLastAt < PULL_REFRESH_COMBO_WINDOW_MS ? pullRefreshComboCount + 1 : 1;
  pullRefreshLastAt = now;
  if (pullRefreshComboCount < 3) return;
  pullRefreshComboCount = 0;
  setTimeout(showPullRefreshBonus, 180);
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
    version: state.meta?.version || "unknown",
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
  if (!hasAcceptedCustomAgreement()) {
    showAgreementDialog("custom");
    return;
  }
  if ((state.config.riskMode === "aggressive" || countHighRiskEnabled(state.options, state.config) > 0) && !hasAcceptedAggressiveAgreement()) {
    showAgreementDialog("aggressive");
    return;
  }
  const highRiskCount = countHighRiskEnabled(state.options, state.config);
  if (highRiskCount > 0 && !(await showConfirm(`当前启用了 ${highRiskCount} 项高风险配置。保存会生成新的 system.prop，通常需要重启后验证。确定继续吗？`))) {
    return;
  }
  setStatus("正在保存配置...");
  const nextConfig = {
    ...state.config,
    profile: state.config.riskMode || "safe"
  };
  try {
    state.config = await saveConfig(state.options, nextConfig);
    state.customDraftDirty = false;
    state.unifiedState = await loadUnifiedState();
    state.configSource = await loadConfigSource();
    renderPage();
    setStatus("已保存，重启后生效", "warn");
  } catch (error) {
    setStatus(`保存失败：${error.message}`, "warn");
  }
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

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function renderHistory() {
  const page = $("#page");
  page.innerHTML = "";
  const section = createSection("安装历史", "install.log");
  const content = createElement("div", "history-log", "正在读取...");
  section.append(content);
  page.append(section);

  const logResult = await exec(`tail -n 260 ${shellQuote(`${STATE_DIR}/install.log`)} 2>/dev/null`);
  const log = logResult.code === 0 ? logResult.stdout : await readText(`${STATE_DIR}/install.log`);
  const entries = parseInstallLog(log || "");
  content.innerHTML = "";
  if (!entries.length) {
    content.textContent = "暂无安装历史";
    return;
  }
  let visible = 0;
  const renderNext = () => {
    const slice = entries.slice(visible, visible + 10);
    for (const entry of slice) {
      const card = createElement("div", "history-card");
      card.append(metric("时间", entry.time || "未知"));
      card.append(metric("规则", "规则驱动"));
      card.append(metric("来源", sourceLabel({ source: entry.source, matched_total: entry.matched_total })));
      card.append(metric("匹配数量", entry.matched_total || "0"));
      card.append(metric("版本", entry.version || "未知"));
      content.append(card);
    }
    visible += slice.length;
    more.hidden = visible >= entries.length;
  };
  const more = createButton("加载更多", "wide-button", renderNext);
  renderNext();
  section.append(more);
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
    "cat /data/adb/dex2oat-lock-install.prop 2>/dev/null",
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
    copyLabel: "复制全部诊断信息",
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
  const status = unifiedState["summary.status"] || "unknown";
  const attentionTotal = Number(unifiedState["summary.attention_total"] || 0);
  const alertTotal = Number(unifiedState["summary.attention_alert_total"] || 0);
  const section = createElement("section", "diagnostic-summary");
  const header = createElement("div", "diagnostic-summary-head");
  header.append(createElement("strong", "", "统一状态结论"));
  header.append(createElement("span", "", unifiedState["summary.message"] || "未读取到 state.prop 摘要"));
  section.append(header);
  const chips = createElement("div", "diagnostic-chip-row");
  chips.append(createDiagnosticChip("状态", status, status === "ok" ? "applied" : status === "error" ? "failed" : "mismatch"));
  chips.append(createDiagnosticChip(alertTotal ? "关注项" : "细节", attentionTotal, alertTotal ? "mismatch" : "applied"));
  chips.append(createDiagnosticChip("配置", unifiedState["config.source"] || "unknown", unifiedState["config.source"] ? "applied" : "mismatch"));
  chips.append(createDiagnosticChip("风险", unifiedState["risk.mode"] || "safe", unifiedState["risk.mode"] === "aggressive" ? "failed" : "applied"));
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
  const rawStatus = unifiedState["match.status"] || "unknown";
  const statusTone = ["ok", "partial", "fallback"].includes(rawStatus) ? "applied" : rawStatus === "error" || rawStatus === "failed" ? "failed" : "mismatch";
  const section = createElement("section", "diagnostic-summary");
  const header = createElement("div", "diagnostic-summary-head");
  header.append(createElement("strong", "", "规则匹配"));
  header.append(createElement("span", "", `mode=${unifiedState["match.mode"] || "unknown"} updated=${unifiedState["match.updated_at"] || "unknown"}`));
  section.append(header);
  const chips = createElement("div", "diagnostic-chip-row");
  chips.append(createDiagnosticChip("匹配状态", rawStatus, statusTone));
  chips.append(createDiagnosticChip("抓取", unifiedState["match.captured_total"] || 0, "applied"));
  chips.append(createDiagnosticChip("命中", unifiedState["match.matched_total"] || 0, "applied"));
  chips.append(createDiagnosticChip("默认", unifiedState["match.default_total"] || 0, "matched"));
  section.append(chips);
  return section;
}

function createConfigGenerationSummary(unifiedState) {
  const updatedAt = unifiedState["config.updated_at"] || "unknown";
  const status = unifiedState["config.status"] || "unknown";
  const statusTone = status === "ok" || status === "pending" ? "applied" : status === "error" || status === "failed" ? "failed" : "mismatch";
  const section = createElement("section", "diagnostic-summary");
  const header = createElement("div", "diagnostic-summary-head");
  header.append(createElement("strong", "", "配置生成"));
  header.append(createElement("span", "", `source=${unifiedState["config.source"] || "unknown"} · updated=${updatedAt}`));
  section.append(header);
  const chips = createElement("div", "diagnostic-chip-row");
  chips.append(createDiagnosticChip("生成状态", status, statusTone));
  chips.append(createDiagnosticChip("prop 数", unifiedState["config.prop_count"] || 0, "applied"));
  chips.append(createDiagnosticChip("来源", unifiedState["config.source"] || "unknown", "matched"));
  chips.append(createDiagnosticChip("Hash", shortHash(unifiedState["config.prop_hash"]), "applied"));
  section.append(chips);
  return section;
}

function createIntegritySummary(integrityState, unifiedState) {
  const status = integrityState.status || unifiedState["integrity.status"] || "unknown";
  const blockingMissing = Number(integrityState.blocking_missing_total || unifiedState["integrity.blocking_missing_total"] || 0);
  const blockingChanged = Number(integrityState.blocking_changed_total || unifiedState["integrity.blocking_changed_total"] || 0);
  const statusTone = status === "ok" || (["warning", "warn"].includes(status)) || (status === "missing" && !blockingMissing) || (status === "changed" && !blockingChanged)
    ? "applied"
    : status === "error" ? "failed" : "mismatch";
  const section = createElement("section", "diagnostic-summary");
  const header = createElement("div", "diagnostic-summary-head");
  header.append(createElement("strong", "", "完整性 / 防篡改"));
  header.append(createElement("span", "", `reason=${integrityState.reason || unifiedState["integrity.reason"] || "unknown"}`));
  section.append(header);
  const chips = createElement("div", "diagnostic-chip-row");
  chips.append(createDiagnosticChip("状态", status, statusTone));
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
  const status = healthState.status || "unknown";
  const statusTone = status === "error" ? "failed" : "applied";
  const section = createElement("section", "diagnostic-summary");
  const header = createElement("div", "diagnostic-summary-head");
  header.append(createElement("strong", "", "自愈监控"));
  header.append(createElement("span", "", `health=${status} conflict=${conflictState.conflict_total || 0}`));
  section.append(header);
  const chips = createElement("div", "diagnostic-chip-row");
  chips.append(createDiagnosticChip("健康", status, statusTone));
  chips.append(createDiagnosticChip("文件", healthState.files_ok || "unknown", healthState.files_ok === "no" && status === "error" ? "failed" : "applied"));
  chips.append(createDiagnosticChip("属性", healthState.props_ok || "unknown", healthState.props_ok === "no" && status === "error" ? "failed" : "applied"));
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
  let title = "status=not-applied";
  let detail = "没有读取到 apply.log 记录，暂时不能证明模块服务已在开机后运行。";

  if (rebootState.status === "error") {
    tone = "failed";
    title = "status=service-error";
    detail = rebootState.reason
      ? `service-state 报告服务异常：${rebootState.reason}。`
      : "service-state 报告服务异常；请检查模块文件和 apply.log。";
  } else if (rebootState.status === "skipped") {
    tone = "mismatch";
    title = "status=service-skipped";
    detail = rebootState.reason
      ? `service-state 报告已跳过运行时应用：${rebootState.reason}。`
        : "service-state 报告已跳过运行时应用；设备可能未匹配到可应用的运行时属性。";
  } else if (total || summary) {
    if (failed || mismatch) {
      tone = "failed";
      title = "status=apply-problem";
      detail = `${failed + mismatch} 项写入失败或未粘住，优先查看下方问题列表。`;
    } else if (!hasSettled) {
      tone = "mismatch";
      title = "status=partial-apply";
      detail = "apply.log 存在，但没有 settled 阶段；请确认已刷入最新包并开机等待至少 3 分钟。";
    } else if (diagnosticState.postApplyOverrides.length && !diagnosticState.unresolved.length && !diagnosticState.missing.length) {
      tone = "mismatch";
      title = "status=post-apply-override";
      detail = `apply.log 已写入成功，但 ${diagnosticState.postApplyOverrides.length} 项最终 getprop 被系统后置覆盖。`;
    } else if (diagnosticState.mismatches.length || diagnosticState.missing.length) {
      tone = "mismatch";
      title = "status=needs-follow-up";
      detail = `${diagnosticState.mismatches.length + diagnosticState.missing.length} 项最终 getprop 与 system.prop 不一致，需要回传完整诊断。`;
    } else {
      tone = "applied";
      title = "status=ok";
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
  dialog.querySelector('[data-action="save"]')?.addEventListener("click", () => saveDialogContent(content, options.savePath));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog && options.closeOnBackdrop === true) closeDialog(dialog);
  });
  document.body.append(dialog);
}

async function saveDialogContent(content, savePath) {
  const result = await writeBase64(savePath, content);

  if (result.code === 0) {
    setStatus(`已保存到 ${savePath}`, "ok");
  } else {
    setStatus(`保存失败：${result.stderr || result.stdout || result.code}`, "warn");
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

async function rebootDevice() {
  const ok = await showConfirm("确定现在重启设备吗？");
  if (!ok) return;
  setStatus("正在请求重启...");
  const result = await exec("reboot");
  if (result.code !== 0) {
    setStatus(`重启失败：${resultMessage(result)}`, "warn");
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

  renderShell();
  setPage("home");
  await refreshAll();
}

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
