# Changelog

## v2.2 (2026-06-23)

### Bug Fixes
- 修复 `device-monitor.js` 中 `computePowerFromMicrowatts()` 的 UTF-8 乱码字符串

### Refactor
- 提取 `parseKeyValue()` 和 `shellQuote()` 到 `utils.js`，消除 `device-monitor.js`、`system-info.js`、`bridge.js` 重复定义
- 将 `showDiagnostics()` 中硬编码的 `staticPart` shell 脚本提取为 `buildStaticDiagnosticShell()` 函数
- 优化定时器：离开首页时暂停 `refreshStats` 定时器，减少非必要请求
- 移除未使用的 `vendor/lucide.min.js` 引用
- 清理 CSS 中 `.link-row` 冗余的 grid 定义

### Security
- `buildDiagnosticShell()` 中 section title 的单引号现在会被正确转义，防止 shell 注入

## v2.1 (2026-06-23)

### Bug Fixes
- 修复 `openUrl()` 中因 UTF-8/GBK 编码损坏导致的乱码错误提示

### Refactor
- 新增 `buildDiagnosticShell()` 函数，从 `diagnosticSections` 动态生成诊断 shell 脚本，消除 prop 列表重复维护
- 拆分 `renderHome()` 为五个独立渲染函数

### CSS
- 修复 `.option-row` grid 布局，`select` 元素改为明确的 `grid-row: 2` 定位
- 移除全局 `select { grid-column: 2 }` 声明

## v2.0 (2026-06-06)

- 修复了一些已知问题

## v1.9 (2026-06-05)

- 修复了一些已知问题
