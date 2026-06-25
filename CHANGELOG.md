# Changelog

## v3.2-release (2026-06-25)

- 基于 6 份真机抓取日志补全规则库，保留 29 个高价值证据属性，覆盖 ART heap、ISA、runtime metrics、USAP、iorap 与 ROM 预加载相关键。
- 修复规则生成器对空默认值、通配符 metrics、重复属性去重的处理，6 份日志回放均输出 `status=ok`。
- 统一 `state.prop` 聚合逻辑，`partial`、`fallback`、`warning` 不再被误判为整体 `error`。
- 首页调整为状态总览，移除进入自定义按钮；关于页移除诊断、system.prop 与版本摘要按钮；卡片布局调整为一行三卡。
- 自定义页保留规则库增删能力，保存按钮移动到自定义工作台下方，开关右置且点击开关不展开卡片。
- 关于页查看风险协议保持只读直接打开，不触发倒计时、算术验证或解锁写入。
- 模块管理器 `description` 增加绿色、黄色、红色方块状态提示。
- 发布版 WebUI 使用 appbs 风格 HTML 包装，并对 JS 模块生成受保护资源；公开上传树不包含原始 `webroot/js` 与 `webroot/css`。
- 发布包 `Dex2oat-Lock-v3.2-release.zip` 不包含 `README.md`、`CHANGELOG.md`、`update.json`。

## v3.2 (2026-06-25)

- 规则驱动架构稳定为主线，不恢复厂商检测、vendor 模板或多厂商 options 分流。
- 安装期新增实时进度输出，并同步写入 `install-progress.prop` 与 `state.prop`。
- 完整性校验接入 baseline、report 与统一状态，首页和诊断展示一致。
- WebUI 首页、关于、自定义、诊断围绕统一状态重构。
