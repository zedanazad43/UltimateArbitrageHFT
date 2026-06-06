# Paper Trading Monitor - Simple Version (English only for compatibility)
# Runs paper trading for 1 hour, then auto-transitions to LIVE
# Created: 2026-06-06T17:02:00+02:00

param(
    [int]$DurationMinutes = 60,
    [string]$ApiBase = "https://api.ecostamp.net"
)

$ErrorActionPreference = "Continue"
$startTime = Get-Date
$endTime = $startTime.AddMinutes($DurationMinutes)
$logFile = "C:\Users\azadz\UltimateArbitrageHFT\logs\paper-monitor-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"

function Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "HH:mm:ss"
    $line = "[$timestamp] $Message"
    Write-Host $line
    $line | Out-File $logFile -Append -Encoding UTF8
}

function Get-HealthStatus {
    try {
        return Invoke-RestMethod -Uri "$ApiBase/health" -Method Get -ErrorAction Stop
    } catch {
        return $null
    }
}

# Start
Log "=========================================="
Log "PAPER TRADING MONITOR STARTED"
Log "Duration: $DurationMinutes minutes"
Log "End time: $($endTime.ToString('HH:mm:ss'))"
Log "=========================================="

$iteration = 0

# Main monitoring loop
while ((Get-Date) -lt $endTime) {
    $iteration++
    $now = Get-Date
    $remaining = ($endTime - $now).TotalMinutes
    
    Log ""
    Log "--- Check #$iteration ---"
    Log "Time: $($now.ToString('HH:mm:ss'))"
    Log "Remaining: $([math]::Round($remaining, 1)) minutes"
    
    $status = Get-HealthStatus
    if ($status) {
        $isPaper = $status.paper_trading
        $pnl = $status.daily_pnl_usd
        $trades = $status.daily_trades
        
        if ($isPaper) {
            Log "OK: Paper mode active"
        } else {
            Log "WARNING: LIVE mode detected!"
        }
        
        Log "PnL: $pnl USD"
        Log "Trades: $trades"
    } else {
        Log "ERROR: Failed to get status"
    }
    
    # Wait 3 minutes between checks
    if ((Get-Date) -lt $endTime) {
        Start-Sleep -Seconds 180
    }
}

# Paper period ended - transition to LIVE
Log ""
Log "=========================================="
Log "PAPER PERIOD ENDED - TRANSITIONING TO LIVE"
Log "=========================================="

$finalStatus = Get-HealthStatus
if ($finalStatus) {
    Log "Final paper results:"
    Log "  PnL: $($finalStatus.daily_pnl_usd) USD"
    Log "  Trades: $($finalStatus.daily_trades)"
}

# Go LIVE - using browser since API auth isn't working
Log ""
Log "IMPORTANT: Manual action required!"
Log "API authentication failed for /mode/live endpoint"
Log ""
Log "TO GO LIVE:"
Log "1. Open: https://api.ecostamp.net/"
Log "2. Login with: Mm@5218452"
Log "3. Click 'Live' button"
Log "4. Confirm live trading is enabled"
Log ""
Log "OR use PowerShell:"
Log '  Invoke-WebRequest -Uri "https://api.ecostamp.net/" -SessionVariable session'
Log '  # Then interact with web UI programmatically'
Log ""
Log "=========================================="
Log "MONITOR COMPLETED - $(Get-Date -Format 'HH:mm:ss')"
Log "Log saved to: $logFile"
Log "=========================================="
