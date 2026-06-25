# Dex2oat Lock

Dex2oat Lock 是一个面向 Magisk / KernelSU / APatch 的 ART 与 dexopt 属性调控模块。它通过设备属性抓取、规则匹配和统一状态汇总，生成当前设备可用的 `system.prop`，帮助减少后台、安装、OTA 等场景中不必要的 dex2oat 编译负担。

当前公开版本：`v3.2-release` / `versionCode=32`

## 主要能力

- 规则驱动：根据当前设备实际存在的 ART、dexopt、runtime、device_config 属性生成配置，不使用旧厂商模板。
- 6 份真机日志规则库：覆盖 OnePlus/OPlus、Xiaomi/HyperOS/MIUI、Motorola/AOSP-like 抓取样本中的关键属性。
- 统一状态：安装、匹配、配置生成、apply、健康、冲突和完整性摘要统一写入 `/data/adb/dex2oat-lock/state.prop`。
- 安装进度：安装时显示实时百分比，并同步写入 `install-progress.prop` 与统一状态。
- WebUI：首页显示真实状态总览，自定义页提供安全/谨慎/危险三档工作台，关于页提供模块信息与风险协议入口。
- 完整性校验：核心脚本、WebUI 资源、规则与元数据都有 baseline/report/state 闭环。
- 状态摘要：模块管理器中的 `description` 会显示绿色/黄色/红色方块提示当前状态。

## 状态分级

Dex2oat Lock 不把“匹配成功但信息不足”直接当作异常。状态聚合区分：

- `ok`：规则匹配与配置生成可信，运行状态正常。
- `partial`：命中部分规则，配置可用但需要提示。
- `fallback`：没有足够命中时使用保守默认策略。
- `warning`：存在非阻断风险，如冲突、完整性变更或健康自愈。
- `error`：生成失败、apply 失败、关键文件缺失等阻断性问题。

## WebUI 说明

公开发布包中的 WebUI 使用保护版资源，不上传可直接维护的 `webroot/js` 与 `webroot/css` 源码目录。源码维护目录仍保留完整开发文件，公开分支只保留运行所需的受保护资源。

## 安装

1. 下载 `Dex2oat-Lock-v3.2-release.zip`。
2. 在 Magisk / KernelSU / APatch 中从本地安装。
3. 重启设备。
4. 打开 WebUI 查看首页状态，必要时进入自定义工作台保存配置。
5. 修改配置后再次重启，使属性在开机阶段应用。

## 运行目录

主要运行态文件位于 `/data/adb/dex2oat-lock/`：

- `state.prop`：统一主状态源。
- `install-progress.prop`：安装进度兼容文件。
- `system.prop.bak`：最近配置备份。
- `config.json`：WebUI 自定义配置。
- `prop-lock.list`：运行时锁定快照。
- `match-report.txt`：规则匹配证据。
- `integrity-report.txt`：完整性校验证据。
- `conflict-report.txt`：冲突检测证据。

## 风险提示

Dex2oat Lock 只修改模块内的系统属性配置，不替换系统文件。不同系统版本、ROM 和 Root 管理器对 ART/dexopt 属性的处理可能不同。启用危险模式或高风险配置前，请确认理解对应属性含义。查看风险协议不需要解锁，进入自定义配置、启用危险模式或保存高风险配置时才需要确认。

## 更新

更新日志见 [CHANGELOG.md](./CHANGELOG.md)。
