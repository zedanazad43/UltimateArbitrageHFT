#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Switch bot to Paper Trading mode and diagnose exchange credentials
.DESCRIPTION
    Run this script to switch to paper trading mode or check exchange credentials.
    Requires ADMIN_TOKEN (the token set during initial setup).
.EXAMPLE
    powershell -File scripts\switch-to-paper.ps1
#>

$workerUrl = "https://ultimatearbitragehft.zedanazad43.workers.dev"

Write-Host "`n🔧 UltimateArbitrageHFT — Paper Mode & Diagnostics`n" -ForegroundColor Cyan

# Get admin token
$adminToken = $env:ADMIN_TOKEN
if (-not $adminToken) {
    $adminToken = Read-Host "Enter ADMIN_TOKEN (from wrangler secret list or your setup)"
}

if (-not $adminToken) {
    Write-Host "❌ ADMIN_TOKEN is required" -ForegroundColor Red
    exit 1
}

$headers = @{
    "x-admin-token" = $adminToken
    "Content-Type"  = "application/json"
}

# ── Check current status ──────────────────────────────────────────────────────
Write-Host "📊 Current System Status:" -ForegroundColor Yellow
try {
    $status = Invoke-RestMethod -Uri "$workerUrl/api/status" -Headers $headers -ErrorAction Stop
    $modeColor = if ($status.paper_trading -ne $false) { "Yellow" } else { "Red" }
    Write-Host "  Mode: $(if ($status.paper_trading -ne $false) { '📄 Paper' } else { '🔴 LIVE' })" -ForegroundColor $modeColor
    Write-Host "  Trading: $(if ($status.trading_enabled) { '✅ Enabled' } else { '❌ Disabled' })"
    Write-Host "  Equity: `$$($status.equity_usd)"
    Write-Host "  Daily Trades: $($status.daily_trades)"
    Write-Host "  Daily PnL: `$$($status.daily_pnl_usd)"
} catch {
    Write-Host "  ❌ Cannot fetch status: $_" -ForegroundColor Red
    exit 1
}

# ── Check exchange credentials ────────────────────────────────────────────────
Write-Host "`n💰 Exchange Credentials & Balances:" -ForegroundColor Yellow
try {
    $balances = Invoke-RestMethod -Uri "$workerUrl/api/balances" -Headers $headers -ErrorAction Stop
    foreach ($ex in $balances.data) {
        $icon = if ($ex.error) { "❌" } elseif ($ex.configured) { "✅" } else { "⚠️" }
        $info = if ($ex.error) {
            "ERROR: $($ex.error)"
        } elseif ($ex.configured) {
            "Balance: `$$([math]::Round($ex.balance, 2)) USDT"
        } else {
            "Not configured (missing: $($ex.missing_keys -join ', '))"
        }
        Write-Host "  $icon $($ex.exchange.ToUpper().PadRight(10)) $info"
    }
} catch {
    Write-Host "  ❌ Cannot fetch balances: $_" -ForegroundColor Red
}

# ── Switch to Paper mode ──────────────────────────────────────────────────────
Write-Host "`n📄 Switching to Paper Trading mode..." -ForegroundColor Cyan
try {
    $result = Invoke-RestMethod -Uri "$workerUrl/mode/paper" -Method POST -Headers $headers -ErrorAction Stop
    Write-Host "  ✅ $result" -ForegroundColor Green
} catch {
    Write-Host "  ❌ Failed to switch mode: $_" -ForegroundColor Red
}

# ── Final status ──────────────────────────────────────────────────────────────
Write-Host "`n✅ Done! The bot is now in Paper Trading mode." -ForegroundColor Green
Write-Host ""
Write-Host "To fix exchange credentials, run:" -ForegroundColor Yellow
Write-Host "  wrangler secret put MEXC_API_KEY" -ForegroundColor White
Write-Host "  wrangler secret put MEXC_API_SECRET" -ForegroundColor White
Write-Host "  wrangler secret put BINANCE_API_KEY" -ForegroundColor White
Write-Host "  wrangler secret put BINANCE_API_SECRET" -ForegroundColor White
Write-Host ""
Write-Host "To switch back to LIVE mode after fixing keys:" -ForegroundColor Yellow
Write-Host "  Invoke-RestMethod -Uri `"$workerUrl/mode/live`" -Method POST -Headers @{`"x-admin-token`"=`"YOUR_TOKEN`"}" -ForegroundColor White
