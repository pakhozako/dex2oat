# State

统一状态文件是 `/data/adb/dex2oat-lock/state.prop`。它用于 WebUI 首页、模块管理器描述、诊断输出和运行期健康判断。

## Write Rules

- Shell 状态更新必须通过 `state_update`，最终由 `core/statectl.sh` 执行。
- `statectl.sh` 通过 `sh statectl.sh` 调用，不依赖可执行位。
- `statectl.sh update key=value ...` 使用 `$STATE_DIR/.state.lock`、PID 临时文件和 `mv` 原子替换。
- summary attention 清理使用 `statectl.sh clear-attention`，同样受状态锁保护。
- WebUI 不允许直接整文件覆盖 `state.prop`。
- `core/webui-save.sh` 负责 WebUI 保存事务，并在成功后统一更新配置摘要。

## Runtime Files

默认状态目录：`/data/adb/dex2oat-lock`

- `state.prop`: 统一状态。
- `service-state.prop`: service 阶段状态。
- `config.json`: WebUI 用户配置。
- `config-source.prop`: 当前配置来源摘要。
- `system.prop.bak`: 最新生成配置备份。
- `prop-lock.list`: 运行态属性锁定快照。
- `runtime-props.tmp`: service 运行态属性缓存。
- `runtime-props.hash`: `system.prop` hash，用于判断缓存是否有效。
- `health.log`: 健康检查报告。
- `integrity-report.txt`: 完整性报告。
- `conflict-report.txt`: 冲突检测报告。
- `logs/`: WebUI 诊断和卸载归档日志。

## Summary Model

`state_recompute_summary` 汇总 install、match、config、apply、service、health、conflict、integrity 和 restore 状态，输出：

- `summary.status`
- `summary.title`
- `summary.message`
- `summary.attention_total`
- `summary.attention_alert_total`
- `summary.updated_at`

summary 只表达当前诊断结论，不直接改变配置。

## Concurrency

- `statectl.sh`: 保护 `state.prop`。
- `webui-save.sh`: 保护 WebUI 保存事务。
- `service.sh`: 保护开机服务和 WebUI 手动执行不并发。

新增状态写入时必须复用这些锁，不得直接写入 `state.prop`。
