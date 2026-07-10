# Dex2oat Lock 维基

## 兼容性矩阵

| Root 管理器 | 支持版本范围 | 安装路径 | 运行路径 |
| --- | --- | --- | --- |
| Magisk | v20.4+ | Manager 模块安装器 | `customize.sh` + `service.sh` + `system.prop` |
| KernelSU | 当前官方版本 v3.2.5 | Manager 模块安装器 | `customize.sh` + `service.sh` + `system.prop` |
| APatch | 当前官方版本 11142 | Manager 模块安装器 | `customize.sh` + `service.sh` + `system.prop` |

## 设计规则

- Magisk、KernelSU、APatch 共用同一套实现路径。
- Root 管理器检测仅用于日志和诊断。
- 不基于 Magisk、KernelSU 或 APatch 版本创建功能分支。
- `skip_mount` 必须保留，因为 Dex2oat Lock 不挂载 `/system`。
- 不需要 `/system` 挂载支持。

## Recovery

Recovery installation is not supported by KernelSU/APatch official design.

请改用 Magisk 管理器、KernelSU 管理器或 APatch 管理器安装。

## v6.0 可靠性机制

- 安装采用 prepare / commit / rollback 事务，并可恢复中断安装。
- 连续启动应用失败达到阈值后进入保护模式。
- 配置变更前自动保存最近三份快照。
- 诊断检查使用输入哈希和冷却时间，导出内容自动脱敏。
