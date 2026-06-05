# Changelog

## v1.8 (2026-06-05)

### 修复
- 修复 WebUI 目录名 webui → webroot（KernelSU 要求）
- 修复 shell 脚本换行符问题
- 修复打包时包含 .git 目录的问题
- 统一所有版本号至 v1.8

## v1.7 (2026-06-05)

### 修复
- 修复 WebUI 目录名 webui → webroot
- 修复 shell 脚本换行符问题

## v1.6 (2026-06-05)

### 修复
- 修复 shell 脚本换行符问题
- 添加设备兼容性检查

## v1.5 (2026-06-05)

### 改进
- 重写 README 文档，优化结构和排版
- 修复 app-meta.json 版本号过期问题
- service.sh 添加错误处理和详细日志
- uninstall.sh 添加日志输出

## v1.4 (2026-06-05)

### 改进
- 优化 system.prop 注释，添加默认值对比
- 添加版本标记和卸载说明
- 标注 iorap 属性仅适用于 Android 12
- 移除激进档重复的 `dalvik.vm.dex2oat-filter` 属性
- 改进三档标题格式（emoji + 中英文）

## v1.3 (2026-06-05)

### 修复
- 修复 CSS 目录名拼写错误 (ccs → css)
- 修复 CSS 文件名拼写错误 (app.ccs → app.css)
- 修复 WebUI 样式加载失败的问题

### 新增
- 支持 Magisk 云端更新检查
- 添加更新日志 (CHANGELOG.md)

## v1.2 (2026-06-02)

### 改进
- 重构代码结构
- 优化 WebUI 界面

## v1.1 (2026-06-01)

### 新增
- 添加 WebUI 配置界面
- 支持在线切换配置方案

## v1.0 (2026-06-01)

### 首发
- 初始版本发布
- 支持三种配置方案（安全/谨慎/激进）
- 自动检测 ColorOS 设备
