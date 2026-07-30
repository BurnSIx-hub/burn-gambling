# Gambling - build a GitHub release.
# Produces release\module.zip (the module itself) and release\module.json
# (manifest for install-by-URL in Foundry).
#
# The archive is built from the committed HEAD state, so uncommitted work in
# progress never leaks into a public release.
#
# Run:  powershell -ExecutionPolicy Bypass -File tools\pack-release.ps1

$ErrorActionPreference = 'Stop'
$root    = Split-Path $PSScriptRoot
$release = Join-Path $root 'release'
New-Item -ItemType Directory -Force $release | Out-Null

$zipPath      = Join-Path $release 'module.zip'
$manifestPath = Join-Path $release 'module.json'
if (Test-Path $zipPath) { Remove-Item $zipPath }

# 1. Zip the committed tree. Dev-only files are dropped via export-ignore
#    attributes in .gitattributes.
git -C $root archive --format=zip --output=$zipPath HEAD
if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }

# 2. Pull module.json straight out of the archive we just built, byte for byte.
#    (Piping git output through PowerShell would re-encode the Cyrillic
#    description via the console codepage and corrupt it.)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $entry = $zip.GetEntry('module.json')
    if (-not $entry) { throw 'module.json not found in the archive' }
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $manifestPath, $true)
} finally {
    $zip.Dispose()
}

$ver = (Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json).version
Write-Host "Done: $zipPath (version $ver)"
Write-Host "Next: gh release create v$ver release\module.zip release\module.json"
