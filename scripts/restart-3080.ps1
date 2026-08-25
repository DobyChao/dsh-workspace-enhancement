# scripts/restart-3080.ps1 — 在「会话外」重启 3080 真实 DSH 实例
#
# 为什么需要它：3080 实例的 node 进程就是当前 Web GUI 会话的宿主进程，
# 从会话内 kill 会连同正在进行的对话一起终止；请在普通终端（非 DSH GUI 内）
# 运行本脚本完成重启 + 启动验证。
#
# 用法：pwsh -File scripts/restart-3080.ps1
# 只做：终止 3080 监听进程 → 启动 dsh web --port 3080 --no-open → 验证 3 项。
# 不影响：profile 外的任何文件、.dsh-lab、其它端口/进程。

$ErrorActionPreference = 'Stop'
$port = 3080
$dshBin = 'C:\Users\Admin\AppData\Roaming\npm\dsh'
$profile = 'C:\Users\Admin\.dsh\profiles\web'
$outLog = Join-Path $profile '.restart-out.log'
$errLog = Join-Path $profile '.restart-err.log'

function Get-PidOnPort() {
  try {
    (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
      Select-Object -First 1 -ExpandProperty OwningProcess)
  } catch { $null }
}

$pid0 = Get-PidOnPort
if ($pid0) {
  Write-Host "[1/4] 终止 3080 进程 PID=$pid0 ..."
  taskkill /PID $pid0 /T /F | Out-Host
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (-not (Get-PidOnPort)) { break }
  }
  if (Get-PidOnPort) { Write-Error '端口 3080 未释放，中止。' }
} else {
  Write-Host "[1/4] 3080 当前无监听进程，直接启动。"
}

Write-Host "[2/4] 启动 dsh web --port 3080 --no-open ..."
Start-Process -FilePath $dshBin -ArgumentList 'web', '--port', '3080', '--no-open' `
  -WorkingDirectory $profile -WindowStyle Hidden `
  -RedirectStandardOutput $outLog -RedirectStandardError $errLog

$ok = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 3
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -TimeoutSec 3 -UseBasicParsing
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch {}
}
if (-not $ok) {
  Write-Host "[3/4] 启动失败或超时。日志：`n--- stdout ---`n$(Get-Content $outLog -Tail 30 -ErrorAction SilentlyContinue)`n--- stderr ---`n$(Get-Content $errLog -Tail 30 -ErrorAction SilentlyContinue)"
  Write-Host '回滚提示：恢复 package.json 备份 → dsh plugin --profile web add dsh-workspace-enhancement → 重跑本脚本。'
  exit 1
}
Write-Host "[3/4] GET / = 200 ✓"

try {
  Invoke-WebRequest -Uri "http://127.0.0.1:$port/plugins/dsh-workspace-enhancement/client.js" -TimeoutSec 5 -UseBasicParsing | Out-Null
  Write-Host "      /plugins/dsh-workspace-enhancement/client.js = 200 ✓"
} catch {
  Write-Host "      client.js 检查失败：$($_.Exception.Message)（插件可能未注入，请查 $errLog）"
}
try {
  $body = '{}'
  $res = Invoke-WebRequest -Uri "http://127.0.0.1:$port/dsw/connections.list" -Method POST -Body $body `
    -ContentType 'application/json' -TimeoutSec 5 -UseBasicParsing
  Write-Host "      POST /dsw/connections.list = $($res.StatusCode) ✓ ($($res.Content.Substring(0, [Math]::Min(80, $res.Content.Length))))"
} catch {
  Write-Host "      /dsw 通道检查失败：$($_.Exception.Message)"
}
Write-Host "[4/4] 完成。新 PID: $(Get-PidOnPort)"
