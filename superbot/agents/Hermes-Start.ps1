<#
.SYNOPSIS
    Hermes Telegram Gateway Setup & Launch – all-in-one script.
#>
param(
    [string]$BotToken,
    [switch]$ForceHosts
)
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Start-Process PowerShell -Verb RunAs -ArgumentList "-File `"$PSCommandPath`" -BotToken '$BotToken' -ForceHosts:`$$ForceHosts"
    exit
}
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   Hermes Telegram Gateway Setup & Launch" -ForegroundColor Cyan
Write-Host "============================================`n" -ForegroundColor Cyan
if (-not $BotToken) {
    $secure = Read-Host "Paste your Telegram bot token from @BotFather" -AsSecureString
    $BotToken = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    )
}
if (-not $BotToken -or $BotToken -notmatch '^\d+:[a-zA-Z0-9_-]+$') {
    Write-Host "ERROR: Invalid bot token format." -ForegroundColor Red
    exit 1
}
Write-Host "`n[1/5] Testing Python TCP connectivity..." -ForegroundColor Yellow
$test = & python -c "import socket; s=socket.socket(); s.settimeout(5); s.connect(('149.154.166.110',443)); print('OK'); s.close()" 2>&1
$needHosts = ($test -ne "OK")
if (-not $needHosts) { Write-Host "✔ Python can reach Telegram." -ForegroundColor Green }
else { Write-Host "⚠ Python cannot reach Telegram. Will apply hosts fix." -ForegroundColor Red }
if ($needHosts -or $ForceHosts) {
    Write-Host "`n[2/5] Applying hosts file fix..." -ForegroundColor Yellow
    $hostsPath = "$env:windir\System32\drivers\etc\hosts"
    $entry = "149.154.166.110 api.telegram.org"
    if ((Get-Content $hostsPath -ErrorAction SilentlyContinue) -notmatch [regex]::Escape($entry)) {
        Add-Content -Path $hostsPath -Value "`r`n$entry"
        Write-Host "✔ Added $entry" -ForegroundColor Green
        ipconfig /flushdns | Out-Null
    }
    else { Write-Host "✔ Hosts entry already present." -ForegroundColor Green }
} else { Write-Host "`n[2/5] Skipping hosts fix." -ForegroundColor Cyan }
Write-Host "`n[3/5] Updating TELEGRAM_TOKEN in .env..." -ForegroundColor Yellow
$envDir = "$env:USERPROFILE\.hermes"
$envFile = Join-Path $envDir ".env"
if (-not (Test-Path $envDir)) { New-Item -ItemType Directory -Path $envDir -Force | Out-Null }
if (Test-Path $envFile) {
    $lines = Get-Content $envFile
    $found = $false
    $newLines = foreach ($line in $lines) { if ($line -match '^TELEGRAM_TOKEN\s*=') { "TELEGRAM_TOKEN=$BotToken"; $found = $true } else { $line } }
    if (-not $found) { $newLines += "TELEGRAM_TOKEN=$BotToken" }
    $newLines | Set-Content $envFile -Encoding UTF8
} else { "TELEGRAM_TOKEN=$BotToken" | Set-Content $envFile -Encoding UTF8 }
Write-Host "✔ TELEGRAM_TOKEN updated." -ForegroundColor Green
Write-Host "`n[4/5] Stopping any existing gateway instance..." -ForegroundColor Yellow
hermes gateway stop 2>&1 | Out-Null
Get-Process -Name "python" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*hermes*gateway*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Write-Host "✔ Previous instance stopped." -ForegroundColor Green
Write-Host "`n[5/5] Starting Hermes Gateway..." -ForegroundColor Yellow
Write-Host "Command: hermes gateway"
Write-Host "Press Ctrl+C to stop.`n"
$env:TELEGRAM_TOKEN = $BotToken

# skills.sh + lean-ctx wiring (free-model-first)
$repoRoot = Split-Path -Parent $PSScriptRoot
$env:HERMES_SKILLS_DIR   = Join-Path $repoRoot "skills.sh"
$env:LEAN_CTX_PATH       = Join-Path $repoRoot "lean-ctx\ctx.py"
$env:HERMES_PROVIDER_ORDER = "ollama,cloudflare_ai,openrouter_free,openrouter"
if (Test-Path $env:HERMES_SKILLS_DIR) { Write-Host "✔ skills.sh: $($env:HERMES_SKILLS_DIR)" -ForegroundColor Green }
if (Test-Path $env:LEAN_CTX_PATH)     { Write-Host "✔ lean-ctx:  $($env:LEAN_CTX_PATH)"     -ForegroundColor Green }
Write-Host "✔ Provider order: $($env:HERMES_PROVIDER_ORDER)" -ForegroundColor Cyan

hermes gateway
