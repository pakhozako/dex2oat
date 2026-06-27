# Maintain

Dex2oat Lock 是 Root 模块工程，长期维护目标是稳定、可验证、可回滚。任何整理都不得改变模块功能、接口、运行行为或 Material Design 3 设计语言。

## Project Architecture

- Install layer: `customize.sh` 负责安装阶段属性采集、初始配置生成和安装状态写入。
- Service layer: `service.sh` 负责开机后等待系统完成、处理 WebUI rematch 触发、应用运行时属性并刷新诊断状态。
- Core layer: `core/` 提供公共 Shell、状态写入、健康检查、完整性校验、冲突检测、属性锁和 WebUI 保存事务。
- WebUI layer: `webroot-src/` 是源码，`webroot/` 是构建后的发布资源。
- Build layer: `tools/` 负责校验、构建、完整性基线、发布包、源码备份和 manifest。

## Directory Responsibilities

- `core/`: 设备端核心脚本，只放模块运行所需逻辑。
- `scripts/`: 安装和配置生成辅助脚本。
- `tools/`: Node.js 开发和发布工具。
- `webroot-src/`: WebUI 源码、M3 CSS、前端数据源。
- `webroot/`: 构建后的 WebUI 发布目录。
- `docs/`: 架构、构建、发布、状态、兼容性和风险说明。
- `reports/`: 本地审查报告输出目录，内容默认不提交。
- `temp/`: 构建 staging 和临时文件，内容默认不提交。
- `releases/`: release ZIP、SHA256、manifest 输出目录，内容默认不提交。
- `backups/`: source backup 输出目录，内容默认不提交。
- `META-INF/`: Magisk 安装兼容入口。

## State Model

- 统一状态目录默认是 `/data/adb/dex2oat-lock`。
- `state.prop` 是 WebUI、模块描述和诊断状态的统一事实来源。
- 状态写入必须通过 `core/state.sh` 的 `state_update`，最终使用 `sh core/statectl.sh`。
- WebUI 配置保存由 `core/webui-save.sh` 在锁保护下提交。
- `service.sh`、`statectl.sh` 和 `webui-save.sh` 都有各自锁，新增写入不得绕过锁。

## Build Flow

1. 检测开发环境并生成 `.env.local`、`build.config.json`、`environment-report.md`。
2. 清理旧构建缓存和 `webroot/assets/`。
3. 同步版本元数据。
4. 执行 Shell、JavaScript、JSON 和 options 校验。
5. 从 `webroot-src/` 构建 protected WebUI。
6. 生成完整性基线。
7. 再次执行 validate。
8. 生成 release 和 source backup。

## Release Flow

发布前执行：

```powershell
node tools\validate.js
node tools\build.js
node tools\release.js
```

发布产物位于 `releases/`：

- `Dex2oat-Lock-v*-release.zip`
- `Dex2oat-Lock-v*-release.sha256`
- `Dex2oat-Lock-v*-manifest.json`

源码备份位于 `backups/v*/`，用于本地归档，不替代 Git 历史。

## Integrity Flow

- `tools/generate-integrity.js` 复用 `tools/release.js` 的 staging 规则。
- `core/integrity-baseline.prop` 只覆盖最终发布包中的文件。
- `module.prop` 的 `description=` 行会在基线中归一化，避免运行时描述变化造成误报。
- 每次正式发布前必须重新生成基线并再次 validate。

## WebUI Architecture

- `webroot-src/index.html` 是源码模板。
- `webroot-src/js/` 按现有模块拆分业务、桥接、主题、配置、系统信息和 UI 工具。
- `webroot-src/css/m3-tokens.css`、`m3-theme.css`、`m3-components.css`、`m3-utils.css` 和 `app.css` 按顺序合并。
- `webroot/assets/*.protected.*` 和 `webroot/index.html` 由构建工具生成，不手工编辑。

## Material Design 3 Constraints

- 颜色、字体、shape、elevation、motion 优先使用 M3 token。
- 深色、浅色和动态源色能力必须保持一致。
- 组件状态要体现 hover、focus、pressed 和 disabled 语义。
- 不用主观审美替代设计系统判断。
- WebUI 是 Magisk WebUI，不机械套 Android App 控件尺寸；如有触控问题，优先扩大点击热区而不改变视觉尺寸。

## Shell Coding Rules

- 保持 POSIX / BusyBox `sh` 兼容。
- 使用 `case`、普通函数和简单参数解析，避免 Bash-only 语法。
- 临时文件放入受控目录，写入完成后原子替换。
- 权限默认最小化，敏感状态使用 `0600`，状态目录使用 `0700`。
- 失败处理要写入状态或日志，避免静默失败。

## JavaScript Coding Rules

- WebUI 代码保持无大型框架依赖。
- JSBridge 参数必须校验和转义。
- 不把现代 WebView API 作为唯一实现；缺失时要有 fallback。
- Promise 必须处理异常，用户可见操作要返回明确状态。
- 避免全局泄漏和重复注册事件监听。

## CSS Coding Rules

- 新样式优先使用 `--md-sys-*` 和项目语义 token。
- 避免新增 magic color；确需新增时同步说明用途。
- 保持响应式布局在窄屏 WebView 中不溢出。
- 现代 CSS 能力如 `color-mix()`、`backdrop-filter` 必须保持旧 WebView fallback。

## Node.js Tool Rules

- 工具入口保持可单独执行，也可被 `tools/build.js` 复用。
- 文件删除必须限制在项目根目录或明确允许目录内。
- 发布包内容只能通过 release staging 生成。
- 不新增必须联网安装的构建依赖，除非经过兼容性评估。

## Git Rules

- 主开发分支建议使用 `main`。
- 发布建议使用 tag `vX.Y` 或 `vX.Y.Z`。
- 不重写已有历史，不强推覆盖发布历史。
- 提交信息建议使用 `feat:`、`fix:`、`docs:`、`chore:`、`build:`。
- Shell、JS、CSS、JSON、Markdown 统一 LF。

## Release Checklist

- `git status` 已确认变更范围。
- `node tools\validate.js` 通过。
- `node tools\build.js` 通过。
- `node tools\release.js` 通过。
- `core/integrity-baseline.prop` 已重新生成。
- `releases/` 中 ZIP、SHA256、manifest 同步生成。
- 文档已同步更新。

## Rollback Flow

1. 优先使用 Git revert 回滚问题提交。
2. 如问题来自生成产物，重新执行 `node tools\build.js`。
3. 如问题来自发布包，废弃该 ZIP 并用新 tag 或修订版本重新发布。
4. 不直接编辑已发布 ZIP。

## Common Issues

- WebUI 空白：先检查 `webroot/index.html` 是否引用存在的 protected asset。
- integrity missing：确认基线和 release staging 是否使用同一发布文件集合。
- WebUI 保存失败：检查 JSBridge 路径边界、stage 文件和 `webui-save.sh` 日志。
- 开机未应用：检查 `service.sh` lock、boot completed 等待和 `state.prop` summary。
- Windows 构建乱码：用 UTF-8 读取文档和工具输出，不要用非 UTF-8 重写源码。

## Forbidden

1. 不允许大规模重构。
2. 不允许改变项目架构。
3. 不允许改变 Material Design 3 设计语言。
4. 不允许绕过 state lock 写入状态。
5. 不允许提供 JSBridge 任意路径写入能力。
6. 不允许把 docs、tools、reports、temp 或 package lock 放入完整性基线。
7. 不允许手工修改 protected WebUI bundle。
8. 不允许引入未经评估的新依赖。
9. 不允许跳过 validate、build、release。
10. 不允许删除预留但有明确用途的主题或兼容模块。
