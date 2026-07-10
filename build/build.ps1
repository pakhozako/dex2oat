param(
  [string]$Version = "6.0",
  [string]$SevenZip = "D:\7-Zip\7z.exe"
)

$ErrorActionPreference = "Stop"
$NodeBuild = Join-Path (Split-Path -Parent $PSScriptRoot) "tools/build.mjs"
if (Get-Command node -ErrorAction SilentlyContinue) {
  & node $NodeBuild
  if ($LASTEXITCODE -ne 0) { throw "Node 构建失败" }
  exit 0
}
$Root = Split-Path -Parent $PSScriptRoot
$Manifest = Join-Path $PSScriptRoot "release-files.txt"
$Output = Join-Path $Root "dex2oat-lock-v$Version.zip"

if (!(Test-Path -LiteralPath $SevenZip)) {
  throw "未找到 7-Zip: $SevenZip"
}

$Paths = Get-Content -LiteralPath $Manifest | Where-Object { $_ -and !$_.StartsWith("#") }
foreach ($Path in $Paths) {
  if (!(Test-Path -LiteralPath (Join-Path $Root $Path))) {
    throw "发布文件缺失: $Path"
  }
}

Remove-Item -LiteralPath $Output -Force -ErrorAction SilentlyContinue
Push-Location $Root
try {
  & $SevenZip a -tzip -mx=9 $Output @Paths | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "7-Zip 构建失败" }
} finally {
  Pop-Location
}

$ArchiveList = & $SevenZip l -ba $Output
if ($LASTEXITCODE -ne 0) { throw "无法读取发布包" }
if ($ArchiveList -match '\.md\b') { throw "发布包包含 Markdown 文件" }
if ($ArchiveList -match '\.tmp-state|\.zip\s*$') { throw "发布包包含临时文件或嵌套 ZIP" }

$Hash = Get-FileHash -Algorithm SHA256 -LiteralPath $Output
[pscustomobject]@{
  Path = $Output
  Size = (Get-Item -LiteralPath $Output).Length
  SHA256 = $Hash.Hash
}
