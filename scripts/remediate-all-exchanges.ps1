param(
  [switch]$DryRun,
  [switch]$DiagnoseOnly,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$RemainingArgs
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$devVarsFile = Join-Path $repoRoot '.dev.vars'

foreach ($arg in ($RemainingArgs | Where-Object { $_ })) {
  switch ($arg.ToLowerInvariant()) {
    '--dry-run' { $DryRun = $true; continue }
    '--diagnose-only' { $DiagnoseOnly = $true; continue }
    default {
      throw "Unknown option: $arg`nSupported options: --dry-run | --diagnose-only"
    }
  }
}

function Import-DevVars {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    return
  }

  Write-Output '== Load local secrets from .dev.vars =='
  Get-Content $Path | ForEach-Object {
    $line = $_
    if (-not $line) { return }
    if ($line.Trim().StartsWith('#')) { return }
    $idx = $line.IndexOf('=')
    if ($idx -lt 1) { return }

    $key = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1)

    if (-not $key) { return }
    if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($key))) { return }

    [Environment]::SetEnvironmentVariable($key, $value)
  }

  Write-Output ''
}

Import-DevVars -Path $devVarsFile

if ([string]::IsNullOrWhiteSpace($env:ADMIN_TOKEN)) {
  throw 'ADMIN_TOKEN is required. Set it in shell or .dev.vars'
}

$secrets = @(
  'MEXC_API_KEY',
  'MEXC_API_SECRET',
  'BINANCE_API_KEY',
  'BINANCE_API_SECRET',
  'KUCOIN_API_KEY',
  'KUCOIN_SECRET_KEY',
  'KUCOIN_PASSPHRASE',
  'OKX_API_KEY',
  'OKX_API_SECRET',
  'OKX_PASSPHRASE',
  'BITGET_API_KEY',
  'BITGET_SECRET_KEY',
  'BITGET_API_PASSPHRASE',
  'BITMART_API_KEY',
  'BITMART_SECRET_KEY',
  'BITMART_MEMO',
  'HTX_API_KEY',
  'HTX_API_SECRET',
  'HFT_ENGINE_URL',
  'HFT_ENGINE_SECRET'
)

function Set-WorkerSecret {
  param(
    [string]$Name,
    [bool]$IsDryRun
  )

  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    Write-Output "[SKIP] $Name (not set in env)"
    return
  }

  if ($IsDryRun) {
    Write-Output "[DRY]  wrangler secret put $Name"
    return
  }

  Write-Output "[PUT]  $Name"
  $value | npx --yes wrangler@4 secret put $Name | Out-Null
}

if (-not $DiagnoseOnly) {
  Write-Output '== Upload exchange/HFT secrets from env =='
  foreach ($key in $secrets) {
    Set-WorkerSecret -Name $key -IsDryRun:$DryRun
  }
  Write-Output ''
}

Write-Output '== Run all-platform readiness diagnostic =='
if ($DryRun) {
  Write-Output '[DRY]  ADMIN_TOKEN=*** node scripts/diagnose-exchange-readiness.js'
} else {
  Set-Location $repoRoot
  node scripts/diagnose-exchange-readiness.js
}
