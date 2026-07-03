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

## Cloud Mirror

云端镜像只更新 Codex 管理目录 `/root/codex-managed/dex2oat-lock`，不得修改服务器原有业务目录或无关 systemd 服务。
当前 Dex2oat cloud 已迁到 `18082`；`18080` 由 1Panel 承载服务器管理面板；
`18081` 继续空置，旧 admin 服务应保持停止和禁用。发布与运维工具继续检查
`18082`，不要回退到旧端口。发布给 WebUI 的远端元数据只允许 HTTPS 或本机
HTTP；如果公网云端仍是明文 HTTP，构建产物会清空 WebUI cloud URL，避免手机
WebView 在生产环境发起不安全请求。

本地发布完成后可检查云端状态：

```powershell
npm.cmd run cloud:check
```

需要同步云端发布包和 `/api/update.json` 时，先设置凭据，再执行：

```powershell
$env:DEX2OAT_CLOUD_PASSWORD = "<server password>"
npm.cmd run cloud:deploy
Remove-Item Env:\DEX2OAT_CLOUD_PASSWORD
```

PowerShell 5 默认执行策略可能拦截 `npm.ps1`，因此 Windows 环境优先使用 `npm.cmd`，或直接执行 `python tools\deploy-cloud-release.py check`。

`tools/deploy-cloud-release.py` 会：

- 上传当前 `releases/Dex2oat-Lock-v*-release.zip` 和 manifest。
- 更新 `/api/update.json`、`/api/releases.json`、`/api/rules.json`、`/health.json`。
- 备份旧云端 JSON 到服务器 `backups/deploy-*`。
- 校验远端 ZIP SHA256 与本地 release 一致。
- 不生成或维护自写云端首页；部署时会清理旧 `index.html`、`admin.html`
  和 `usage.html`，避免把 18080 重新变成 Dex2oat 自写面板。

发布同步完成后可用运维入口复核服务器状态：

```powershell
$env:DEX2OAT_CLOUD_PASSWORD = "<server password>"
npm.cmd run cloud:ops -- status
npm.cmd run cloud:ops -- health
Remove-Item Env:\DEX2OAT_CLOUD_PASSWORD
```

`cloud:ops` 只检查 `/root/codex-managed/dex2oat-lock` 托管目录、Dex2oat 相关 systemd 服务、公开 API、健康日志和发布 ZIP 哈希，不应修改服务器无关目录或服务。
