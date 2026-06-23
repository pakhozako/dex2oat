# Changelog

## v2.4 (2026-06-23)

### Bug Fixes
- 修复实时功耗始终显示 0.00W 或"暂不可用"的问题：修复乱码字符串、优化零值处理、添加 fallback 功耗计算
- 修复 computePowerFromMicrowatts 返回乱码字符串导致 fallback 逻辑失效

### UI
- 全新 UI 设计：去除粉色色调，改用蓝灰色系
- 移除毛玻璃效果，改用半透明纯色背景
- 降低字重（800 → 600-700），更易阅读
- 深色模式改用深蓝灰色背景（#0f1117），替代纯黑
- Profile header 改用左侧色条区分三档
- Switch 开关重新设计，更简洁
- 优化卡片间距和圆角

## v2.3 (2026-06-23)

### Bug Fixes
- 修复 device-monitor.js 中 computePowerFromMicrowatts() 的 UTF-8 乱码字符串（v2.2 修复未生效）
- 修复 updateOption() 中 item.prop 可能为 undefined 导致的 TypeError
- 修复 loadMeta() fallback 版本号硬编码为 v2.1 的问题

### Refactor
- 提取 resultMessage() 到 utils.js，消除 app.js 和 config.js 重复定义
- 删除 app.js 中重复的 shellQuote() 本地定义，改为从 utils.js 导入
- refreshStats() 现在跳过非首页，减少非必要设备状态请求
- openUrl() 失败时记录 console.warn 日志
- bridge.js 的 writeBase64() 使用 TextEncoder 替代废弃的 unescape()
- config.js 的 saveConfig() 使用 shellQuote() 转义 shell 路径，防止注入

### CSS
- 将 diagnostic-chip-row 的 2 列断点从 360px 提高到 480px，改善中等屏幕显示

## v2.2 (2026-06-23)

### Bug Fixes
- 修复 device-monitor.js 中 computePowerFromMicrowatts() 的 UTF-8 乱码字符串

### Refactor
- 提取 parseKeyValue() 和 shellQuote() 到 utils.js，消除三个文件重复定义
- 将 showDiagnostics() 中硬编码的 staticPart shell 脚本提取为 buildStaticDiagnosticShell() 函数
- 移除未使用的 vendor/lucide.min.js 引用
- 清理 CSS 中 .link-row 冗余的 grid 定义

### Security
- buildDiagnosticShell() 中 section title 的单引号现在会被正确转义，防止 shell 注入

## v2.1 (2026-06-23)

### Bug Fixes
- 修复 openUrl() 中因 UTF-8/GBK 编码损坏导致的乱码错误提示

### Refactor
- 新增 buildDiagnosticShell() 函数，从 diagnosticSections 动态生成诊断 shell 脚本
- 拆分 renderHome() 为五个独立渲染函数

### CSS
- 修复 .option-row grid 布局
- 移除全局 select { grid-column: 2 } 声明

## v2.0 (2026-06-06)

- 修复了一些已知问题

## v1.9 (2026-06-05)

- 修复了一些已知问题
