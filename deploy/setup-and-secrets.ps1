#Requires -Version 5.1
<#
.SYNOPSIS
  UltimateArbitrageHFT – one-shot setup + secrets upload
  Installs gh CLI & wrangler, authenticates both, then pushes
  every project secret to GitHub Actions AND the Cloudflare Worker.

.USAGE
  powershell -ExecutionPolicy Bypass -File .\setup-and-secrets.ps1
#>

$ErrorActionPreference = "Stop"
Set-Location "C:\Users\azadz\OneDrive\UltimateArbitrageHFT"

$Repo       = "zedanazad43/UltimateArbitrageHFT"
$WorkerName = "ultimatearbitragehft"     # from wrangler.toml

# ════════════════════════════════════════════════════════════
# STEP 1 — Install tools (skip if already present)
# ════════════════════════════════════════════════════════════
Write-Host "`n[1/4] Checking tools..." -ForegroundColor Cyan

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "  Installing GitHub CLI via winget..." -ForegroundColor Yellow
    winget install --id GitHub.cli -e --accept-package-agreements --accept-source-agreements
    # Reload PATH
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH","User")
} else {
    Write-Host "  gh CLI already installed." -ForegroundColor Green
}

if (-not (Get-Command wrangler -ErrorAction SilentlyContinue)) {
    Write-Host "  Installing wrangler via npm..." -ForegroundColor Yellow
    npm install -g wrangler
} else {
    Write-Host "  wrangler already installed." -ForegroundColor Green
}

# ════════════════════════════════════════════════════════════
# STEP 2 — Authenticate GitHub CLI
# ════════════════════════════════════════════════════════════
Write-Host "`n[2/4] GitHub authentication..." -ForegroundColor Cyan

$ghStatus = gh auth status 2>&1
if ($ghStatus -match "Logged in") {
    Write-Host "  Already logged in to GitHub." -ForegroundColor Green
} else {
    Write-Host "  Opening GitHub login (choose: GitHub.com → HTTPS → Browser)..." -ForegroundColor Yellow
    gh auth login
}

# ════════════════════════════════════════════════════════════
# STEP 3 — Authenticate Cloudflare (wrangler)
# ════════════════════════════════════════════════════════════
Write-Host "`n[3/4] Cloudflare authentication..." -ForegroundColor Cyan

$wrStatus = wrangler whoami 2>&1
if ($wrStatus -notmatch "You are not authenticated") {
    Write-Host "  Already logged in to Cloudflare." -ForegroundColor Green
} else {
    Write-Host "  Opening Cloudflare login in browser..." -ForegroundColor Yellow
    wrangler login
}

# ════════════════════════════════════════════════════════════
# STEP 4 — Prompt & push every secret
# ════════════════════════════════════════════════════════════
Write-Host "`n[4/4] Secret upload — press Enter to skip optional ones." -ForegroundColor Cyan

$Secrets = [ordered]@{
  # Admin & security
  "ADMIN_TOKEN"                      = "[REQUIRED] Protects /start /stop /scan admin routes"
  "ALLOWED_IPS"                      = "[optional] CSV of IPs allowed for admin routes"
  "WORKFLOW_ADMIN_TOKEN"             = "[optional] Temporal workflow admin token"
  "TELEGRAM_WEBHOOK_SECRET"          = "[optional] Telegram webhook secret"
  # Telegram
  "TELEGRAM_BOT_TOKEN"               = "[optional] Telegram bot token"
  "TELEGRAM_CHAT_ID"                 = "[optional] Telegram chat/channel ID"
  # Exchange credentials
  "MEXC_API_KEY"                     = "MEXC primary key"
  "MEXC_API_SECRET"                  = "MEXC primary secret"
  "MEXC_API_KEY_2"                   = "[optional] MEXC backup key"
  "MEXC_API_SECRET_2"                = "[optional] MEXC backup secret"
  "BINANCE_API_KEY"                  = "Binance API key"
  "BINANCE_API_SECRET"               = "Binance API secret"
  "KUCOIN_API_KEY"                   = "KuCoin key"
  "KUCOIN_SECRET_KEY"                = "KuCoin secret"
  "KUCOIN_PASSPHRASE"                = "KuCoin passphrase"
  "BITGET_API_KEY"                   = "Bitget key"
  "BITGET_SECRET_KEY"                = "Bitget secret"
  "BITGET_API_PASSPHRASE"            = "Bitget passphrase"
  "BITMART_API_KEY"                  = "Bitmart key"
  "BITMART_SECRET_KEY"               = "Bitmart secret"
  "BITMART_MEMO"                     = "Bitmart memo"
  "HTX_API_KEY"                      = "HTX/Huobi key"
  "HTX_API_SECRET"                   = "HTX/Huobi secret"
  "BYBIT_API_KEY"                    = "Bybit key (data-only)"
  "BYBIT_API_SECRET"                 = "Bybit secret (data-only)"
  "GATEIO_API_KEY"                   = "Gate.io key (data-only)"
  "GATEIO_API_SECRET"                = "Gate.io secret (data-only)"
  # HFT engine
  "HFT_ENGINE_SECRET"                = "Shared auth token — Worker ↔ Go engine"
  # Temporal Cloud
  "TEMPORAL_API_KEY"                 = "Temporal Cloud API key"
  # DEX / on-chain
  "DEX_EXECUTOR_URL"                 = "[optional] Remote DEX executor URL"
  "DEX_EXECUTOR_TOKEN"               = "[optional] DEX executor auth token"
  # Proxy (secret variants)
  "PROXY_LIST"                       = '[optional] JSON e.g. [{"url":"...","type":"http","priority":0}]'
  "EXTERNAL_PROXY_FALLBACK_USERNAME" = "[optional] Paid proxy provider username"
  "EXTERNAL_PROXY_FALLBACK_PASSWORD" = "[optional] Paid proxy provider password"
  # Free data providers
  "ALPHA_VANTAGE_API_KEY"            = "[optional] Alpha Vantage key"
  "TWELVE_DATA_API_KEY"              = "[optional] Twelve Data key"
  # Broker adapters
  "BROKER_ALPACA_API_KEY"            = "[optional] Alpaca key"
  "BROKER_ALPACA_API_SECRET"         = "[optional] Alpaca secret"
  "BROKER_IBKR_ACCOUNT_ID"          = "[optional] IBKR account ID"
  "BROKER_IBKR_GATEWAY_URL"         = "[optional] IBKR gateway URL"
  "BROKER_TRADIER_API_TOKEN"        = "[optional] Tradier token"
  "BROKER_TRADIER_ACCOUNT_ID"       = "[optional] Tradier account ID"
  # Go engine extras
  "WALLET_PRIVATE_KEY"               = "[optional] EVM wallet private key (no 0x prefix)"
  "FLASHBOTS_SIGNING_KEY"            = "[optional] Flashbots bundle signing key"
  "ZEROX_API_KEY"                    = "[optional] 0x Protocol API key"
  "POSTGRES_DSN"                     = "[optional] PostgreSQL DSN for Go engine"
}

$saved   = @()
$skipped = @()
$failed  = @()

foreach ($entry in $Secrets.GetEnumerator()) {
    $name = $entry.Key
    $hint = $entry.Value

    Write-Host "`n  $name" -ForegroundColor Yellow -NoNewline
    Write-Host " — $hint" -ForegroundColor DarkGray
    $secure = Read-Host -AsSecureString "  Value (blank = skip)"
    $bstr   = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        if ([string]::IsNullOrWhiteSpace($plain)) {
            $skipped += $name
            Write-Host "  ↷ Skipped." -ForegroundColor DarkYellow
            continue
        }
        # Push to GitHub Actions
        $plain | gh secret set $name --repo $Repo
        # Push to Cloudflare Worker
        $plain | wrangler secret put $name --name $WorkerName
        $saved += $name
        Write-Host "  ✔ Saved in GitHub + Cloudflare." -ForegroundColor Green
    }
    catch {
        $failed += $name
        Write-Warning "  ✘ Failed for ${name}: $_"
    }
    finally {
        if ($bstr -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
    }
}

# ════════════════════════════════════════════════════════════
# Summary
# ════════════════════════════════════════════════════════════
Write-Host "`n════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "Done!" -ForegroundColor Green
Write-Host "  Repo   : $Repo"
Write-Host "  Worker : $WorkerName"
Write-Host "  Saved  : $($saved.Count)   Skipped: $($skipped.Count)   Failed: $($failed.Count)"

if ($failed.Count -gt 0) {
    Write-Host "`nFailed secrets (retry manually):" -ForegroundColor Red
    $failed | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
}