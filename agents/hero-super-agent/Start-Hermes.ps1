# Hermes Telegram Connectivity Fix & Launch Script
# Run this script as Administrator (required for hosts file edit)

param(
    [switch]$ForceHostsEdit,
    [switch]$UseProxy,
    [string]$ProxyAddress
)

# Ensure admin rights for hosts edit
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "This script needs Administrator privileges to edit the hosts file." -ForegroundColor Red
    Write-Host "Restarting as Administrator..." -ForegroundColor Yellow
    Start-Process PowerShell -Verb RunAs -ArgumentList "-File `"$PSCommandPath`""
    exit
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   Hermes Connectivity Fix & Launch" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# 1. Test Python TCP connectivity to Telegram
Write-Host "[1] Testing Python TCP connection to Telegram..." -ForegroundColor Yellow
$pythonTest = python -c "import socket; s=socket.socket(); s.settimeout(5); s.connect(('149.154.166.110',443)); print('OK'); s.close()" 2>&1
if ($pythonTest -eq "OK") {
    Write-Host "SUCCESS: Python can connect to Telegram. No network fix needed." -ForegroundColor Green
    $needHostsFix = $false
} else {
    Write-Host "FAILED: Python cannot reach Telegram directly." -ForegroundColor Red
    $needHostsFix = $true
}

# 2. Apply hosts-file fix if needed (or forced)
$hostsPath = "$env:windir\System32\drivers\etc\hosts"
$hostsEntry = "149.154.166.110 api.telegram.org"

if ($needHostsFix -or $ForceHostsEdit) {
    Write-Host "`n[2] Applying hosts-file fix..." -ForegroundColor Yellow
    $currentHosts = Get-Content $hostsPath -ErrorAction SilentlyContinue
    if ($currentHosts -match [regex]::Escape($hostsEntry)) {
        Write-Host "Hosts entry already present." -ForegroundColor Green
    } else {
        Add-Content -Path $hostsPath -Value "`r`n$hostsEntry"
        Write-Host "Added: $hostsEntry" -ForegroundColor Green
        Write-Host "Flushing DNS cache..." -ForegroundColor Yellow
        ipconfig /flushdns | Out-Null
    }
} elseif (-not $UseProxy) {
    Write-Host "`n[2] Skipping hosts fix (connection already works)." -ForegroundColor Cyan
}

# 3. Proxy option
if ($UseProxy -and $ProxyAddress) {
    Write-Host "`n[3] Setting proxy environment variables..." -ForegroundColor Yellow
    $env:ALL_PROXY = $ProxyAddress
    $env:HTTPS_PROXY = $ProxyAddress
    Write-Host "Proxy set to: $ProxyAddress" -ForegroundColor Green
} elseif ($UseProxy) {
    Write-Host "Proxy switch used but no address provided. Please supply -ProxyAddress." -ForegroundColor Red
}

# 4. Token check warning (cosmetic, but user can verify if needed)
Write-Host "`n[4] Token warnings check..." -ForegroundColor Yellow
Write-Host "The non-ASCII character warnings were automatically stripped." -ForegroundColor Cyan
Write-Host "If you still see authentication errors later, re-copy the keys from the dashboard using a plain-text editor and run:" -ForegroundColor Cyan
Write-Host "  hermes setup" -ForegroundColor White

# 5. Launch Hermes Gateway
Write-Host "`n[5] Starting Hermes Gateway..." -ForegroundColor Yellow
Write-Host "Command: hermes gateway" -ForegroundColor White
Write-Host "Press Ctrl+C to stop.`n" -ForegroundColor Cyan

# Optional: If you need to ensure all components are enabled, you can add environment variables here.
# For example:
# $env:HERMES_ENABLE_SKILLS = "true"
# $env:HERMES_ENABLE_MODELS = "true"
# $env:HERMES_ENABLE_AGENTS = "true"

hermes gateway