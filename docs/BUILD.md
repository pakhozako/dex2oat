# Build

`node tools/build.js` 是当前 v3.5 的唯一自动化入口。

流程：

1. 检测 Windows、PowerShell、Git、Shell、Node、npm、Python、7-Zip、BusyBox、WSL、OpenSSL、Java。
2. 生成 `environment-report.md`、`.env.local`、`build.config.json`。
3. 如存在 `package.json`，自动执行 `npm install`。
4. 清理 `dist`、`release`、`temp`、`cache`、旧 `webroot/assets`。
5. 同步 `tools/version.json` 到 `module.prop`、`update.json`、WebUI meta、README、CHANGELOG。
6. 执行 Shell / JS / JSON / options 校验。
7. 从 `webroot-src` 构建受保护 WebUI 到 `webroot/assets`。
8. 生成 `core/integrity-baseline.prop`。
9. 生成发布包、源码快照、SHA256 和 manifest。

