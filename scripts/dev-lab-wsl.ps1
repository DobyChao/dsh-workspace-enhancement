#!/usr/bin/env pwsh
# scripts/dev-lab-wsl.ps1 — Windows wrapper for the WSL Linux-host lab (INFRA-19).
#
# Usage (from the repo, anywhere on Windows):
#   pwsh -File scripts/dev-lab-wsl.ps1                # npm install + build + pack, then the WSL lab boots in the FOREGROUND
#   pwsh -File scripts/dev-lab-wsl.ps1 -Smoke         # build + pack + WSL lab smoke (HTTP + /api/dsw channel probe) + stop
#   pwsh -File scripts/dev-lab-wsl.ps1 -SkipBuild     # reuse the existing .tmp tarball
#   pwsh -File scripts/dev-lab-wsl.ps1 -Tag next -Port 50600
#
# The actual lab logic lives in scripts/dev-lab-wsl.sh (runs INSIDE WSL):
# DSH_HOME=$HOME/.dsh-lab-wsl, port 50600, plugin installed from the pack
# tarball — the same artifact real installs use. Never touches 3080 or the
# product home.

param(
  [int]$Port = 50600,
  [string]$Tag = 'next',
  [switch]$Smoke,
  [switch]$NoBoot,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Continue'
$RepoRoot = Split-Path -Parent $PSScriptRoot

if (-not (wsl --status 2>$null)) { throw '[lab-wsl] WSL is not available (wsl --status failed)' }

if (-not $SkipBuild) {
  Push-Location $RepoRoot
  try {
    Write-Host '[lab-wsl] npm install ...'
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
    Write-Host '[lab-wsl] npm run build ...'
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }
    Write-Host '[lab-wsl] npm pack ...'
    $tgz = (npm pack --pack-destination .tmp 2>$null | Select-Object -Last 1)
    if ($LASTEXITCODE -ne 0 -or -not $tgz) { throw 'npm pack failed' }
    Write-Host "[lab-wsl] packed: $tgz"
  } finally { Pop-Location }
}

# D:\a\b -> /mnt/d/a/b (the .sh resolves the repo from its own location, so
# only the flags need forwarding).
$drive = $PSScriptRoot.Substring(0, 1).ToLower()
$wslScript = '/mnt/' + $drive + ($PSScriptRoot.Substring(2) -replace '\\', '/') + '/dev-lab-wsl.sh'
$bashArgs = @('-e', 'bash', $wslScript, '--port', "$Port", '--tag', $Tag)
if ($Smoke) { $bashArgs += '--smoke' }
if ($NoBoot) { $bashArgs += '--no-boot' }

Write-Host "[lab-wsl] wsl $($bashArgs -join ' ')"
& wsl @bashArgs
exit $LASTEXITCODE
