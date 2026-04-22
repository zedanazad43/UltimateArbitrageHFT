# test-telegram-control.ps1
# Smoke-tests the Telegram Bot Center and Control Center connectivity:
#   1. Verifies TELEGRAM_BOT_TOKEN is valid with Telegram getMe API.
#   2. Calls /status on the Control Center and reports the result.
#
# Usage:
#   .\scripts\test-telegram-control.ps1
#   .\scripts\test-telegram-control.ps1 -BotToken "..." -ControlCenterUrl "..." -AdminToken "..."
#   .\scripts\test-telegram-control.ps1 -SkipControlCenter   # only checks the bot token
param(
  [string]$BotToken          = '',
  [string]$ControlCenterUrl  = '',
  [string]$AdminToken        = '',
  [switch]$SkipControlCenter,
  [switch]$NoPrompt
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'common.ps1')

$isNonInteractive = $NoPrompt -or (Test-NonInteractiveBotSession)

$resolvedBotToken = Resolve-BotSetting `
  -ScriptRoot    $PSScriptRoot `
  -Name          'TELEGRAM_BOT_TOKEN' `
  -ExplicitValue $BotToken `
  -PromptMessage 'Enter TELEGRAM_BOT_TOKEN' `
  -DisablePrompt:$isNonInteractive

if ([string]::IsNullOrWhiteSpace($resolvedBotToken)) {
  throw 'TELEGRAM_BOT_TOKEN is required. Pass -BotToken, set TELEGRAM_BOT_TOKEN in the environment, or run setup-telegram-control.ps1.'
}

$resolvedControlUrl = Resolve-BotSetting `
  -ScriptRoot    $PSScriptRoot `
  -Name          'CONTROL_CENTER_BASE_URL' `
  -ExplicitValue $ControlCenterUrl `
  -DisablePrompt:$true

if (-not [string]::IsNullOrWhiteSpace($resolvedControlUrl)) {
  $resolvedControlUrl = Get-ValidatedAbsoluteHttpUrl -Name 'CONTROL_CENTER_BASE_URL' -Value $resolvedControlUrl
}

$resolvedAdminToken = Resolve-BotSetting `
  -ScriptRoot    $PSScriptRoot `
  -Name          'CONTROL_CENTER_ADMIN_TOKEN' `
  -ExplicitValue $AdminToken `
  -DisablePrompt:$true

$allPassed = $true

# ── 1. Telegram bot token check ───────────────────────────────────────────────

Write-Host ""
Write-Host "[1/2] Testing Telegram bot token..." -ForegroundColor Cyan
try {
  $response = Invoke-RestMethod -Method Get -Uri "https://api.telegram.org/bot$resolvedBotToken/getMe"
  if ($response.ok) {
    $bot = $response.result
    Write-Host "  ✅ Bot: @$($bot.username) (id=$($bot.id), name='$($bot.first_name)')" -ForegroundColor Green
  } else {
    Write-Host "  ❌ Telegram returned ok=false: $($response | ConvertTo-Json)" -ForegroundColor Red
    $allPassed = $false
  }
} catch {
  $details = $_.Exception.Message
  if ($_.ErrorDetails -and -not [string]::IsNullOrWhiteSpace($_.ErrorDetails.Message)) {
    $details = $_.ErrorDetails.Message
  }
  Write-Host "  ❌ Telegram getMe failed: $details" -ForegroundColor Red
  $allPassed = $false
}

# ── 2. Control Center /status check ──────────────────────────────────────────

if ($SkipControlCenter) {
  Write-Host "[2/2] Skipping Control Center check (SkipControlCenter flag set)." -ForegroundColor Yellow
} elseif ([string]::IsNullOrWhiteSpace($resolvedControlUrl)) {
  Write-Host "[2/2] CONTROL_CENTER_BASE_URL not set — skipping Control Center check." -ForegroundColor Yellow
} else {
  Write-Host "[2/2] Testing Control Center at $resolvedControlUrl/status ..." -ForegroundColor Cyan
  try {
    $headers = @{}
    if (-not [string]::IsNullOrWhiteSpace($resolvedAdminToken)) {
      $headers['x-admin-token'] = $resolvedAdminToken
    }
    $statusResponse = Invoke-WebRequest -UseBasicParsing -Method Get `
      -Uri "$resolvedControlUrl/status" -Headers $headers -TimeoutSec 20
    if ($statusResponse.StatusCode -eq 200) {
      Write-Host "  ✅ Control Center responded (HTTP 200)" -ForegroundColor Green
      $statusJson = $statusResponse.Content | ConvertFrom-Json -ErrorAction SilentlyContinue
      if ($statusJson) {
        $mode = if ($statusJson.paper_trading) { 'PAPER' } else { 'LIVE' }
        $enabled = if ($statusJson.trading_enabled) { 'enabled' } else { 'disabled' }
        Write-Host "     Status: trading=$enabled, mode=$mode, daily_trades=$($statusJson.daily_trades), equity=`$$($statusJson.equity)" -ForegroundColor White
      }
    } else {
      Write-Host "  ❌ Unexpected HTTP $($statusResponse.StatusCode)" -ForegroundColor Red
      $allPassed = $false
    }
  } catch {
    $details = $_.Exception.Message
    if ($_.ErrorDetails -and -not [string]::IsNullOrWhiteSpace($_.ErrorDetails.Message)) {
      $details = $_.ErrorDetails.Message
    }
    Write-Host "  ❌ Control Center request failed: $details" -ForegroundColor Red
    $allPassed = $false
  }
}

Write-Host ""
if ($allPassed) {
  Write-Host "✅ All checks passed." -ForegroundColor Green
} else {
  throw "One or more connectivity checks failed. Review the output above."
}
