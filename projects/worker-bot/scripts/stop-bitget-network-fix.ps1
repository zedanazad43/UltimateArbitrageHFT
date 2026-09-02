$ErrorActionPreference = 'Continue'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeDir = Join-Path $scriptDir '.runtime'
$pidFiles = @(
  Join-Path $runtimeDir 'gateway-node.pid',
  Join-Path $runtimeDir 'cloudflared-gateway.pid'
)

foreach ($pidFile in $pidFiles) {
  if (-not (Test-Path $pidFile)) {
    continue
  }

  $pidValue = Get-Content $pidFile -ErrorAction SilentlyContinue
  if (-not $pidValue) {
    Remove-Item $pidFile -ErrorAction SilentlyContinue
    continue
  }

  try {
    Stop-Process -Id ([int]$pidValue) -Force -ErrorAction Stop
    Write-Output "[netfix] stopped PID=$pidValue"
  } catch {
    Write-Output "[netfix] process already stopped PID=$pidValue"
  }

  Remove-Item $pidFile -ErrorAction SilentlyContinue
}

Write-Output '[netfix] done'
