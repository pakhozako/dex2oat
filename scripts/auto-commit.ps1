param(
    [string]$Message,
    [switch]$NoPush,
    [switch]$NoPull
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

function Invoke-Git {
    git @args
    if ($LASTEXITCODE -ne 0) {
        throw "Git command failed: git $args"
    }
}

$branch = & git branch --show-current
if ($LASTEXITCODE -ne 0) {
    throw "Git command failed: git branch --show-current"
}

if (-not $branch) {
    throw "Unable to determine the current Git branch."
}

if (-not $NoPull) {
    Invoke-Git pull --ff-only origin $branch
}

$status = & git status --porcelain=v1
if ($LASTEXITCODE -ne 0) {
    throw "Git command failed: git status --porcelain=v1"
}

if (-not $status) {
    Write-Host "No changes to commit."
    exit 0
}

if (-not $Message) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $Message = "chore: auto commit $timestamp"
}

Invoke-Git add -A
Invoke-Git commit -m $Message

if (-not $NoPush) {
    Invoke-Git push origin $branch
}

Write-Host "Committed changes on $branch."
