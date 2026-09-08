param(
    [string]$NodeExe = "node",
    [string]$OutputDirectory = ""
)
$ErrorActionPreference = "Stop"
$releaseRoot = Split-Path -Parent $PSScriptRoot
$releaseConfig = Get-Content -LiteralPath (Join-Path $releaseRoot "release\config.json") -Raw | ConvertFrom-Json
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $releaseRoot ("outputs\" + $releaseConfig.tag) }
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
& $NodeExe (Join-Path $PSScriptRoot "release.js") pack $OutputDirectory
if ($LASTEXITCODE -ne 0) { throw "Release gates or package creation failed" }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = Join-Path $OutputDirectory $releaseConfig.zip
# Direct assignment keeps the JSON array flat in Windows PowerShell 5.1 and PowerShell 7.
$expected = Get-Content -LiteralPath (Join-Path $releaseRoot "release\production-files.json") -Raw | ConvertFrom-Json
$archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $names = @($archive.Entries | ForEach-Object { $_.FullName })
    if ($names.Count -ne $expected.Count -or @($names | Select-Object -Unique).Count -ne $names.Count) { throw "Entry count/uniqueness failure" }
    foreach ($name in $names) {
        if ($name -cnotmatch '^[A-Za-z][A-Za-z0-9]*\.(js|css|html|json)$' -or $expected -cnotcontains $name) { throw "Unsafe or unexpected entry: $name" }
    }
    if (@($names | Where-Object { $_ -ceq 'manifest.json' }).Count -ne 1) { throw "Missing root manifest" }
} finally { $archive.Dispose() }
$extractPath = Join-Path $OutputDirectory "extracted"
if (Test-Path -LiteralPath $extractPath) { throw "Independent extraction destination already exists" }
[System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $extractPath)
& $NodeExe (Join-Path $PSScriptRoot "release.js") verify $OutputDirectory
if ($LASTEXITCODE -ne 0) { throw "Independent package verification failed" }
