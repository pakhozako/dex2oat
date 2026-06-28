# WebUI 前端交接说明

本文档面向后续接手 Dex2oat Lock WebUI 的前端工程师。项目本体是 Magisk / KernelSU / APatch 模块，不是 Android App；WebUI 运行在管理器提供的 Android WebView 中。

## 交接范围

- 主要源码：`webroot-src/`
- 当前构建产物：`webroot/`
- Material Design 3 token 与样式：`webroot-src/css/m3-*.css`
- WebUI 业务入口：`webroot-src/js/app.js`
- JSBridge：`webroot-src/js/bridge.js`
- 配置与规则数据：`webroot-src/data/options.json`
- WebUI 构建与保护：`tools/build-webui.mjs`
- 全量构建与发布：`tools/build.js`、`tools/release.js`

## 当前交接状态

- 主项目目录：`D:\dex2oat-work`
- 前端交接副本：`D:\下载\GITHUB\wenui`
- 当前版本：`v3.7 / 370`
- 项目没有 `package.json` 和 npm 依赖，构建工具直接使用 Node.js 标准库脚本。
- `webroot-src/` 是唯一前端源码目录，`webroot/` 是保护后的发布产物。
- 前端工程师应先在交接副本中修改，确认后再同步回主项目执行完整 `validate / build / release`。

## 必须遵守的边界

- 不要把它当成普通浏览器单页应用开发。
- 不要引入大型前端框架，除非先评估 Android WebView、Magisk/KSU/APatch WebUI 环境和构建保护流程。
- 不要直接修改 `webroot/` 作为源码；`webroot/` 是构建产物。
- 不要改变 JSBridge API、配置 JSON 格式、状态文件语义或 Shell 调用路径。
- 不要删除预留功能、保护流程、动态主题、规则库字段或彩蛋资源保护流程。
- 不要暴露明文 `options.json`、`app-meta.json`、歌词、封面、Logo 等受保护资源到最终发布包。
- 任何 UI 改动都必须保持 Material Design 3 / Material You 设计语言。

## WebUI 目录职责

`webroot-src/index.html`

开发态入口。只放启动屏、基础 CSS/JS 引用和必要 meta。最终发布时会被 `tools/build-webui.mjs` 转换为保护后的 `webroot/index.html`。

`webroot-src/css/`

- `m3-tokens.css`：Material Design 3 token。
- `m3-theme.css`：深浅色、动态色、主题映射。
- `m3-components.css`：通用组件样式。
- `m3-utils.css`：工具类。
- `app.css`：当前 WebUI 业务布局、Motion、状态层、响应式与兼容 fallback。

`webroot-src/js/`

- `app.js`：页面渲染、状态汇总、交互、Dialog、Pull to Refresh、Logo 彩蛋。
- `bridge.js`：WebUI 与 Shell 通信封装，包含写入路径限制。
- `config.js`：配置读取、合并保存、跨档位 merge、system.prop 生成。
- `m3-theme.js`：主题初始化、动态色、localStorage 设置。
- `system-info.js`：设备信息读取脚本片段。
- `ui.js`：安全文本与 DOM 工具。

`webroot-src/data/`

规则库、版本元数据、Logo、启动图标、彩蛋歌词和封面。构建时会写入保护数据，不应在最终发布包中以明文保留。

## v3.7 当前 UI 边界

以下内容是当前版本已经确认的产品边界，后续前端修改应保持一致：

- 只保留 Logo 连续点击 5 次彩蛋，其它下拉、长按、隐藏入口类彩蛋都应删除或保持不存在。
- 启动页 `index.html` 使用 `html-icon.jpg`，首页 Logo 使用 `home-logo.jpg`，两者都从 `webroot-src/data/` 进入保护构建。
- 启动页歌词保留为：`等不到最浪漫的歌 等不到最寂静的海`。
- 顶部胶囊只显示设备信息已刷新等简短状态，不在该区域重复显示机型和 Android 版本。
- `设备系统配置摘要` 卡片需要保留机型、设备 ID 等摘要信息。
- 自定义工作台不得显示“自定义已确认”“危险模式”“待确认”等噪声文案。
- 卡片透明度设置控制的是前景卡片透明度，不是背景图透明度；取值应覆盖 0-100。
- 模糊强度设置同样应覆盖 0-100。
- 安装历史应使用弹窗展示，不跳转到独立页面。
- 首页和诊断页不得出现 `null`、`undefined`、`NaN`、空数组占位或内部状态码。
- 对普通用户隐藏 `runtime-apply-ok`、`runtime-apply-running`、`Passed`、`Partial Rule Match` 等工程化状态文本。
- 保存并生成 `system.prop` 必须有防重复提交和非阻塞反馈，不能导致 WebUI 卡死。

## 构建流程

完整项目根目录为 `D:\dex2oat-work`。推荐在主项目根目录执行：

```powershell
node tools\validate.js
node tools\build.js
node tools\release.js
```

仅验证 WebUI 构建时，可在包含 `webroot-src/`、`webroot/`、`tools/` 的项目根目录执行：

```powershell
node tools\build-webui.mjs
```

注意：全量 release 仍依赖模块根目录结构、Shell 核心、`module.prop`、`core/`、`scripts/`、`META-INF/` 等文件。

交接副本也包含必要的 Shell、配置和工具上下文，便于前端工程师检查 JSBridge 与状态文件语义；但最终发布仍应回到主项目目录执行。

## 保护流程

`tools/build-webui.mjs` 会完成以下动作：

- 合并和压缩 CSS。
- 将 JS 模块打包为保护加载器。
- 保护 `options.json`、`app-meta.json`、歌词、封面、Logo、启动图标。
- 生成 `webroot/assets/dex2oat-ui.protected.js`。
- 生成 `webroot/assets/dex2oat-ui.protected.css`。
- 生成保护后的 `webroot/index.html`。
- 阻止明文敏感资源进入 `webroot/data/`。

前端改动完成后必须重新构建，不能手工编辑 protected 文件。

## 主题与设计要求

WebUI 继续遵循 Material Design 3：

- 使用 M3 color roles，不直接堆 magic color。
- 使用 Surface / Surface Container / Outline / Primary / Secondary / Error token。
- 动效优先使用 `opacity` 和 `transform`，避免频繁重排。
- Dialog、Snackbar、Button、Card、Navigation、Switch、Chip、Progress 必须保持 M3 风格。
- 保持深色模式、浅色模式、动态源色、卡片透明度、模糊强度设置可用。
- 文案简洁自然，避免向普通用户暴露过多工程化状态。
- 页面切换、Dialog、Snackbar、按钮、卡片和列表项都需要有轻量动画反馈。
- 动效应优先使用 M3 Motion 的 fade、fade through、scale、state layer 和 elevation transition。
- 颜色和卡片层级应来自 M3 token，避免重新引入旧式高饱和渐变、硬编码阴影或 Material 2 风格控件。

## 兼容性要求

- Android 8-16 WebView。
- Magisk / KernelSU / APatch WebUI。
- 低版本 WebView 不应因 `color-mix()`、`backdrop-filter`、`TextEncoder` 等能力缺失而白屏。
- 不要假设浏览器一定支持现代剪贴板、文件 API、长任务 API 或高级动画 API。
- 触摸交互优先，鼠标 hover 只能作为补充。

## 配置保存注意事项

配置保存链路是高风险区域：

1. WebUI 调用 `config.js` 合并配置。
2. 通过 `bridge.js` 写入受限路径下的 staging 文件。
3. Shell 脚本提交到模块状态目录和 `system.prop`。
4. 更新统一状态。

修改时必须保证：

- 跨档位配置不会互相覆盖。
- 保存采用 merge 策略。
- 写入路径不能突破授权目录。
- 保存失败必须给出明确原因。
- 保存按钮需要防重复提交。
- 保存时必须合并所有档位，不能只写当前档位导致其它档位丢失。
- 配置损坏时应优先恢复备份或使用安全默认值，不应让 WebUI 白屏。

## JSBridge 注意事项

- 保持现有 API 名称和返回结构，不要为 UI 方便改动 Shell 侧契约。
- 文件写入必须走授权目录，不允许开放任意绝对路径、`../` 或路径穿越。
- 导出诊断和备份时要确认目标路径与 Android 权限模型兼容。
- 所有显示到页面的外部输入都要经过安全文本处理，不使用 `innerHTML` 拼接用户数据。

## 常见问题

PowerShell 显示中文乱码：

这是 Windows PowerShell 5.1 控制台显示层问题，不代表文件编码损坏。请用 UTF-8 编辑器查看源码，或用 Node.js 以 UTF-8 读取文件。

修改 `webroot/` 后刷新无效：

`webroot/` 是构建产物。请修改 `webroot-src/` 后重新运行构建。

发布包里看不到 `options.json`：

这是预期行为。规则库会被保护进 `dex2oat-ui.protected.js`，最终发布包不应包含明文规则库。

## 提交前检查清单

- `node tools\validate.js` 通过。
- `node tools\build.js` 通过。
- `node tools\release.js` 通过。
- `webroot/assets/*.protected.*` 已更新。
- 没有新增明文敏感资源进入发布包。
- 没有新增 `null`、`undefined`、`NaN` 等用户可见异常文本。
- 没有恢复旧 UI 文案，如“已确认 / 待确认”等状态噪声。
- 没有破坏 Logo 连点 5 次彩蛋。
- 没有修改 JSBridge API 或配置文件格式。

## 交接包说明

`D:\下载\GITHUB\wenui` 是给前端工程师使用的交接副本。主项目仍以 `D:\dex2oat-work` 为准。前端工程师完成修改后，应将变更同步回主项目，再由主项目执行完整 validate / build / release。

交接副本包含：

- `webroot-src/`：前端源码。
- `webroot/`：当前保护后的 WebUI 发布产物。
- `docs/`：架构、构建、状态、规则、兼容性和本交接说明。
- `tools/`：WebUI 构建、保护、校验和发布脚本。
- `core/`、`scripts/`、`customize.sh`、`service.sh`、`uninstall.sh`：JSBridge 与状态链路需要参考的模块上下文。
- `module.prop`、`system.prop`、`build.config.json`、`update.json`、`CHANGELOG.md`、`README.md`：版本、发布和说明上下文。
