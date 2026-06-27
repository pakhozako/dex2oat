# Build

`node tools/build.js` 是当前唯一完整自动化入口。它会执行 validate、WebUI build、完整性基线生成、release、source backup 和构建报告输出。

## Prerequisites

- Node.js 24 或当前项目验证通过的兼容版本。
- 可执行 Shell 校验环境：Git Bash、WSL 或 BusyBox 任一可用。
- Windows PowerShell 用于环境探测；发布 ZIP 由 Node 内置打包实现，不依赖 7-Zip。

## Commands

```powershell
node tools\validate.js
node tools\build.js
node tools\release.js
```

日常修改后优先运行 `validate`。发布前必须运行完整 `build`，并用单独 `release` 入口确认发布打包仍可独立执行。

## Build Pipeline

1. 检测开发环境并生成 `.env.local`、`build.config.json`、`environment-report.md`。
2. 如存在 `package.json`，执行 Node 依赖检查；当前项目不需要 npm 依赖时会跳过。
3. 清理 `dist/`、`release/`、`temp/`、`cache/`、`.cache/` 和旧 `webroot/assets/`。
4. 同步版本到 `module.prop`、`update.json`、WebUI meta、README、CHANGELOG。
5. 运行 Shell / JavaScript / JSON / options 校验。
6. 从 `webroot-src/` 构建 protected WebUI 到 `webroot/`。
7. 基于 release staging 生成 `core/integrity-baseline.prop`。
8. 再次运行 validate。
9. 生成 release ZIP、SHA256、manifest。
10. 生成 source backup、SHA256、manifest。
11. 写入 `v* 自动化开发与构建报告.md`。

## Tool Responsibilities

- `tools/build.js`: 完整流水线入口。
- `tools/validate.js`: 聚合 Shell、JS、JSON、options 校验。
- `tools/build-webui.mjs`: 构建 WebUI protected JS/CSS 和 WebUI 数据文件。
- `tools/generate-integrity.js`: 复用 release staging 规则生成完整性基线。
- `tools/release.js`: 生成发布包、SHA256 和 manifest。
- `tools/backup-source.js`: 生成源码快照。
- `tools/archive.js`: 固定顺序、固定时间戳 ZIP 实现。
- `tools/environment.js`: 开发环境检测和配置文件生成。

## Generated Files

以下文件由构建工具生成或刷新，不应手工维护：

- `webroot/assets/*`
- `webroot/data/*`
- `webroot/index.html`
- `core/integrity-baseline.prop`
- `releases/*`
- `backups/*`
- `.env.local`
- `build.config.json`
- `environment-report.md`
- `v* 自动化开发与构建报告.md`
- `temp/`

`releases/`、`backups/`、`reports/` 和 `temp/` 目录通过 `.gitkeep` 保留目录结构，目录内容默认忽略。

## Failure Handling

构建失败时先查看终端输出和 `v* 自动化开发与构建报告.md`。不要手工改 protected bundle；应修复 `webroot-src/` 或 `tools/` 后重新构建。
