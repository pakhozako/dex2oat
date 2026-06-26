# Release

发布产物输出到父目录 `发布版/`：

- `Dex2oat-Lock-v3.5-release.zip`
- `Dex2oat-Lock-v3.5-release.sha256`
- `Dex2oat-Lock-v3.5-manifest.json`

发布包只包含运行所需文件，不包含：

- `README.md`
- `CHANGELOG.md`
- `update.json`
- `tools/`
- `webroot-src/`
- 原始 `webroot/js`、`webroot/css`

Zip 由 Node 以固定顺序和固定时间戳生成，便于重复构建验证。

