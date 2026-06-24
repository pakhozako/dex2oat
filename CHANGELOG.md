# Changelog

## v3.0 (2026-06-25)

### Multi-Vendor
- 新增 Samsung、Pixel、MIUI、Meizu、RedMagic 与 Generic 兜底模板。
- 安装期按 `ro.product.manufacturer` -> `ro.product.brand` -> `ro.product.system.manufacturer` 自动识别厂商。
- `device.prop` 新增 `detected_vendor`、`detected_source`、`detected_value`，便于诊断识别路径。
- 统一安装期、re-match 与 WebUI 的 vendor/options 映射，保留旧 `xiaomi` 状态兼容。

### Self-Healing
- 新增 `core/health-check.sh`、`core/conflict-detect.sh`、`core/prop-lock.sh`。
- 开机生成 `health.log`，检测关键文件与属性状态，并在关键文件缺失时自愈。
- 安装期与 re-match 后生成 `prop-lock.list`，避免 WebUI 保存后被旧锁定值覆盖。
- 冲突报告新增扫描状态、同名同值/异值标记与双方属性值。

### WebUI
- 首页新增健康状态指示，诊断输出新增 `health.log` 与 `conflict-report.txt`。
- 保存配置时同步 `system.prop.bak` 与 `prop-lock.list`，并保留未被 options 管理的启用属性。
- WebUI 写文件改为临时文件成功后再覆盖，降低写入失败导致配置损坏的风险。

### Reliability
- 扩大 dex2oat 自动匹配抓取范围，覆盖 `pm.dexopt.*`、`persist.device_config.*` 与厂商相关属性。
- `service.log` 与 `install.log` 增加轻量轮转，降低长期运行日志膨胀风险。
- 卸载清理 v3.0 新增状态文件，降低卸载重装污染。

## v2.9 (2026-06-24)

### Installer
- 新增安装时询问：是否执行 dex2oat 属性抓取并自动匹配配置
- 新增 `scripts/capture-props.sh`，安装期抓取当前设备 ART / dexopt / dex2oat 相关属性
- 新增 `scripts/match-props.sh`，按当前厂商模板和抓取结果生成匹配版 `system.prop`
- 匹配失败、抓取失败或用户拒绝时自动回退厂商模板，不中断安装

### Diagnostics
- 新增 `/data/adb/dex2oat-lock/config-source.prop`，记录配置来源：模板、dex2oat 属性抓取匹配或 WebUI 自定义
- 新增 `/data/adb/dex2oat-lock/captured-props.txt` 与 `match-report.txt`，便于反馈设备适配情况
- WebUI 首页显示配置来源，诊断输出包含抓取结果和匹配报告

### WebUI
- 移除选项卡片内的"收起卡片"按钮文字
- 点击整张卡片展开说明，再次点击同一张卡片收回

## v2.8 (2026-06-23)

### WebUI
- 点击整张卡片展开选项说明，不再需要"展开详情"按钮
- 展开后显示"收起卡片"按钮，点击收起

### Options
- 谨慎档默认值改为最安全的值：`dalvik.vm.dex2oat-filter` 由 `speed-profile` 改为 `verify`；`dalvik.vm.dex2oat-very-large` 由 `everything` 改为 `verify`

## v2.7 (2026-06-23)

### Architecture
- 拆分 OPlus 独立模板 `props/oplus.prop`，与 `props/xiaomi.prop` 排版一致，统一两厂商管理方式
- 安装脚本统一从 `props/<vendor>.prop` 复制到 `system.prop`，不再让 OPlus 走不同路径
- 新增 `webroot/data/vendors.json`，记录每个厂商的 id / label / options 文件 / 识别关键词
- WebUI 改为从 vendors.json 动态查找 options 文件，新增厂商无需修改 JS 代码

### Tools
- 新增 `tools/validate-options.js`：自动校验 JSON 合法性、JS 语法、LF 换行、版本号一致性、厂商 options/prop 完整性
- 新增 `tools/build-release.js`：自动运行校验 → 生成 ZIP → 验证 ZIP 路径符合规范

### WebUI
- 诊断弹窗修复无法向下滚动的问题（.dialog-panel 由 overflow: hidden 改为 overflow-y: auto）
- 诊断静态 shell 增加 `device.prop` 输出，方便确认厂商配置命中情况
- 选项说明默认折叠为 2 行，新增"展开详情 / 收起详情"切换按钮

### Module
- customize.sh 修复 log 仍显示"Initializing ColorOS configuration"，改为"Initializing configuration"
- module.prop 说明更新为 `OPlus/Xiaomi dexopt tuning`
- README 重写：新增访问统计徽章、支持厂商说明、项目结构、安装步骤

## v2.6 (2026-06-23)

### Multi-Vendor
- 新增 Xiaomi / Redmi / POCO 支持，安装时自动识别厂商，Xiaomi 使用独立 `props/xiaomi.prop` 与 `options-xiaomi.json`
- OPlus / OPPO / OnePlus / Realme 继续使用原 v2.5 OPlus 配置
- 未识别设备安装时直接拒绝

### Xiaomi（57 项）
- 安全档：pm.dexopt.* 全套 + MIUI dexfile preload + ART startup class preload + precache + iorap
- 谨慎档：线程数、image 堆、madvise、profile 首次保存、dexpreload CPU 绑定等
- 危险档：everything 全量 AOT 策略

### WebUI / Compliance
- 修复 service.sh / customize.sh 缺失 20 个属性模式匹配
- 修复 app.js diagnosticSections 改为动态从 options.json 生成
- 修复 system.prop 未包含新增 20 项属性
- 统一关键脚本为 LF 换行，移除 webroot 手动 chmod（符合 KSU/APatch 规范）

## v2.5 (2026-06-23)

### Summary
- 新增 20 项编译控制属性（基于真机 dump：一加 13 / 13T / ACE5 至尊版），总计 77 项
- 安全 36 项 / 谨慎 32 项 / 危险 9 项，按功能重新分类
- UI 精简：移除实时监控面板、QQ 群、background.jpg 等
- 12 项 Bug 修复：UTF-8 乱码、Shell 整数溢出、df -Pk、getprop fallback、writeBase64 分块 padding 等
- 代码重构：parseKeyValueLines / parseStateFile 提取到 utils.js，删除 device-monitor.js
- WebUI 保存改为 base64 分块写入临时文件再解码，修复大文件截断问题

## v2.4 (2026-06-23)

- 修复实时功耗显示 0.00W / "暂不可用"
- 全新 UI 设计：蓝灰色系，移除毛玻璃，降低字重，优化 Switch / 卡片样式

## v2.3 (2026-06-23)

- 修复 device-monitor.js UTF-8 乱码（v2.2 未生效）
- 修复 updateOption() TypeError
- 提取 resultMessage() / shellQuote() 到 utils.js

## v2.2 (2026-06-23)

- 修复 computePowerFromMicrowatts 乱码
- 提取 parseKeyValue() / shellQuote() 到 utils.js
- 安全修复：section title 单引号转义防止 shell 注入

## v2.1 (2026-06-23)

- 修复 openUrl() UTF-8 乱码
- 新增 buildDiagnosticShell() 动态生成诊断脚本
- 拆分 renderHome() 为五个独立函数
