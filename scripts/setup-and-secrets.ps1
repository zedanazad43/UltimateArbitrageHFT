#Requires -Version 5.1
<#
.SYNOPSIS
  UltimateArbitrageHFT - one-shot setup + secrets upload.
  Installs gh CLI and wrangler, authenticates both, then pushes
  every project secret to GitHub Actions AND the Cloudflare Worker.

.USAGE
  powershell -ExecutionPolicy Bypass -File .\scripts\setup-and-secrets.ps1
#>

$ErrorActionPreference = "Stop"
Set-Location "C:\Users\azadz\OneDrive\UltimateArbitrageHFT"

$Repo       = "zedanazad43/UltimateArbitrageHFT"
$WorkerName = "ultimatearbitragehft"

# ============================================================
# STEP 1 - Install tools
# ============================================================
Write-Host ""
Write-Host "[1/4] Checking tools..." -ForegroundColor Cyan

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "  Installing GitHub CLI via winget..." -ForegroundColor Yellow
    winget install --id GitHub.cli -e --accept-package-agreements --accept-source-agreements
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

# ============================================================
# STEP 2 - Authenticate GitHub CLI
# ============================================================
Write-Host ""
Write-Host "[2/4] GitHub authentication..." -ForegroundColor Cyan

$ghStatus = gh auth status 2>&1
if ($ghStatus -match "Logged in") {
    Write-Host "  Already logged in to GitHub." -ForegroundColor Green
} else {
    Write-Host "  Opening GitHub login (choose: GitHub.com > HTTPS > Browser)..." -ForegroundColor Yellow
    gh auth login
}

# ============================================================
# STEP 3 - Authenticate Cloudflare (wrangler)
# ============================================================
Write-Host ""
Write-Host "[3/4] Cloudflare authentication..." -ForegroundColor Cyan

$wrStatus = wrangler whoami 2>&1
if ($wrStatus -notmatch "You are not authenticated") {
    Write-Host "  Already logged in to Cloudflare." -ForegroundColor Green
} else {
    Write-Host "  Opening Cloudflare login in browser..." -ForegroundColor Yellow
    wrangler login
}

# ============================================================
# STEP 4 - Prompt and push every secret
# ============================================================
Write-Host ""
Write-Host "[4/4] Secret upload - press Enter to skip optional ones." -ForegroundColor Cyan

$SecretNames = @(
    "ADMIN_TOKEN",
    "ALLOWED_IPS",
    "WORKFLOW_ADMIN_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "MEXC_API_KEY",
    "MEXC_API_SECRET",
    "MEXC_API_KEY_2",
    "MEXC_API_SECRET_2",
    "BINANCE_API_KEY",
    "BINANCE_API_SECRET",
    "KUCOIN_API_KEY",
    "KUCOIN_SECRET_KEY",
    "KUCOIN_PASSPHRASE",
    "BITGET_API_KEY",
    "BITGET_SECRET_KEY",
    "BITGET_API_PASSPHRASE",
    "BITMART_API_KEY",
    "BITMART_SECRET_KEY",
    "BITMART_MEMO",
    "HTX_API_KEY",
    "HTX_API_SECRET",
    "BYBIT_API_KEY",
    "BYBIT_API_SECRET",
    "GATEIO_API_KEY",
    "GATEIO_API_SECRET",
    "HFT_ENGINE_SECRET",
    "TEMPORAL_API_KEY",
    "DEX_EXECUTOR_URL",
    "DEX_EXECUTOR_TOKEN",
    "PROXY_LIST",
    "EXTERNAL_PROXY_FALLBACK_USERNAME",
    "EXTERNAL_PROXY_FALLBACK_PASSWORD",
    "ALPHA_VANTAGE_API_KEY",
    "TWELVE_DATA_API_KEY",
    "BROKER_ALPACA_API_KEY",
    "BROKER_ALPACA_API_SECRET",
    "BROKER_IBKR_ACCOUNT_ID",
    "BROKER_IBKR_GATEWAY_URL",
    "BROKER_TRADIER_API_TOKEN",
    "BROKER_TRADIER_ACCOUNT_ID",
    "WALLET_PRIVATE_KEY",
    "FLASHBOTS_SIGNING_KEY",
    "ZEROX_API_KEY",
    "POSTGRES_DSN"
)

$saved   = [System.Collections.Generic.List[string]]::new()
$skipped = [System.Collections.Generic.List[string]]::new()
$failed  = [System.Collections.Generic.List[string]]::new()

foreach ($name in $SecretNames) {
    Write-Host ""
    Write-Host ("  " + $name) -ForegroundColor Yellow
    $secure = Read-Host -AsSecureString "  Value (blank = skip)"
    $bstr   = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        if ([string]::IsNullOrWhiteSpace($plain)) {
            $skipped.Add($name)
            Write-Host "  Skipped." -ForegroundColor DarkYellow
            continue
        }
        $plain | gh secret set $name --repo $Repo
        $plain | wrangler secret put $name --name $WorkerName
        $saved.Add($name)
        Write-Host "  Saved in GitHub + Cloudflare." -ForegroundColor Green
    } catch {
        $failed.Add($name)
        Write-Warning ("  Failed for " + $name + ": " + $_)
    } finally {
        if ($bstr -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
    }
}

# ============================================================
# Summary
# ============================================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Done!" -ForegroundColor Green
Write-Host ("  Repo   : " + $Repo)
Write-Host ("  Worker : " + $WorkerName)
Write-Host ("  Saved  : " + $saved.Count + "   Skipped: " + $skipped.Count + "   Failed: " + $failed.Count)

if ($failed.Count -gt 0) {
    Write-Host ""
    Write-Host "Failed secrets (retry manually):" -ForegroundColor Red
    foreach ($f in $failed) {
        Write-Host ("  " + $f) -ForegroundColor Red
    }
}
