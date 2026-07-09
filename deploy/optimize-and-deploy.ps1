$ErrorActionPreference = "Stop"
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Applying speed/security optimizations & deploy" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

# 1. Check tools
Write-Host "`n[1/6] Checking tools..." -ForegroundColor Yellow
@("node","npm","git","wrangler") | ForEach-Object {
    if (-not (Get-Command $_ -ErrorAction SilentlyContinue)) {
        Write-Host "✕ $_ is missing." -ForegroundColor Red
        exit 1
    }
}
Write-Host "✔ All tools present" -ForegroundColor Green

# 2. Backup wrangler.toml
Write-Host "`n[2/6] Backing up wrangler.toml..." -ForegroundColor Yellow
Copy-Item wrangler.toml wrangler.toml.backup
Write-Host "✔ Backup done" -ForegroundColor Green

# 3. Update speed settings in wrangler.toml
Write-Host "`n[3/6] Adjusting speed settings..." -ForegroundColor Yellow
$toml = Get-Content wrangler.toml -Raw

# Reduce min seconds between trades from 10 to 5
$toml = $toml -replace 'AGGRESSIVE_FORCED_MIN_SECONDS_BETWEEN_TRADES\s*=\s*"\d+"', 'AGGRESSIVE_FORCED_MIN_SECONDS_BETWEEN_TRADES = "5"'

# Increase max live trades per scan from 10 to 20
$toml = $toml -replace 'AGGRESSIVE_FORCED_MAX_LIVE_TRADES_PER_SCAN\s*=\s*"\d+"', 'AGGRESSIVE_FORCED_MAX_LIVE_TRADES_PER_SCAN = "20"'

# Add DIRECT_EXCHANGES if missing
if ($toml -notmatch 'DIRECT_EXCHANGES') {
    $toml = $toml -replace 'PROXY_MODE\s*=\s*"auto"', "PROXY_MODE = `"auto`"`nDIRECT_EXCHANGES = `"mexc,bitget`""
}

Set-Content -Path wrangler.toml -Value $toml -Encoding utf8
Write-Host "✔ Settings updated" -ForegroundColor Green

# 4. Fix vulnerabilities & push
Write-Host "`n[4/6] Fixing npm vulnerabilities & pushing..." -ForegroundColor Yellow
npm audit fix 2>&1 | Out-Null
$dirty = git status --porcelain
if ($dirty) {
    Write-Host "  Changes detected – committing & pushing..." -ForegroundColor Gray
    git add package.json package-lock.json wrangler.toml
    git commit -m "optimize: speed settings, npm audit fix, DIRECT_EXCHANGES"
    git push
    Write-Host "✔ Pushed to GitHub" -ForegroundColor Green
} else {
    Write-Host "✔ No changes to push" -ForegroundColor Green
}

# 5. Deploy to Cloudflare
Write-Host "`n[5/6] Deploying to Cloudflare..." -ForegroundColor Yellow
wrangler deploy
if ($LASTEXITCODE -eq 0) {
    Write-Host "✔ Deploy successful" -ForegroundColor Green
} else {
    Write-Host "✕ Deploy failed" -ForegroundColor Red
    exit 1
}

# 6. Smoke tests
Write-Host "`n[6/6] Testing endpoints..." -ForegroundColor Yellow
$base = "https://ultimatearbitragehft.zedanazad43.workers.dev"

Write-Host "  Checking /api/ai/health..." -ForegroundColor Gray
try {
    $health = Invoke-RestMethod -Uri "$base/api/ai/health" -ErrorAction Stop
    if ($health.PSObject.Properties.Name -notcontains "gatewayUrl") {
        Write-Host "    ✔ gatewayUrl is hidden" -ForegroundColor Green
    } else {
        Write-Host "    ⚠ gatewayUrl still present!" -ForegroundColor Magenta
    }
} catch {
    Write-Host "    ✕ Request failed: $_" -ForegroundColor Red
}

Write-Host "  Checking /api/trades..." -ForegroundColor Gray
try {
    $trades = Invoke-RestMethod -Uri "$base/api/trades" -ErrorAction Stop
    if ($trades.ok -eq $true) {
        Write-Host "    ✔ Response includes ok: true" -ForegroundColor Green
    } else {
        Write-Host "    ⚠ ok: true not found" -ForegroundColor Magenta
    }
} catch {
    Write-Host "    ✕ Request failed: $_" -ForegroundColor Red
}

Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host "Optimizations and tests complete." -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "`nTips:"
Write-Host " - Run 'wrangler tail' in a separate window for live logs."
Write-Host " - Open Cloudflare Dashboard to monitor metrics."
Write-Host " - To revert settings, restore from wrangler.toml.backup."
