#Requires -Version 7.0
<#
.SYNOPSIS
    Master deployment script — activates the Control Center and Telegram bot,
    uploads all secrets, and starts live trading.

.DESCRIPTION
    Runs the full activation sequence in order:
      1. Deploy the Cloudflare Worker (wrangler deploy)
      2. Upload ADMIN_TOKEN secret
      3. Upload MEXC API keys
      4. Upload Telegram secrets (bot token + chat ID)
      5. Apply D1 database migrations
      6. Register Telegram webhook
      7. Switch trading mode to LIVE
      8. Start the trading bot

    All values are resolved from (highest to lowest priority):
      • Named parameters passed on the command line
      • Environment variables
      • UltimateArbitrageBot/.dev.vars file
      • Interactive prompt (unless -NoPrompt or CI environment is detected)

.PARAMETER WorkerDir
    Path to the UltimateArbitrageBot directory. Defaults to the UltimateArbitrageBot
    subfolder next to this script.

.PARAMETER AdminToken
    Cloudflare Worker ADMIN_TOKEN. Generated automatically if blank.

.PARAMETER MexcApiKey
    MEXC exchange API key.

.PARAMETER MexcApiSecret
    MEXC exchange API secret.

.PARAMETER TelegramBotToken
    Telegram bot token from @BotFather.

.PARAMETER TelegramChatId
    Primary Telegram chat ID for notifications.

.PARAMETER AlchemyApiKey
    Alchemy API key (optional — only needed for DEX price feeds).

.PARAMETER DexWalletAddress
    DEX/Metamask wallet address (optional).

.PARAMETER WebhookUrl
    Telegram webhook URL. Defaults to the deployed worker URL.

.PARAMETER SkipDeploy
    Skip the wrangler deploy step (use if the worker is already deployed).

.PARAMETER SkipMigrations
    Skip the D1 migration step.

.PARAMETER SkipWebhook
    Skip Telegram webhook registration.

.PARAMETER PaperMode
    Activate paper/simulation mode instead of live trading.

.PARAMETER NoPrompt
    Suppress all interactive prompts (for CI/automation).

.EXAMPLE
    # Full interactive setup from scratch
    .\Deploy-All.ps1

.EXAMPLE
    # Fully scripted (CI-style), supplying all secrets
    .\Deploy-All.ps1 `
        -MexcApiKey "mx0vg..." -MexcApiSecret "abc..." `
        -TelegramBotToken "7654321:AAx..." -TelegramChatId "111111" `
        -AdminToken "your_token" -NoPrompt

.EXAMPLE
    # Skip deploy (worker already live), just re-configure and restart
    .\Deploy-All.ps1 -SkipDeploy -NoPrompt
#>
param(
    [string]$WorkerDir          = '',
    [string]$AdminToken         = '',
    [string]$MexcApiKey         = '',
    [string]$MexcApiSecret      = '',
    [string]$TelegramBotToken   = '',
    [string]$TelegramChatId     = '',
    [string]$AlchemyApiKey      = '',
    [string]$DexWalletAddress   = '',
    [string]$WebhookUrl         = '',
    [switch]$SkipDeploy,
    [switch]$SkipMigrations,
    [switch]$SkipWebhook,
    [switch]$PaperMode,
    [switch]$NoPrompt
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Helpers ───────────────────────────────────────────────────────────────────

function Write-Step {
    param([string]$Number, [string]$Title)
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host "  [$Number] $Title" -ForegroundColor Cyan
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
}

function Write-OK   { param([string]$Msg) Write-Host "  ✅ $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "  ⚠️  $Msg" -ForegroundColor Yellow }
function Write-Fail { param([string]$Msg) Write-Host "  ❌ $Msg" -ForegroundColor Red }

function Read-DevVars {
    param([string]$Path)
    $vals = @{}
    if (-not (Test-Path $Path)) { return $vals }
    foreach ($line in (Get-Content -Path $Path)) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) { continue }
        $parts = $line -split '=', 2
        if ($parts.Count -ne 2) { continue }
        $vals[$parts[0].Trim()] = $parts[1].Trim().Trim('"').Trim("'")
    }
    return $vals
}

function Resolve-Param {
    param([string]$Name, [string]$Explicit, [hashtable]$DevVars, [string]$Prompt, [switch]$Sensitive, [switch]$Optional)
    if (-not [string]::IsNullOrWhiteSpace($Explicit)) { return $Explicit }
    $env = [Environment]::GetEnvironmentVariable($Name)
    if (-not [string]::IsNullOrWhiteSpace($env)) { return $env }
    if ($DevVars.ContainsKey($Name) -and -not [string]::IsNullOrWhiteSpace($DevVars[$Name])) { return $DevVars[$Name] }
    if ($isNonInteractive -or $NoPrompt) {
        if ($Optional) { return '' }
        throw "$Name is required but not set. Pass -$Name or set $Name in the environment / .dev.vars."
    }
    if ($Sensitive) { return Read-Host -AsSecureString $Prompt | ForEach-Object { [System.Net.NetworkCredential]::new('', $_).Password } }
    return Read-Host $Prompt
}

function Test-IsCI {
    if ($env:CI -match '^(1|true)$') { return $true }
    if ($env:GITHUB_ACTIONS -match '^(1|true)$') { return $true }
    if ($env:TF_BUILD -match '^(1|true)$') { return $true }
    try {
        if ([Console]::IsInputRedirected) { return $true }
    } catch {}
    return $false
}

# ── Bootstrap ─────────────────────────────────────────────────────────────────

$scriptRoot    = $PSScriptRoot
$isNonInteractive = $NoPrompt -or (Test-IsCI)

if ([string]::IsNullOrWhiteSpace($WorkerDir)) {
    $WorkerDir = Join-Path $scriptRoot 'UltimateArbitrageBot'
}

if (-not (Test-Path $WorkerDir)) {
    throw "UltimateArbitrageBot directory not found at: $WorkerDir`nClone the repo and run this script from the repo root."
}

$scriptsDir   = Join-Path $WorkerDir 'scripts'
$wranglerToml = Join-Path $WorkerDir 'wrangler.toml'
$devVarsPath  = Join-Path $WorkerDir '.dev.vars'
$devVars      = Read-DevVars -Path $devVarsPath
$workerUrl    = 'https://ultimate-arbitrage-hft.zedanazad43.workers.dev'

# ── Banner ────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║   ULTIMATE ARBITRAGE BOT — Full Activation Script   ║" -ForegroundColor Magenta
Write-Host "║   Control Center + Telegram Bot + Live Trading       ║" -ForegroundColor Magenta
Write-Host "╚══════════════════════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""
Write-Host "  Worker directory : $WorkerDir" -ForegroundColor White
Write-Host "  Worker URL       : $workerUrl"  -ForegroundColor White
Write-Host "  Mode             : $(if ($PaperMode) { 'PAPER (simulation)' } else { 'LIVE (real trades)' })" `
    -ForegroundColor $(if ($PaperMode) { 'Yellow' } else { 'Red' })
Write-Host ""

if (-not $PaperMode -and -not $isNonInteractive) {
    Write-Host "  ⚠️  You are about to enable LIVE trading with REAL money." -ForegroundColor Red
    Write-Host "     Ensure your MEXC API keys, risk limits, and capital are correct." -ForegroundColor Yellow
    Write-Host ""
    $confirm = Read-Host "  Type 'yes' to proceed with live trading setup"
    if ($confirm.Trim().ToLower() -ne 'yes') {
        Write-Warn "Cancelled by user."
        exit 0
    }
}

# ── Collect secrets ───────────────────────────────────────────────────────────

Write-Step '0' 'Collecting configuration'

$resolvedAdminToken  = Resolve-Param -Name 'ADMIN_TOKEN'       -Explicit $AdminToken       -DevVars $devVars `
    -Prompt 'Enter ADMIN_TOKEN (or press Enter to auto-generate)' -Optional
$resolvedMexcKey     = Resolve-Param -Name 'MEXC_API_KEY'      -Explicit $MexcApiKey       -DevVars $devVars `
    -Prompt 'Enter MEXC_API_KEY' -Sensitive
$resolvedMexcSecret  = Resolve-Param -Name 'MEXC_API_SECRET'   -Explicit $MexcApiSecret    -DevVars $devVars `
    -Prompt 'Enter MEXC_API_SECRET' -Sensitive
$resolvedBotToken    = Resolve-Param -Name 'TELEGRAM_BOT_TOKEN' -Explicit $TelegramBotToken -DevVars $devVars `
    -Prompt 'Enter TELEGRAM_BOT_TOKEN'
$resolvedChatId      = Resolve-Param -Name 'TELEGRAM_CHAT_ID'   -Explicit $TelegramChatId   -DevVars $devVars `
    -Prompt 'Enter TELEGRAM_CHAT_ID'
$resolvedAlchemy     = Resolve-Param -Name 'ALCHEMY_API_KEY'    -Explicit $AlchemyApiKey    -DevVars $devVars `
    -Prompt 'Enter ALCHEMY_API_KEY (optional — press Enter to skip)' -Optional
$resolvedDexWallet   = Resolve-Param -Name 'DEX_WALLET_ADDRESS' -Explicit $DexWalletAddress -DevVars $devVars `
    -Prompt 'Enter DEX_WALLET_ADDRESS (optional — press Enter to skip)' -Optional

# Auto-generate ADMIN_TOKEN if not provided
if ([string]::IsNullOrWhiteSpace($resolvedAdminToken)) {
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $resolvedAdminToken = [Convert]::ToHexString($bytes).ToLowerInvariant()
    $tokenPreview = $resolvedAdminToken.Substring(0, 8) + '…'
    Write-OK "Auto-generated ADMIN_TOKEN (preview: $tokenPreview)"
    Write-Warn "Full token written only to final summary. Store it securely — do not share terminal output."
}

# Validate required secrets
$missingSecrets = @()
if ([string]::IsNullOrWhiteSpace($resolvedMexcKey))    { $missingSecrets += 'MEXC_API_KEY' }
if ([string]::IsNullOrWhiteSpace($resolvedMexcSecret)) { $missingSecrets += 'MEXC_API_SECRET' }
if ([string]::IsNullOrWhiteSpace($resolvedBotToken))   { $missingSecrets += 'TELEGRAM_BOT_TOKEN' }
if ([string]::IsNullOrWhiteSpace($resolvedChatId))     { $missingSecrets += 'TELEGRAM_CHAT_ID' }

if ($missingSecrets.Count -gt 0) {
    throw "Required secrets not provided: $($missingSecrets -join ', ')`nSet them in UltimateArbitrageBot/.dev.vars or pass them as parameters."
}
Write-OK "All required secrets collected."

# ── Step 1 — Deploy worker ────────────────────────────────────────────────────

if ($SkipDeploy) {
    Write-Step '1' 'Deploy Worker (SKIPPED)'
    Write-Warn "SkipDeploy flag set — using existing deployed worker."
} else {
    Write-Step '1' 'Deploy Cloudflare Worker'
    $prevLocation = Get-Location
    try {
        Set-Location $WorkerDir
        Write-Host "  Running: npx wrangler deploy" -ForegroundColor White
        npx wrangler deploy
        Write-OK "Worker deployed to: $workerUrl"
    } finally {
        Set-Location $prevLocation
    }
}

# ── Step 2 — Upload ADMIN_TOKEN ───────────────────────────────────────────────

Write-Step '2' 'Upload ADMIN_TOKEN secret'
try {
    $prevLocation = Get-Location
    Set-Location $WorkerDir
    $resolvedAdminToken | npx wrangler secret put ADMIN_TOKEN
    Write-OK "ADMIN_TOKEN uploaded."
} catch {
    Write-Fail "Failed to upload ADMIN_TOKEN: $($_.Exception.Message)"
    throw
} finally {
    Set-Location $prevLocation
}

# ── Step 3 — Upload MEXC secrets ─────────────────────────────────────────────

Write-Step '3' 'Upload MEXC API secrets'
try {
    $prevLocation = Get-Location
    Set-Location $WorkerDir
    $resolvedMexcKey    | npx wrangler secret put MEXC_API_KEY
    $resolvedMexcSecret | npx wrangler secret put MEXC_API_SECRET
    Write-OK "MEXC secrets uploaded."
} catch {
    Write-Fail "Failed to upload MEXC secrets: $($_.Exception.Message)"
    throw
} finally {
    Set-Location $prevLocation
}

# ── Step 4 — Upload Telegram secrets ─────────────────────────────────────────

Write-Step '4' 'Upload Telegram secrets'
try {
    $prevLocation = Get-Location
    Set-Location $WorkerDir
    $resolvedBotToken | npx wrangler secret put TELEGRAM_BOT_TOKEN
    $resolvedChatId   | npx wrangler secret put TELEGRAM_CHAT_ID
    Write-OK "Telegram secrets uploaded."
} catch {
    Write-Fail "Failed to upload Telegram secrets: $($_.Exception.Message)"
    throw
} finally {
    Set-Location $prevLocation
}

# ── Step 5 — Upload optional secrets ─────────────────────────────────────────

Write-Step '5' 'Upload optional secrets (Alchemy, DEX wallet)'
$prevLocation = Get-Location
Set-Location $WorkerDir
try {
    if (-not [string]::IsNullOrWhiteSpace($resolvedAlchemy)) {
        $resolvedAlchemy | npx wrangler secret put ALCHEMY_API_KEY
        Write-OK "ALCHEMY_API_KEY uploaded."
    } else {
        Write-Warn "ALCHEMY_API_KEY not provided — DEX price feeds via Alchemy will be unavailable."
    }
    if (-not [string]::IsNullOrWhiteSpace($resolvedDexWallet)) {
        $resolvedDexWallet | npx wrangler secret put DEX_WALLET_ADDRESS
        Write-OK "DEX_WALLET_ADDRESS uploaded."
    } else {
        Write-Warn "DEX_WALLET_ADDRESS not provided — on-chain DEX trading will be skipped."
    }
} finally {
    Set-Location $prevLocation
}

# ── Step 6 — D1 migrations ────────────────────────────────────────────────────

if ($SkipMigrations) {
    Write-Step '6' 'D1 Migrations (SKIPPED)'
    Write-Warn "SkipMigrations flag set."
} else {
    Write-Step '6' 'Apply D1 database migrations'
    $prevLocation = Get-Location
    try {
        Set-Location $WorkerDir
        Write-Host "  Running: wrangler d1 migrations apply ultimate-arbitrage-db --remote" -ForegroundColor White
        npx wrangler d1 migrations apply ultimate-arbitrage-db --remote
        Write-OK "D1 migrations applied."
    } catch {
        Write-Warn "D1 migration failed (may be already up to date): $($_.Exception.Message)"
    } finally {
        Set-Location $prevLocation
    }
}

# ── Step 7 — Register Telegram webhook ───────────────────────────────────────

if ($SkipWebhook) {
    Write-Step '7' 'Telegram Webhook (SKIPPED)'
    Write-Warn "SkipWebhook flag set."
} else {
    Write-Step '7' 'Register Telegram webhook'
    $webhookTarget = if ($WebhookUrl) { $WebhookUrl } else { "$workerUrl/telegram/webhook" }
    try {
        $body = @{ url = $webhookTarget; drop_pending_updates = $true }
        $resp = Invoke-RestMethod -Method Post `
            -Uri "https://api.telegram.org/bot${resolvedBotToken}/setWebhook" `
            -Body $body
        if ($resp.ok) {
            Write-OK "Telegram webhook registered: $webhookTarget"
        } else {
            Write-Warn "Telegram webhook registration returned ok=false: $($resp | ConvertTo-Json)"
        }
    } catch {
        Write-Warn "Telegram webhook registration failed (non-fatal): $($_.Exception.Message)"
    }
}

# ── Step 8 — Wait for worker to propagate ────────────────────────────────────

Write-Step '8' 'Waiting for worker to be reachable'
$maxAttempts = 12
$attempt = 0
$reachable = $false
while ($attempt -lt $maxAttempts -and -not $reachable) {
    $attempt++
    Write-Host "  Attempt $attempt/$maxAttempts — checking $workerUrl/health ..." -ForegroundColor White
    try {
        $resp = Invoke-RestMethod -Method Get -Uri "$workerUrl/health" -TimeoutSec 10
        if ($resp.status -eq 'ok') {
            $reachable = $true
            Write-OK "Worker is reachable. Status: trading_enabled=$($resp.trading_enabled), paper_trading=$($resp.paper_trading)"
        }
    } catch {
        if ($attempt -lt $maxAttempts) { Start-Sleep -Seconds 5 }
    }
}
if (-not $reachable) {
    Write-Warn "Worker did not respond within the timeout. Proceeding anyway — it may still be propagating."
}

# ── Step 9 — Set trading mode ────────────────────────────────────────────────

Write-Step '9' "Set trading mode to $(if ($PaperMode) { 'PAPER' } else { 'LIVE' })"
$modeEndpoint = if ($PaperMode) { "$workerUrl/mode/paper" } else { "$workerUrl/mode/live" }
try {
    $modeResp = Invoke-WebRequest -UseBasicParsing -Method Get -Uri $modeEndpoint `
        -Headers @{ 'x-admin-token' = $resolvedAdminToken } -TimeoutSec 15
    Write-OK "Trading mode set. Response: $($modeResp.Content)"
} catch {
    $details = $_.Exception.Message
    if ($_.ErrorDetails -and -not [string]::IsNullOrWhiteSpace($_.ErrorDetails.Message)) {
        $details = $_.ErrorDetails.Message
    }
    Write-Warn "Mode switch failed (non-fatal — may need to retry after propagation): $details"
}

# ── Step 10 — Start trading ───────────────────────────────────────────────────

Write-Step '10' 'Start the trading bot'
try {
    $startResp = Invoke-WebRequest -UseBasicParsing -Method Get -Uri "$workerUrl/start" `
        -Headers @{ 'x-admin-token' = $resolvedAdminToken } -TimeoutSec 15
    Write-OK "Trading started. Response: $($startResp.Content)"
} catch {
    $details = $_.Exception.Message
    if ($_.ErrorDetails -and -not [string]::IsNullOrWhiteSpace($_.ErrorDetails.Message)) {
        $details = $_.ErrorDetails.Message
    }
    Write-Warn "Start command failed: $details"
    Write-Warn "You can start manually: Invoke-WebRequest -Method Get -Uri '$workerUrl/start' -Headers @{'x-admin-token'='$resolvedAdminToken'}"
}

# ── Final status ──────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║           ✅  ACTIVATION COMPLETE                   ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  🌐 Control Center Dashboard  : $workerUrl" -ForegroundColor White
Write-Host "  📊 Status API               : $workerUrl/health" -ForegroundColor White
Write-Host "  🤖 Telegram Bot              : configured" -ForegroundColor White
$tokenPreview = $resolvedAdminToken.Substring(0, 8) + '…'
Write-Host "  🔑 ADMIN_TOKEN (first 8)     : $tokenPreview" -ForegroundColor Yellow
Write-Host "     Store the full token somewhere safe (password manager / secret store)." -ForegroundColor DarkYellow
Write-Host ""
Write-Host "  Quick commands:" -ForegroundColor Cyan
Write-Host "    Check status  : cd UltimateArbitrageBot && npm run bot:status" -ForegroundColor White
Write-Host "    Stop trading  : cd UltimateArbitrageBot && npm run bot:stop" -ForegroundColor White
Write-Host "    Force scan    : cd UltimateArbitrageBot && npm run bot:scan" -ForegroundColor White
Write-Host "    Paper mode    : cd UltimateArbitrageBot && npm run bot:mode:paper" -ForegroundColor White
Write-Host ""
Write-Host "  ⚠️  Keep your ADMIN_TOKEN safe — it controls all protected endpoints." -ForegroundColor Yellow
