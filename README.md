# Dex2oat Lock

A Magisk module for ColorOS devices that fine-tunes `pm.dexopt.*` and `dalvik.vm.*` system properties to suppress unnecessary dexopt compilation during background tasks, app installation, and OTA updates — reducing heat, lowering power consumption, and extending battery life without compromising app runtime performance. A built-in WebUI allows switching between three preset profiles without reflashing.

针对 ColorOS 设备的 Magisk 模块，通过精细调控 `pm.dexopt.*` 与 `dalvik.vm.*` 系列属性，抑制系统在后台、安装、OTA 等场景下触发不必要的 dexopt 编译行为，从而减少发热、降低功耗、延长电池寿命，同时保持应用的正常运行性能。模块内置 WebUI，支持在线切换三种预设方案，无需重新刷入。

---

## ✨ Features / 功能特性

- 🎯 **三档配置方案** — 安全 / 谨慎 / 激进，按需选择
- 🌐 **WebUI 界面** — 可视化配置，无需手动编辑文件
- ☁️ **云端更新** — Magisk 自动检测新版本
- 📝 **详细日志** — 完整的运行日志记录
- 🔄 **安全回滚** — 卸载模块自动恢复原始配置
- 🛡️ **设备检测** — 仅在 ColorOS/OPlus 设备上生效

---

## 📦 Profiles / 配置方案

### 🟢 Safe / 安全

保守策略，适合日常使用。跳过后台 dexopt，安装时采用 `speed-profile` 编译，开机后及闲置场景仅做 `verify` 验证，禁用 ColorOS 后台编译开关，关闭调试符号生成，并禁用 iorap 预读与追踪。

| Property | Value | Description |
|:---------|:------|:------------|
| `pm.dexopt.bg-dexopt` | `skip` | 跳过后台 dexopt |
| `pm.dexopt.install` | `speed-profile` | 安装时按 profile 编译 |
| `pm.dexopt.boot-after-ota` | `speed-profile` | OTA 后按 profile 编译 |
| `pm.dexopt.first-boot` | `verify` | 首次开机仅验证 |
| `pm.dexopt.post-boot` | `verify` | 开机后仅验证 |
| `pm.dexopt.inactive` | `verify` | 闲置 App 仅验证 |
| `pm.dexopt.shared` | `speed` | 共享库 speed 编译 |
| `pm.dexopt.downgrade_after_inactive_days` | `9999` | 禁用闲置降级 |
| `dalvik.vm.dex2oat-minidebuginfo` | `false` | 关闭调试符号生成 |
| `persist.sys.oplus.bgdex2oat_enabled` | `false` | 禁用 ColorOS 后台编译 |
| `persist.device_config.runtime_native_boot.iorap_readahead_enable` | `false` | 禁用 iorap 预读 |

### 🟡 Caution / 谨慎

在安全基础上叠加更多选项（默认注释，按需启用）：全局编译过滤器、超大 APK 防降级、启动字符串预解析开关、ColorOS 温控编译触发控制，以及 heap 优化触发的 dexopt 抑制。

### 🔴 Aggressive / 激进

最大化抑制所有编译行为，适合有经验的用户。将所有 `pm.dexopt.*` 场景全部设为 `everything` 或彻底禁用，关闭 ART Service 调度器，禁用 JIT 即时编译，移除温控截断，清零 JIT 代码缓存上限。

> ⚠️ 激进模式会完全关闭运行时优化，可能导致应用冷启动变慢，请在充分了解风险后使用。

---

## 📋 Requirements / 安装要求

| 项目 | 要求 |
|:-----|:-----|
| Root 框架 | Magisk / KernelSU / APatch |
| 系统 | ColorOS (OPPO / OnePlus / Realme) |
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
│   │   ├── device-monitor.js # 设备监控
│   │   ├── system-info.js  # 系统信息
│   │   ├── ui.js           # UI 工具
│   │   └── utils.js        # 共享工具函数
│   └── index.html          # 入口页面
├── CHANGELOG.md            # 更新日志
├── customize.sh            # 安装脚本
├── module.prop             # 模块属性
├── service.sh              # 服务脚本
├── system.prop             # 系统属性配置
├── uninstall.sh            # 卸载脚本
└── update.json             # 云端更新配置
```

---

## 📝 Notes / 注意事项

- 本模块仅修改系统属性，不涉及任何系统文件，卸载后完全还原
- 激进模式下关闭 JIT 可能影响性能敏感型应用，请按需选用
- 每次 OTA 更新后建议确认模块状态
- iorap 相关属性仅适用于 Android 12，Android 13+ 已移除 iorap

---

## 📄 License

MIT License
