# Dex2oat Lock

![:name](https://count.getloli.com/@dex2oat?name=dex2oat&theme=moebooru&padding=7&offset=0&align=top&scale=1&pixelated=1&darkmode=auto)

## 📌 项目简介

Dex2oat Lock 是一个面向 Android Root 环境的 ART / dexopt 属性模块。它在安装时读取设备当前属性，通过内置规则包生成 `system.prop`，过滤与其他活动模块重复的属性，并在系统启动后仅应用值发生变化的运行时属性。

v6.1 延续 v6.0 的轻量化流程，重点是保持流程短、状态少、失败边界明确。它不备份原始属性，也不在卸载时手动回写属性；模块卸载后，模块提供的 `system.prop` 自然停止加载。

## 🎯 设计目标

Android 版本、厂商 ROM 和 Root 实现对 ART / dexopt 属性的支持并不完全一致。直接套用固定配置可能写入设备没有采用的属性，也可能与其他模块重复设置同一属性。

Dex2oat Lock 采用规则驱动流程：先验证规则包，再采集规则涉及的设备属性，根据允许值、默认值和共享策略生成候选配置，最后扫描其他活动模块并移除冲突项。整个流程失败时不会提交未验证的候选配置。

## 🔧 主要功能

### 规则包校验与规则解析

内置规则包在解码前必须通过 SHA256 校验。解码后的 TSV 必须符合固定 12 列 schema，并验证规则 ID、属性名、枚举、风险等级、默认开关、默认值、owner 关系、字段长度和受控重复关系。校验失败会直接终止本次配置生成。

规则解析优先使用设备已采集且位于允许集合中的值。对于 `defaultEnabled=true` 但设备没有采集值的规则，会使用规则定义的默认值生成属性；未默认启用且没有采集值的规则不会写入。

### 冲突属性过滤

候选配置生成后，模块会扫描 `/data/adb/modules/*/system.prop`。只要其他活动模块声明了同一属性，本模块就会跳过该属性，无论双方值相同还是不同，避免两个模块共同管理同一键。

带有 `disable` 或 `remove` 标记的模块不参与冲突判断。扫描失败或遇到不可读的活动模块配置时，本次配置不会提交。详细结果写入 `conflict-report.txt`。

### 原子配置提交

候选 `system.prop` 会先在私有工作目录中生成，经过属性格式、重复键和 SHA256 校验后，再通过同目录原子替换提交。规则解码、schema、采集、冲突扫描或最终校验任一步失败，现有有效 `system.prop` 都不会被候选内容覆盖。

覆盖安装不会预先删除旧状态目录。安装入口仅维护当前必要报告和日志，不保存原始属性副本。

### 仅应用变化值

启动服务读取最终 `system.prop`，逐项比较当前值与目标值。值相同的属性直接计为 `unchanged`，不会调用 `resetprop` 或 `setprop`；只有值不同的属性才会写入并回读验证。

启动等待和操作锁都有明确上限。锁记录 PID、boot ID 和 owner，进程消失或设备重启后可清理失效锁，不会无限等待。

### 精简状态与日志

运行状态目录为 `/data/adb/dex2oat-lock`，只保留以下文件：

- `match-report.prop`：规则解析和最终配置统计。
- `conflict-report.txt`：冲突模块、冲突类型和被跳过属性。
- `runtime-status.prop`：运行时写入、未变化、不一致和失败计数。
- `install.log`：安装结果与配置摘要。
- `service.log`：启动等待和运行时应用结果。

安装日志和服务日志带有基础大小轮转。项目不创建额外持久化确认目录、属性备份、快照或回滚状态。

## 🎛️ Action 操作

模块管理器的 Action 入口提供简洁的状态、规则、配置、健康和冲突摘要。也可以直接执行：

```sh
sh action.sh status
sh action.sh preview
sh action.sh rematch
sh action.sh apply
sh action.sh conflicts
sh action.sh all
```

`preview` 会完整执行规则解码、采集、解析和冲突扫描，但不会替换 `system.prop`，也不会更新持久报告或运行状态。`rematch` 重新生成并提交配置；`apply` 仅应用与当前值不同的属性。

## 📱 安装与兼容性

请通过 Magisk、KernelSU 或 APatch 的模块管理器安装 ZIP。三端使用同一模块结构、同一 `customize.sh` 和同一属性流程，不提供单独的平台安装器。

模块保留标准入口文件及 `skip_mount`。它不挂载或替换 `/system` 文件。KernelSU 与 APatch 不支持 Recovery 安装，请在 Android 已启动后通过模块管理器安装。

不同 Android 版本和厂商 ROM 可能忽略、覆盖或重新解释部分属性。规则命中表示模块已生成目标配置，不代表 ROM 一定采用该属性。冲突检测只覆盖其他模块公开的 `system.prop`，无法识别其脚本在运行时动态写入但未声明的属性。

## ⚠️ 注意事项

本模块需要 Root 权限，修改 ART / dexopt 属性可能影响应用安装、后台编译、功耗和系统稳定性。安装前应备份重要数据，并确认能够通过模块管理器禁用或卸载模块。

项目不会备份所谓“原始属性”。Android 模块属性不是需要在卸载时逐项回写的持久配置：卸载模块并重启后，其 `system.prop` 不再参与加载。