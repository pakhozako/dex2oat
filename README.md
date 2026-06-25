# Dex2oat Lock

![:name](https://count.getloli.com/@dex2oat?name=dex2oat&theme=moebooru&padding=7&offset=0&align=top&scale=1&pixelated=1&darkmode=auto)

Dex2oat Lock 是一个适用于 Magisk / KernelSU / APatch 的 Android 编译策略调控模块，用来管理 ART、dex2oat、dexopt 相关系统属性。

它的主要作用是减少后台、安装、OTA、空闲维护等场景中不必要的 dex2oat 编译触发，降低发热、耗电和后台资源占用，同时保留可自定义的编译策略。

## 主要功能

- 自动抓取当前设备上的 ART / dexopt / runtime 相关属性。
- 根据规则库生成适合当前设备的 `system.prop`。
- 提供安全、谨慎、危险三档配置模式。
- WebUI 可查看当前状态、安装进度、匹配结果、健康检查和完整性状态。
- 支持自定义规则开关，并保存生成新的 `system.prop`。
- 模块管理器中显示 🟩 / 🟨 / 🟥 状态提醒。
- 卸载后恢复模块内改动，不替换系统文件。

## 使用方式

1. 下载 `Dex2oat-Lock-v3.3-release.zip`。
2. 在 Magisk / KernelSU / APatch 中从本地安装。
3. 重启设备。
4. 打开模块 WebUI 查看状态，必要时进入自定义页调整配置。
5. 修改配置后再次重启，让属性在开机阶段生效。

## 注意事项

- 不同 Android 版本和 ROM 对 dex2oat / dexopt 属性的支持不同。
- 安全模式适合大多数用户，危险模式需要理解对应属性含义后再启用。
- 查看风险协议不需要解锁；进入自定义配置、危险模式或保存高风险配置时才需要确认。
