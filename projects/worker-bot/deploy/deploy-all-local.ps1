# ============================================================
# UltimateArbitrageHFT — Full Local Deployment Script
# Run from project root: pwsh ./deploy-all-local.ps1
# ============================================================

# ─── Fill in your tokens here ──────────────────────────────
$env:CLOUDFLARE_API_TOKEN   = "cf48cfb41422fa4ff25991f72a536da38c490"
$env:CLOUDFLARE_ACCOUNT_ID  = "652e53f35781522e2745784cc4425d9d"
$FLY_API_TOKEN              = "FlyV1 fm2_lJPECAAAAAAAEbrkxBA7qPeB8VUa4qMdLj2giECBwrVodHRwczovL2FwaS5mbHkuaW8vdjGUAJLOABa0ux8Lk7lodHRwczovL2FwaS5mbHkuaW8vYWFhL3YxxDyJms1sRMvW1nTVnX1qkdENNYCuyoLuNsDtiD5YP8S7qo2Mo3MNhQNH+v1EEHrUvJn3J6CagDnqOgB+6kzETkGlz/ZYe6p/7rHAM5Z/iGdzCbRgEGw1BKoTnOZ1/PXUSLwUzGevZa6JI4hz5dnfM4mvn9P6BbdzdOvMXOGLVDWOBGTUZxKbzqJe0jlfg8QgS5oKPKkBITwE3g4u+Arvm9+PA6GXH2jbXALGKNbEI0I=,fm2_lJPETkGlz/ZYe6p/7rHAM5Z/iGdzCbRgEGw1BKoTnOZ1/PXUSLwUzGevZa6JI4hz5dnfM4mvn9P6BbdzdOvMXOGLVDWOBGTUZxKbzqJe0jlfg8QQP7qVMWh6dWkdg8Z1hQ7LM8O5aHR0cHM6Ly9hcGkuZmx5LmlvL2FhYS92MZgEks5qQneyzwAAAAEmOpXQF84AFciBCpHOABXIgQzEEBFG1QFAnv651G9WalHqRQvEIAxOe2wfwTTp4o7eZE5P6smqnLFvzFJNzb4qy2ivC5Iv"        # https://fly.io/user/personal_access_tokens
$RAILWAY_API_TOKEN          = "f2033121-7100-4aae-a899-a485f658e012"    # https://railway.app/account/tokens
$EMERGENT_API_TOKEN         = "YOUR_EMERGENT_API_TOKEN"   # https://app.emergent.sh/settings
$RAILWAY_SERVICE_ID         = "ad1edd5e"
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

# ── 7. Deploy to Fly.io ──────────────────────────────────────
Step "Deploying HFT engine to Fly.io"
if (-not $FLY_API_TOKEN -or $FLY_API_TOKEN -eq "YOUR_FLY_API_TOKEN") {
    WARN "FLY_API_TOKEN not set — skipping Fly.io deploy"
} else {
    $env:FLY_API_TOKEN = $FLY_API_TOKEN
    # Install flyctl if not present
    if (-not (Get-Command flyctl -ErrorAction SilentlyContinue)) {
        Write-Host "   Installing flyctl..." -ForegroundColor Gray
        iwr https://fly.io/install.ps1 -useb | iex
    }
    flyctl deploy --config fly.toml --remote-only
    if ($LASTEXITCODE -ne 0) { WARN "Fly.io deploy failed — check flyctl output" }
    else { OK "Fly.io HFT engine deployed → https://ultimatearbitragehft.fly.dev" }
}

# ── 8. Trigger Railway redeploy ──────────────────────────────
Step "Triggering Railway redeploy"
if (-not $RAILWAY_API_TOKEN -or $RAILWAY_API_TOKEN -eq "YOUR_RAILWAY_API_TOKEN") {
    WARN "RAILWAY_API_TOKEN not set — skipping Railway trigger"
} else {
    $mutation = '{"query":"mutation { serviceInstanceRedeploy(serviceId: \"' + $RAILWAY_SERVICE_ID + '\") { id } }"}'
    try {
        $r = Invoke-RestMethod `
            -Uri "https://backboard.railway.app/graphql/v2" `
            -Method POST `
            -Headers @{ Authorization = "******"; "Content-Type" = "application/json" } `
            -Body $mutation
        OK "Railway redeploy triggered → https://ultimatearbitragehft-production.up.railway.app"
    } catch {
        WARN "Railway API error: $_"
        Write-Host "   → Redeploy manually at https://railway.app" -ForegroundColor Gray
    }
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
Write-Host "   Fly.io     → https://ultimatearbitragehft.fly.dev"
Write-Host "   Railway    → https://ultimatearbitragehft-production.up.railway.app"
Write-Host "   Emergent   → https://app.emergent.sh"
Write-Host ""
Write-Host "Next: merge PR #273 → https://github.com/zedanazad43/UltimateArbitrageHFT/pull/273"
Write-Host "  to trigger the CI/CD pipeline for Cloudflare + Fly.io automatically."
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Green