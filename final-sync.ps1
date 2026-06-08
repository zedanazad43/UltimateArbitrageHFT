$ErrorActionPreference = "Continue"
$base = "https://ultimatearbitragehft.zedanazad43.workers.dev"
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Ultimate Sync: Spell, Lint, Test, Fix, Speed, Deploy" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

# 1. Tools check
Write-Host "`n[1/8] Checking tools..." -ForegroundColor Yellow
@("node","npm","git","wrangler") | % {
    if (-not (Get-Command $_ -ErrorAction SilentlyContinue)) {
        Write-Host "✕ $_ missing – install it first." -ForegroundColor Red
        exit 1
    }
}
Write-Host "✔ All tools present" -ForegroundColor Green

# 2. Spell check (cspell + codespell)
Write-Host "`n[2/8] Spell checking..." -ForegroundColor Yellow
if (Get-Command cspell -ErrorAction SilentlyContinue) {
    cspell "**/*.{js,mjs,cjs,json,md,yml,yaml,html}" --no-progress 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "⚠ Spelling issues found – auto-fixing with codespell if available" -ForegroundColor Magenta
        if (Get-Command codespell -ErrorAction SilentlyContinue) { codespell --write-changes --quiet-level 2 . 2>&1 | Out-Null }
    } else { Write-Host "✔ No spelling issues" -ForegroundColor Green }
} else { Write-Host "⚠ cspell not installed – skipping spell check" -ForegroundColor Magenta }

# 3. Lint
Write-Host "`n[3/8] Running ESLint..." -ForegroundColor Yellow
npm run lint 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Host "✔ Lint passed" -ForegroundColor Green }
else { Write-Host "⚠ Lint warnings/errors found" -ForegroundColor Magenta }

# 4. Tests
Write-Host "`n[4/8] Running tests..." -ForegroundColor Yellow
npm test 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Host "✔ All tests passed" -ForegroundColor Green }
else { Write-Host "✕ Tests failed – review before deploy" -ForegroundColor Red; exit 1 }

# 5. Security audit + fix
Write-Host "`n[5/8] Fixing vulnerabilities..." -ForegroundColor Yellow
npm audit fix 2>&1 | Out-Null
Write-Host "✔ Audit fix applied" -ForegroundColor Green

# 6. Cleanup temp files
Write-Host "`n[6/8] Cleaning temporary files..." -ForegroundColor Yellow
@(".venv_aider","aider-env",".aider","node_modules/.cache",".turbo") | % {
    if (Test-Path $_) { Remove-Item -Recurse -Force $_ -ErrorAction SilentlyContinue; Write-Host "  Removed $_" -ForegroundColor Gray }
}
Write-Host "✔ Cleanup done" -ForegroundColor Green

# 7. Speed optimizations (update wrangler.toml)
Write-Host "`n[7/8] Applying speed settings..." -ForegroundColor Yellow
Copy-Item wrangler.toml wrangler.toml.bak
$toml = Get-Content wrangler.toml -Raw
$toml = $toml -replace 'AGGRESSIVE_FORCED_MIN_SECONDS_BETWEEN_TRADES\s*=\s*"\d+"', 'AGGRESSIVE_FORCED_MIN_SECONDS_BETWEEN_TRADES = "5"'
$toml = $toml -replace 'AGGRESSIVE_FORCED_MAX_LIVE_TRADES_PER_SCAN\s*=\s*"\d+"', 'AGGRESSIVE_FORCED_MAX_LIVE_TRADES_PER_SCAN = "20"'
if ($toml -notmatch 'DIRECT_EXCHANGES') { $toml = $toml -replace 'PROXY_MODE\s*=\s*"auto"', "PROXY_MODE = `"auto`"`nDIRECT_EXCHANGES = `"mexc,bitget`"" }
Set-Content -Path wrangler.toml -Value $toml -Encoding utf8
Write-Host "✔ Speed settings applied (backup: wrangler.toml.bak)" -ForegroundColor Green

# 8. Git push + Cloudflare deploy
Write-Host "`n[8/8] Pushing to GitHub & deploying to Cloudflare..." -ForegroundColor Yellow
$dirty = git status --porcelain
if ($dirty) {
    git add .
    git commit -m "Auto-sync: spell, lint, test, speed optimizations"
}
git push
if ($LASTEXITCODE -ne 0) { Write-Host "✕ Git push failed" -ForegroundColor Red; exit 1 }
Write-Host "✔ Pushed to GitHub" -ForegroundColor Green

wrangler deploy
if ($LASTEXITCODE -eq 0) { Write-Host "✔ Cloudflare deploy successful" -ForegroundColor Green }
else { Write-Host "✕ Cloudflare deploy failed" -ForegroundColor Red; exit 1 }

Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host "All done. To verify endpoints manually:" -ForegroundColor Green
Write-Host " 1. Get ADMIN_TOKEN from Cloudflare Dashboard -> Workers -> Settings -> Variables -> Reveal" -ForegroundColor Gray
Write-Host " 2. Run: `$t='your-token'; `$h=@{Authorization=`"Bearer `$t`"}; Invoke-RestMethod -Uri `"$base/api/ai/health`" -Headers `$h" -ForegroundColor Gray
Write-Host " 3. Check that gatewayUrl is absent and /api/trades returns ok:true" -ForegroundColor Gray
Write-Host "================================================" -ForegroundColor Cyan
