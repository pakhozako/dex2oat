# Contributing

本项目接受长期迭代，但所有变更必须保持 Magisk / KernelSU / APatch 模块行为稳定。

## Development Principles

- 优先最小修改。
- 不做无需求的大规模重构。
- 不改变模块接口、发布包结构、WebUI 业务行为或 Material Design 3 风格。
- 新增功能必须同步更新文档和发布说明。
- 修改 JSBridge、安全、状态模型或完整性流程时必须专项审查。

## Shell

- 使用 POSIX / BusyBox `sh` 兼容语法。
- 脚本调用统一使用 `sh path/to/script.sh`，不要依赖 `-x` 或可执行位。
- 日志和状态写入要可诊断，避免静默吞错。
- 临时文件必须在受控目录内，并在成功后原子替换。
- 新增锁使用 `mkdir` lock directory，并处理 stale lock。

## JavaScript

- WebUI 不引入大型框架。
- 模块间保持当前文件职责：`app.js` 业务入口，`bridge.js` 桥接，`config.js` 配置，`ui.js` UI 工具，`m3-theme.js` 主题。
- 用户输入、路径、命令参数必须校验。
- 所有异步操作必须返回明确结果并处理异常。
- 兼容旧 WebView，必要时提供 fallback。

## CSS

- 优先使用 M3 token 和项目语义变量。
- 组件样式放在合适的 M3 或 app 样式文件中，不重复散落。
- 避免新增 magic color、magic spacing；确需新增时保持命名清晰。
- 保持窄屏 WebView 无横向溢出。

## JSON And Data

- JSON 必须可被 `node tools/validate-json.js` 校验。
- `webroot-src/data/options.json` 是规则数据源，修改后必须运行 options 校验。
- 不把构建缓存或本地环境路径写入数据文件。

## Node.js Tools

- 工具入口必须可单独执行。
- 删除、移动、复制文件时必须限制在项目根目录或明确允许目录内。
- 发布包内容只通过 `tools/release.js` staging 生成。
- 不新增需要联网安装的依赖，除非先更新兼容性说明。

## Commit And Release

- 建议提交前执行 `node tools\validate.js`。
- 发布前执行 `node tools\build.js` 和 `node tools\release.js`。
- 提交信息建议使用 `feat:`、`fix:`、`docs:`、`build:`、`chore:`。
- 发布 tag 使用 `vX.Y` 或 `vX.Y.Z`。
- 不重写 Git 历史，不强推覆盖发布分支。
