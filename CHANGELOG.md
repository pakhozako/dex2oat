# Dex2oat Lock v3.2 更新日志

## Dex2oat-Lock-v3.2-release (2026-06-25)

### 规则系统

- 基于 6 份真机抓取日志补全 v3.2 规则库，覆盖 OnePlus/OPlus、Xiaomi/HyperOS/MIUI、Motorola/AOSP-like 设备样本。
- 保留 29 个高价值证据属性，补充 ART heap、ISA、runtime metrics、USAP、iorap、precache app-list 等规则项。
- 修复规则生成器对空默认值、通配符 metrics、重复属性去重的处理。
- 6 份日志回放均输出 `status=ok`，不再把重复属性跳过误判为 warning/error。

### 状态与诊断

- `state.prop` 继续作为统一主状态源，汇总 install、match、config、apply、health、conflict、integrity、risk、summary 等状态。
- 修正 summary 聚合：`partial`、`fallback`、`warning` 不再直接升级成整体 `error`。
- 模块管理器 `description` 增加绿色、黄色、红色方块状态提示，方便在管理器列表中快速判断状态。
- 完整性、健康、冲突、apply 摘要保持写入统一状态，首页和诊断页显示口径一致。

### WebUI

- 首页删除“进入自定义”按钮，状态信息更集中。
- 首页/诊断摘要卡片改为一行三卡布局。
- 自定义页保留规则库增删能力，保存按钮移动到自定义工作台下方。
- 配置开关保持右置，点击开关只切换，点击卡片主体才展开。
- 关于页删除“查看诊断”、“查看 system.prop”和“版本摘要”。
- 关于页“查看风险协议”保持只读直接打开，不触发倒计时、算术验证或解锁写入。

### 发布包

- 发布包名称：`Dex2oat-Lock-v3.2-release.zip`。
- 发布包 WebUI 使用保护版资源，不包含原始 `webroot/js` 和 `webroot/css` 源码目录。
- 发布包不包含 `README.md`、`CHANGELOG.md`、`update.json`。
- 发布包不包含旧 `props/`、`vendor/`、`vendors.json`、`options-*.json` 或旧厂商模板结构。

### 更新入口

- `update.json` 指向 `Mian` 分支中的 `Dex2oat-Lock-v3.2-release.zip`。
- 公开分支保留 `README.md`、`CHANGELOG.md`、`update.json` 和发布 zip，便于用户查看说明、更新日志与下载包。
