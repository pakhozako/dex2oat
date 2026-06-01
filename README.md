# Dex2oat Lock

A Magisk module for ColorOS devices that fine-tunes `pm.dexopt.*` and `dalvik.vm.*` system properties to suppress unnecessary dexopt compilation during background tasks, app installation, and OTA updates — reducing heat, lowering power consumption, and extending battery life without compromising app runtime performance. A built-in WebUI allows switching between three preset profiles without reflashing.

针对 ColorOS 设备的 Magisk 模块，通过精细调控 `pm.dexopt.*` 与 `dalvik.vm.*` 系列属性，抑制系统在后台、安装、OTA 等场景下触发不必要的 dexopt 编译行为，从而减少发热、降低功耗、延长电池寿命，同时保持应用的正常运行性能。模块内置 WebUI，支持在线切换三种预设方案，无需重新刷入。

---

## Profiles / 配置方案

### 🟢 Safe / 安全

A conservative strategy suited for everyday use. Skips background dexopt, compiles apps at install time using `speed-profile`, sets post-boot and idle compilation to `verify` only, disables ColorOS background compilation, disables debug symbol generation, and disables iorap prefetch and tracing.

保守策略，适合日常使用。跳过后台 dexopt，安装时采用 `speed-profile` 编译，开机后及闲置场景仅做 `verify` 验证，禁用 ColorOS 后台编译开关，关闭调试符号生成，并禁用 iorap 预读与追踪。

| Property | Value | Description / 说明 |
|---|---|---|
| `pm.dexopt.bg-dexopt` | `skip` | Skip background dexopt / 跳过后台 dexopt |
| `pm.dexopt.install` | `speed-profile` | Profile-guided compile on install / 安装时按 profile 编译 |
| `pm.dexopt.boot-after-ota` | `speed-profile` | Profile-guided compile after OTA / OTA 后按 profile 编译 |
| `pm.dexopt.first-boot` | `verify` | Verify only on first boot / 首次开机仅验证 |
| `pm.dexopt.post-boot` | `verify` | Verify only after boot / 开机后仅验证 |
| `pm.dexopt.inactive` | `verify` | Verify only for idle apps / 闲置 App 仅验证 |
| `pm.dexopt.shared` | `speed` | Speed compile for shared libs / 共享库 speed 编译 |
| `pm.dexopt.downgrade_after_inactive_days` | `9999` | Disable idle downgrade / 禁用闲置降级 |
| `dalvik.vm.dex2oat-minidebuginfo` | `false` | Disable debug symbol generation / 关闭调试符号生成 |
| `persist.sys.oplus.bgdex2oat_enabled` | `false` | Disable ColorOS background compile / 禁用 ColorOS 后台编译 |
| `persist.device_config.runtime_native_boot.iorap_readahead_enable` | `false` | Disable iorap prefetch / 禁用 iorap 预读 |

### 🟡 Caution / 谨慎

Builds on Safe with additional options disabled by default and enabled as needed: a global `dex2oat-filter`, oversized APK downgrade prevention, startup string pre-resolution toggle, ColorOS thermal-triggered compilation control, and heap-optimization-triggered dexopt suppression.

在安全基础上叠加更多可选项（默认注释，按需启用）：全局编译过滤器、超大 APK 防降级、启动字符串预解析开关、ColorOS 温控编译触发控制，以及 heap 优化触发的 dexopt 抑制。

- `dalvik.vm.dex2oat-filter=speed-profile` — Global default compile filter / 全局默认编译过滤器
- `dalvik.vm.dex2oat-very-large=everything` — Prevent downgrade for oversized APKs / 超大 APK 防降级
- `dalvik.vm.dex2oat-resolve-startup-strings=false` — Disable startup string pre-resolution / 禁用启动字符串预解析
- `oplus.dex.tempcontrol=false` — Disable ColorOS thermal compile trigger / 禁用温控编译触发
- `sys.heap.optimize.enable=0` etc. — Suppress heap-optimization-triggered dexopt / 禁用 heap 优化触发的 dexopt

### 🔴 Aggressive / 激进

Maximally suppresses all compilation activity. Intended for experienced users. Sets all `pm.dexopt.*` scenarios to `everything` or disables them entirely, turns off the ART Service scheduler, disables JIT compilation, removes thermal cutoff, zeroes the JIT code cache limit, and sets the profile save interval to its maximum value.

最大化抑制所有编译行为，适合有经验的用户。将所有 `pm.dexopt.*` 场景全部设为 `everything` 或彻底禁用，关闭 ART Service 调度器，禁用 JIT 即时编译，移除温控截断，清零 JIT 代码缓存上限，并将 profile 保存间隔设为最大值。

- `dalvik.vm.useartservice=false` — Disable ART Service scheduler / 禁用 ART Service 调度器
- `dalvik.vm.usejit=false` — Disable JIT compilation / 禁用 JIT 即时编译
- `dalvik.vm.dexopt.thermal-cutoff=0` — Remove thermal cutoff / 关闭温控截断
- `dalvik.vm.jitmaxsize=0` — Zero out JIT code cache / JIT 代码缓存上限清零
- `dalvik.vm.ps-min-save-period-ms=2147483647` — Maximize profile save interval / profile 保存间隔设最大值

> ⚠️ Aggressive mode fully disables runtime optimization and may slow cold app launches. Use only if you understand the trade-offs.
>
> ⚠️ 激进模式会完全关闭运行时优化，可能导致应用冷启动变慢，请在充分了解风险后使用。

---

## Requirements / 安装要求

- **Root framework / Root 框架**：Magisk / KernelSU / APatch
- **System / 系统**：ColorOS (OPPO / OnePlus / Realme)
- Android 12+

---

## Installation / 安装步骤

1. In Magisk / KernelSU Manager, select **Install from storage** / 在管理器中选择「从本地安装」
2. Select the module zip / 选取模块 zip 文件
3. Reboot / 重启设备
4. Open the module WebUI and choose a profile / 打开 WebUI，选择配置方案
5. Reboot again to apply / 再次重启使属性生效

---

## Switching Profiles / 切换配置方案

Open the WebUI from Magisk / KernelSU Manager at any time to switch between Safe, Caution, and Aggressive. Changes take effect after a reboot — no reflash required.

随时从 Magisk / KernelSU 管理器打开 WebUI，在线切换「安全 / 谨慎 / 激进」三档方案，重启后生效，无需重新刷入。

---

## Notes / 注意事项

- Only system properties are modified; no system files are touched. Uninstalling the module fully restores the original state. / 本模块仅修改系统属性，不涉及任何系统文件，卸载后完全还原。
- Disabling JIT in Aggressive mode may impact performance-sensitive apps. / 激进模式下关闭 JIT 可能影响性能敏感型应用，请按需选用。
- After any OTA update, verify the module is still active. / 每次 OTA 更新后建议确认模块状态。
