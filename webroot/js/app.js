import { MODULE_DIR, STATE_DIR, exec, readText, writeBase64 } from "./bridge.js";
import { countEnabled, loadJson, loadUserConfig, readGeneratedSystemProp, saveConfig } from "./config.js";
import { readSystemInfo } from "./system-info.js";
import { $, createElement, metric, setStatus, showConfirm } from "./ui.js";
import { shellQuote, resultMessage, parseKeyValueLines, parseStateFile } from "./utils.js";

const state = {
  meta: null,
  options: null,
  config: null,
  device: null,
  configSource: null,
  page: "home",
  systemInfo: null
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

  return [
    ...staticSections,
    { title: "--- managed props ---", props: allProps }
  ];
}


function buildDiagnosticShell() {
  const lines = [
    "echo '--- bridge ---'",
    "echo shell_ok",
    "GETPROP=/system/bin/getprop",
    "[ -x \"$GETPROP\" ] || GETPROP=getprop"
  ];
  for (const section of getDiagnosticSections()) {
    lines.push(`echo '${section.title.replace(/'/g, "'\"'\"'")}'`);
    for (const prop of section.props) {
      lines.push(`"$GETPROP" ${prop}`);
    }
  }
  return lines.join("\n");
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

async function loadMeta() {
  const meta = await loadJson("./data/app-meta.json", {
    moduleName: "Dex2oat Lock",
    version: "v2.9",
    githubUrl: ""
  });
  const moduleProp = parseModuleProp(await readText(`${MODULE_DIR}/module.prop`));

  return {
    ...meta,
    moduleName: moduleProp.name || meta.moduleName,
    version: moduleProp.version || meta.version
  };
}

async function loadDeviceState() {
  const device = parseStateFile(await readText(`${STATE_DIR}/device.prop`));
  if (!device.vendor) {
    device.vendor = "oplus";
    device.label = "OPlus-family";
  }
  return device;
}

async function loadConfigSource() {
  return parseStateFile(await readText(`${STATE_DIR}/config-source.prop`));
}

async function loadOptionsForDevice(device) {
  const vendors = await loadJson("./data/vendors.json", { vendors: [] });
  const found = vendors.vendors.find((v) => v.id === device.vendor);
  const optionsPath = found ? `./data/${found.options}` : "./data/options.json";
  return loadJson(optionsPath, { categories: [] });
}

function renderShell() {
  $("#app").innerHTML = `
    <header class="topbar">
      <div class="brand">
        <span class="brand-logo" aria-hidden="true">D</span>
        <div class="brand-text">
          <h1>${state.meta.moduleName}</h1>
          <p>${state.meta.version}</p>
        </div>
      </div>
      <div class="top-actions">
        <button class="icon-button" id="refreshButton" title="刷新">↻</button>
        <button class="icon-button" id="rebootButton" title="重启">⏻</button>
      </div>
    </header>
    <main id="page"></main>
    <nav class="bottom-nav">
      <button data-page="home">主页</button>
      <button data-page="safe" class="safe">安全</button>
      <button data-page="caution" class="caution">谨慎</button>
      <button data-page="aggressive" class="aggressive">危险</button>
      <button data-page="history">历史</button>
    </nav>
    <div class="status" id="statusMessage" data-tone="neutral">准备就绪</div>
  `;

  $("#refreshButton").addEventListener("click", refreshAll);
  $("#rebootButton").addEventListener("click", rebootDevice);

  document.querySelectorAll(".bottom-nav button").forEach((button) => {
    button.addEventListener("click", () => setPage(button.dataset.page));
  });
}

function setPage(page) {
  state.page = page;
  document.querySelectorAll(".bottom-nav button").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === page);
  });
  renderPage();
}

function renderPage() {
  if (state.page === "home") {
    renderHome();
  } else if (state.page === "history") {
    renderHistory();
  } else {
    renderCategory(state.page);
  }
}

function createStatusCard() {
  const rebootState = state.config.rebootState || {};
  const isIntact = !state.config.pendingReboot && (!rebootState.serviceFailedTotal || rebootState.serviceFailedTotal === 0) && (!rebootState.serviceMismatchTotal || rebootState.serviceMismatchTotal === 0);
  const label = state.config.pendingReboot ? "待重启" : (isIntact ? "完整性通过 ✓" : rebootState.label || "已生效");
  const hero = createElement("section", "module-status-card is-working");
  hero.innerHTML = `
    <div class="module-status-content">
      <div class="module-status-title">模块运行中</div>
      <div class="module-status-version">${state.meta.version}</div>
      <div class="module-status-meta">
        <span>已启用 ${countEnabled(state.config)} 项属性</span>
      </div>
      <div class="module-status-reboot">${label}</div>
    </div>
    <div class="module-status-mark" aria-hidden="true"></div>
  `;
  return hero;
}

function createSummaryBand() {
  const info = state.systemInfo || {};
  const summary = createElement("section", "summary-band");
  summary.append(metric("设备", info.model || "暂不可用"));
  summary.append(metric("厂商配置", state.device?.label || state.device?.vendor || "OPlus-family"));
  summary.append(metric("配置来源", sourceLabel(state.configSource)));
  summary.append(metric("模块版本", state.configSource?.version || state.meta.version));
  summary.append(metric("系统", `${info.android || "暂不可用"} · ${info.coloros || "Unknown"}`));
  summary.append(metric("Root", info.root || "暂不可用"));
  summary.append(metric("内核", info.kernel || "暂不可用"));
  return summary;
}

function sourceLabel(source) {
  switch (source?.source) {
    case "dex2oat-match":
      return `dex2oat 属性抓取匹配 · ${source.matched_total || 0} 项`;
    case "webui-custom":
      return "WebUI 自定义";
    case "template":
      return "厂商模板";
    case "template-fallback":
      return "dex2oat 匹配失败，已回退模板";
    default:
      return "暂不可用";
  }
}

function createModuleStateSection() {
  const info = state.systemInfo || {};
  const rebootState = state.config.rebootState || {};
  const label = rebootState.label || (state.config.pendingReboot ? "待重启" : "已生效");
  const moduleState = createSection("运行状态", label);
  const moduleGrid = createElement("div", "metric-grid compact");
  moduleGrid.append(metric("写入异常", `${rebootState.serviceFailedTotal || 0} 失败 / ${rebootState.serviceMismatchTotal || 0} 未粘住`));
  moduleGrid.append(metric("内核", info.kernel || "暂不可用"));
  moduleGrid.append(metric("状态依据", rebootState.reason || "暂不可用"));
  moduleState.append(moduleGrid);
  return moduleState;
}

function createLinkRow() {
  const githubLabel = state.meta.githubUrl ? "打开 GitHub" : "GitHub 待填写";
  const links = createElement("section", "link-row");
  links.append(createButton(githubLabel, "wide-button", () => openUrl(state.meta.githubUrl)));
  links.append(createButton("查看 system.prop", "wide-button", showSystemProp));
  links.append(createButton("诊断输出", "wide-button", showDiagnostics));
  links.append(createButton("重新抓取匹配", "wide-button", rerunDex2oatMatch));
  links.append(createButton("安装历史", "wide-button", () => setPage("history")));
  return links;
}

function renderHome() {
  const page = $("#page");
  page.innerHTML = "";
  page.append(createStatusCard());
  page.append(createSummaryBand());
  page.append(createModuleStateSection());
  page.append(createLinkRow());
}

function createSection(title, meta) {
  const section = createElement("section", "section");
  section.innerHTML = `
    <div class="section-title">
      <h2>${title}</h2>
      ${meta ? `<span>${meta}</span>` : ""}
    </div>
  `;
  return section;
}

function createButton(text, className, onClick) {
  const button = createElement("button", className, text);
  button.addEventListener("click", onClick);
  return button;
}

function renderCategory(categoryId) {
  const category = categoryById(categoryId);
  const page = $("#page");
  page.innerHTML = "";

  const header = createElement("section", `profile-header ${category.tone}`);
  header.innerHTML = `<h2>${category.title}</h2><p>${category.description}</p>`;
  page.append(header);

  const list = createElement("section", "option-list");

  for (const item of category.items) {
    const itemState = state.config.items[item.id] || { enabled: item.defaultEnabled, value: item.defaultValue };
    const row = createElement("article", "option-row");
    row.innerHTML = `
      <label class="switch">
        <input type="checkbox" ${itemState.enabled ? "checked" : ""} />
        <span></span>
      </label>
      <div class="option-copy">
        <h3>${item.label}</h3>
        <p>${item.description}</p>
        <code>${item.prop}</code>
      </div>
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

    checkbox.addEventListener("change", () => {
      if (categoryId === "aggressive" && checkbox.checked) {
        const ok = showConfirm("危险选项可能影响性能、兼容性、安装耗时或 OTA 后维护流程。确定启用吗？");
        if (!ok) {
          checkbox.checked = false;
          return;
        }
      }
      updateOption(item.id, { enabled: checkbox.checked });
    });

    select.addEventListener("change", () => {
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
  setStatus("正在刷新设备信息...");
  try {
    state.systemInfo = await readSystemInfo();
    renderPage();
    setStatus("设备信息已刷新", "ok");
  } catch (error) {
    setStatus(`刷新失败：${error.message}`, "warn");
  }
}

async function refreshSystemInfo() {
  state.systemInfo = await readSystemInfo();
}

async function saveCurrentConfig() {
  setStatus("正在保存配置...");
  const nextConfig = {
    ...state.config,
    profile: state.page
  };
  try {
    state.config = await saveConfig(state.options, nextConfig);
    await writeBase64(`${STATE_DIR}/config-source.prop`, `source=webui-custom\nvendor=${state.device?.vendor || "unknown"}\nupdated_at=${Math.floor(Date.now() / 1000)}\nversion=${state.configSource?.version || state.meta.version}\n`);
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
  const ok = showConfirm("重新抓取并匹配会覆盖当前 system.prop，确定继续吗？");
  if (!ok) return;

  setStatus("正在重新抓取并匹配...");
  const vendor = state.device?.vendor || "oplus";
  const optionsFile = vendor === "xiaomi" ? "options-xiaomi.json" : "options.json";
  const command = [
    `sh ${shellQuote(`${MODULE_DIR}/scripts/capture-props.sh`)} ${shellQuote(`${STATE_DIR}/captured-props.txt`)} ${shellQuote("/storage/emulated/0/Download/dex2oat-captured-props.txt")}`,
    `sh ${shellQuote(`${MODULE_DIR}/scripts/match-props.sh`)} ${shellQuote(`${STATE_DIR}/captured-props.txt`)} ${shellQuote(`${MODULE_DIR}/webroot/data/${optionsFile}`)} ${shellQuote(`${MODULE_DIR}/props/${vendor}.prop`)} ${shellQuote(`${MODULE_DIR}/system.prop`)} ${shellQuote(`${STATE_DIR}/matched-props.txt`)} ${shellQuote(`${STATE_DIR}/match-report.txt`)} ${shellQuote(`${STATE_DIR}/config-source.prop`)} ${shellQuote(vendor)} ${shellQuote(state.meta.version)}`
  ].join(" && ");

  const result = await exec(command);
  state.configSource = await loadConfigSource();
  renderPage();
  setStatus(result.code === 0 ? "重新匹配完成，重启后生效" : `重新匹配失败：${resultMessage(result)}`, result.code === 0 ? "warn" : "warn");
}

async function renderHistory() {
  const page = $("#page");
  page.innerHTML = "";
  const section = createSection("安装历史", "install.log");
  const content = createElement("pre", "history-log", "正在读取...");
  section.append(content);
  page.append(section);

  const log = await readText(`${STATE_DIR}/install.log`);
  content.textContent = log || "暂无安装历史";
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
    "echo '--- device state ---'",
    "cat /data/adb/dex2oat-lock/device.prop 2>/dev/null",
    "echo '--- current system.prop ---'",
    "cat /data/adb/modules/dex2oat-lock/system.prop 2>/dev/null",
    "echo '--- config source ---'",
    "cat /data/adb/dex2oat-lock/config-source.prop 2>/dev/null",
    "echo '--- ds match report ---'",
    "cat /data/adb/dex2oat-lock/match-report.txt 2>/dev/null",
    "echo '--- captured props ---'",
    "cat /data/adb/dex2oat-lock/captured-props.txt 2>/dev/null",
    "echo '--- reboot state ---'",
    "cat /proc/sys/kernel/random/boot_id 2>/dev/null",
    "cat /data/adb/dex2oat-lock/service-state.prop 2>/dev/null",
    "echo '--- uninstall state ---'",
    "cat /data/adb/dex2oat-lock-uninstall.prop 2>/dev/null",
    "echo '--- apply log ---'",
    "tail -n 120 /data/adb/dex2oat-lock/service.log 2>/dev/null || true"
  ].join("\n");
}

async function showDiagnostics() {
  setStatus("正在读取诊断输出...");
  const dynamicPart = buildDiagnosticShell();
  const staticPart = buildStaticDiagnosticShell();
  const result = await exec(`${dynamicPart}\n${staticPart}`);

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
  const diagnosticState = buildDiagnosticState(content, applyLog, desiredProps);
  showDialog("诊断输出", content, createDiagnosticSummary(applyLog, diagnosticState, rebootState, installState, uninstallState), {
    savePath: `${STATE_DIR}/logs/webui-diagnostic.txt`
  });
}

function createDiagnosticSummary(applyLog, diagnosticState, rebootState, installState, uninstallState) {
  const section = createElement("section", "diagnostic-stack");
  section.append(createLifecycleStateSummary(installState, uninstallState));
  section.append(createRebootStateSummary(rebootState, applyLog.passSummaries));
  section.append(createFinalPropSummary(diagnosticState));
  section.append(createApplyLogSummary(applyLog, diagnosticState, rebootState));
  return section;
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
  chips.append(createDiagnosticChip("服务", rebootState.status || "未知", rebootState.status === "settled" ? "applied" : "mismatch"));
  chips.append(createDiagnosticChip("健康", rebootState.health || "未知", rebootState.health === "problem" ? "failed" : "applied"));
  chips.append(createDiagnosticChip("阶段", rebootState.phase || "未知", rebootState.phase === "settled" ? "applied" : "mismatch"));
  chips.append(createDiagnosticChip("异常", `${rebootState.failedTotal || 0}/${rebootState.mismatchTotal || 0}`, rebootState.failedTotal || rebootState.mismatchTotal ? "failed" : "applied"));
  chips.append(createDiagnosticChip("settled", rebootState.settledAt ? "已记录" : "缺失", rebootState.settledAt ? "applied" : "mismatch"));
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
      : "服务已跳过运行时属性应用；设备可能不在 OPlus/Xiaomi 支持范围。";
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
        : "service-state 报告已跳过运行时应用；设备可能不在 OPlus/Xiaomi 支持范围。";
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

function showDialog(title, content, beforeContent, options = {}) {
  const dialog = createElement("div", "dialog");
  const saveButton = options.savePath ? '<button class="text-button" data-action="save">保存</button>' : "";
  dialog.innerHTML = `
    <div class="dialog-panel">
      <div class="section-title">
        <h2>${title}</h2>
        <div class="dialog-actions">
          ${saveButton}
          <button class="text-button" data-action="copy">复制</button>
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
  pre.textContent = content;
  dialog.querySelector('[data-action="close"]').addEventListener("click", () => dialog.remove());
  dialog.querySelector('[data-action="copy"]').addEventListener("click", () => copyDialogContent(content, pre));
  dialog.querySelector('[data-action="save"]')?.addEventListener("click", () => saveDialogContent(content, options.savePath));
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
  const ok = showConfirm("确定现在重启设备吗？");
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
  state.meta = await loadMeta();
  state.device = await loadDeviceState();
  state.configSource = await loadConfigSource();
  state.options = await loadOptionsForDevice(state.device);
  state.config = await loadUserConfig(state.options);

  renderShell();
  setPage("home");
  await refreshAll();
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
