param(
  [string]$GatewayToken = 'gw-2026-06-01'
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$runtimeDir = Join-Path $scriptDir '.runtime'
$gatewayPidFile = Join-Path $runtimeDir 'gateway-node.pid'
$tunnelPidFile = Join-Path $runtimeDir 'cloudflared-gateway.pid'
$gatewayOutLog = Join-Path $runtimeDir 'gateway-node.out.log'
$gatewayErrLog = Join-Path $runtimeDir 'gateway-node.err.log'
$tunnelOutLog = Join-Path $runtimeDir 'cloudflared-gateway.out.log'
$tunnelErrLog = Join-Path $runtimeDir 'cloudflared-gateway.err.log'

if (-not (Test-Path $runtimeDir)) {
  New-Item -Path $runtimeDir -ItemType Directory | Out-Null
}

function Test-RunningProcess {
  param([string]$PidFile)
  if (-not (Test-Path $PidFile)) { return $false }
  $pidValue = Get-Content $PidFile -ErrorAction SilentlyContinue
  if (-not $pidValue) { return $false }
  try {
    $proc = Get-Process -Id ([int]$pidValue) -ErrorAction Stop
    return $null -ne $proc
  } catch {
    return $false
  }
}

$cfg = Join-Path $HOME '.cloudflared/config-arbitrage-gateway.yml'
if (-not (Test-Path $cfg)) {
  throw "Missing tunnel config: $cfg"
}
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  throw 'cloudflared is not installed or not in PATH'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'node is not installed or not in PATH'
}

if (-not (Test-RunningProcess -PidFile $gatewayPidFile)) {
  $gatewayCmd = "Set-Location '$repoRoot/proxy-gateway'; `$env:GATEWAY_AUTH_TOKEN='$GatewayToken'; node node-gateway.mjs"
  $gatewayProc = Start-Process -FilePath 'powershell' -ArgumentList @('-NoProfile', '-Command', $gatewayCmd) -PassThru -WindowStyle Hidden -RedirectStandardOutput $gatewayOutLog -RedirectStandardError $gatewayErrLog
  Set-Content -Path $gatewayPidFile -Value $gatewayProc.Id -Encoding ascii
  Write-Output "[netfix] started gateway-node PID=$($gatewayProc.Id)"
} else {
  Write-Output '[netfix] gateway-node already running'
}

if (-not (Test-RunningProcess -PidFile $tunnelPidFile)) {
  $tunnelCmd = "cloudflared --config '$cfg' --protocol http2 tunnel run"
  $tunnelProc = Start-Process -FilePath 'powershell' -ArgumentList @('-NoProfile', '-Command', $tunnelCmd) -PassThru -WindowStyle Hidden -RedirectStandardOutput $tunnelOutLog -RedirectStandardError $tunnelErrLog
  Set-Content -Path $tunnelPidFile -Value $tunnelProc.Id -Encoding ascii
  Write-Output "[netfix] started cloudflared PID=$($tunnelProc.Id)"
} else {
  Write-Output '[netfix] cloudflared already running'
}

Start-Sleep -Seconds 3

try {
  $res = Invoke-RestMethod -Method Get -Uri 'https://arb-gateway01.ecostamp.net/health' -Headers @{ 'X-Gateway-Token' = $GatewayToken } -TimeoutSec 15
  Write-Output "[netfix] health ok=$($res.ok) mode=$($res.mode)"
} catch {
  Write-Output '[netfix] health check failed, inspect logs:'
  Write-Output "- $gatewayOutLog"
  Write-Output "- $gatewayErrLog"
  Write-Output "- $tunnelOutLog"
  Write-Output "- $tunnelErrLog"
  throw
}
