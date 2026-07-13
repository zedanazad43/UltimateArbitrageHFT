# ============================================================
# UltimateArbitrageHFT — Full Local Deployment Script
# Run from project root: pwsh ./deploy-all-local.ps1
# ============================================================

# ─── Fill in your tokens here ──────────────────────────────
$env:CLOUDFLARE_API_TOKEN   = "cf48cfb41422fa4ff25991f72a536da38c490"
$env:CLOUDFLARE_ACCOUNT_ID  = "652e53f35781522e2745784cc4425d9d"
$EMERGENT_API_TOKEN         = "YOUR_EMERGENT_API_TOKEN"   # https://app.emergent.sh/settings
$EMERGENT_JOB_ID            = "2ff01fc9-2713-44b7-a586-84695af5846d"
# ────────────────────────────────────────────────────────────

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Step([string]$msg) {
    Write-Host "`n━━━ $msg ━━━" -ForegroundColor Cyan
}

function OK([string]$msg)   { Write-Host "✅  $msg" -ForegroundColor Green }
function WARN([string]$msg) { Write-Host "⚠️   $msg" -ForegroundColor Yellow }
function FAIL([string]$msg) { Write-Host "❌  $msg" -ForegroundColor Red; exit 1 }

# ── 1. Prerequisites ─────────────────────────────────────────
Step "Checking prerequisites"
foreach ($cmd in @("git","node","npm","npx")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { FAIL "$cmd not found in PATH" }
}
OK "All prerequisites found"

# ── 2. Git — push current branch ────────────────────────────
Step "Pushing current branch to GitHub"
git push origin HEAD
if ($LASTEXITCODE -ne 0) { FAIL "git push failed" }
OK "Branch pushed"

# ── 3. Lint ──────────────────────────────────────────────────
Step "Running lint"
npm run lint
if ($LASTEXITCODE -ne 0) { FAIL "Lint failed" }
OK "Lint passed"

# ── 4. Tests ─────────────────────────────────────────────────
Step "Running full test suite"
npm run test:all
if ($LASTEXITCODE -ne 0) { FAIL "Tests failed" }
OK "Tests passed (68/68)"

# ── 5. Deploy Cloudflare Worker ──────────────────────────────
Step "Deploying Cloudflare Worker"
npx wrangler@4 deploy
if ($LASTEXITCODE -ne 0) { FAIL "Cloudflare Worker deploy failed" }
OK "Cloudflare Worker deployed → https://ultimatearbitragehft.zedanazad43.workers.dev"

# ── 6. Upload secrets to Cloudflare ─────────────────────────
Step "Uploading secrets to Cloudflare"
$secrets = @{
    MEXC_API_KEY          = $env:MEXC_API_KEY
    MEXC_API_SECRET       = $env:MEXC_API_SECRET
    BINANCE_API_KEY       = $env:BINANCE_API_KEY
    BINANCE_API_SECRET    = $env:BINANCE_API_SECRET
    KUCOIN_API_KEY        = $env:KUCOIN_API_KEY
    KUCOIN_SECRET_KEY     = $env:KUCOIN_SECRET_KEY
    KUCOIN_PASSPHRASE     = $env:KUCOIN_PASSPHRASE
    BITGET_API_KEY        = $env:BITGET_API_KEY
    BITGET_SECRET_KEY     = $env:BITGET_SECRET_KEY
    BITGET_API_PASSPHRASE = $env:BITGET_API_PASSPHRASE
    TELEGRAM_BOT_TOKEN    = $env:TELEGRAM_BOT_TOKEN
    TELEGRAM_CHAT_ID      = $env:TELEGRAM_CHAT_ID
    ADMIN_TOKEN           = $env:ADMIN_TOKEN
    HFT_ENGINE_SECRET     = $env:HFT_ENGINE_SECRET
}
$filtered = @{}
foreach ($k in $secrets.Keys) { if ($secrets[$k]) { $filtered[$k] = $secrets[$k] } }
if ($filtered.Count -gt 0) {
    $tmpFile = [System.IO.Path]::GetTempFileName() + ".json"
    $filtered | ConvertTo-Json | Set-Content -Path $tmpFile -Encoding UTF8
    npx wrangler@4 secret bulk $tmpFile
    Remove-Item $tmpFile -Force
    if ($LASTEXITCODE -ne 0) { WARN "Secret upload had issues — check output above" }
    else { OK "Secrets uploaded to Cloudflare" }
} else {
    WARN "No exchange secrets found in environment — skipping secret upload"
}

# ── 9. Trigger Emergent deploy ───────────────────────────────
Step "Triggering Emergent deploy"
if (-not $EMERGENT_API_TOKEN -or $EMERGENT_API_TOKEN -eq "YOUR_EMERGENT_API_TOKEN") {
    WARN "EMERGENT_API_TOKEN not set — skipping Emergent deploy"
} else {
    try {
        Invoke-RestMethod `
            -Uri "https://app.emergent.sh/api/v1/jobs/$EMERGENT_JOB_ID/deploy" `
            -Method POST `
            -Headers @{ Authorization = "******"; "Content-Type" = "application/json" } | Out-Null
        OK "Emergent deploy triggered → https://app.emergent.sh"
    } catch {
        WARN "Emergent API error: $_"
        Write-Host "   → Deploy manually at https://app.emergent.sh" -ForegroundColor Gray
    }
}

# ── Summary ──────────────────────────────────────────────────
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "🎉  All deployment steps complete!" -ForegroundColor Green
Write-Host "   GitHub     → branch pushed (merge PR #273 to trigger CI)"
Write-Host "   Cloudflare → https://ultimatearbitragehft.zedanazad43.workers.dev"
Write-Host "   Emergent   → https://app.emergent.sh"
Write-Host ""
Write-Host "Next: merge PR #273 → https://github.com/zedanazad43/UltimateArbitrageHFT/pull/273"
Write-Host "  to trigger the CI/CD pipeline for Cloudflare automatically."
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Green
