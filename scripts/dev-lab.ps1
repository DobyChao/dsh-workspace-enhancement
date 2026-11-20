#!/usr/bin/env pwsh
# scripts/dev-lab.ps1 — isolated lab sandbox launcher for dsh-workspace-enhancement
#
# Usage (run from anywhere):
#   pwsh -File scripts/dev-lab.ps1                # build + install profile + compose check + boot web (foreground, Ctrl+C to stop)
#   pwsh -File scripts/dev-lab.ps1 -NoBoot        # build + install profile + dump-config compose check only
#   pwsh -File scripts/dev-lab.ps1 -Smoke         # build + install + boot in background + HTTP/RPC verify + stop (CI-ish)
#   pwsh -File scripts/dev-lab.ps1 -Port 50600    # custom port (default 50599)
#
# Safety boundary:
#   - Sets $env:DSH_HOME = C:\Users\Admin\.dsh-lab; every dsh invocation inherits
#     it, so all profile/state writes land in .dsh-lab. C:\Users\Admin\.dsh is
#     never copied or modified.
#   - Default port 50599; the real GUI occupies 3080 and is never reused.
#     --no-open keeps the browser closed.
#   - The initial profile bundles come from the dsh CLI's own initProfile(web)
#     template: @deepseek-ai/dsh-base + @deepseek-ai/dsh-web-app; this plugin is
#     appended as the third bundle via `dsh plugin --profile web add <repo>`.
#   - No real machine/key data is written; example connections use placeholders.

param(
  [int]$Port = 50599,
  [switch]$NoBoot,
  [switch]$SkipBuild,
  [switch]$Smoke
)

# 'Continue' (not 'Stop'): native commands (npm/pnpm/dsh) write warnings to
# stderr, and EAP=Stop would turn them into terminating NativeCommandErrors.
# Failures are detected via $LASTEXITCODE instead.
$ErrorActionPreference = 'Continue'

$LabHome  = 'C:\Users\Admin\.dsh-lab'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Profile  = Join-Path $LabHome 'profiles\web'

if ($Port -eq 3080) { throw '[dev-lab] port 3080 belongs to the real GUI; use -Port 50599 or another lab port' }

# Explicit DSH_HOME for every dsh child process
$env:DSH_HOME = $LabHome
Write-Host "[dev-lab] DSH_HOME = $env:DSH_HOME"
Write-Host "[dev-lab] repo     = $RepoRoot"
if (Test-Path 'C:\Users\Admin\.dsh') { Write-Host '[dev-lab] C:\Users\Admin\.dsh is read-only reference; nothing is written there' }

# -- 1) build artifacts (host lib/ + client lib/client.js) -------------------
if (-not $SkipBuild) {
  Push-Location $RepoRoot
  try {
    Write-Host '[dev-lab] npm install ...'
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
    Write-Host '[dev-lab] npm run build ...'
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }
  } finally {
    Pop-Location
  }
  if (-not (Test-Path (Join-Path $RepoRoot 'lib\index.js'))) { throw 'lib/index.js missing — host build incomplete' }
  if (-not (Test-Path (Join-Path $RepoRoot 'lib\client.js'))) { throw 'lib/client.js missing — client build incomplete' }
}

# -- 2) profile init + plugin install (first run auto-inits via initProfile) --
Write-Host '[dev-lab] dsh plugin --profile web add <repo> ...'
& dsh plugin --profile web add $RepoRoot
if ($LASTEXITCODE -ne 0) { throw "dsh plugin add failed: exit $LASTEXITCODE" }

$manifest = Get-Content (Join-Path $Profile 'package.json') -Raw | ConvertFrom-Json
Write-Host ('[dev-lab] profile bundles: ' + ($manifest.dsh.profile.bundles -join ', '))

# -- 3) compose check: expect ssh-remote / directory-picker-ssh / ssh-web-channel --
Write-Host '[dev-lab] composed tree (dsh --profile web --dump-config):'
$dump = & dsh --profile web --dump-config 2>&1
if ($LASTEXITCODE -ne 0) { throw "dsh --dump-config failed: exit $LASTEXITCODE" }
$dump | Select-String -Pattern 'ssh-remote|directory-picker-ssh|ssh-web-channel|dsh-workspace-enhancement' | ForEach-Object { $_.Line }

if ($NoBoot) {
  Write-Host '[dev-lab] -NoBoot: web not started. Run without -NoBoot to boot in the foreground.'
  return
}

# -- 4a) smoke mode: background boot + HTTP/RPC verification + stop ----------
if ($Smoke) {
  $logDir = Join-Path $RepoRoot '.tmp'
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $stdout = Join-Path $logDir 'dev-lab-web.stdout.log'
  $stderr = Join-Path $logDir 'dev-lab-web.stderr.log'
  Write-Host "[dev-lab] smoke: starting dsh web --port $Port --no-open (background)"
  # 'dsh' alone resolves to the extensionless bash shim on Windows (not a Win32
  # app); the npm .cmd shim launches through cmd.exe reliably.
  $dsh = (Get-Command 'dsh.cmd' -ErrorAction SilentlyContinue).Source
  if (-not $dsh) { $dsh = (Get-Command 'dsh').Source }
  if (-not $dsh) { throw 'dsh CLI not found on PATH' }
  $proc = Start-Process -FilePath $dsh -ArgumentList @('web', '--port', "$Port", '--no-open') -PassThru `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr -NoNewWindow
  if ($null -eq $proc) { throw 'failed to start dsh web process' }
  try {
    $deadline = (Get-Date).AddSeconds(120)
    # FIX-8: ADR-0018 moved the channel under /api. A bare GET / is a 303, not
    # 200, until the launch token is redeemed — same sequence as boot-smoke.mjs
    # and dev-lab-wsl.sh. The envelope method is the path below /api.
    $listenUrl = $null
    while ((Get-Date) -lt $deadline) {
      if ($proc.HasExited) {
        throw "dsh web exited early (code $($proc.ExitCode)); see $stderr"
      }
      $log = Get-Content -Raw -Path $stdout -ErrorAction SilentlyContinue
      if ($log -match 'http://127\.0\.0\.1:\d+/\?token=[\w.-]+') {
        $listenUrl = $Matches[0]
        break
      }
      Start-Sleep -Seconds 3
    }
    if (-not $listenUrl) {
      throw "web did not print a listening URL at http://127.0.0.1:$Port/ within 120s; see $stderr"
    }
    Write-Host "[dev-lab] smoke: listening ($listenUrl)"
    $redeem = Invoke-WebRequest -UseBasicParsing -Uri $listenUrl -MaximumRedirection 0 -SkipHttpErrorCheck -TimeoutSec 10
    if ($redeem.StatusCode -ne 303 -and $redeem.StatusCode -ne 200) {
      throw "GET /?token=… -> HTTP $($redeem.StatusCode) (expected 303/200)"
    }
    Write-Host "[dev-lab] smoke: GET /?token=… -> HTTP $($redeem.StatusCode)"
    $cookieParts = @(
      @($redeem.Headers['Set-Cookie']) | ForEach-Object {
        if (-not [string]::IsNullOrEmpty($_)) { ($_ -split ';', 2)[0] }
      }
    ) | Where-Object { -not [string]::IsNullOrEmpty($_) }
    $cookie = $cookieParts -join '; '
    if ([string]::IsNullOrEmpty($cookie)) { throw 'token exchange returned no session cookie' }
    $sessionHeaders = @{ Cookie = $cookie }

    $resp = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/" -Headers $sessionHeaders -TimeoutSec 10
    if ($resp.StatusCode -ne 200) { throw "GET / (session) -> HTTP $($resp.StatusCode) (expected 200)" }
    Write-Host "[dev-lab] smoke: HTTP 200 on http://127.0.0.1:$Port/ ($($resp.RawContentLength) bytes)"
    $bundleReferenced = $resp.Content -match 'dsh-workspace-enhancement/client\.js'
    Write-Host "[dev-lab] smoke: index references plugin client bundle: $bundleReferenced"
    if (-not $bundleReferenced) { throw 'plugin client bundle is not injected into the served index' }

    $body = '{"type":"client-request","rpcId":"lab-smoke-1","method":"dsw/connections.list","payload":{}}'
    $rpc = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/dsw/connections.list" `
      -Headers $sessionHeaders -ContentType 'application/json' -Body $body -TimeoutSec 10
    $value = $rpc.result.value
    $wire = if ($null -ne $value) { $value | ConvertTo-Json -Compress } else { 'null' }
    Write-Host "[dev-lab] smoke: POST /api/dsw/connections.list -> ok=$($rpc.result.ok), value=$wire"
    if (-not $rpc.result.ok) { throw 'RPC channel /api/dsw returned ok=false' }
    Write-Host '[dev-lab] smoke: PASS (HTTP + client bundle + /api/dsw RPC channel)'
  } finally {
    if ($null -ne $proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
    # dsh.cmd is a wrapper: the node server child survives Stop-Process, so
    # also stop anything still bound to $Port.
    Start-Sleep -Seconds 2
    $listeners = @(netstat -ano | Where-Object { $_ -match ":$Port\s" -and $_ -match 'LISTENING' })
    foreach ($line in $listeners) {
      $pidText = ($line.Trim() -split '\s+')[-1]
      if ($pidText -match '^\d+$' -and [int]$pidText -ne $PID) {
        try { Stop-Process -Id ([int]$pidText) -Force -ErrorAction SilentlyContinue } catch { }
      }
    }
    Write-Host '[dev-lab] smoke: server stopped.'
  }
  return
}

# -- 4) boot web (--port confirmed via `dsh web --help`) ---------------------
Write-Host "[dev-lab] booting: dsh web --port $Port --no-open"
Write-Host "[dev-lab] verify at http://127.0.0.1:$Port/ (Ctrl+C to stop)"
& dsh web --port $Port --no-open
