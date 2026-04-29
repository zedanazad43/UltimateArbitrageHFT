#Requires -Version 5.1
<#
.SYNOPSIS
    Full deploy script for Ultimate Arbitrage HFT on Cloudflare Workers.

.DESCRIPTION
    Steps performed:
      1. Verify wrangler.toml is present and names the correct worker
      2. Check Node.js / npm are installed
      3. Verify / perform Cloudflare login (wrangler whoami)
      4. npm install
      5. Upload every real secret from api_keys.txt
      6. Upload TELEGRAM_WEBHOOK_SECRET (auto-generated if not supplied)
      7. Run D1 database migration (migrations/schema.sql)
      8. wrangler deploy
      9. Register Telegram webhook with Telegram API (optional)

.PARAMETER WorkerName
    Cloudflare worker name. Defaults to "arbitrage-bot".

.PARAMETER ApiKeysFile
    Path to the API keys file. Defaults to .\api_keys.txt

.PARAMETER MigrationFile
    Path to the D1 schema SQL file. Defaults to .\migrations\schema.sql

.PARAMETER TelegramBotToken
    Your Telegram bot token (e.g. "123456:AABBcc...").
    If omitted the script reads TELEGRAM_BOT_TOKEN from api_keys.txt.

.PARAMETER WebhookSecret
    Secret string for Telegram webhook validation.
    If omitted a random 32-byte hex string is generated automatically.

.EXAMPLE
    .\deploy.ps1

.EXAMPLE
    .\deploy.ps1 -TelegramBotToken "123456:AABBcc..."
#>
[CmdletBinding()]
param(
    [string]$WorkerName       = "ultimate-arbitrage-hft",
    [string]$ApiKeysFile      = ".\api_keys.txt",
    [string]$MigrationFile    = ".\migrations\schema.sql",
    [string]$TelegramBotToken = "",
    [string]$WebhookSecret    = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Write-Step  { param([string]$m) Write-Host "`n--- $m ---" -ForegroundColor Cyan }
function Write-OK    { param([string]$m) Write-Host "  [OK] $m"   -ForegroundColor Green }
function Write-Warn  { param([string]$m) Write-Host "  [!!] $m"   -ForegroundColor Yellow }
function Write-Fail  {
    param([string]$m)
    Write-Host "  [ERR] $m" -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------------
# 0. Verify wrangler.toml
# ---------------------------------------------------------------------------
Write-Step "Verifying wrangler.toml"
if (-not (Test-Path ".\wrangler.toml")) {
    Write-Fail "wrangler.toml not found. Run this script from the project root."
}
$toml = Get-Content ".\wrangler.toml" -Raw
if ($toml -notmatch 'name\s*=\s*"ultimate-arbitrage-hft"') {
    Write-Fail "wrangler.toml does not declare name = `"ultimate-arbitrage-hft`". Fix it first."
}
Write-OK "wrangler.toml OK  (name=ultimate-arbitrage-hft)"

# ---------------------------------------------------------------------------
# 1. Check Node / npm
# ---------------------------------------------------------------------------
Write-Step "Checking prerequisites"
try {
    $nodeVer = & node --version 2>&1
    Write-OK "Node $nodeVer"
} catch {
    Write-Fail "Node.js not found. Install it from https://nodejs.org"
}
try {
    $npmVer = & npm --version 2>&1
    Write-OK "npm $npmVer"
} catch {
    Write-Fail "npm not found. Reinstall Node.js."
}

# ---------------------------------------------------------------------------
# 2. Cloudflare authentication
# ---------------------------------------------------------------------------
Write-Step "Checking Cloudflare authentication"
$whoami = & npx --yes wrangler@4 whoami 2>&1
if ($LASTEXITCODE -ne 0 -or ($whoami -join " ") -match "not authenticated") {
    Write-Warn "Not logged in to Cloudflare. Launching wrangler login..."
    & npx --yes wrangler@4 login
    if ($LASTEXITCODE -ne 0) { Write-Fail "wrangler login failed." }
}
Write-OK "Cloudflare auth OK"
Write-Host ($whoami | Out-String).Trim() -ForegroundColor DarkGray

# ---------------------------------------------------------------------------
# 3. npm install
# ---------------------------------------------------------------------------
Write-Step "Installing npm dependencies"
& npm install
if ($LASTEXITCODE -ne 0) { Write-Fail "npm install failed." }
Write-OK "Dependencies installed"

# ---------------------------------------------------------------------------
# 4. Upload secrets from api_keys.txt
# ---------------------------------------------------------------------------
Write-Step "Uploading secrets from $ApiKeysFile"
if (-not (Test-Path $ApiKeysFile)) {
    Write-Warn "api_keys.txt not found. Skipping secrets upload."
    Write-Warn "Create it from the template and fill in real values, then re-run."
} else {
    $uploaded = 0
    $skipped  = 0
    foreach ($rawLine in (Get-Content $ApiKeysFile)) {
        $line = $rawLine.Trim()
        # Skip blank lines, comments (#), and section headers ([SECTION])
        if (-not $line -or $line.StartsWith('#') -or $line.StartsWith('[')) { continue }

        $parts = $line -split '=', 2
        if ($parts.Count -ne 2) { continue }

        $key   = $parts[0].Trim()
        $value = $parts[1].Trim()

        # Skip template placeholder values
        if ($value -like 'YOUR_*') {
            Write-Warn "Skipping placeholder: $key"
            $skipped++
            continue
        }

        Write-Host "  Uploading: $key" -ForegroundColor DarkCyan
        $value | & npx --yes wrangler@4 secret put $key --name $WorkerName
        if ($LASTEXITCODE -ne 0) { Write-Fail "Failed to upload secret: $key" }
        $uploaded++
    }
    Write-OK "Secrets uploaded: $uploaded   Skipped (placeholder): $skipped"
}

# ---------------------------------------------------------------------------
# 5. Upload TELEGRAM_WEBHOOK_SECRET
# ---------------------------------------------------------------------------
Write-Step "Uploading TELEGRAM_WEBHOOK_SECRET"
if ($WebhookSecret -eq "") {
    $rng   = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $WebhookSecret = -join ($bytes | ForEach-Object { $_.ToString("x2") })
    Write-Warn "No -WebhookSecret supplied. Generated a random one (save it for reference):"
    Write-Host "  TELEGRAM_WEBHOOK_SECRET = $WebhookSecret" -ForegroundColor Yellow
}
$WebhookSecret | & npx --yes wrangler@4 secret put TELEGRAM_WEBHOOK_SECRET --name $WorkerName
if ($LASTEXITCODE -ne 0) { Write-Fail "Failed to upload TELEGRAM_WEBHOOK_SECRET." }
Write-OK "TELEGRAM_WEBHOOK_SECRET uploaded"

# ---------------------------------------------------------------------------
# 6. D1 database migration
# ---------------------------------------------------------------------------
Write-Step "Running D1 migration ($MigrationFile)"
if (-not (Test-Path $MigrationFile)) {
    Write-Fail "Migration file not found: $MigrationFile"
}
& npx --yes wrangler@4 d1 execute ultimate-arbitrage-db --file=$MigrationFile --remote
if ($LASTEXITCODE -ne 0) { Write-Fail "D1 migration failed." }
Write-OK "D1 migration applied"

# ---------------------------------------------------------------------------
# 7. Deploy worker
# ---------------------------------------------------------------------------
Write-Step "Deploying worker '$WorkerName'"
& npx --yes wrangler@4 deploy
if ($LASTEXITCODE -ne 0) { Write-Fail "wrangler deploy failed." }
Write-OK "Worker deployed"

# ---------------------------------------------------------------------------
# 8. Register Telegram webhook (optional)
# ---------------------------------------------------------------------------
Write-Step "Registering Telegram webhook"

# Resolve bot token: prefer -TelegramBotToken param, then api_keys.txt
if (($TelegramBotToken -eq "") -and (Test-Path $ApiKeysFile)) {
    $tokenLine = Get-Content $ApiKeysFile |
                 Where-Object { $_ -match '^TELEGRAM_BOT_TOKEN=' } |
                 Select-Object -First 1
    if ($tokenLine) {
        $TelegramBotToken = ($tokenLine -split '=', 2)[1].Trim()
    }
}

if (($TelegramBotToken -eq "") -or ($TelegramBotToken -like 'YOUR_*')) {
    Write-Warn "No real TELEGRAM_BOT_TOKEN found. Skipping webhook registration."
    Write-Host "  Register it manually with:" -ForegroundColor DarkGray
    $manualUrl = "https://api.telegram.org/bot<TOKEN>/setWebhook"
    $manualUrl += "?url=https://$WorkerName.zedanazad43.workers.dev/telegram/webhook"
    $manualUrl += "&secret_token=<YOUR_WEBHOOK_SECRET>"
    Write-Host "  $manualUrl" -ForegroundColor DarkGray
} else {
    $workerUrl  = "https://$WorkerName.zedanazad43.workers.dev/telegram/webhook"
    $apiUrl     = "https://api.telegram.org/bot$TelegramBotToken/setWebhook"

    $body = [ordered]@{
        url          = $workerUrl
        secret_token = $WebhookSecret
    } | ConvertTo-Json -Compress

    Write-Host "  Endpoint: $workerUrl" -ForegroundColor DarkCyan
    try {
        $resp = Invoke-RestMethod -Uri $apiUrl -Method Post -ContentType "application/json" -Body $body
        if ($resp.ok) {
            Write-OK "Telegram webhook registered: $($resp.description)"
        } else {
            Write-Warn "Telegram API response: $($resp | ConvertTo-Json -Compress)"
        }
    } catch {
        Write-Warn "Webhook registration request failed: $_"
    }
}

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "  DEPLOYMENT COMPLETE"                              -ForegroundColor Green
Write-Host "  Worker : https://$WorkerName.zedanazad43.workers.dev"  -ForegroundColor Green
Write-Host "  Tail   : npx wrangler tail --name $WorkerName"   -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
