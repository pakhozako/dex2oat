import { MODULE_DIR, STATE_DIR, exec, readText, writeBase64 } from "./bridge.js";
import { countEnabled, loadJson, loadUserConfig, readGeneratedSystemProp, resetSafeProfile, saveConfig } from "./config.js";
import { readDeviceStats } from "./device-monitor.js";
import { readSystemInfo } from "./system-info.js";
import { $, createElement, metric, setStatus, showConfirm } from "./ui.js";

const state = {
  meta: null,
  options: null,
  config: null,
  page: "home",
  systemInfo: null,
  stats: null
};

function categoryById(id) {
  return state.options.categories.find((category) => category.id === id);
}

function parseModuleProp(content) {
  const result = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    result[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }

  return result;
}

function resultMessage(result) {
  return result.stderr || result.stdout || `exit ${result.code}`;
}

function commandUrl(value) {
  return String(value || "").replace(/"/g, '\\"');
}

async function loadMeta() {
  const meta = await loadJson("./data/app-meta.json", {
    moduleName: "Dex2oat Lock",
    version: "v1.9",
    edition: "ColorOS Edition"
  });
  const moduleProp = parseModuleProp(await readText(`${MODULE_DIR}/module.prop`));

  return {
    ...meta,
    moduleName: moduleProp.name || meta.moduleName,
    version: moduleProp.version || meta.version
  };
}

function renderShell() {
  $("#app").innerHTML = `
    <header class="topbar">
      <div class="brand">
        <span class="brand-logo" aria-hidden="true">D</span>
        <div class="brand-text">
          <h1>${state.meta.moduleName}</h1>
          <p>${state.meta.version} · ${state.meta.edition}</p>
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
  } else {
    renderCategory(state.page);
  }
}

function renderHome() {
  const page = $("#page");
  const info = state.systemInfo || {};
  const stats = state.stats || {};
  const githubLabel = state.meta.githubUrl ? "打开 GitHub" : "GitHub 待填写";
  const qqLabel = state.meta.qqGroup ? `QQ 群 ${state.meta.qqGroup}` : "QQ 群待填写";

  page.innerHTML = "";

  const hero = createElement("section", "module-status-card is-working");
  hero.innerHTML = `
    <div class="module-status-content">
      <div class="module-status-title">模块运行中</div>
      <div class="module-status-version">${state.meta.version}</div>
      <div class="module-status-meta">
        <span>已验证✅</span>
        <span>${state.meta.edition}</span>
      </div>
    </div>
    <div class="module-status-mark" aria-hidden="true"></div>
  `;
  page.append(hero);

  const summary = createElement("section", "summary-band");
  summary.append(metric("设备", info.model || "暂不可用"));
  summary.append(metric("系统", `${info.android || "暂不可用"} · ${info.coloros || "Unknown"}`));
  summary.append(metric("Root", info.root || "暂不可用"));
  summary.append(metric("已开机", stats.uptime || "暂不可用"));
  page.append(summary);

  const realtime = createSection("实时状态", "自动刷新");
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

  const moduleState = createSection("模块状态", state.config.pendingReboot ? "待重启" : "已生效");
  const moduleGrid = createElement("div", "metric-grid compact");
  moduleGrid.append(metric("当前档位", categoryById(state.config.profile)?.title || "安全"));
  moduleGrid.append(metric("启用属性", `${countEnabled(state.config)} 项`));
  moduleGrid.append(metric("待重启应用", state.config.pendingReboot ? "是" : "否"));
  moduleGrid.append(metric("内核", info.kernel || "暂不可用"));
  moduleState.append(moduleGrid);
  page.append(moduleState);

  const links = createElement("section", "link-row");
  links.append(createButton(githubLabel, "wide-button", () => openUrl(state.meta.githubUrl)));
  links.append(createButton(qqLabel, "wide-button", () => openUrl(state.meta.qqGroupUrl)));
  links.append(createButton("恢复安全默认", "wide-button", restoreSafe));
  links.append(createButton("查看 system.prop", "wide-button", showSystemProp));
  links.append(createButton("诊断输出", "wide-button", showDiagnostics));
  page.append(links);
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

    for (const value of item.values) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      option.selected = value === itemState.value;
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
  try {
    await Promise.all([refreshSystemInfo(), refreshStats()]);
    renderPage();
    setStatus("设备信息已刷新", "ok");
  } catch (error) {
    setStatus(`刷新失败：${error.message}`, "warn");
  }
}

async function refreshSystemInfo() {
  state.systemInfo = await readSystemInfo();
}

async function refreshStats() {
  state.stats = await readDeviceStats();
  if (state.page === "home") renderHome();
}

async function saveCurrentConfig() {
  setStatus("正在保存配置...");
  state.config.profile = state.page;
  try {
    state.config = await saveConfig(state.options, state.config);
    renderPage();
    setStatus("已保存，重启后生效", "warn");
  } catch (error) {
    setStatus(`保存失败：${error.message}`, "warn");
  }
}

async function restoreSafe() {
  const ok = showConfirm("确定恢复安全默认配置吗？");
  if (!ok) return;
  const safeConfig = resetSafeProfile(state.options);
  try {
    state.config = await saveConfig(state.options, safeConfig);
    renderPage();
    setStatus("已恢复安全默认，重启后生效", "warn");
  } catch (error) {
    setStatus(`恢复失败：${error.message}`, "warn");
  }
}

async function showSystemProp() {
  const content = await readGeneratedSystemProp();
  showDialog("system.prop", content || "暂不可用");
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
echo '--- dexopt props ---'
/system/bin/getprop pm.dexopt.bg-dexopt
/system/bin/getprop pm.dexopt.install
/system/bin/getprop pm.dexopt.boot-after-ota
/system/bin/getprop pm.dexopt.post-boot
/system/bin/getprop dalvik.vm.dex2oat-filter
/system/bin/getprop dalvik.vm.dex2oat-resolve-startup-strings
/system/bin/getprop dalvik.vm.dexopt.secondary
/system/bin/getprop dalvik.vm.dexopt.thermal-cutoff
/system/bin/getprop dalvik.vm.enable_pr_dexopt
/system/bin/getprop dalvik.vm.pr_dexopt_async_for_ota
/system/bin/getprop dalvik.vm.bgdexopt.new-classes-percent
/system/bin/getprop dalvik.vm.bgdexopt.new-methods-percent
/system/bin/getprop dalvik.vm.background-dex2oat-threads
/system/bin/getprop persist.dalvik.vm.dex2oat-threads
/system/bin/getprop dalvik.vm.usejit
/system/bin/getprop dalvik.vm.useartservice
/system/bin/getprop dalvik.vm.jitmaxsize
/system/bin/getprop dalvik.vm.ps-min-save-period-ms
/system/bin/getprop system_perf_init.bg-dex2oat-threads
/system/bin/getprop system_perf_init.boot-dex2oat-threads
/system/bin/getprop system_perf_init.dex2oat-threads
echo '--- ART services ---'
/system/bin/getprop init.svc.artd
/system/bin/getprop init.svc.art_boot
/system/bin/getprop init.svc_debug_pid.artd
/system/bin/getprop init.svc_debug_pid.art_boot
echo '--- ColorOS runtime props ---'
/system/bin/getprop persist.sys.oplus.bgdex2oat_enabled
/system/bin/getprop persist.sys.feature.compile.re.cache.miss
/system/bin/getprop persist.sys.feature.compile.re.fmap.size
/system/bin/getprop persist.device_config.runtime_native.use_app_image_startup_cache
/system/bin/getprop persist.device_config.runtime_native_boot.iorap_readahead_enable
/system/bin/getprop persist.device_config.runtime_native_boot.iorap_perfetto_enable
/system/bin/getprop oplus.dex.tempcontrol
/system/bin/getprop sys.oplus.dalvik_sync_config
/system/bin/getprop sys.heap.optimize.enable
/system/bin/getprop sys.furtherHeapEnlarge.optimize.enable
/system/bin/getprop sys.gcsupression.optimize.enable
echo '--- meminfo ---'
cat /proc/meminfo | head -n 8
echo '--- battery ---'
ls -l /sys/class/power_supply/battery 2>/dev/null
cat /sys/class/power_supply/battery/capacity 2>/dev/null
cat /sys/class/power_supply/battery/status 2>/dev/null
cat /sys/class/power_supply/battery/temp 2>/dev/null
echo '--- storage ---'
df -k /data 2>/dev/null
echo '--- apply log ---'
grep -E 'Runtime property apply pass completed|Runtime property apply completed|Applied:|Matched:|Mismatch:|Failed:' /data/adb/dex2oat-lock/logs/apply.log 2>/dev/null | tail -n 80
echo '--- apply log tail ---'
tail -n 80 /data/adb/dex2oat-lock/logs/apply.log 2>/dev/null
`.trim());

  showDiagnosticsDialog(`errno=${result.code}\n\n${result.stdout || ""}\n${result.stderr || ""}`);
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

function showDiagnosticsDialog(content) {
  const applyLog = parseApplyLog(content);
  showDialog("诊断输出", content, createApplyLogSummary(applyLog), {
    savePath: `${STATE_DIR}/logs/webui-diagnostic.txt`
  });
}

function createApplyLogSummary({ groups, passSummaries, summary }) {
  const total = Object.values(groups).reduce((count, rows) => count + rows.length, 0);
  const section = createElement("section", "diagnostic-summary");

  const header = createElement("div", "diagnostic-summary-head");
  header.append(createElement("strong", "", "apply.log 摘要"));
  header.append(createElement("span", "", summary || (total ? `${total} 条记录` : "未读取到 apply.log 摘要")));
  section.append(header);
  section.append(createDiagnosticConclusion(groups, passSummaries, total, summary));

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

  return section;
}

function createDiagnosticConclusion(groups, passSummaries, total, summary) {
  const failed = groups.failed.length;
  const mismatch = groups.mismatch.length;
  const hasSettled = passSummaries.some((pass) => pass.phase === "settled");
  const latestPass = passSummaries.at(-1);
  const conclusion = createElement("div", "diagnostic-conclusion");
  let tone = "mismatch";
  let title = "status=not-applied";
  let detail = "没有读取到 apply.log 记录，暂时不能证明模块服务已在开机后运行。";

  if (total || summary) {
    if (failed || mismatch) {
      tone = "failed";
      title = "status=apply-problem";
      detail = `${failed + mismatch} 项写入失败或未粘住，优先查看下方问题列表。`;
    } else if (!hasSettled) {
      tone = "mismatch";
      title = "status=partial-apply";
      detail = "apply.log 存在，但没有 settled 阶段；请确认已刷入最新包并开机等待至少 3 分钟。";
    } else {
      tone = "applied";
      title = "status=ok";
      detail = "initial/recheck/settled 均已记录，且 apply.log 未发现失败或未粘住项。";
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
  const result = await exec(`am start -a android.intent.action.VIEW -d "${commandUrl(url)}"`);
  if (result.code !== 0) {
    setStatus(`打开链接失败：${resultMessage(result)}`, "warn");
  }
}

async function start() {
  state.meta = await loadMeta();
  state.options = await loadJson("./data/options.json", { categories: [] });
  state.config = await loadUserConfig(state.options);

  renderShell();
  setPage("home");
  await refreshAll();

  setInterval(refreshStats, 3000);
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
