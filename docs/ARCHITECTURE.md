# Architecture

Dex2oat Lock 是 Magisk / KernelSU / APatch 模块，不是 Android App。项目由设备端 Shell、Node.js 构建工具、WebUI、JSBridge 和 Material Design 3 样式体系组成。

## Runtime Layers

1. Install layer: `customize.sh` 在安装阶段采集设备属性、生成初始 `system.prop`、写入安装进度和最终安装状态。
2. Service layer: `service.sh` 在开机后等待 boot completed，处理 WebUI rematch 触发，应用运行时属性，刷新 health、integrity、prop-lock 状态。服务入口使用 `$STATE_DIR/.service.lock` 避免开机服务和 WebUI 手动触发并发执行。
3. Core layer: `core/` 提供状态、健康检查、完整性校验、冲突检测、WebUI 保存事务和公共工具。`core/statectl.sh` 是 `state.prop` 的统一写入口，使用 lock directory、PID 临时文件和原子替换。
4. WebUI layer: `webroot-src/` 是源码，`webroot/` 是构建后的发布资源。发布包只包含 protected assets，不包含原始 WebUI 源码。
5. Build layer: `tools/` 负责 validate、WebUI build、integrity baseline、release zip、source backup 和 manifest。

## Data Flow

安装阶段：

1. `customize.sh` 创建 `/data/adb/dex2oat-lock`。
2. `scripts/capture-props.sh` 采集设备属性。
3. `scripts/generate-props.sh` 根据发布包内的 `webroot/data/rule-props.tsv` 生成 `system.prop`、匹配报告和配置摘要；`webroot-src/data/options.json` 只作为构建期规则源并被保护进 WebUI bundle。
4. `core/state.sh` / `core/statectl.sh` 汇总状态到 `state.prop`。

运行阶段：

1. `service.sh` 通过全局锁进入单实例执行。
2. 如存在 `/data/adb/dex2oat-lock/trigger-rematch`，重新生成配置。
3. 运行 health、integrity、prop-lock。
4. 多阶段应用运行时属性并写入 summary。

WebUI 保存：

1. WebUI 只能通过 JSBridge 写入受限路径。
2. 配置先写入 `/data/adb/dex2oat-lock/stage-*`。
3. `core/webui-save.sh` 校验 stage 后在 `.webui-save.lock` 下提交。
4. 状态更新统一走 `statectl.sh`。

## Build Artifacts

- `webroot/assets/*.protected.js`: 从 `webroot-src/js` 构建，发布版使用 classic script 兼容 Root 管理器 WebView。
- `webroot/assets/*.protected.css`: 合并 `m3-tokens.css`、`m3-theme.css`、`m3-components.css`、`m3-utils.css` 和 `app.css` 后构建。
- `core/integrity-baseline.prop`: 基于 release staging 生成，只覆盖最终发布包形态。
- `releases/*.zip`: 可安装模块包。
- `backups/v*/`: 源码快照，不包含本地环境文件、临时目录或报告碎片。
- `reports/`: 本地审查报告目录，内容默认不提交。
- `temp/`: 构建 staging 目录，内容默认不提交。

## Non Goals

- 不在设备端依赖 Node.js。
- 不把 WebUI 当作标准浏览器应用开发。
- 不引入大型前端框架。
- 不通过文档或构建整理改变模块运行行为。
