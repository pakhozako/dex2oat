# Dex2oat Lock 更新日志

## v3.3 (2026-06-25)

- 修复完整性校验持续显示 `integrity missing / changed` 的问题：运行态 `state.prop`、`config.json` 不再被当作阻断性缺失，`module.prop` 动态 `description` 状态摘要不再破坏 baseline。
- 修复发布版规则匹配数量可能始终为 0 的问题：发布保护流程保留 `options.json` 可被 shell 规则生成器稳定解析的结构，规则生成器改为精确属性键匹配。
- 修复自定义工作台安全 / 谨慎 / 危险档位切换后列表不刷新的问题，切换档位会立即重绘当前工作台。
- 优化 WebUI 首页布局：状态结论更轻量，摘要卡片保持三列归组，快捷操作集中到首页下方卡片。
- 优化自定义页布局：保存并生成 `system.prop` 移到工作台下方，减少误触和视觉阻塞。
- 关于页继续保持风险协议只读查看，不触发倒计时、计算验证或解锁写入。
- 模块管理器 `description` 继续显示 🟩 / 🟨 / 🟥 状态提醒。
- 输出 v3.3 未加密包、加密发布包，并更新 Aurora 兼容交付包。

## v3.2 (2026-06-25)

- 基于 6 份真机抓取日志补全规则库，覆盖 OnePlus/OPlus、Xiaomi/HyperOS/MIUI、Motorola/AOSP-like 设备样本。
- 统一 `state.prop` 作为安装、匹配、配置、apply、健康、冲突、完整性和 summary 的主状态源。
- 首页、关于、自定义、诊断围绕统一状态重构。
- 发布包 WebUI 使用保护版资源，不包含原始 `webroot/js` 和 `webroot/css` 源码目录。
