# Compatibility

Dex2oat Lock 的运行环境是 Android Root 模块和 Magisk WebUI，不是标准浏览器或 Android App。

## Root Frameworks

目标兼容：

- Magisk
- KernelSU
- APatch

设备端入口保持标准 Magisk 模块文件：

- `customize.sh`
- `service.sh`
- `uninstall.sh`
- `META-INF/com/google/android/update-binary`
- `META-INF/com/google/android/updater-script`

## Shell

- 设备端脚本使用 `#!/system/bin/sh`。
- 保持 BusyBox / POSIX Shell 兼容。
- 不使用 Bash-only 语法。
- 不依赖 `flock`。
- 锁使用 `mkdir` lock directory。
- 属性应用优先 `resetprop -n`，不可用时回退 `setprop`。
- 开发端 Shell 校验由 `tools/validate-shell.js` 自动选择 Git Bash、WSL 或 BusyBox。

## WebUI

- WebUI 运行在 Root 管理器 WebView 环境。
- JSBridge 需要兼容 KernelSU、APatch 和常见 WebUI bridge 名称。
- 不依赖大型前端框架。
- 避免把现代浏览器 API 作为唯一实现。
- `TextEncoder`、`color-mix()`、`backdrop-filter` 已有 fallback。
- Clipboard API 不可用时回退为选择文本。

## Build Host

当前构建工具链以 Node.js 为主，支持 Windows PowerShell 环境。ZIP、SHA256、manifest 由 `tools/` 内部完成，不要求设备端或构建端安装 7-Zip。

- 发布产物输出到项目内 `releases/`。
- 源码备份输出到项目内 `backups/`。
- `.gitattributes` 固定 Shell、WebUI、Node 工具和文档使用 LF，降低 Windows / Android 之间的换行差异。

## SELinux And Permissions

- 模块运行文件保持 root 所有权和最小可读权限。
- 状态目录默认 `0700`。
- 敏感状态和日志默认 `0600`。
- `system.prop` 保持模块可读取的 `0644`。

## Compatibility Rules

- 新 Shell 代码必须先通过 `node tools/validate.js`。
- 新 WebUI 代码不得假设标准浏览器环境。
- 新构建工具不得引入必须联网安装的依赖。
- 新发布文件必须同步更新 release 和 integrity baseline 规则。
- 修改 JSBridge、安全边界或状态模型时必须重新进行专项审查。
