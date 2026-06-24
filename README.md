# Dex2oat Lock

![:name](https://count.getloli.com/@dex2oat?name=dex2oat&theme=moebooru&padding=7&offset=0&align=top&scale=1&pixelated=1&darkmode=auto)

Magisk / KernelSU / APatch 模块，通过规则驱动的属性抓取、匹配与生成链路，精细调控 `pm.dexopt.*` 与 `dalvik.vm.*` 系列属性，减少后台、安装、OTA 等场景下不必要的 dexopt 编译。内置 WebUI，可在线切换三档方案，无需重新刷入。

---

## 3.1 架构

v3.1 不再通过厂商识别选择模板，而是走 `capture-props.sh` 抓取当前设备实际属性，再由 `generate-props.sh` 根据 `webroot/data/options.json` 的规则目录生成最终 `system.prop`。

运行状态统一汇总到 `/data/adb/dex2oat-lock/state.prop`，WebUI 首页、诊断页、service、health-check 和 conflict-detect 都优先读取或写入这一个主状态源。

---

## 功能特性

- **三档风险模式** — 安全 / 谨慎 / 危险集成在自定义工作台
- **规则驱动** — 设备属性抓取后按规则目录生成最终配置，不再维护厂商模板
- **WebUI** — 首页真实状态总览、自定义工作台、关于页三导航
- **风险协议** — 自定义和危险模式需要 30 秒等待、算术验证和显式同意
- **完整性校验** — 校验 WebUI、脚本、规则和关键模块文件，结果进入首页和诊断
- **安全回滚** — 安装时自动备份原始属性，卸载后完整还原
- **诊断面板** — 内置属性生效验证与 apply.log 摘要分析
- **云端更新** — 管理器自动检测新版本
- **统一状态** — `state.prop` 汇总配置来源、prop 摘要、匹配结果、健康状态和冲突状态

---

## 配置档位

### 安全档（默认启用）

压制后台、安装、OTA 等场景的额外编译触发。安装期会优先复用当前设备已存在的相关属性值，未抓到的规则使用安全默认值。

### 谨慎档（默认关闭）

进阶控制，按需启用：dex2oat 线程数、CPU 亲和性、堆大小、madvise 预读阈值、profile 保存间隔、JIT 配置等。

### 危险档（默认关闭）

全量 AOT 模式：将安装、后台、命令行等策略设为 `everything`，适合愿意接受安装耗时换取极致性能的用户。

---

## 安装要求

| 项目 | 要求 |
|:--|:--|
| Root 框架 | Magisk / KernelSU / APatch |
| 系统 | Android 12+，不依赖显式厂商模板 |
| Android 版本 | Android 12+ |

---

## 安装步骤

1. 从 [Releases](https://github.com/pakhozako/dex2oat/releases) 下载最新 zip
2. 在 Magisk / KernelSU / APatch 管理器中选择「从本地安装」
3. 重启设备
4. 打开 WebUI 选择配置方案（可选）
5. 再次重启使属性生效

---

## 项目结构

```
dex2oat/
├── core/
│   ├── state.sh            # 统一状态读写 helper
│   ├── integrity-check.sh  # WebUI / 脚本 / 规则完整性校验
│   ├── integrity-baseline.prop # 发布构建生成的完整性基线
│   ├── health-check.sh     # 健康检查与自愈
│   ├── conflict-detect.sh  # 模块间属性冲突检测
│   └── prop-lock.sh        # 运行时属性保护
├── scripts/
│   ├── capture-props.sh    # 抓取 ART/dex2oat 相关设备属性
│   └── generate-props.sh   # 规则驱动生成 system.prop
├── webroot/
│   ├── css/app.css
│   ├── data/
│   │   ├── options.json    # 规则目录与 WebUI 配置 schema
│   │   └── app-meta.json
│   ├── js/
│   │   ├── app.js bridge.js config.js utils.js ui.js system-info.js
│   └── index.html
├── tools/
│   ├── validate-options.js # 打包前自动校验
│   ├── generate-integrity-baseline.js # 生成完整性 hash 基线
│   └── build-release.js    # 自动化构建脚本
├── customize.sh             # 安装脚本（抓取 + 规则生成）
├── service.sh               # 开机属性应用脚本
├── uninstall.sh             # 卸载还原脚本
├── system.prop              # 当前生效配置（由 WebUI/安装脚本生成）
├── module.prop
└── update.json
```

---

## 注意事项

- 仅修改系统属性，不涉及任何系统文件，卸载后完全还原
- 激进模式下关闭 JIT 可能影响性能敏感型应用，按需选用
- iorap 相关属性仅适用于 Android 12，Android 13+ 已移除
- v3.1 已移除厂商模板主链路，更新后建议执行一次“重新抓取匹配”或重新保存配置
- 首页和诊断可直接查看；自定义配置和危险模式需先完成风险协议确认

---

## License

MIT License
