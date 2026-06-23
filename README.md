# Dex2oat Lock

A Magisk module for OPlus and Xiaomi-family devices that fine-tunes `pm.dexopt.*` and `dalvik.vm.*` system properties to suppress unnecessary dexopt compilation during background tasks, app installation, and OTA updates — reducing heat, lowering power consumption, and extending battery life without compromising app runtime performance. A built-in WebUI allows switching between three preset profiles without reflashing.

针对 OPlus 与 Xiaomi 系设备的 Magisk 模块，通过精细调控 `pm.dexopt.*` 与 `dalvik.vm.*` 系列属性，抑制系统在后台、安装、OTA 等场景下触发不必要的 dexopt 编译行为，从而减少发热、降低功耗、延长电池寿命，同时保持应用的正常运行性能。模块内置 WebUI，支持在线切换三种预设方案，无需重新刷入。

---

## ✨ Features / 功能特性

- 🎯 **三档配置方案** — 安全 / 谨慎 / 激进，按需选择
- 🌐 **WebUI 界面** — 可视化配置，无需手动编辑文件
- ☁️ **云端更新** — Magisk 自动检测新版本
- 📝 **详细日志** — 完整的运行日志记录
- 🔄 **安全回滚** — 卸载模块自动恢复原始配置
- 🛡️ **设备检测** — 自动识别 OPlus / Xiaomi 系设备，未识别设备拒绝安装
- 📊 **诊断面板** — 内置属性生效验证与 apply.log 分析

---

## 📦 Profiles / 配置方案

### 🟢 Safe / 安全

保守策略，适合日常使用。包含 36 项编译控制属性：
- 所有 `pm.dexopt.*` 场景压制为 `skip`/`verify`/`speed-profile` 组合
- 禁用 ColorOS 私有后台编译、缓存 miss 触发、opex 合并
- 禁用 OPlus 编译器服务、ZygoteC/ocomp、runtime dexopt
- 禁用 PR dexopt、iorap 预读与追踪、调试符号、启动缓存
- bg-dexopt 新类/新方法阈值降至 0

### 🟡 Caution / 谨慎

在安全基础上叠加 32 项进阶控制（默认注释，按需启用）：全局 dex2oat-filter、线程数控制（6 组独立属性）、CPU 亲和性绑定（4 组）、MTK 激进调度、dex2oat 堆大小、odex/vdex madvise 预读阈值、profile 保存/首次延迟、JIT 缓存上限、温控截断等。

### 🔴 Aggressive / 激进

极致性能配置，9 项全量 AOT 策略。将所有编译场景设为 `everything`，关闭 ART Service 与 JIT，适合愿意接受安装耗时和存储占用以换取极致性能的用户。

> ⚠️ 激进模式会完全关闭运行时优化，可能导致应用冷启动变慢，请在充分了解风险后使用。

---

## 📋 Requirements / 安装要求

| 项目 | 要求 |
|:-----|:-----|
| Root 框架 | Magisk / KernelSU / APatch |
| 系统 | ColorOS/OPlus (OPPO / OnePlus / Realme) 或 Xiaomi/Redmi/POCO |
| Android 版本 | Android 12+ |

---

## 🚀 Installation / 安装步骤

1. 下载最新版本的模块 zip 文件
2. 在 Magisk / KernelSU 管理器中选择「从本地安装」
3. 选取下载的 zip 文件
4. 重启设备
5. 打开 WebUI 选择配置方案
6. 再次重启使属性生效

---

## 🔄 Cloud Update / 云端更新

模块已配置 Magisk 云端更新检查，当有新版本发布时，Magisk 管理器会自动显示更新提示，无需手动下载。

---

## 📁 Project Structure / 项目结构

```
dex2oat/
├── webroot/                # WebUI 界面（KernelSU 要求）
│   ├── css/
│   │   └── app.css         # 样式文件
│   ├── data/
│   │   ├── app-meta.json   # 应用元数据
│   │   └── options.json    # 配置选项
│   ├── js/
│   │   ├── app.js          # 主应用逻辑
│   │   ├── bridge.js       # 桥接层
│   │   ├── config.js       # 配置管理
│   │   ├── system-info.js  # 系统信息
│   │   ├── ui.js           # UI 工具
│   │   └── utils.js        # 共享工具函数
│   └── index.html          # 入口页面
├── CHANGELOG.md            # 更新日志
├── customize.sh            # 安装脚本
├── module.prop             # 模块属性
├── props/                  # 厂商默认 system.prop 模板
├── service.sh              # 服务脚本
├── system.prop             # 系统属性配置
├── uninstall.sh            # 卸载脚本
└── update.json             # 云端更新配置
```

---

## 📝 Notes / 注意事项

- 本模块仅修改系统属性，不涉及任何系统文件，卸载后完全还原
- 安装时自动识别厂商；OPlus 使用原配置，Xiaomi/Redmi/POCO 使用独立配置
- 激进模式下关闭 JIT 可能影响性能敏感型应用，请按需选用
- 每次 OTA 更新后建议确认模块状态
- iorap 相关属性仅适用于 Android 12，Android 13+ 已移除 iorap
- 模块包含 77 项可配置属性，首次安装默认启用安全方案（36 项）

---

## 📄 License

MIT License
