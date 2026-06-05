import { exec } from "./bridge.js";
import { countEnabled, loadJson, loadUserConfig, readGeneratedSystemProp, resetSafeProfile, saveConfig } from "./config.js";
import { readDeviceStats } from "./device-monitor.js";
import { readRunningApps } from "./running-apps.js";
import { readSystemInfo } from "./system-info.js";
import { $, createElement, metric, setStatus, showConfirm } from "./ui.js";

const state = {
  meta: null,
  options: null,
  config: null,
  page: "home",
  systemInfo: null,
  stats: null,
  running: null,
  runningExpanded: false
};

function categoryById(id) {
  return state.options.categories.find((category) => category.id === id);
}

function renderShell() {
  $("#app").innerHTML = `
    <header class="topbar">
      <div>
        <h1>${state.meta.moduleName}</h1>
        <p>${state.meta.version} · ${state.meta.edition}</p>
      </div>
      <div class="top-actions">
        <button class="icon-button" id="refreshButton" title="刷新">↻</button>
        <button class="icon-button" id="rebootButton" title="重启">⏻</button>
      </div>
    </header>
    <main id="page"></main>
    <nav class="bottom-nav">
      <button data-page="home">首页</button>
      <button data-page="safe" class="safe">安全</button>
      <button data-page="caution" class="caution">谨慎</button>
      <button data-page="aggressive" class="aggressive">激进</button>
    </nav>
    <div class="status" id="statusMessage" data-tone="neutral">准备就绪</div>
  `;

  $("#refreshButton").addEventListener("click", refreshAll);
  $("#rebootButton").addEventListener("click", rebootDevice);

  document.querySelectorAll(".bottom-nav button").forEach((button) => {
    button.addEventListener("click", () => {
      setPage(button.dataset.page);
    });
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
  } else {
    renderCategory(state.page);
  }
}

function renderHome() {
  const page = $("#page");
  const info = state.systemInfo || {};
  const stats = state.stats || {};
  const running = state.running || {};
  const githubLabel = state.meta.githubUrl ? "打开 GitHub" : "GitHub 待填写";
  const qqLabel = state.meta.qqGroup ? `QQ群 ${state.meta.qqGroup}` : "QQ群待填写";

  page.innerHTML = "";

  const summary = createElement("section", "summary-band");
  summary.append(metric("设备", info.model || "暂不可用"));
  summary.append(metric("系统", `${info.android || "暂不可用"} · ${info.coloros || "Unknown"}`));
  summary.append(metric("Root", info.root || "暂不可用"));
  summary.append(metric("已开机", stats.uptime || "暂不可用"));
  page.append(summary);

  const realtime = createElement("section", "section");
  realtime.innerHTML = `<div class="section-title"><h2>实时状态</h2><span>自动刷新</span></div>`;
  const grid = createElement("div", "metric-grid");
  grid.append(metric("电量", stats.battery || "暂不可用"));
  grid.append(metric("状态", stats.batteryStatus || "暂不可用"));
  grid.append(metric("实时功耗", stats.power || "暂不可用"));
  grid.append(metric("电池温度", stats.batteryTemp || "暂不可用"));
  grid.append(metric("SoC 温度", stats.socTemp || "暂不可用"));
  grid.append(metric("物理内存", stats.memory || "暂不可用"));
  grid.append(metric("虚拟内存", stats.swap || "暂不可用"));
  grid.append(metric("/data 存储", stats.storage || "暂不可用"));
  realtime.append(grid);
  page.append(realtime);

  const runningSection = createElement("section", "section");
  runningSection.innerHTML = `
    <div class="section-title">
      <h2>正在运行</h2>
      <button class="text-button" id="runningRefresh">刷新</button>
    </div>
  `;
  const runningGrid = createElement("div", "metric-grid compact");
  runningGrid.append(metric("前台应用", running.foreground || "暂不可用"));
  runningGrid.append(metric("进程数量", running.count || "暂不可用"));
  runningSection.append(runningGrid);

  const toggle = createElement("button", "wide-button", state.runningExpanded ? "收起进程列表" : "展开查看运行中的应用");
  toggle.addEventListener("click", () => {
    state.runningExpanded = !state.runningExpanded;
    renderHome();
  });
  runningSection.append(toggle);

  if (state.runningExpanded) {
    const table = createElement("div", "process-list");
    for (const process of running.processes || []) {
      table.append(metric(`${process.pid} · ${process.name}`, process.rss));
    }
    runningSection.append(table);
  }

  page.append(runningSection);

  const moduleState = createElement("section", "section");
  moduleState.innerHTML = `<div class="section-title"><h2>模块状态</h2><span>${state.config.pendingReboot ? "待重启" : "已生效"}</span></div>`;
  const moduleGrid = createElement("div", "metric-grid compact");
  moduleGrid.append(metric("当前档位", categoryById(state.config.profile)?.title || "安全"));
  moduleGrid.append(metric("启用属性", `${countEnabled(state.config)} 项`));
  moduleGrid.append(metric("待重启应用", state.config.pendingReboot ? "是" : "否"));
  moduleGrid.append(metric("内核", info.kernel || "暂不可用"));
  moduleState.append(moduleGrid);
  page.append(moduleState);

  const links = createElement("section", "link-row");
  links.innerHTML = `
    <button class="wide-button" id="githubButton">${githubLabel}</button>
    <button class="wide-button" id="qqButton">${qqLabel}</button>
    <button class="wide-button" id="safeReset">恢复安全默认</button>
    <button class="wide-button" id="showProp">查看 system.prop</button>
    <button class="wide-button" id="diagnosticsButton">诊断输出</button>
  `;
  page.append(links);

  $("#runningRefresh").addEventListener("click", refreshRunning);
  $("#safeReset").addEventListener("click", restoreSafe);
  $("#showProp").addEventListener("click", showSystemProp);
  $("#diagnosticsButton").addEventListener("click", showDiagnostics);
  $("#githubButton").addEventListener("click", () => openUrl(state.meta.githubUrl));
  $("#qqButton").addEventListener("click", () => openUrl(state.meta.qqGroupUrl));
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

    for (const value of item.values) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      option.selected = value === itemState.value;
      select.append(option);
    }

    checkbox.addEventListener("change", () => {
      if (categoryId === "aggressive" && checkbox.checked) {
        const ok = showConfirm("激进选项可能增加发热、安装耗时或 OTA 风险。确定启用吗？");
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

    list.append(row);
  }

  page.append(list);

  const actions = createElement("section", "sticky-actions");
  actions.innerHTML = `
    <button class="primary-button ${category.tone}" id="saveButton">保存并生成 system.prop</button>
  `;
  page.append(actions);

  $("#saveButton").addEventListener("click", saveCurrentConfig);
}

function updateOption(id, patch) {
  if (patch.enabled) {
    const current = state.options.categories.flatMap((category) => category.items).find((item) => item.id === id);
    if (current) {
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
  await Promise.all([refreshSystemInfo(), refreshStats(), refreshRunning()]);
  renderPage();
  setStatus("设备信息已刷新", "ok");
}

async function refreshSystemInfo() {
  state.systemInfo = await readSystemInfo();
}

async function refreshStats() {
  state.stats = await readDeviceStats();
  if (state.page === "home") renderHome();
}

async function refreshRunning() {
  state.running = await readRunningApps();
  if (state.page === "home") renderHome();
}

async function saveCurrentConfig() {
  setStatus("正在保存配置...");
  state.config.profile = state.page;
  state.config = await saveConfig(state.options, state.config);
  renderPage();
  setStatus("已保存，重启后生效", "warn");
}

async function restoreSafe() {
  const ok = showConfirm("确定恢复安全默认配置吗？");
  if (!ok) return;
  state.config = resetSafeProfile(state.options);
  state.config = await saveConfig(state.options, state.config);
  renderPage();
  setStatus("已恢复安全默认，重启后生效", "warn");
}

async function showSystemProp() {
  const content = await readGeneratedSystemProp();
  const dialog = createElement("div", "dialog");
  dialog.innerHTML = `
    <div class="dialog-panel">
      <div class="section-title">
        <h2>system.prop</h2>
        <button class="text-button">关闭</button>
      </div>
      <pre></pre>
    </div>
  `;
  dialog.querySelector("pre").textContent = content || "暂不可用";
  dialog.querySelector("button").addEventListener("click", () => dialog.remove());
  document.body.append(dialog);
}

async function showDiagnostics() {
  setStatus("正在读取诊断输出...");
  const result = await exec(`
echo '--- bridge ---'
echo shell_ok
echo '--- getprop ---'
/system/bin/getprop ro.product.model
/system/bin/getprop ro.build.version.release
/system/bin/getprop ro.build.version.oplusrom
/system/bin/getprop ro.oplus.version
echo '--- meminfo ---'
cat /proc/meminfo | head -n 8
echo '--- battery ---'
ls -l /sys/class/power_supply/battery 2>/dev/null
cat /sys/class/power_supply/battery/capacity 2>/dev/null
cat /sys/class/power_supply/battery/status 2>/dev/null
cat /sys/class/power_supply/battery/temp 2>/dev/null
echo '--- storage ---'
df -k /data 2>/dev/null
`.trim());

  const dialog = createElement("div", "dialog");
  dialog.innerHTML = `
    <div class="dialog-panel">
      <div class="section-title">
        <h2>诊断输出</h2>
        <button class="text-button">关闭</button>
      </div>
      <pre></pre>
    </div>
  `;
  dialog.querySelector("pre").textContent = `errno=${result.code}\n\n${result.stdout || ""}\n${result.stderr || ""}`;
  dialog.querySelector("button").addEventListener("click", () => dialog.remove());
  document.body.append(dialog);
  setStatus("诊断输出已生成", "ok");
}

async function rebootDevice() {
  const ok = showConfirm("确定现在重启设备吗？");
  if (!ok) return;
  setStatus("正在请求重启...");
  await exec("reboot");
}

async function openUrl(url) {
  if (!url) {
    setStatus("链接还没有填写", "warn");
    return;
  }
  await exec(`am start -a android.intent.action.VIEW -d "${url}"`);
}

async function start() {
  state.meta = await loadJson("./data/app-meta.json", {
    moduleName: "Dex2oat Lock",
    version: "v1.1",
    edition: "ColorOS Edition"
  });
  state.options = await loadJson("./data/options.json", { categories: [] });
  state.config = await loadUserConfig(state.options);

  renderShell();
  setPage("home");
  await refreshAll();

  setInterval(refreshStats, 3000);
}

start();
