# Dex2oat Lock v3.0

v3.0 是一次正式多厂商版本发布，重点补齐多厂商模板、健康检查、自愈保护和 WebUI 诊断能力。

## 更新内容

- 新增 Samsung、Pixel、MIUI、Meizu、RedMagic 与 Generic 兜底模板，安装时自动识别厂商并选择对应配置。
- 新增健康检查、自愈恢复、属性锁定和冲突扫描，降低配置缺失、被覆盖或与其他模块冲突导致的异常。
- WebUI 首页新增健康状态，诊断输出包含 `health.log`、`conflict-report.txt`、匹配报告和抓取结果。
- 保存配置改为临时文件成功后再覆盖，并同步 `system.prop.bak` 与 `prop-lock.list`，降低写入失败造成的配置损坏风险。
- 扩大 dex2oat 自动匹配抓取范围，覆盖 `pm.dexopt.*`、`persist.device_config.*`、`dalvik.vm.*` 与厂商相关属性。
- 卸载流程清理 v3.0 新增状态文件，降低卸载后重装的状态污染。

## 安装说明

- 支持 Magisk、KernelSU、APatch。
- 建议 Android 12+ 设备使用。
- 更新后建议打开 WebUI 重新保存一次配置，再重启设备，使新版模板、备份和属性锁定状态同步。

## 发布产物

- `dex2oat-v3.0.zip`
