# Changelog

## v2.5 (2026-06-23)


- **属性扩展**：基于一加13 / 13T / ACE5至尊版三台真机 dump，新增 20 项编译控制属性（ocompiler、ZygoteC、CPU 亲和性、MTK 激进调度、堆大小、madvise 阈值、profile 首次保存延迟等），总计 77 项
- **分类重构**：安全 36 项、谨慎 32 项、危险 9 项，按功能而非风险重新划分
- **UI 精简**：移除实时监控面板、QQ 群、服务阶段、background.jpg 等冗余元素；状态卡片整合
- **Bug 修复**：12 项修复 — UTF-8 乱码、Shell 整数溢出、df -Pk 兼容性、getprop fallback、writeBase64 分块编码、applySystemPropState Map 重写、bootId 空值保护、600s 超时等
- **代码重构**：parseKeyValueLines / parseStateFile 提取到 utils.js 共享；删除 device-monitor.js
- **新增抓取脚本**：`dex2oat-属性抓取.sh`，保持原始 su -c getprop | grep 管道风格

### 补丁（同版本修复）
- 修复 service.sh / customize.sh 缺失 20 个属性的模式匹配，导致 ocompiler、CPU 亲和性、MTK 激进调度、堆大小、madvise 等属性不会被应用或备份
- 修复 app.js diagnosticSections 硬编码列表仅覆盖部分属性（40 遗漏），现动态从 options.json 生成
- 修复 system.prop 未包含新增的 20 项属性，且危险区域仍为旧 verify 值
- 修复 README.md 仍引用已删除的 device-monitor.js、安全方案表格仅列 11/36 项
- service.sh / customize.sh 属性匹配统一使用更宽泛模式避免遗漏

**重要**：若你此前安装过 v2.5，请重新刷入此 ZIP 以修复上述问题。无需卸载，覆盖刷入即可。

### Bug Fixes
- 修复 device-monitor.js 中 computePowerFromMicrowatts() 的 UTF-8 乱码字符串（确认修复）
- 修复 Shell 端 `C * V / 1000000` 整数溢出导致功耗计算错误（改用 JS 端直接计算）
- 修复诊断面板 `buildStaticDiagnosticShell()` 产生重复 apply.log 条目导致统计数据翻倍
- 修复 `df` 解析在某些 Android 版本因输出格式差异导致 `/data` 存储不可用（改用 POSIX `-Pk`）
- 修复 `buildDiagnosticShell()` 硬编码 `/system/bin/getprop` 在部分设备不可用
- 修复 `showDiagnostics()` 中 getprop 路径无 fallback 的问题
- 修复 `loadMeta()` 默认版本号仍为 v2.3 未与模块同步
- 修复 `writeBase64()` 中大型 base64 字符串可能超出 shell 参数长度限制
- 修复 `shouldClearPendingReboot()` 在 bootId 不可读时永远不清除待重启状态
- 修复 `applySystemPropState()` 中同一 prop 出现在多类别时映射错乱
- 修复 `computePowerFromMicroamps()` 在 µ-unit 和 m-unit 均无数据时回退到电压量级启发式算法
- 修复 `applySystemPropState()` 中 `#` 前缀行被误解析为注释（allowComments=false 保留完整属性）

### Edge Case Handling
- 选项默认值不在可选值列表中时自动回退到 defaultValue
- 启动等待 `sys.boot_completed` 增加 600 秒超时，防止永久阻塞
- SoC 温度读取扩展匹配 `tsens`、`virt`、`therm` 等更多热区命名

### Refactor
- 提取 `parseKeyValueLines()` 和 `parseStateFile()` 到 utils.js，消除 app.js 和 config.js 中 5 处重复的 key=value 解析逻辑
- 合并 parseDiagnosticStateSection / parseDiagnosticRebootState 为通用 `parseDiagnosticSection()` + `parseStateFile()` 组合
- 删除 device-monitor.js（实时监控面板已移除）
- 删除 device-monitor.sh shell fallback 中易溢出的手工功耗计算

### UI
- 重新布局首页：去掉实时状态面板、QQ 群显示、服务阶段/健康状态、完整性校验提示、ColorOS Edition 品牌
- 状态卡片整合：显示"完整性通过 ✓"（无待重启且无写入失败时）
- 内核信息移入运行状态区域

### Module
- options.json 重新分类：安全 36 项（压制后台编译/阈值/缓存/madvise/OPlus私有触发）、谨慎 32 项（线程/CPU绑定/GC/heap/profile/JIT/MTK 激进调度）、危险 9 项（全量 AOT everything）
- 新增基于真实设备抓取编译相关属性：OPlus 编译器(ocompiler)、ZygoteC/ocomp、runtime 命名空间 dexopt/merge 开关、dex2oat CPU 亲和性、MTK 激进调度、dex2oat 堆大小、odex/vdex madvise 阈值、profile 首次保存延迟
- 移除 module.prop 中 ColorOS/background.jpg/webuiIcon
- 移除 app-meta.json 中 ColorOS Edition/qqGroup

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
