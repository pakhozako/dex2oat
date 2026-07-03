# Dex2oat-Lock 当前项目交接文档

更新时间：2026-07-03

本文档给新的 Codex 窗口或维护者接手当前 Dex2oat-Lock 项目使用。它把本轮多窗口对话里的关键上下文收口到一个地方：项目目录、当前版本、服务器、云端、兑换码、WebUI、构建验证、已知问题和安全边界。

重要说明：本文档会记录服务器地址、用户名、端口、服务路径和操作命令，但不会写入服务器明文密码、Token、Cookie、SSH Key、兑换码明文池或私有哈希池内容。需要连接服务器时，由用户在当前会话临时提供凭据，并通过 `DEX2OAT_CLOUD_PASSWORD` 等临时环境变量传入，用完立即清理。

## 1. 接手先读

- 权威仓库根目录：`D:\dex2oat-work`
- 当前环境有时会落在：`D:\dex2oat-work\构建\source`
- 不要把 `D:\dex2oat-work\构建` 或 `D:\dex2oat-work\构建\source` 当成仓库根。
- 修改源码优先改 `webroot-src/`、`core/`、`scripts/`、`tools/`、`docs/`。
- `webroot/`、`构建/source/`、`releases/`、`backups/` 里的内容多为构建或发布产物，不要手改生成物后忘记回源。
- 当前工作树长期有大量未提交改动和未跟踪文件，接手后先看状态，不要清理、不回滚。
- 不要使用 `git reset --hard`、`git checkout --`、递归删除等破坏性操作。
- 用户偏好：能直接做就直接做；需要排查时给出根因和验证结果；涉及发布、云端和兑换码时要保守、可回滚、留证据。

接手第一组命令：

```powershell
cd D:\dex2oat-work
$OutputEncoding=[System.Text.Encoding]::UTF8
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
git status --short --untracked-files=all
git diff --stat
```

## 2. 当前最高优先级任务

用户最新明确了两项独立任务，执行顺序不能反：

1. 先修 `custom` 视图风险档位显示 bug。
2. 再把完整皮肤主题方案简化为“只保留徽章”。

### 2.1 custom 风险档位显示 bug

现象：

- 在安全、谨慎、危险三档之间切换后，`custom` 视图里显示的档位始终是“安全”。
- 用户强调这次反馈不是旧 Bug 1 的简单复述。旧 Bug 1 是“档位切换本身不生效”；这次要确认是全局状态没变，还是 `custom` 视图单独读了旧缓存、默认值或错误字段。

排查重点：

- 点击风险档位后，`state` 里的真实字段是否改变。
- 切换后是否持久化到 `config.json` 或等价配置。
- 刷新页面、重新渲染、重新加载统一状态后，是否又被某个初始化逻辑重置为 `safe`。
- `custom` 视图展示档位时是否直接读 `currentRiskMode()`，还是用了内部副本。

推荐搜索：

```powershell
rg -n "currentRiskMode|syncRiskMode|risk-mode|modeLabel|档位|安全|谨慎|危险|data-risk|risk.mode|riskMode" webroot-src\js\app.js webroot-src\js\config.js tools
```

重点文件和函数：

- `D:\dex2oat-work\webroot-src\js\app.js`
  - `currentRiskMode()`
  - `syncRiskMode()`
  - `createRiskModePanel()`
  - `renderCustom()`
  - `refreshAfterMatch()`
  - custom 视图里展示“当前档位”的组件
- `D:\dex2oat-work\webroot-src\js\config.js`
  - `normalizeRiskMode()`
  - `mergeConfig()`
  - 配置保存、恢复、默认值合并逻辑

期望修复方向：

- `custom` 视图每次渲染都从全局 `currentRiskMode()` 或同一权威配置字段读取。
- 不维护 `custom` 专属风险档位缓存。
- 不恢复“风险档位过滤 custom 数据集”的旧逻辑。此前已经确定 custom 视图应展示“设备实际抓取属性 + 规则比对命中”的结果集，风险档位主要影响提示、高风险确认和保存策略。

验收：

- 安全 active 时，设置区和 custom 视图都显示“安全”。
- 谨慎 active 时，设置区和 custom 视图都显示“谨慎”。
- 危险 active 时，设置区和 custom 视图都显示“危险”。
- 关闭 WebUI 或重新加载状态后，不应回退为安全档。
- `node tools\validate-webui-smoke.js` 应覆盖 mock bridge 下 safe/caution/aggressive 切换。

### 2.2 皮肤方案简化为只保留徽章

产品决策：

- 不再做全局主题换肤。
- 不再通过 `data-skin` 改整页 M3 color role、shape scale、卡片或组件配色。
- 兑换码和本地解锁逻辑继续保留，因为它们仍用于授权徽章。
- 已解锁记录的数据结构可以暂时继续使用 `memorial-amber`、`founder-qingmu`，前端语义从“应用皮肤”改为“展示徽章”。

保留：

- `core/skin-unlock.sh`
- `core/redeem-code-verify.sh`
- `core/supporter-install-id.sh`
- `unlocked-skins.json` 记录结构
- 兑换码云端校验和按皮肤授权范围解锁
- 顶部/个人区域徽章展示
- 徽章动画：
  - `amber-blobMorph`
  - `amber-blobDrift`
  - `qingmu-ringSweep`
  - `qingmu-coreFlicker`
- “关闭动态效果”开关，但语义改成“关闭徽章动画”。

移除或停用：

- `data-skin` 全局切换机制
- `theme-memorial-amber.css`
- `theme-founder-qingmu.css`
- 皮肤选择器里“应用全局主题”的 UI 和逻辑
- 按需加载两套全局主题 CSS 的构建逻辑

删除文件前必须搜索引用：

```powershell
rg -n "data-skin|theme-memorial-amber|theme-founder-qingmu|selectSkin|skinMotion|SKINS|themeHref|skin-badges|memorial-amber|founder-qingmu" webroot-src tools webroot core
```

可能涉及：

- `D:\dex2oat-work\webroot-src\js\app.js`
- `D:\dex2oat-work\webroot-src\js\config.js`
- `D:\dex2oat-work\webroot-src\js\skin-manifest.js`
- `D:\dex2oat-work\webroot-src\css\skin-badges.css`
- `D:\dex2oat-work\webroot-src\css\theme-memorial-amber.css`
- `D:\dex2oat-work\webroot-src\css\theme-founder-qingmu.css`
- `D:\dex2oat-work\tools\build-webui.mjs`
- `D:\dex2oat-work\tools\validate.js`
- `D:\dex2oat-work\tools\validate-webui-smoke.js`

验收：

- 页面始终使用默认 M3 主题。
- 已解锁徽章能显示。
- 未解锁徽章应显示锁定/引导兑换状态，不能假装已解锁。
- 徽章动态效果开关有效。
- 构建产物中不再引用已删除的全局主题 CSS。
- 删除主题 CSS 后不能出现 404 或控制台报错。

## 3. 当前版本与发布状态

当前元数据已经切到：

```text
version=v4.6
versionCode=460
```

相关文件：

- `D:\dex2oat-work\tools\version.json`
- `D:\dex2oat-work\module.prop`
- `D:\dex2oat-work\update.json`

已知注意点：

- 最近一轮已经验证通过的 release/source 产物主要还是 v4.5。
- 不要把 v4.5 的绿色验证结论当作 v4.6 发布结论。
- 完成当前 bug 修复和皮肤简化后必须重新构建、验证，再考虑发布 v4.6。

曾见到的 v4.5 产物：

```text
releases/Dex2oat-Lock-v4.5-release.zip
backups/v4.5/Dex2oat-Lock-v4.5-source.zip
```

版本一致性原则：

- 先改 `tools/version.json`。
- 再跑 `node tools\build.js`。
- 确认 `module.prop`、`update.json`、release ZIP、source ZIP、manifest、SHA256、构建报告同步。
- `node tools\validate.js` 会阻断 stale 的 `构建/source/module.prop`，这条是故意做成硬错误，用来防止装到旧包。

## 4. 服务器与凭据交接

### 4.1 连接信息

公网 API：

```text
https://cloud.154-219-110-62.sslip.io
```

SSH / SFTP：

```text
host: 154.219.110.62
port: 22
user: root
```

凭据处理：

```text
password: 由用户临时提供，不写入仓库、不写入交接文档、不写入最终回复。
```

用户曾在对话里提供过服务器口令，但不要把它复制到任何项目文件。原因很简单：这个仓库、构建目录、交接文档和最终回复都可能被复制、打包、提交或同步，明文口令一旦落盘就会变成长期泄漏点。

### 4.2 推荐凭据使用方式

PowerShell 临时环境变量：

```powershell
try {
  $env:DEX2OAT_CLOUD_PASSWORD = "<用户临时提供的服务器 SSH 密码>"
  python D:\dex2oat-work\tools\deploy-cloud-release.py check
  python D:\dex2oat-work\tools\cloud-ops.py status
} finally {
  Remove-Item Env:\DEX2OAT_CLOUD_PASSWORD -ErrorAction SilentlyContinue
}
```

只读检查时也使用同一方式：

```powershell
try {
  $env:DEX2OAT_CLOUD_PASSWORD = "<用户临时提供>"
  python D:\dex2oat-work\tools\cloud-ops.py health
  python D:\dex2oat-work\tools\cloud-ops.py logs
} finally {
  Remove-Item Env:\DEX2OAT_CLOUD_PASSWORD -ErrorAction SilentlyContinue
}
```

SFTP 手工连接时：

```text
sftp root@154.219.110.62
```

密码由用户临时输入，不写到脚本、命令历史说明或 Markdown 文档。

### 4.3 服务器服务和路径

云端服务：

```text
systemd service: dex2oat-cloud.service
server root: /root/codex-managed/dex2oat-lock
server script: /root/codex-managed/dex2oat-lock/scripts/dex2oat_cloud_server.py
private supporter pool: /root/codex-managed/dex2oat-lock/data/supporters.json
redemptions log: /root/codex-managed/dex2oat-lock/data/supporter-redemptions.jsonl
verifications log: /root/codex-managed/dex2oat-lock/data/supporter-verifications.jsonl
rule evidence raw log: /root/codex-managed/dex2oat-lock/data/rule-evidence.jsonl
public root: /root/codex-managed/dex2oat-lock/public
public supporters: /root/codex-managed/dex2oat-lock/public/api/supporters.json
```

常用 systemd 检查：

```bash
systemctl status dex2oat-cloud.service --no-pager
journalctl -u dex2oat-cloud.service -n 120 --no-pager
```

常用日志检查：

```bash
tail -n 80 /root/codex-managed/dex2oat-lock/data/supporter-verifications.jsonl
tail -n 80 /root/codex-managed/dex2oat-lock/data/supporter-redemptions.jsonl
tail -n 80 /root/codex-managed/dex2oat-lock/data/rule-evidence.jsonl
```

注意：查看日志时不要把完整设备标识、完整兑换码、完整 system.prop、完整日志内容贴到最终回复。只摘取必要字段和结论。

### 4.4 端口约定

```text
18082 = Dex2oat-Lock cloud/API/release/update/rule evidence/supporter verify
18080 = 1Panel 服务器管理面板
18081 = 空置，旧 admin 不要恢复
22    = SSH/SFTP
```

不要做的事：

- 不要把 Dex2oat API 放回 `18080`。
- 不要恢复旧 `18081` admin。
- 不要改 `komari`、`sing-box`、全局 SSH、防火墙全局策略。
- 不要碰非 `/root/codex-managed/dex2oat-lock` 的业务目录。
- 不要用自写临时 HTML 控制台替代 1Panel。

## 5. 云端 API 和部署工具

主要接口：

```text
GET  /health.json
GET  /api/update.json
GET  /api/releases.json
GET  /api/supporters.json
GET  /api/evidence-summary.json
POST /api/supporter/verify
POST /api/feedback
POST /api/rule-evidence
```

公网 base：

```text
https://cloud.154-219-110-62.sslip.io
```

本地工具：

- `D:\dex2oat-work\tools\deploy-cloud-release.py`
- `D:\dex2oat-work\tools\cloud-ops.py`
- `D:\dex2oat-work\tools\generate-supporter-codes.mjs`

常用只读检查：

```powershell
cd D:\dex2oat-work
try {
  $env:DEX2OAT_CLOUD_PASSWORD = "<用户临时提供>"
  python tools\deploy-cloud-release.py check
  python tools\cloud-ops.py status
  python tools\cloud-ops.py health
} finally {
  Remove-Item Env:\DEX2OAT_CLOUD_PASSWORD -ErrorAction SilentlyContinue
}
```

当前 `deploy-cloud-release.py check` 已增强：

- 校验 `/api/update.json`
- 校验 `/api/releases.json.latest`
- 校验 `/health.json`
- 校验 `/api/supporters.json` 公开目录结构
- 检查公开 supporters 是否泄漏隐私字段

已知历史点：

- 线上 `/api/supporters.json` 曾是 legacy 公开展示结构，缺 `versionCode`。
- 本地部署脚本下次 deploy 会补 `versionCode`；当前 check 可能只 warning，不阻断。
- 如果要改成阻断，先确认线上已部署新版公开目录结构。

## 6. 兑换码和支持者系统

### 6.1 产品策略

当前策略已经从“任意 supporter 码解锁全部皮肤”改为“分权授权”：

- `memorial-amber`：纪念版・琥珀纪元
- `founder-qingmu`：创始人版・倾慕 / Elaina

兑换码系统仍保留；皮肤简化后，它授权的是徽章展示，而不是全局主题换肤。

### 6.2 本地和云端相关文件

本地：

- `D:\dex2oat-work\core\redeem-code-verify.sh`
- `D:\dex2oat-work\core\skin-unlock.sh`
- `D:\dex2oat-work\core\supporter-install-id.sh`
- `D:\dex2oat-work\deploy\cloud\supporters.private.json`
- `D:\dex2oat-work\tools\generate-supporter-codes.mjs`
- `D:\dex2oat-work\tools\validate-fixtures.js`
- `D:\dex2oat-work\构建\兑换码服务器凭据说明.md`
- `D:\dex2oat-work\构建\supporter-redeem-codes-v4.5-manifest.json`
- `D:\dex2oat-work\构建\supporter-redeem-codes-v4.5-memorial-amber-500.txt`
- `D:\dex2oat-work\构建\supporter-redeem-codes-v4.5-founder-qingmu-10.txt`
- `D:\dex2oat-work\构建\supporter-redeem-codes-v4.5-all-510.txt`

云端：

- `/root/codex-managed/dex2oat-lock/data/supporters.json`
- `/root/codex-managed/dex2oat-lock/data/supporter-redemptions.jsonl`
- `/root/codex-managed/dex2oat-lock/data/supporter-verifications.jsonl`
- `/root/codex-managed/dex2oat-lock/public/api/supporters.json`

注意：

- 真实兑换码文件属于敏感产物，不要复制到 docs 或最终回复。
- 私有哈希池内容不要贴出来。
- WebUI 不保存原始兑换码，只传给本地脚本，再由脚本调用云端 verify。

### 6.3 兑换码校验链路

链路：

```text
WebUI 输入兑换码
  -> bridge 调用 core/redeem-code-verify.sh
  -> 本地脚本读取/接收 installHash
  -> curl POST https://cloud.154-219-110-62.sslip.io/api/supporter/verify
  -> 服务端验证 code hash 和 installHash 绑定
  -> 服务端返回 skinId/skinIds
  -> 本地 core/skin-unlock.sh 写 unlocked-skins.json
  -> WebUI 重新 loadUnlockedSkins()
  -> 展示对应徽章
```

服务端请求字段应与 `dex2oat_cloud_server.py` 对齐，当前本地曾确认使用：

```text
credential
installHash
moduleVersion
versionCode
manager
```

安全要求：

- `curl` 不得使用 `-k` 或 `--insecure`。
- 网络超时应合理，不能让 WebUI 长时间无响应。
- installHash 缺失必须 fail-closed，不允许 shell 自行发明 fallback 指纹。
- 同一 installHash 重复验证应幂等。
- 不同 installHash 使用已绑定码应拒绝。
- 本地解锁状态只信 `skin-unlock.sh list <installHash>`。
- legacy localStorage supporter pass 只能做展示辅助，不能参与授权判断。

### 6.4 已完成的兑换码加固

近期已完成或应保持的逻辑：

- `core/skin-unlock.sh list` 按当前 installHash 过滤。
- installHash 缺失时返回空授权或错误，不能返回全部。
- `core/redeem-code-verify.sh` 成功后按服务端 `skinIds` 解锁，不再硬编码 `unlock-all`。
- `skin_scope_missing` 必须 fail-closed。
- `tools/validate-fixtures.js` 增加 fake curl fixture：
  - memorial-only 只解锁 `memorial-amber`
  - founder-only 只解锁 `founder-qingmu`
  - 服务端成功但缺少 skin scope 时失败
- 本地 `unlocked-skins.json` 有轻量完整性校验。
- 卸载时保留 `unlocked-skins.json` 和 supporter install id，这是用户解锁状态。

### 6.5 兑换失败排查清单

用户此前反馈过“正确兑换码仍被服务器拒绝”“服务器未返回成功状态”等问题。再次排查时按这个顺序来，不要直接猜：

1. 确认 WebUI 安装包是否真的是最新版本。
   - 手机上报版本必须与当前发布目标一致。
   - 如果 `构建/source/module.prop` 仍是旧版本，先重新 `node tools\build.js`。
2. 确认 WebUI 请求传到本地脚本。
   - 按钮有 loading。
   - 失败 toast 不是静默。
   - bridge 调用了 `core/redeem-code-verify.sh`。
3. 确认本地脚本请求字段。
   - `credential` 是用户输入的码。
   - `installHash` 非空。
   - `versionCode` 是当前包版本。
4. 确认兑换码格式。
   - 用户不应需要手动输入“序号”字段，除非生成文件明确要求。
   - 如果用户只输入短 token 被拒，检查生成文件里真实可兑换字段到底是哪一列。
5. 查云端验证日志。
   - 看 `supporter-verifications.jsonl` 是否有请求到达。
   - 看失败原因是 code not found、bound to another installHash、version mismatch、skin scope missing 还是 server error。
6. 查云端私有池是否已同步。
   - 本地 `deploy/cloud/supporters.private.json` 和云端 `/data/supporters.json` 要一致。
   - 如果本地生成了 v4.5 双池但没部署，线上必然拒绝。
7. 测两类兑换码。
   - 纪念版码应只授予 `memorial-amber`。
   - 创始人码应只授予 `founder-qingmu`。
8. 清理测试绑定只允许在用户明确授权后做。
   - 不要随意删除生产 `supporter-redemptions.jsonl`。
   - 测试前最好备份云端数据文件。

## 7. 规则库和证据链路

相关云端端点：

```text
GET /api/evidence-summary.json
POST /api/rule-evidence
```

云端原始证据：

```text
/root/codex-managed/dex2oat-lock/data/rule-evidence.jsonl
```

本地常见文件：

- `D:\dex2oat-work\webroot-src\data\prop-policy.tsv`
- `D:\dex2oat-work\构建\规则\prop-frequency.non-test.csv`
- `D:\dex2oat-work\构建\规则\existing-rules-meaning-audit.md`

规则处理原则：

- `capture-props.sh -> decode-rules.sh -> generate-props.sh` 应保持“抓取当前设备真实属性 -> 与规则比对 -> 命中多少写多少”的模型。
- custom 视图依赖 `matched-props.txt`，不能回退成展示全量 options。
- 不要恢复基于厂商前缀或 riskMode 的静态裁剪逻辑。
- 默认值规则应收口到构建期单一 fallback 来源，运行时消费 `fallbackValue`。
- 用户显式保存的配置不能被规则重匹配覆盖。

## 8. WebUI 维护要点

WebUI 目标环境：

- Magisk / KernelSU / APatch WebUI。
- 手机 WebView 优先。
- Material Design 3 / Material You 风格。
- 不能假设现代桌面浏览器所有 API 都存在。

重要限制：

- 旧 Android WebView 可能没有 `AbortController`，已有 fallback 需要保留。
- 不要使用会导致 Android 7/旧 WebView 报错的新语法或 API。
- 不要把功能做成桌面大屏优先。
- 不要让页面出现横向滚动。
- 文字必须适配小屏，不要让按钮文字溢出。

近期用户在意的问题：

- 兑换码按钮不能“点了没反应”。
- 保存、重新匹配、皮肤/徽章、风险档位等必要操作要有 toast 或明确 loading。
- 首页状态卡片要简洁，不要一堆重复状态卡。
- “路径与配置文件”常驻卡片已要求从主页删除，只保留常用排障入口即可。
- 关键路径中不要出现 `data/adb/dex2oat-lock/unlocked-skins.json` 这种细节字样；只保留“常用排障入口”。
- 诊断输出页面要降低视觉混乱。
- 全局字体曾要求略微缩小，应通过字号 token 调整，不逐个组件硬编码。

Toast 反馈已确认应补的重点操作：

- 重新匹配完成：`匹配完成，命中 N 项`
- 风险档位切换：`已切换到谨慎模式` 等
- 徽章动态效果开关：开启/关闭提示
- 匿名收集计划开关：成功/失败提示
- 规则证据上传：成功/失败提示
- 提交反馈：成功/失败提示，失败带服务端原因
- 复制反馈包：成功提示
- 导出配置备份：成功带路径，失败带原因
- 从备份恢复到工作台：成功/失败提示；若缺覆盖确认，需要单独提出
- 背景图/Logo 更换：成功/失败提示；用户取消文件选择不提示
- 恢复默认背景/Logo：成功提示

不需要额外 toast 的操作：

- 主题色切换
- 首页报错卡片忽略
- 弹窗打开
- GitHub / 爱发电外链正常跳转
- 已有确认交互且状态栏足够的危险操作

## 9. 构建、验证和发布

本地总验证：

```powershell
cd D:\dex2oat-work
node tools\validate.js
```

完整构建：

```powershell
cd D:\dex2oat-work
node tools\build.js
```

WebUI smoke：

```powershell
cd D:\dex2oat-work
node tools\validate-webui-smoke.js
```

fixture：

```powershell
cd D:\dex2oat-work
node tools\validate-fixtures.js
```

Python 工具检查：

```powershell
cd D:\dex2oat-work
node tools\validate-python.js
```

云端一致性检查：

```powershell
cd D:\dex2oat-work
try {
  $env:DEX2OAT_CLOUD_PASSWORD = "<用户临时提供>"
  python tools\deploy-cloud-release.py check
} finally {
  Remove-Item Env:\DEX2OAT_CLOUD_PASSWORD -ErrorAction SilentlyContinue
}
```

Android AVD 线上包 smoke：

```powershell
cd D:\dex2oat-work
try {
  $env:DEX2OAT_CLOUD_PASSWORD = "<用户临时提供>"
  npm.cmd run smoke:android
} finally {
  Remove-Item Env:\DEX2OAT_CLOUD_PASSWORD -ErrorAction SilentlyContinue
}
```

完整收尾建议：

```powershell
cd D:\dex2oat-work
node tools\build.js
node tools\validate.js
try {
  $env:DEX2OAT_CLOUD_PASSWORD = "<用户临时提供>"
  python tools\deploy-cloud-release.py check
  npm.cmd run smoke:android
} finally {
  Remove-Item Env:\DEX2OAT_CLOUD_PASSWORD -ErrorAction SilentlyContinue
}
```

注意：

- 用户多次要求“用 Node 工具”，因此本地验证优先跑 `node tools\*.js`。
- Python 工具是现有云端部署/运维工具，使用时只传临时环境变量，不写凭据文件。
- 如果 validate 失败，先读错误，不要绕过 gate。

## 10. Android AVD

服务器上已有 Android AVD：

```text
device: emulator-5554
sdk: 35
model: Google ATD built for x86_64
boot_completed: 1
env: /opt/dex2oat-android-lab/env.sh
```

`npm.cmd run smoke:android` 的目标：

- 从线上 release 下载 ZIP。
- 在 Android 环境中对包内 shell 脚本执行 `/system/bin/sh -n`。
- 辅助确认发布包不是只在 Windows/PowerShell 环境里看起来正常。

如果需要开 Android 设备排查 WebUI：

- 优先使用现有服务器 AVD。
- 不要安装重型依赖前忘记记录改动。
- 不要把 Android 临时日志中的设备唯一标识、完整路径或用户数据贴到文档。

## 11. 当前工作树和近期改动提醒

当前工作树可能包含大量未提交改动，接手不要清理。先运行：

```powershell
cd D:\dex2oat-work
git status --short --untracked-files=all
git diff --stat
```

需要重点关注的近期文件：

- `D:\dex2oat-work\core\redeem-code-verify.sh`
- `D:\dex2oat-work\core\skin-unlock.sh`
- `D:\dex2oat-work\core\supporter-install-id.sh`
- `D:\dex2oat-work\core\webui-config-save.sh`
- `D:\dex2oat-work\tools\validate-fixtures.js`
- `D:\dex2oat-work\tools\validate-webui-smoke.js`
- `D:\dex2oat-work\tools\android-release-smoke.py`
- `D:\dex2oat-work\deploy\cloud\dex2oat_cloud_server.py`
- `D:\dex2oat-work\webroot-src\css\theme-memorial-amber.css`
- `D:\dex2oat-work\webroot-src\css\theme-founder-qingmu.css`
- `D:\dex2oat-work\webroot-src\css\skin-badges.css`
- `D:\dex2oat-work\webroot-src\js\skin-manifest.js`
- `D:\dex2oat-work\docs\CURRENT_PROJECT_HANDOFF.md`

服务端脚本注意：

- 用户明确过“不评判、不建议修改服务端 `dex2oat_cloud_server.py` 本身，只审查本地对接逻辑”。
- 如果发现必须改服务端才能解决问题，先汇报“需要改服务端”，不要直接改生产脚本。
- 但本地 `deploy/cloud/dex2oat_cloud_server.py` 可能已经有过结构化 `skinIds` 对接相关改动，接手时以 diff 为准。

## 12. 发布包和源码一致性历史问题

用户曾反馈：

```text
仓库里看到你把 webui 开源了；我要求内容必须与 release.zip 内容相同。
```

当时用户说“放到后面再说”，所以不要把它和当前 custom/徽章任务混在一起。

后续专项要检查：

- GitHub main 分支结构
- `webroot-src/` 是否应公开
- `webroot/` 是否是保护后的产物
- release ZIP 内实际结构
- source ZIP 内是否应包含源码和工具链
- 构建链是否还能从源码复现 release

不要直接删除 `webroot-src/`。这会破坏构建链。

## 13. 安全和隐私边界

可以写入文档：

- 服务器 IP、端口、用户名
- API 地址
- systemd 服务名
- 云端路径
- 本地工具命令
- 环境变量名称
- 非敏感的版本号、接口路径、构建流程

不要写入文档：

- 服务器 SSH/SFTP 明文密码
- 1Panel 面板密码
- Token、Cookie、SSH 私钥
- 兑换码明文列表
- 私有 supporters 哈希池内容
- 用户设备唯一标识
- 完整日志
- 完整 system.prop
- 完整用户配置

如果后续用户再次要求“密码也写进去”，文档里只能保留这句：

```text
密码：由用户临时提供，不落盘；通过 DEX2OAT_CLOUD_PASSWORD 临时环境变量传入。
```

原因：

- 交接文档可能被提交到 Git。
- 构建目录可能被打包或发送。
- Codex 最终回复可能被复制。
- 明文凭据一旦落盘，后续很难确认是否已经泄漏。

## 14. 推荐下一步执行顺序

1. 读取当前 git 状态和 diff。
2. 修复 custom 档位显示 bug。
3. 为 custom 档位显示增加或更新 WebUI smoke 覆盖。
4. 简化皮肤方案，只保留徽章。
5. 删除或停用全局主题 CSS 引用。
6. 确认兑换码解锁后展示徽章，不再应用全局主题。
7. 跑 `node tools\validate-webui-smoke.js`。
8. 跑 `node tools\validate-fixtures.js`。
9. 跑 `node tools\build.js`。
10. 跑 `node tools\validate.js`。
11. 如需云端确认，使用临时 `DEX2OAT_CLOUD_PASSWORD` 跑 `deploy-cloud-release.py check`。
12. 如需 Android 线上包 smoke，使用临时凭据跑 `npm.cmd run smoke:android`。

## 15. 最后一条提醒

这个项目现在已经进入“本地 Root 模块 + 手机 WebUI + 云端校验/发布 + 规则证据”的长期维护阶段。最容易出问题的地方不是单个按钮，而是版本、构建产物、云端数据和手机实际安装包之间不同步。

接手时优先保证：

- 当前改的是权威源码。
- 当前测的是最新构建。
- 当前装的是最新发布包。
- 当前云端私有池和本地生成记录一致。
- 当前 UI 展示来自同一权威状态源。
- 当前文档没有落入明文凭据。
