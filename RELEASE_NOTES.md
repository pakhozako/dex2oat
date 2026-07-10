# v6.0

- 状态系统拆分为 store、schema、summary、migrate 与兼容层。
- 新增批量事务、严格输入校验、锁 owner/boot ID 校验和原子写入。
- 生命周期拆分为安装、启动、运行时应用与诊断编排。
- 规则包强制 SHA256，TSV/policy schema 与受控重复校验。
- 新增安装事务、崩溃恢复、提交标记和上一版本回滚。
- 新增启动保护、Dry-run、配置快照与 Action 回滚。
- 新增诊断冷却、哈希缓存、耗时指标和脱敏导出。
- 新增 Node 构建、验证、发布工具和 GitHub Actions。
- 发布包继续排除全部 Markdown 文件。
- 安装检查新增 PASS/WARN/FAIL 分级：完整性 FAIL 会阻断安装，冲突检测与 prop-lock 写入异常以 WARN 展示且不阻断。
- 修复默认启用规则在设备无采集值时未写入 `system.prop` 的问题，默认规则现在会按规则定义生成属性。
- Magisk v20.4+、KernelSU v3.2.5、APatch 11142 保持统一流程。
- Recovery installation is not supported by KernelSU/APatch official design.
