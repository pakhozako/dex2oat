# Rules

本文件记录 Dex2oat Lock 的长期维护硬性规则。项目是 Magisk / KernelSU / APatch 模块，不是 Android App；WebUI 运行在 Root 管理器 WebView 中。

## Change Rules

1. 优先最小修改原则。
2. 不允许无需求的大规模重构。
3. 不允许在维护整理中改变项目架构、模块接口、运行行为或 Material Design 3 设计语言。
4. 新增功能必须同步更新 `docs/`、`MAINTAIN.md` 和必要的发布说明。
5. 不允许引入未经评估的新运行时依赖。

## Shell Rules

- 设备端脚本保持 `#!/system/bin/sh` 和 BusyBox / POSIX Shell 兼容。
- 不使用 Bash-only 语法、数组、`[[ ... ]]`、process substitution 或 `pipefail`。
- 不能依赖脚本可执行位；跨脚本调用统一使用 `sh script.sh`。
- 锁使用 `mkdir` lock directory，必须支持异常退出释放和 stale lock 清理。
- 状态写入统一通过 `core/state.sh` / `core/statectl.sh`。

## WebUI Rules

- WebUI 源码位于 `webroot-src/`，发布资源由构建工具输出到 `webroot/`。
- 保持零大型框架依赖，避免把标准浏览器 API 当作唯一实现。
- Material Design 3 token、theme、component、utility 样式必须从 `webroot-src/css/m3-*.css` 进入构建链。
- `m3-theme.js` 属于主题初始化和动态主题预留能力，不得因当前入口少而删除。

## JSBridge Rules

- JSBridge 不提供任意路径写入能力。
- 文件写入只能落在明确允许的状态、配置、临时发布或导出目录中。
- 拒绝绝对路径、`..`、路径穿越和未授权目录。
- 修改 JSBridge、安全边界或状态模型后必须进行专项审查。

## Build And Release Rules

- 每次修改后必须执行：
  - `node tools/validate.js`
  - `node tools/build.js`
  - `node tools/release.js`
- 每次正式发布必须重新生成 `core/integrity-baseline.prop`。
- 完整性基线只能基于 release staging 生成，不包含 docs、tools、reports、temp、package lock 或源码目录。
- 发布包内容由 `tools/release.js` 控制，不手工编辑 ZIP。
- 发布产物输出到 `releases/`，源码备份输出到 `backups/`，两者内容默认不提交 Git。
