# Release

发布入口是 `node tools/build.js`。完整构建成功后，可再运行 `node tools/release.js` 确认独立 release 入口正常。

## Output

发布产物输出到项目内 `releases/`：

- `Dex2oat-Lock-v*-release.zip`
- `Dex2oat-Lock-v*-release.sha256`
- `Dex2oat-Lock-v*-manifest.json`

源码快照输出到项目内 `backups/v*/`：

- `Dex2oat-Lock-v*-source.zip`
- `Dex2oat-Lock-v*-source.sha256`
- `Dex2oat-Lock-v*-source-manifest.json`
- `source/`

## Release Package Contents

发布包只包含运行所需文件：

- `customize.sh`
- `service.sh`
- `uninstall.sh`
- `system.prop`
- `skip_mount`
- `module.prop`
- `core/`
- `scripts/`
- `META-INF/`
- `webroot/`

发布包不包含：

- `README.md`
- `CHANGELOG.md`
- `update.json`
- `docs/`
- `tools/`
- `webroot-src/`
- `reports/`
- `temp/`
- 原始 `webroot/js/`、`webroot/css/`

## Integrity Baseline

`core/integrity-baseline.prop` 必须基于 release staging 生成。它不应包含 docs、tools、package lock、报告、临时文件或源码目录。

发布前检查：

```powershell
node tools\generate-integrity.js
node tools\validate.js
node tools\build.js
node tools\release.js
```

## Release Rules

- 不手工编辑 `webroot/assets/*`。
- 不手工编辑 release ZIP 内容。
- 不跳过最终 validate。
- 每次发布必须重新生成完整性基线。
- 发布 SHA256 和 manifest 必须与最终 ZIP 同步。
- 不再把发布产物输出到项目父目录；历史 `发布版/`、`源码版/` 只作为旧归档路径处理。
