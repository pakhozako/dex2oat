# State

统一状态文件是 `/data/adb/dex2oat-lock/state.prop`。

写入规则：

- Shell 和 WebUI 都应通过 `core/statectl.sh update key=value ...` 更新状态。
- 不允许 WebUI 直接整文件覆盖 `state.prop`。
- `core/webui-save.sh` 负责 WebUI 保存事务，并在成功后统一更新配置摘要。
- `runtime-props.tmp` 使用 `system.prop` hash 判断缓存是否有效。

