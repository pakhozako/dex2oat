# FAQ

## 支持哪些 Root 管理器？

Dex2oat Lock 支持 Magisk v20.4+、KernelSU v3.2.5、APatch 11142。

## 需要 KernelSU 或 APatch 专用适配吗？

不需要。Magisk、KernelSU、APatch 对 Dex2oat Lock 使用同一套模块流程。

## 支持 Recovery 安装吗？

不支持。Recovery installation is not supported by KernelSU/APatch official design. 请通过 Magisk 管理器、KernelSU 管理器或 APatch 管理器安装。

## KernelSU 或 APatch 需要 `/system` 挂载支持吗？

不需要。Dex2oat Lock 使用脚本和 `system.prop`，不会挂载 `/system` 文件。`skip_mount` 是故意保留的。

## 属性如何写入？

Dex2oat Lock 优先使用 `resetprop -n` 写入属性；失败时 fallback 到 `setprop`。

## Root 管理器版本会影响功能分支吗？

不会。版本与平台信息仅用于日志和诊断，不用于 Magisk/KernelSU/APatch 功能分支。

## 如何预演、回滚或导出诊断？

在模块管理器的 Action 中运行对应操作，或执行 `sh action.sh dry-run`、`sh action.sh rollback`、`sh action.sh export`。这些能力不依赖 WebUI。
