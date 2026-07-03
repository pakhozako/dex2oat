# Dex2oat-Lock 新窗口接手手册

这份文档给“完全不知道前文的新 Codex 窗口”使用。请先读完本文件，再动项目。

不要把服务器密码、GitHub Token、面板密码、SSH Key 或任何私密凭据写进仓库文件。

## 1. 项目是什么

Dex2oat-Lock 是一个 Root 模块项目，不是 Android App。

模块目标：

- 通过规则库生成和应用 ART / dexopt 相关 `system.prop` / runtime 配置。
- 在 Magisk / KernelSU / APatch 环境下保持兼容。
- 提供 Magisk/KSU/APatch WebUI 用于本地管理、诊断、配置生成、规则证据上传等。
- WebUI 使用 Material Design 3 / Material You 设计语言，面向手机 WebView，而不是标准桌面浏览器。

主要组成：

- Shell 核心：安装、开机服务、状态刷新、规则匹配、完整性检查、卸载清理。
- Node.js 工具链：验证、构建、保护 WebUI、生成完整性基线、release 打包、云端同步。
- WebUI：手机优先的 Material 3 管理界面。
- JSBridge：WebUI 和 Shell/文件系统通信边界。
- 云端：发布镜像、更新 API、匿名统计、规则证据汇总、远端健康检查。

## 2. 关键路径

本地项目主目录：

```text
D:\dex2oat-work
```

注意：有时工作目录会是：

```text
D:\dex2oat-work\构建
```

但真正仓库根目录是 `D:\dex2oat-work`。执行 Git、构建、发布命令时回到根目录。

服务器托管目录：

```text
/root/codex-managed/dex2oat-lock
```

服务器 IP：

```text
154.219.110.62
```

SSH 用户：

```text
root
```

密码由用户提供过，但不要写进文件。需要连接时使用临时环境变量。

## 3. 目录职责

根目录常见内容：

- `core/`：模块核心 Shell 库、完整性基线、状态/规则相关核心文件。
- `scripts/`：设备端辅助 Shell 脚本。
- `tools/`：Node/Python 构建、验证、发布、云端运维工具。
- `webroot-src/`：WebUI 可编辑源码，优先修改这里。
- `webroot/`：构建后的 WebUI 发布产物，通常由工具生成/保护。
- `docs/`：维护、云端、架构、发布、交接文档。
- `META-INF/`：Magisk ZIP 安装结构相关文件。
- `releases/`：release ZIP、sha256、manifest。
- `dist/`：构建输出。
- `backups/`：版本备份。
- `temp/`：临时脚本/调试文件，可清理但不要误删有用证据。
- `构建/`：可能是构建树/检查树，不等同于仓库根。

重要文件：

- `customize.sh`：安装阶段逻辑。
- `service.sh`：开机/后台服务逻辑。
- `uninstall.sh`：卸载清理。
- `module.prop`：模块元数据。
- `system.prop`：默认/生成相关 prop。
- `package.json`：Node 工具入口。
- `tools/version.json`：版本号、云端 URL、规则版本等。
- `tools/build.js`：主构建流程。
- `tools/release.js`：发布包生成流程。
- `tools/deploy-cloud-release.py`：云端 release/API 同步工具。
- `tools/cloud-ops.py`：云端状态/健康/日志/worker 检查工具。

## 4. 用户偏好和硬性规则

用户非常重视这些原则：

1. 保持现有架构，不要为了“优化”推倒重来。
2. 默认直接做事，不要反复请求确认。
3. 最小改动优先，但 WebUI 视觉/交互在明确授权时可以较大幅度打磨。
4. 模块必须兼容 Magisk / KernelSU / APatch。
5. Shell 必须保持 POSIX / BusyBox / Android shell 兼容。
6. WebUI 必须手机优先，围绕 Android WebView/Magisk WebUI 使用场景设计。
7. WebUI 风格必须遵循 Material Design 3 / Material You。
8. 每次修改后尽量执行 validate、build、release。
9. 发布 ZIP、WebUI 保护、完整性基线必须一致。
10. 不要删除预留功能，除非确认无引用且用户明确允许。
11. 不要暴露用户隐私、日志、完整配置、账号、设备唯一 ID 等敏感数据。
12. 不要把服务器凭据、面板密码、Token 写入仓库。

用户常用表达：

- “mian” 多半指 GitHub 的 `main` 分支，但操作前用 `git branch` 确认。
- “webui源码与 release.zip 内容相同” 指发布分支/上传结构不要把未保护源码错误暴露给 release 结构，后续需要专项处理。

## 5. PowerShell 环境注意

PowerShell 5 默认中文/UTF-8 容易出问题。每次读写中文文件前建议：

```powershell
$OutputEncoding=[System.Text.Encoding]::UTF8
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
```

避免使用 Bash heredoc：

```powershell
python - <<'PY'
```

PowerShell 会报错。改用 `@' ... '@ | python -`，或写临时脚本。

优先使用：

```powershell
rg
git -C D:\dex2oat-work ...
node tools\validate.js
```

## 6. 标准本地检查命令

从仓库根目录执行：

```powershell
cd D:\dex2oat-work
$OutputEncoding=[System.Text.Encoding]::UTF8
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8

git status --short --untracked-files=all
node tools\validate.js
node tools\build.js
node tools\release.js
```

WebUI 单独检查常见链路：

```powershell
node tools\validate-js.js
node tools\validate-options.mjs
node tools\build-webui.mjs
node tools\validate.js
```

实际是否存在这些脚本，以当前 `tools/` 为准。

云端检查：

```powershell
$env:DEX2OAT_CLOUD_PASSWORD = "<临时填写，不要写入文件>"
python tools\deploy-cloud-release.py check
python tools\cloud-ops.py status
python tools\cloud-ops.py health
python tools\cloud-ops.py inventory
Remove-Item Env:\DEX2OAT_CLOUD_PASSWORD
```

## 7. 当前本地改动状态

当前窗口结束前，以下文件有未提交改动或新增：

- `docs/CLOUD.md`
- `docs/V3.9_DEVOPS_AND_V4_ROADMAP.md`
- `package.json`
- `tools/cloud-ops.py`
- `tools/deploy-cloud-release.py`
- `docs/NEXT_WINDOW_HANDOFF.md`

新窗口接手第一步必须运行：

```powershell
cd D:\dex2oat-work
git status --short --untracked-files=all
git diff -- docs\CLOUD.md docs\V3.9_DEVOPS_AND_V4_ROADMAP.md package.json tools\cloud-ops.py tools\deploy-cloud-release.py docs\NEXT_WINDOW_HANDOFF.md
```

这些改动的背景：

- 曾经临时把 18080 首页改成自写统计/健康控制台。
- 用户随后纠正：服务器管理面板不要自写，要用 GitHub 上成熟开源项目一键部署。
- 最新事实：Dex2oat cloud 已迁到 `18082`，`18080` 由 1Panel 使用，
  `18081` 现在空置，旧 admin 必须保持停止和禁用。
- 本窗口不要再碰远端服务器部署，只处理本地项目、文档、构建和 release 结构。

## 8. 当前服务器状态

服务器已知情况：

- 系统：Ubuntu 24.04.1 LTS。
- 当前分工：`18082` 用于 Dex2oat-Lock 发布/API；`18080` 是 1Panel 服务器管理面板；`18081` 现在空置。
- 本窗口不要继续部署服务器面板，不要改 1Panel，不要调整远端端口。
- `18081` 是旧 admin 端口，旧 admin 必须保持停止和禁用，不要重新启用。
- Dex2oat 发布/运维工具应继续检查 `http://154.219.110.62:18082`；发布给 WebUI
  的远端元数据只允许 HTTPS 或本机 HTTP，公网仍是明文 HTTP 时应保持 WebUI
  cloud URL 为空。

如果需要确认 Dex2oat 云端状态，只做只读检查：

```powershell
$env:DEX2OAT_CLOUD_PASSWORD = "<临时填写>"
python tools\deploy-cloud-release.py check
python tools\cloud-ops.py status
python tools\cloud-ops.py health
Remove-Item Env:\DEX2OAT_CLOUD_PASSWORD
```

不要动这些用户原有服务/端口：

- `komari`
- `sing-box`
- SSH 配置
- 全局防火墙策略
- 非 `/root/codex-managed/dex2oat-lock` 的业务目录

## 9. 18080 / 18082 的正确定位

用户最新纠正非常重要：

- 不要把我临时写的 18080 自定义页面当作长期服务器管理面板。
- `18080` 交给 1Panel 等成熟服务器面板。
- `18082` 是 Dex2oat-Lock 模块发布/API/更新检查/规则证据汇总入口。
- 发布/运维工具和云端文档继续以 `18082` 作为 Dex2oat 云端 base URL；WebUI
  只暴露 HTTPS 或本机 HTTP 的远端 URL，公网明文 HTTP 不写入发布元数据。
- 当前 `18082` 已承接 Dex2oat cloud；`18080` 已由 1Panel 使用；`18081` 为空置状态。

推荐后续处理：

- 清理旧的 `18080` Dex2oat API 文案。
- 不要恢复 `18081`。
- 不要把 Dex2oat 自写 HTML 面板部署到 `18080`。

## 10. 服务器面板方向

用户要求：服务器管理面板使用现成 GitHub 开源项目，可一条命令部署，不要自写。

另一个窗口已经接手服务器面板，当前端口状态为：

- `18082 = Dex2oat 发布/API`
- `18080 = 1Panel 等成熟面板`
- `18081 = 空置，旧 admin 必须保持停止和禁用`

本窗口不要继续安装或配置服务器面板，也不要恢复旧 admin。

背景候选：1Panel。

已查到的信息：

- 项目：`1Panel`
- GitHub：`1Panel-dev/1Panel`
- 官方一键脚本：

```text
https://resource.1panel.pro/v2/quick_start.sh
```

- 当前查到最新版：`v2.2.2`
- 官方资源路径：

```text
https://resource.1panel.pro/v2/stable/<version>/release/
```

- 安装后通常使用：

```bash
1pctl user-info
```

获取访问地址和登录信息。

如果将来需要复核服务器面板，必须：

1. 确认安装脚本交互参数。
2. 确认端口不冲突：不能占 `22`、`18082`、`komari`、`sing-box`。
3. 不要把面板密码写入文件。
4. 安装后记录非敏感访问信息，敏感凭据只给用户或保存在服务器安全位置。
5. 验证 1Panel 服务、端口、登录入口。
6. 再验证 `18082` Dex2oat API 没受影响。

## 11. 旧 18080 自写页面怎么处理

旧问题：曾经在 `tools/deploy-cloud-release.py` 里新增过较大的自写 HTML 控制台模板和 `index` 命令。

用户已指出：服务器面板不能用这种自写方案。

当前方向：

- 不要恢复自写 18080 控制台。
- `tools/deploy-cloud-release.py` 应只同步 Dex2oat release/API 到 `18082`。
- 如果需要首页，也只作为 `18082` 的极简 release/API landing，不承担服务器管理。

## 12. WebUI 和 Release ZIP 一致性问题

用户另一个重要反馈：

> 仓库里看到你把 webui 开源了；我要求内容必须与 release.zip 内容相同。

用户说这个“放到后面再说”。

含义：

- 这个问题不要和服务器面板任务混在一起。
- 后续需要专项检查 `webroot-src/`、`webroot/`、release ZIP、GitHub `main` 分支结构。
- 目标可能是：上传/公开内容应与 release 包结构一致，WebUI 相关文件应是保护后的产物，不要错误公开原始彩蛋/歌词/封面/未保护逻辑。

处理前必须先看当前 Git 状态和 release 包内容，不要直接删除源码目录，避免破坏构建链。

## 13. WebUI 项目经验

修改 WebUI 时：

- 优先改 `webroot-src/`。
- `webroot/` 通常是生成/保护产物。
- 改启动页时要同时检查：
  - `webroot-src/index.html`
  - `tools/build-webui.mjs` 内嵌模板
- 用户非常在意：
  - 首次进入 HTML 的 Logo 动画连贯性。
  - HTML 到主界面的过渡不要割裂。
  - 手机窗口为主。
  - 不要横向滑动。
  - Material 3 / Pixel / Android 15 质感。
  - 图标不要空。
  - 卡片紧凑但不乱。
  - 自定义保存不能有 bug。

WebUI 相关资源曾要求：

- 两个 logo 统一用 `D:\dex2oat-work\构建\logo.jpg`，构建输入为 `webroot-src/data/logo.jpg`。
- HTML 启动页文本顺序：
  1. 图标
  2. `Dex2oat-Lock`
  3. `可以愛的話 不退縮`
  4. `正在同步设备状态与配置缓存...`
- 彩蛋：Logo 点击彩蛋保留，其他彩蛋曾要求删除；后续以当前代码和用户最新要求为准。

## 14. 规则库和模块逻辑经验

用户曾要求：

- 能兼容设备时，把 `speed-profile`、`speed` 等升级替换为 `everything`。
- 谨慎/危险分类也可替换为 `everything`，但默认关闭。
- `skip` 要为 `false` 的规则才能启用。
- 线程等能关闭尽量关闭，替换为空或 `0`。
- 清理无用规则、仅一个选项的规则、空选项。
- 加强匹配逻辑，不能因为规则错误导致设备不开机。
- 默认关闭后台触发。

处理规则库时必须保守，特别是会影响开机和 ART/dexopt 的配置。

## 15. 完整性和状态经验

曾经反复出现 `Warning (integrity missing)`。

处理经验：

- 完整性基线只能针对最终发布包关键文件。
- 不要把 docs、package-lock、非发布文件加入完整性基线。
- 发布目录和完整性校验目录必须一致。
- 首装/升级/重启后默认不应显示完整性缺失。
- 不能关闭完整性检测，只能修基线/路径/状态误判。

状态/配置经验：

- WebUI 跨档位保存必须 merge，不要只保存当前档位覆盖全部配置。
- 配置保存要有锁、备份、损坏恢复。
- 不要读取 `/data/adb/dex2oat-lock-install.prop`；用户明确要求去掉相关读取。
- 抓取日志/生成 prop 期望优先放 `/data/adb/dex2oat-lock/`，不要反复写 `/storage/emulated/0/Download/`，除非是用户手动导出。

## 16. 云端通信和隐私边界

允许：

- 可选匿名心跳。
- 模块版本分布。
- Android 版本分布。
- 品牌/机型聚合。
- Root 管理器类型。
- 规则版本。
- 用户手动确认后的规则证据上传。

禁止：

- IMEI、Android ID、序列号、手机号、账号。
- 应用列表。
- 完整日志。
- 完整配置内容。
- system.prop 全量内容。
- token/password/cookie/secret。
- 任意路径/文件内容。

模块本地功能不能依赖服务器可用性。服务器挂了也不能影响开机、保存、规则匹配、完整性检查。

## 17. 已知容易踩坑

- PowerShell 中文乱码：先设置 UTF-8。
- PowerShell 不支持 Bash heredoc。
- 不要直接编辑 `webroot/` 后忘记同步 `webroot-src/` 和构建模板。
- 不要误把 `D:\dex2oat-work\构建` 当仓库根。
- 不要用 `git reset --hard` 或 `git checkout --` 清用户改动。
- 不要把自写临时服务器页面当长期管理面板。
- 不要把 Dex2oat API 放回 18080；当前分工是 18082。
- 不要再启用 18081。
- 不要把服务器密码写入 `docs/` 或工具文件。
- 不要碰 `komari` / `sing-box` / 全局 SSH / 全局防火墙。
- 不要直接删除 `webroot-src/`，即使用户说 release.zip 内容一致，也要先确认构建链如何保留源码/产物。

## 18. 新窗口推荐接手顺序

### 第一步：确认本地状态

```powershell
cd D:\dex2oat-work
$OutputEncoding=[System.Text.Encoding]::UTF8
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
git status --short --untracked-files=all
git diff --stat
```

### 第二步：理解当前未提交改动

```powershell
git diff -- docs\CLOUD.md docs\V3.9_DEVOPS_AND_V4_ROADMAP.md package.json tools\cloud-ops.py tools\deploy-cloud-release.py docs\NEXT_WINDOW_HANDOFF.md
```

### 第三步：修正文档/工具口径

把端口目标口径统一为：

- `18080`：1Panel 等成熟服务器面板。
- `18082`：Dex2oat-Lock 发布/API/统计概览入口。
- `18081`：当前空置，旧 admin 必须保持停止和禁用。

### 第四步：不要接手服务器部署

服务器面板由另一个窗口处理。本窗口只做本地项目收口、文档、构建和 release 检查。

### 第五步：验证 Dex2oat 云端

```powershell
$env:DEX2OAT_CLOUD_PASSWORD = "<临时填写>"
python tools\deploy-cloud-release.py check
python tools\cloud-ops.py status
python tools\cloud-ops.py health
Remove-Item Env:\DEX2OAT_CLOUD_PASSWORD
```

这些命令应检查 `18082`，不要检查旧的 Dex2oat `18080`。

### 第六步：后续再处理 WebUI/release.zip 一致性

等服务器面板稳定后，单独检查：

- GitHub main 分支文件结构。
- `webroot-src/` 是否应公开。
- release ZIP 内实际结构。
- `webroot/` 保护产物是否同步。
- 构建链是否仍可从源码复现 release。

## 19. 最后一条提醒

这个项目现在已经进入“长期维护 + 云端配套 + 手机 WebUI 体验打磨”的阶段。

新窗口不要急着大改。先确认当前状态、保住 release/API/构建链，再逐步处理：

1. 本地 18082 口径收口。
2. 4.0 大版本框架细化。
3. WebUI/release.zip 一致性专项。
4. 下一版模块逻辑和 WebUI 优化。
5. v4.0 分支、发布和回滚策略落地。
