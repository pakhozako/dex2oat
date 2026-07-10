# Dex2oat Lock

Dex2oat Lock 是一个面向 Android Root 模块管理器的规则驱动 ART / dexopt 调优模块。

## 兼容性

Dex2oat Lock 明确支持：

- Magisk v20.4+
- KernelSU 当前官方版本：v3.2.5
- APatch 当前官方版本：11142

Magisk、KernelSU、APatch 统一使用同一套 Dex2oat Lock 安装与运行流程。本模块不需要 Root 管理器专用适配代码，不增加管理器分支，也不依赖 `/system` 挂载支持。

## 安装

请通过受支持的模块管理器安装：

- Magisk 管理器
- KernelSU 管理器
- APatch 管理器

Recovery installation is not supported by KernelSU/APatch official design.

Dex2oat Lock 不提供也不需要 KernelSU/APatch 专用 installer。标准模块管理器安装器会读取 `module.prop`、解压模块并执行 `customize.sh`。

## 运行流程

Dex2oat Lock 保持标准模块结构：

- `module.prop`
- `customize.sh`
- `service.sh`
- `system.prop`
- `skip_mount`
- `uninstall.sh`
- `action.sh`

`skip_mount` 是有意保留的。Dex2oat Lock 不挂载、不替换 `/system` 文件，因此 KernelSU/APatch 不需要提供 `/system` 挂载支持。

## 属性写入

运行时属性统一使用一套实现：

```txt
resetprop -n
  -> 失败时
setprop fallback
```

不使用其他属性写入实现。KernelSU 的属性延迟稳定处理保留在 `service.sh` 中。

## 版本检测

版本与平台信息只用于日志和诊断，不作为功能分支条件。
## v6.0 操作

- `sh action.sh dry-run`：预演规则，不修改当前配置或运行时属性。
- `sh action.sh rollback`：恢复最近配置快照。
- `sh action.sh export`：导出脱敏诊断包。
- `sh action.sh protection-reset`：清除运行保护计数。

## 构建验证

- `node tools/release.mjs` 刷新完整性基线，执行全部测试，构建 ZIP 并生成 SHA256。
- `tests/verify.ps1` 和 `build/build.ps1` 作为 Windows 兼容入口保留。
- 发布包依据 `build/release-files.txt` 构建，并拒绝 Markdown、临时文件和嵌套 ZIP。
