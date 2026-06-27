# Dex2oat Lock


![:name](https://count.getloli.com/@dex2oat?name=dex2oat&theme=moebooru&padding=7&offset=0&align=top&scale=1&pixelated=1&darkmode=auto)

Dex2oat Lock 是一个适用于 Magisk / KernelSU / APatch 的 Android ART 编译策略调控模块。

它通过规则库读取设备上的 dex2oat、dexopt、ART runtime 与 ROM 相关属性，生成适合当前设备的 `system.prop`，并在开机后持续应用和校验关键运行状态。

## 主要功能

- 基于规则库自动生成 dex2oat / dexopt / ART 相关配置。
- 提供安全、谨慎、危险三档自定义工作台。
- 三档差异和影响见 `docs/RISK_MODES.md`，WebUI 内也提供档位说明与提示。
- WebUI 显示安装进度、规则匹配、应用状态、健康检查、冲突检测和完整性状态。
- 支持导出和恢复 WebUI 配置备份，便于换机或重刷后继续使用。
- 统一使用 `state.prop` 汇总运行状态，减少多文件状态冲突。
- 模块管理器描述显示 🟩 / 🟨 / 🟥 状态提醒。

## 适用场景

- 希望减少不必要的后台 dex2oat 编译触发。
- 希望降低安装、OTA、后台维护阶段的发热、耗电和资源占用。
- 希望保留可视化 WebUI 和可回滚的自定义配置能力。

## 注意事项

不同 Android 版本和 ROM 对 ART / dexopt 属性支持不同。建议优先使用安全档，理解对应配置含义后再启用更高风险配置。
