# Architecture

Dex2oat Lock 分为四层：

1. 安装层：`customize.sh` 负责抓取设备属性、生成初始配置、写入安装状态。
2. 运行层：`service.sh` 开机后应用运行时属性、检测 rematch 触发、刷新健康状态。
3. 状态层：`core/statectl.sh` 是 `state.prop` 统一写入口，使用 lock directory、PID 临时文件和原子替换。
4. WebUI 层：`webroot-src` 是源码，`webroot/assets` 是构建后的受保护 bundle。

发布包中的 WebUI 必须由源码重新构建，不允许手工覆盖旧 bundle。

