<#
.SYNOPSIS
    Full deploy script for Ultimate Arbitrage HFT — Cloudflare Workers
.DESCRIPTION
    1. Verifies prerequisites (Node, wrangler auth)
    2. Installs npm dependencies
    3. Pushes all secrets from api_keys.txt to Cloudflare
    4. Pushes TELEGRAM_WEBHOOK_SECRET
    5. Runs D1 database migration
    6. Deploys the worker
    7. Registers the Telegram webhook URL with Telegram
#>

[CmdletBinding()]
param(
    [string]$WorkerName        = "ultimate-arbitrage-hft",
    [string]$ApiKeysFile       = ".\api_keys.txt",
    [string]$MigrationFile     = ".\migrations\schema.sql",
    # Set this to your real Telegram bot token if you want auto-webhook registration.
    # Otherwise leave blank and set it in api_keys.txt as TELEGRAM_BOT_TOKEN=...
    [string]$TelegramBotToken  = "",
    # Leave blank to skip webhook registration (you can do it later)
    [string]$WebhookSecret     = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ─── helpers ──────────────────────────────────────────────────────────────────
function Write-Step([string]$msg) {
    Write-Host "`n━━━ $msg ━━━" -ForegroundColor Cyan
}
function Write-OK([string]$msg) {
    Write-Host "  ✔ $msg" -ForegroundColor Green
}
function Write-Warn([string]$msg) {
    Write-Host "  ⚠ $msg" -ForegroundColor Yellow
}
function Write-Fail([string]$msg) {
    Write-Host "  ✖ $msg" -ForegroundColor Red
    exit 1
}

# ─── 0. Verify wrangler.toml points at the right worker ──────────────────────
Write-Step "Verifying wrangler.toml"
if (-not (Test-Path ".\wrangler.toml")) {
    Write-Fail "wrangler.toml not found — run this script from the project root."
}
$tomlContent = Get-Content ".\wrangler.toml" -Raw
if ($tomlContent -notmatch 'name\s*=\s*"ultimate-arbitrage-hft"') {
    Write-Fail "wrangler.toml does not declare name = `"ultimate-arbitrage-hft`". Fix it before deploying."
}
Write-OK "wrangler.toml looks correct (name=ultimate-arbitrage-hft)"

# ─── 1. Check Node / npm ──────────────────────────────────────────────────────
Write-Step "Checking prerequisites"
try   { $nodeVer = node --version 2>&1; Write-OK "Node $nodeVer" }
catch { Write-Fail "Node.js not found. Install from https://nodejs.org" }

try   { $npmVer = npm --version 2>&1; Write-OK "npm $npmVer" }
catch { Write-Fail "npm not found — reinstall Node.js." }

# ─── 2. Check wrangler authentication ────────────────────────────────────────
Write-Step "Checking Cloudflare authentication"
$whoami = npx --yes wrangler@4 whoami 2>&1
if ($LASTEXITCODE -ne 0 -or $whoami -match "not authenticated") {
    Write-Warn "Not logged in to Cloudflare. Launching 'wrangler login'..."
    npx --yes wrangler@4 login
    if ($LASTEXITCODE -ne 0) { Write-Fail "wrangler login failed." }
}
Write-OK "Cloudflare auth OK"
Write-Host ($whoami | Out-String).Trim() -ForegroundColor DarkGray

# ─── 3. Install npm dependencies ─────────────────────────────────────────────
Write-Step "Installing npm dependencies"
npm install
if ($LASTEXITCODE -ne 0) { Write-Fail "npm install failed." }
Write-OK "Dependencies installed"

# ─── 4. Push secrets from api_keys.txt ───────────────────────────────────────
Write-Step "Uploading secrets from $ApiKeysFile"
if (-not (Test-Path $ApiKeysFile)) {
    Write-Warn "api_keys.txt not found — skipping secrets upload. Create it from the template and fill in real values."
} else {
    $lines = Get-Content $ApiKeysFile
    $uploaded = 0
    $skipped  = 0

    foreach ($line in $lines) {
        $line = $line.Trim()

        # Skip blank lines, comments, and section headers like [MEXC]
        if (-not $line -or $line.StartsWith('#') -or $line.StartsWith('[')) { continue }

        $parts = $line -split '=', 2
        if ($parts.Count -ne 2) { continue }

        $key   = $parts[0].Trim()
        $value = $parts[1].Trim()

        # Skip placeholder values
        if ($value -like 'YOUR_*') {
            Write-Warn "Skipping placeholder: $key"
            $skipped++
            continue
        }

        Write-Host "  Uploading secret: $key" -ForegroundColor DarkCyan
        $value | npx --yes wrangler@4 secret put $key --name $WorkerName
        if ($LASTEXITCODE -ne 0) { Write-Fail "Failed to upload secret $key" }
        $uploaded++
    }

    Write-OK "Secrets uploaded: $uploaded  |  Skipped (placeholder): $skipped"
}

# ─── 5. Push TELEGRAM_WEBHOOK_SECRET ─────────────────────────────────────────
Write-Step "Uploading TELEGRAM_WEBHOOK_SECRET"
if ($WebhookSecret -eq "") {
    # Auto-generate a secure random 32-char hex secret if not provided
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $WebhookSecret = -join ($bytes | ForEach-Object { $_.ToString("x2") })
    Write-Warn "No WebhookSecret supplied — generated a random one (save it if needed):"
    Write-Host "  TELEGRAM_WEBHOOK_SECRET = $WebhookSecret" -ForegroundColor Yellow
}
$WebhookSecret | npx --yes wrangler@4 secret put TELEGRAM_WEBHOOK_SECRET --name $WorkerName
if ($LASTEXITCODE -ne 0) { Write-Fail "Failed to upload TELEGRAM_WEBHOOK_SECRET" }
Write-OK "TELEGRAM_WEBHOOK_SECRET uploaded"

# ─── 6. D1 database migration ────────────────────────────────────────────────
Write-Step "Running D1 migration ($MigrationFile)"
if (-not (Test-Path $MigrationFile)) {
    Write-Fail "Migration file not found: $MigrationFile"
}
npx --yes wrangler@4 d1 execute ultimate-arbitrage-db --file=$MigrationFile --remote
if ($LASTEXITCODE -ne 0) { Write-Fail "D1 migration failed." }
Write-OK "D1 migration applied"

# ─── 7. Deploy the worker ─────────────────────────────────────────────────────
Write-Step "Deploying worker '$WorkerName'"
npx --yes wrangler@4 deploy
if ($LASTEXITCODE -ne 0) { Write-Fail "wrangler deploy failed." }
Write-OK "Worker deployed successfully"

# ─── 8. Register Telegram webhook (optional) ─────────────────────────────────
Write-Step "Registering Telegram webhook"

# Resolve bot token (prefer param, fall back to api_keys.txt)
if ($TelegramBotToken -eq "" -and (Test-Path $ApiKeysFile)) {
    $tokenLine = Get-Content $ApiKeysFile | Where-Object { $_ -match '^TELEGRAM_BOT_TOKEN=' }
    if ($tokenLine) {
        $TelegramBotToken = ($tokenLine -split '=', 2)[1].Trim()
    }
}

if ($TelegramBotToken -eq "" -or $TelegramBotToken -like 'YOUR_*') {
    Write-Warn "No real TELEGRAM_BOT_TOKEN found — skipping webhook registration."
    Write-Host "  Register manually later:" -ForegroundColor DarkGray
    Write-Host "  https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://$WorkerName.zedanazad43.workers.dev/telegram/webhook&secret_token=<WEBHOOK_SECRET>" -ForegroundColor DarkGray
} else {
    $workerUrl  = "https://$WorkerName.zedanazad43.workers.dev/telegram/webhook"
    $setWebhook = "https://api.telegram.org/bot${TelegramBotToken}/setWebhook"

    $body = @{
        url          = $workerUrl
        secret_token = $WebhookSecret
    } | ConvertTo-Json

    Write-Host "  Registering: $workerUrl" -ForegroundColor DarkCyan
    $resp = Invoke-RestMethod -Uri $setWebhook -Method Post `
        -ContentType "application/json" -Body $body
    if ($resp.ok) {
        Write-OK "Telegram webhook registered: $($resp.description)"
    } else {
        Write-Warn "Webhook registration returned: $($resp | ConvertTo-Json -Compress)"
    }
}

# ─── Done ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  ✅  DEPLOYMENT COMPLETE" -ForegroundColor Green
Write-Host "  Worker URL : https://$WorkerName.zedanazad43.workers.dev" -ForegroundColor Green
Write-Host "  Dashboard  : https://$WorkerName.zedanazad43.workers.dev/" -ForegroundColor Green
Write-Host "  Tail logs  : npx wrangler tail --name $WorkerName" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Green