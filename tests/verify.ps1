param(
  [string]$Bash = "C:\Program Files\Git\bin\bash.exe"
)

$ErrorActionPreference = "Stop"
$NodeVerify = Join-Path (Split-Path -Parent $PSScriptRoot) "tools/verify.mjs"
if (Get-Command node -ErrorAction SilentlyContinue) {
  & node $NodeVerify
  if ($LASTEXITCODE -ne 0) { throw "Node 验证失败" }
  exit 0
}
$Root = Split-Path -Parent $PSScriptRoot
$RootPath = $Root -replace '\\', '/'
$RootDrive = $RootPath.Substring(0, 1).ToLowerInvariant()
$UnixRoot = "/$RootDrive" + $RootPath.Substring(2)
$ShellFiles = @(
  "action.sh",
  "customize.sh",
  "service.sh",
  "uninstall.sh",
  "META-INF/com/google/android/update-binary"
) + (Get-ChildItem -LiteralPath (Join-Path $Root "core") -Filter "*.sh" -File | ForEach-Object { "core/$($_.Name)" }) +
    (Get-ChildItem -LiteralPath (Join-Path $Root "scripts") -Filter "*.sh" -File | ForEach-Object { "scripts/$($_.Name)" })

if (!(Test-Path -LiteralPath $Bash)) { throw "未找到 Git Bash: $Bash" }
foreach ($File in $ShellFiles) {
  $UnixFile = $File -replace '\\', '/'
  & $Bash -lc "cd '$UnixRoot' && sh -n '$UnixFile'"
  if ($LASTEXITCODE -ne 0) { throw "Shell 语法错误: $File" }
}

& $Bash -lc "cd '$UnixRoot' && sh tests/property-core.sh '$UnixRoot'"
if ($LASTEXITCODE -ne 0) { throw "属性核心行为测试失败" }

& $Bash -lc "cd '$UnixRoot' && sh tests/state-core.sh '$UnixRoot'"
if ($LASTEXITCODE -ne 0) { throw "状态系统行为测试失败" }

& $Bash -lc "cd '$UnixRoot' && sh tests/rule-core.sh '$UnixRoot'"
if ($LASTEXITCODE -ne 0) { throw "规则系统行为测试失败" }

& $Bash -lc "cd '$UnixRoot' && sh tests/install-transaction.sh '$UnixRoot'"
if ($LASTEXITCODE -ne 0) { throw "安装事务测试失败" }

& $Bash -lc "cd '$UnixRoot' && sh tests/protection-core.sh '$UnixRoot'"
if ($LASTEXITCODE -ne 0) { throw "运行保护测试失败" }

& $Bash -lc "cd '$UnixRoot' && sh tests/diagnostic-core.sh '$UnixRoot'"
if ($LASTEXITCODE -ne 0) { throw "诊断脱敏测试失败" }

& $Bash -lc "cd '$UnixRoot' && sh tests/input-core.sh '$UnixRoot'"
if ($LASTEXITCODE -ne 0) { throw "音量键解析测试失败" }

& $Bash -lc "cd '$UnixRoot' && sh tests/edge-core.sh '$UnixRoot'"
if ($LASTEXITCODE -ne 0) { throw "边界状态测试失败" }

$ModuleProp = Get-Content -LiteralPath (Join-Path $Root "module.prop")
if ($ModuleProp -notcontains "version=v6.0") { throw "module.prop 版本不是 v6.0" }
if ($ModuleProp -notcontains "versionCode=600") { throw "module.prop versionCode 不是 600" }

$UpdateBinary = Get-Content -Raw -LiteralPath (Join-Path $Root "META-INF/com/google/android/update-binary")
$CleanupIndex = $UpdateBinary.LastIndexOf("preinstall_cleanup")
$InstallIndex = $UpdateBinary.IndexOf("install_module")
if ($CleanupIndex -lt 0 -or $InstallIndex -lt 0 -or $CleanupIndex -gt $InstallIndex) {
  throw "安装前清理顺序错误"
}
foreach ($RequiredPath in @("/data/adb/dex2oat-lock", "/data/adb/modules/dex2oat-lock")) {
  if (!$UpdateBinary.Contains($RequiredPath)) { throw "缺少安装清理路径: $RequiredPath" }
}

$ReleaseFiles = Get-Content -LiteralPath (Join-Path $Root "build/release-files.txt")
if ($ReleaseFiles | Where-Object { $_ -match '\.md$' }) { throw "发布清单包含 Markdown" }

[pscustomobject]@{
  ShellFiles = $ShellFiles.Count
  Version = "v6.0"
StateCore = "ok"
RuleCore = "ok"
InstallTransaction = "ok"
ProtectionCore = "ok"
DiagnosticCore = "ok"
InputCore = "ok"
EdgeCore = "ok"
  CleanupOrder = "ok"
  ReleaseManifest = "ok"
}
