#Requires -Version 7.0
# run-telegram-bot.ps1
# Loads .env, activates venv (if present), and runs main_bot_with_telegram.py.
#
# Usage:
#   .\scripts\run-telegram-bot.ps1
#   .\scripts\run-telegram-bot.ps1 -EnvFile "C:\custom\.env"
param(
  [string]$EnvFile = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'common.ps1')

$botRoot  = Get-BotRootPath -ScriptRoot $PSScriptRoot
$envPath  = if ($EnvFile) { $EnvFile } else { Get-EnvFilePath -ScriptRoot $PSScriptRoot }
$mainPy   = Join-Path $botRoot 'main_bot_with_telegram.py'
$venvAct  = Join-Path $botRoot 'venv\Scripts\Activate.ps1'

Write-Host ""
Write-Host "════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  MegaArbitrageBot — Telegram Bot Launcher" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════" -ForegroundColor Cyan

# ── Check Python script exists ────────────────────────────────────────────────

if (-not (Test-Path $mainPy)) {
  throw "main_bot_with_telegram.py not found at: $mainPy"
}

# ── Load .env ─────────────────────────────────────────────────────────────────

if (-not (Test-Path $envPath)) {
  Write-Host "⚠️  .env not found at: $envPath" -ForegroundColor Yellow
  Write-Host "   Run .\scripts\setup-telegram-control.ps1 first." -ForegroundColor Yellow
  Write-Host ""
} else {
  $envValues = Read-EnvFile -EnvFilePath $envPath
  foreach ($key in $envValues.Keys) {
    [Environment]::SetEnvironmentVariable($key, $envValues[$key], 'Process')
  }
  Write-Host "✅ Loaded .env: $envPath" -ForegroundColor Green
}

# ── Verify Telegram token is available ───────────────────────────────────────

$token = [Environment]::GetEnvironmentVariable('TELEGRAM_BOT_TOKEN')
if ([string]::IsNullOrWhiteSpace($token)) {
  Write-Host "⚠️  TELEGRAM_BOT_TOKEN is not set. Notifications will be disabled." -ForegroundColor Yellow
}

# ── Activate venv (if present) ───────────────────────────────────────────────

if (Test-Path $venvAct) {
  Write-Host "🔧 Activating virtual environment..." -ForegroundColor Yellow
  & $venvAct
} else {
  Write-Host "ℹ️  No venv found — using system Python. Run .\install.ps1 to create one." -ForegroundColor Cyan
}

# ── Run ───────────────────────────────────────────────────────────────────────

Write-Host "🚀 Starting Telegram Bot Center..." -ForegroundColor Green
Write-Host "   Press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host ""

Set-Location $botRoot

try {
  python main_bot_with_telegram.py
} finally {
  Write-Host ""
  Write-Host "👋 Bot stopped." -ForegroundColor Cyan
}
