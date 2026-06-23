# Dex2oat Lock

[![Visitors](https://hits.seeyoufarm.com/api/count/incr/badge.svg?url=https%3A%2F%2Fgithub.com%2Fpakhozako%2Fdex2oat&count_bg=%236c8cff&title_bg=%23555555&icon=github.svg&icon_color=%23E7E7E7&title=visits&edge_flat=false)](https://github.com/pakhozako/dex2oat)

Magisk / KernelSU / APatch 模块，通过精细调控 `pm.dexopt.*` 与 `dalvik.vm.*` 系列属性，抑制 OPlus / Xiaomi 系设备在后台、安装、OTA 等场景下触发不必要的 dexopt 编译，减少发热、降低功耗、延长电池寿命。内置 WebUI，可在线切换三档方案，无需重新刷入。

---

## 支持的厂商

| 厂商系列 | 机型示例 | 状态 |
|:--|:--|:--|
| OPlus / ColorOS | OnePlus 13, ACE5 至尊版, OPPO/Realme 系列 | ✅ 完整支持 |
| Xiaomi / MIUI / HyperOS | 小米 13, MIX4, Redmi / POCO 系列 | ✅ 独立配置 |
| 其他 | — | ❌ 安装时自动拒绝 |

安装时自动识别厂商并加载对应配置，两套 profile 互不干扰，属性不会混用。

---

## 功能特性

- **三档方案** — 安全 / 谨慎 / 危险，按需选择
- **WebUI** — 可视化配置，展开查看完整属性说明
- **厂商分离** — OPlus / Xiaomi 独立配置文件和属性模板
- **安全回滚** — 安装时自动备份原始属性，卸载后完整还原
- **诊断面板** — 内置属性生效验证与 apply.log 摘要分析
- **云端更新** — 管理器自动检测新版本
- **设备检测** — 未识别厂商直接拒绝安装

---

## 配置档位

### 安全档（默认启用）

压制后台、安装、OTA 等场景的额外编译触发：

- **OPlus**（36 项）：pm.dexopt.* 全套策略 + ColorOS 私有触发 + OPlus MTK 编译服务 + runtime dexopt 开关 + iorap/启动缓存
- **Xiaomi**（24 项）：pm.dexopt.* 全套策略 + MIUI dexfile preload + ART startup class preload + precache + iorap

### 谨慎档（默认关闭）

进阶控制，按需启用：dex2oat 线程数、CPU 亲和性、堆大小、madvise 预读阈值、profile 保存间隔、JIT 配置等。

### 危险档（默认关闭）

全量 AOT 模式：将安装、后台、命令行等策略设为 `everything`，适合愿意接受安装耗时换取极致性能的用户。

---

## 安装要求

| 项目 | 要求 |
|:--|:--|
| Root 框架 | Magisk / KernelSU / APatch |
| 系统 | OPlus (OPPO/OnePlus/Realme) 或 Xiaomi/Redmi/POCO |
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
├── props/
│   ├── oplus.prop          # OPlus 默认安全配置模板
│   └── xiaomi.prop         # Xiaomi 默认安全配置模板
├── webroot/
│   ├── css/app.css
│   ├── data/
│   │   ├── vendors.json    # 厂商元数据（id/label/options/detect）
│   │   ├── options.json    # OPlus 77 项配置
│   │   └── options-xiaomi.json  # Xiaomi 57 项配置
│   ├── js/
│   │   ├── app.js bridge.js config.js utils.js ui.js system-info.js
│   └── index.html
├── tools/
│   ├── validate-options.js # 打包前自动校验
│   └── build-release.js    # 自动化构建脚本
├── customize.sh             # 安装脚本（厂商识别 + 模板复制）
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
- OPlus 使用原 v2.5 策略（36 项），Xiaomi 自 v2.6 起独立配置（57 项）
- 更新模块后建议重新保存一次配置，以同步新版 system.prop 模板

---

## License

MIT License
