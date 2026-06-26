# Compatibility

目标 Root 框架：

- Magisk
- KernelSU
- APatch

Shell 兼容策略：

- 设备端使用 `/system/bin/sh` 兼容写法。
- 开发端 `tools/validate-shell.js` 自动选择 Git Bash、WSL 或 BusyBox 执行 `sh -n`。
- 构建脚本不依赖固定安装路径。

运行时属性应用优先使用 `resetprop -n`，不可用时回退到 `setprop`。

