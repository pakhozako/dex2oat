param(
  [ValidateSet("Installer", "Action", "Both")]
  [string]$Mode = "Both",
  [switch]$NoDelay
)

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "dex2oat-lock v6.0 UX Preview"

function Write-Line {
  param(
    [string]$Text = "",
    [ConsoleColor]$Color = [ConsoleColor]::Gray
  )
  Write-Host $Text -ForegroundColor $Color
}

function Wait-Preview {
  param([int]$Milliseconds = 180)
  if (-not $NoDelay) {
    Start-Sleep -Milliseconds $Milliseconds
  }
}

function Write-Rule {
  Write-Line "================================================" DarkGray
}

function Write-Kv {
  param(
    [string]$Key,
    [string]$Value
  )
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value -eq "unknown") {
    return
  }
  Write-Line ("{0,-20}: {1}" -f $Key, $Value) Gray
}

function Show-InstallStep {
  param(
    [string]$Index,
    [int]$Percent,
    [string]$Title,
    [string]$Description
  )
  Write-Line
  Write-Line ("[{0}/15] {1,3}%" -f $Index, $Percent) Cyan
  Write-Line $Title White
  Write-Line $Description DarkGray
  Wait-Preview
}

function Show-InstallerPreview {
  Clear-Host
  $DisclaimerText = @'
================================================
dex2oat-lock 软件许可声明、免责条款及责任限制
================================================
在继续安装前，请完整阅读以下条款。
按音量 + 键，即视为你已阅读、理解并接受本条款的全部内容；
按音量 - 键，取消安装。

第一条 定义
本条款所称"本软件"，指 dex2oat-lock 及其相关组件、脚本、
配置文件与后续更新版本；"维护者"，指本软件的开发者及贡献者；
"用户"，指下载、安装、使用本软件的自然人或组织。

第二条 许可声明
本软件依据其开源许可证条款提供，用户对本软件的使用应同时
遵守相应许可证的规定。本条款与许可证条款不一致之处，
以对维护者更为有利的解释为准，但不得因此减损用户依据
强制性法律规定所享有的权利。

第三条 无担保声明
1. 本软件按"现状"（AS IS）及"现有"（AS AVAILABLE）状态提供，
   维护者不对本软件作出任何明示或默示的保证，包括但不限于：
   适销性保证、特定用途适用性保证、不侵权保证、运行不中断
   或无错误的保证。
2. 维护者不保证本软件适用于用户的特定设备、ROM、内核版本
   或 Root 实现方式（包括但不限于 Magisk、KernelSU、APatch），
   亦不保证本软件与用户设备上其它软件或模块的兼容性。

第四条 风险告知
1. 本软件需要 Root 权限方可运行，将生成 system.prop 文件，
   并修改运行时 ART / dexopt 相关系统属性。
2. 前述操作存在导致应用程序运行异常、设备性能波动、功耗变化、
   系统稳定性下降，乃至设备无法正常启动的风险。
3. 用户应于安装前自行完成数据备份，并确认已具备卸载本软件
   或以其它方式恢复系统正常状态的能力与知识。

第五条 责任限制
1. 在适用法律允许的最大范围内，因安装、使用、升级、卸载
   本软件，或因本软件与用户设备、系统、第三方软件的交互
   而产生的任何直接、间接、附带、特殊、惩罚性或后果性损害
   （包括但不限于数据丢失、设备损坏、功能中断、预期利益
   损失），维护者不承担赔偿责任，无论该等主张基于合同、
   侵权（含过失）或其它任何法律理论。
2. 前款责任限制不适用于以下情形：
   （一）维护者的故意或重大过失行为；
   （二）依据适用法律不得以约定方式排除或限制的责任。
3. 若维护者依本条仍需承担责任，该责任在法律允许范围内，
   以用户为使用本软件所支付的对价（如为免费软件，则为
   人民币零元）为限。

第六条 用户确认
用户按音量 + 键即表示确认：
（一）已充分阅读并理解本条款第三条至第五条所述内容；
（二）理解 Root 权限操作及系统属性修改可能带来的风险，
     并自愿承担继续安装、使用本软件所产生的相应后果；
（三）已知悉可通过卸载本软件撤销其自身产生的变更，但
     由此产生的、非本软件直接导致的系统层面问题不在
     撤销范围之内。

第七条 可分割性
本条款任一条款被有管辖权的法院、仲裁机构认定为无效、
违法或不可执行的，不影响其余条款的效力，其余条款
应继续有效并按其原有目的解释和履行。

第八条 确认记录
本次确认操作对应的条款版本号、确认时间与正文哈希，
将记录于本地日志文件：
/data/adb/.dex2oat-lock-persist/disclaimer_ack.log
该记录仅用于证明用户已知悉当前版本条款内容，不涉及网络传输。

第九条 生效与变更
本条款自用户按音量 + 键确认之时起，就当前安装 / 更新行为
生效。维护者保留在后续版本中修改本条款的权利，修改后的
条款以用户安装或更新时呈现的版本为准。

按音量 + 键继续，即表示同意以上全部条款。
按音量 - 键取消安装。
================================================
'@
  foreach ($Line in ($DisclaimerText -split "`r?`n")) {
    Write-Line $Line Gray
    Wait-Preview 40
  }
  Write-Line
  Write-Line "阅读倒计时: 8s" Yellow
  Wait-Preview 500
  Write-Line
  Write-Line "现在可以确认。" Cyan
  Write-Rule
  Write-Line "【音量 +】同意免责声明并继续安装" Green
  Write-Line "【音量 -】不同意并取消安装" Red
  Write-Rule
  Write-Line "✓ 已确认免责声明，继续安装" Green
  Wait-Preview 500

  Write-Line
  Write-Rule
  Write-Line "dex2oat-lock v6.0" White
  Write-Line "Rule-based ART / dexopt Optimization" DarkGray
  Write-Rule
  Write-Kv "Root Manager" "Magisk 29.0"
  Write-Kv "Android" "15"
  Write-Kv "Architecture" "arm64-v8a"
  Write-Kv "Device" "Pixel 8 Pro"
  Write-Kv "Rule Pack" "v6.0"
  Write-Rule

  Show-InstallStep "01" 1 "初始化" "准备安装环境"
  Show-InstallStep "02" 8 "环境检测" "识别 Root Framework"
  Show-InstallStep "03" 14 "状态目录" "创建运行目录"
  Show-InstallStep "04" 22 "设备信息" "读取设备属性"
  Show-InstallStep "05" 26 "原始备份" "备份运行状态"
  Show-InstallStep "06" 30 "属性采集" "采集 ART / dexopt"
  Show-InstallStep "07" 42 "规则匹配" "生成 system.prop"
  Write-Line "Rules Matched       : 126" Gray
  Write-Line "Rules Ignored       : 4" Gray
  Write-Line "Properties          : 38" Gray
  Show-InstallStep "08" 55 "配置生成" "写入最终配置"
  Show-InstallStep "09" 64 "Property Lock" "生成属性锁"
  Show-InstallStep "10" 74 "冲突检测" "扫描模块冲突"
  Write-Line "✓ No Module Conflict" Green
  Show-InstallStep "11" 84 "健康检查" "生成健康状态"
  Write-Line "✓ Health Check Passed" Green
  Show-InstallStep "12" 88 "完整性检查" "校验模块完整性"
  Write-Line "✓ Integrity Verified" Green
  Show-InstallStep "13" 92 "权限设置" "修正权限"
  Show-InstallStep "14" 96 "状态提交" "提交安装事务"
  Show-InstallStep "15" 100 "完成" "安装完成"

  Write-Line
  Write-Rule
  Write-Line "✓ Installation Completed" Green
  Write-Kv "Version" "v6.0"
  Write-Kv "Rule Pack" "v6.0"
  Write-Kv "Matched Rules" "126"
  Write-Kv "Generated Properties" "38"
  Write-Kv "Snapshots" "Enabled"
  Write-Kv "Install Time" "1s"
  Write-Kv "Status" "Success"
  Write-Kv "Configuration Source" "auto-rules"
  Write-Kv "State Schema" "60"
  Write-Kv "Transaction" "Committed"
  Write-Kv "Health" "ok"
  Write-Kv "Integrity" "ok"
  Write-Rule
}

function Show-ActionPreview {
  Clear-Host
  Write-Rule
  Write-Line "Action 菜单" White
  Write-Rule
  Write-Line "音量 +：执行当前项目" Green
  Write-Line "音量 -：跳过并查看下一项" Yellow
  Write-Line

  $items = @(
    "重新匹配规则",
    "立即应用当前运行时属性",
    "只读规则预演（Dry-run）",
    "刷新诊断信息",
    "导出诊断包",
    "回滚最近配置快照",
    "重置运行保护状态",
    "查看当前规则统计",
    "查看当前配置摘要",
    "查看当前状态",
    "查看健康报告",
    "查看完整性报告",
    "查看冲突检测结果",
    "查看最近快照",
    "查看安装信息",
    "查看运行信息",
    "查看 State 信息",
    "查看 Rule Pack 信息",
    "重新执行健康检查",
    "重新执行完整性检查",
    "重新扫描模块冲突",
    "重新生成 system.prop",
    "重建 Property Lock",
    "重建状态摘要",
    "清理诊断缓存",
    "清理历史快照",
    "清理运行日志",
    "恢复默认配置",
    "打开调试模式",
    "关闭调试模式",
    "退出"
  )

  for ($i = 0; $i -lt $items.Count; $i++) {
    Write-Line ("{0:D2} {1}" -f ($i + 1), $items[$i]) Gray
  }

  Write-Line
  Write-Line "[01/31] 重新匹配规则" Cyan
  Write-Line "音量 +：执行    音量 -：跳过" DarkGray
  Wait-Preview 350
  Write-Line "✓ 重新匹配完成：命中=126，属性=38" Green
  Write-Line
  Write-Line "• [INFO] 普通模式隐藏 DEBUG 输出" Gray
  Write-Line "✓ [SUCCESS] 操作完成" Green
  Write-Line "⚠ [WARNING] 示例警告仅用于预览" Yellow
  Write-Line "❌ [ERROR] 示例错误仅用于预览" Red
}

switch ($Mode) {
  "Installer" {
    Show-InstallerPreview
  }
  "Action" {
    Show-ActionPreview
  }
  default {
    Show-InstallerPreview
    if (-not $NoDelay) {
      Write-Line
      Write-Line "按 Enter 查看 Action 菜单预览..." DarkGray
      [void][Console]::ReadLine()
    }
    Show-ActionPreview
  }
}
