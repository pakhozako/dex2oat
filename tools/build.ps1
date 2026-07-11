[CmdletBinding()]
param(
    [string]$Output
)

$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

if ([string]::IsNullOrWhiteSpace($Output)) {
    $Output = Join-Path $Root 'dist\dex2oat-lock-v6.0-release.zip'
} elseif (-not [IO.Path]::IsPathRooted($Output)) {
    $Output = [IO.Path]::GetFullPath((Join-Path (Get-Location) $Output))
}

$PackageFiles = @(
    'META-INF/com/google/android/update-binary'
    'META-INF/com/google/android/updater-script'
    'action.sh'
    'core/common.sh'
    'core/conflict-detect.sh'
    'core/input.sh'
    'core/rule-engine.sh'
    'core/runtime.sh'
    'customize.sh'
    'module.prop'
    'rules/prop-policy.tsv'
    'rules/rule-props.pack'
    'scripts/capture-props.sh'
    'scripts/decode-rules.sh'
    'scripts/generate-props.sh'
    'service.sh'
    'skip_mount'
    'system.prop'
    'uninstall.sh'
) | Sort-Object

foreach ($RelativePath in $PackageFiles) {
    $SourcePath = Join-Path $Root ($RelativePath -replace '/', [IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath $SourcePath -PathType Leaf)) {
        throw "Required package file is missing: $RelativePath"
    }
}

$OutputDirectory = Split-Path -Parent $Output
if (-not (Test-Path -LiteralPath $OutputDirectory)) {
    New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
}

$TemporaryOutput = "$Output.tmp.$PID"
Remove-Item -LiteralPath $TemporaryOutput -Force -ErrorAction SilentlyContinue

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$FixedTimestamp = [DateTimeOffset]::Parse('2024-01-01T00:00:00+00:00')
$ExecutableFiles = @(
    'META-INF/com/google/android/update-binary'
    'action.sh'
    'customize.sh'
    'service.sh'
    'uninstall.sh'
)

$ArchiveStream = $null
$Archive = $null
try {
    $ArchiveStream = [IO.File]::Open($TemporaryOutput, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $Archive = [IO.Compression.ZipArchive]::new($ArchiveStream, [IO.Compression.ZipArchiveMode]::Create, $false)

    foreach ($RelativePath in $PackageFiles) {
        $SourcePath = Join-Path $Root ($RelativePath -replace '/', [IO.Path]::DirectorySeparatorChar)
        $Entry = $Archive.CreateEntry($RelativePath, [IO.Compression.CompressionLevel]::Optimal)
        $Entry.LastWriteTime = $FixedTimestamp
        if ($ExecutableFiles -contains $RelativePath) {
            $Entry.ExternalAttributes = -2115174400 # regular file, mode 0755
        } else {
            $Entry.ExternalAttributes = -2119958528 # regular file, mode 0644
        }

        $SourceStream = $null
        $EntryStream = $null
        try {
            $SourceStream = [IO.File]::OpenRead($SourcePath)
            $EntryStream = $Entry.Open()
            $SourceStream.CopyTo($EntryStream)
        } finally {
            if ($null -ne $EntryStream) { $EntryStream.Dispose() }
            if ($null -ne $SourceStream) { $SourceStream.Dispose() }
        }
    }
} finally {
    if ($null -ne $Archive) { $Archive.Dispose() }
    if ($null -ne $ArchiveStream) { $ArchiveStream.Dispose() }
}

# ZipArchive writes a DOS creator flag even when Unix mode bits are present.
# Mark each central-directory entry as Unix so Android extractors honor 0755/0644.
$ArchiveBytes = [IO.File]::ReadAllBytes($TemporaryOutput)
$EndOffset = -1
for ($Index = $ArchiveBytes.Length - 22; $Index -ge [Math]::Max(0, $ArchiveBytes.Length - 65557); $Index--) {
    if ($ArchiveBytes[$Index] -eq 0x50 -and $ArchiveBytes[$Index + 1] -eq 0x4b -and $ArchiveBytes[$Index + 2] -eq 0x05 -and $ArchiveBytes[$Index + 3] -eq 0x06) {
        $EndOffset = $Index
        break
    }
}
if ($EndOffset -lt 0) {
    throw 'ZIP end-of-central-directory record was not found.'
}

$EntryCount = [BitConverter]::ToUInt16($ArchiveBytes, $EndOffset + 10)
$CentralOffset = [int][BitConverter]::ToUInt32($ArchiveBytes, $EndOffset + 16)
$Cursor = $CentralOffset
for ($EntryIndex = 0; $EntryIndex -lt $EntryCount; $EntryIndex++) {
    if ($ArchiveBytes[$Cursor] -ne 0x50 -or $ArchiveBytes[$Cursor + 1] -ne 0x4b -or $ArchiveBytes[$Cursor + 2] -ne 0x01 -or $ArchiveBytes[$Cursor + 3] -ne 0x02) {
        throw "Invalid ZIP central-directory entry at offset $Cursor."
    }
    $ArchiveBytes[$Cursor + 5] = 3
    $NameLength = [BitConverter]::ToUInt16($ArchiveBytes, $Cursor + 28)
    $ExtraLength = [BitConverter]::ToUInt16($ArchiveBytes, $Cursor + 30)
    $CommentLength = [BitConverter]::ToUInt16($ArchiveBytes, $Cursor + 32)
    $Cursor += 46 + $NameLength + $ExtraLength + $CommentLength
}
[IO.File]::WriteAllBytes($TemporaryOutput, $ArchiveBytes)

Move-Item -LiteralPath $TemporaryOutput -Destination $Output -Force

$ReadArchive = [IO.Compression.ZipFile]::OpenRead($Output)
try {
    $ActualFiles = @($ReadArchive.Entries | ForEach-Object { $_.FullName } | Sort-Object)
    if (($ActualFiles -join "`n") -ne ($PackageFiles -join "`n")) {
        throw 'Package content does not match the runtime allowlist.'
    }
    if ($ActualFiles | Where-Object { $_ -match '(?i)\.md$' }) {
        throw 'Markdown files must not be present in the release package.'
    }
    foreach ($Entry in $ReadArchive.Entries) {
        $SourcePath = Join-Path $Root ($Entry.FullName -replace '/', [IO.Path]::DirectorySeparatorChar)
        $SourceHash = (Get-FileHash -LiteralPath $SourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
        $EntryStream = $null
        $HashAlgorithm = $null
        try {
            $EntryStream = $Entry.Open()
            $HashAlgorithm = [Security.Cryptography.SHA256]::Create()
            $EntryHash = ([BitConverter]::ToString($HashAlgorithm.ComputeHash($EntryStream)) -replace '-', '').ToLowerInvariant()
        } finally {
            if ($null -ne $HashAlgorithm) { $HashAlgorithm.Dispose() }
            if ($null -ne $EntryStream) { $EntryStream.Dispose() }
        }
        if ($EntryHash -ne $SourceHash) {
            throw "Package entry differs from source: $($Entry.FullName)"
        }
    }
} finally {
    $ReadArchive.Dispose()
}

$Hash = (Get-FileHash -LiteralPath $Output -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "Built: $Output"
Write-Host "Files: $($PackageFiles.Count)"
Write-Host "SHA256: $Hash"
