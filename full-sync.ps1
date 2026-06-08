$ErrorActionPreference = "Stop"
$ProjectRoot = Get-Location

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Starting project sync with GitHub & Cloudflare" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

# 1. Check tools
Write-Host "`n[1/9] Checking required tools..." -ForegroundColor Yellow
$tools = @("node", "npm", "git")
foreach ($tool in $tools) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Write-Host "✕ $tool is missing." -ForegroundColor Red
        exit 1
    }
}
Write-Host "✔ Basic tools found" -ForegroundColor Green

Write-Host "`n[2/9] Spell checking..." -ForegroundColor Yellow
if (Get-Command cspell -ErrorAction SilentlyContinue) {
    $prevErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        cspell "**/*.{js,mjs,cjs,json,md,yml,yaml,html}" --no-progress 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "⚠ Some spelling issues found (non-critical)." -ForegroundColor Magenta
            if (Get-Command codespell -ErrorAction SilentlyContinue) {
                Write-Host "  Attempting auto-fix with codespell..." -ForegroundColor Gray
                codespell --write-changes --quiet-level 2 .
            }
        } else {
            Write-Host "✔ No spelling issues" -ForegroundColor Green
        }
    } catch {
        Write-Host "⚠ Spell check encountered an error, continuing..." -ForegroundColor Magenta
    } finally {
        $ErrorActionPreference = $prevErrorAction
    }
} else {
    Write-Host "⚠ cspell not installed — skipping spell check." -ForegroundColor Magenta
}# 3. Lint
Write-Host "`n[3/9] Running ESLint..." -ForegroundColor Yellow
npm run lint 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "✔ Lint passed" -ForegroundColor Green
} else {
    Write-Host "⚠ Lint warnings/errors found." -ForegroundColor Magenta
}

# 4. Tests
Write-Host "`n[4/9] Running tests..." -ForegroundColor Yellow
npm test 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "✔ All tests passed" -ForegroundColor Green
} else {
    Write-Host "✕ Tests failed." -ForegroundColor Red
    exit 1
}

# 5. Security audit
Write-Host "`n[5/9] Security audit..." -ForegroundColor Yellow
npm audit --json 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠ Vulnerabilities found. Run 'npm audit fix'." -ForegroundColor Magenta
} else {
    Write-Host "✔ No known vulnerabilities" -ForegroundColor Green
}

# 6. Cleanup temp files/dirs
Write-Host "`n[6/9] Cleaning temporary files..." -ForegroundColor Yellow
$tempDirs = @(".venv_aider", "aider-env", ".aider", "node_modules/.cache", ".turbo")
$tempFiles = @("*.log", "npm-debug.log", ".DS_Store")
foreach ($dir in $tempDirs) {
    if (Test-Path $dir) {
        Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
        Write-Host "  Removed: $dir" -ForegroundColor Gray
    }
}
foreach ($pattern in $tempFiles) {
    Get-ChildItem -Path . -Filter $pattern -Recurse -File | Remove-Item -Force -ErrorAction SilentlyContinue
}
npm dedupe 2>&1 | Out-Null
Write-Host "✔ Cleanup completed" -ForegroundColor Green

# 7. Git optimization
Write-Host "`n[7/9] Optimizing local git repository..." -ForegroundColor Yellow
git gc --aggressive --prune=now 2>&1 | Out-Null
Write-Host "✔ Git optimization done" -ForegroundColor Green

# 8. Sync with GitHub
Write-Host "`n[8/9] Syncing with GitHub..." -ForegroundColor Yellow
$status = git status --porcelain
if ($status) {
    Write-Host "  Uncommitted changes found — committing..." -ForegroundColor Gray
    git add .
    git commit -m "auto-sync: cleanup and updates $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
}
$currentBranch = git rev-parse --abbrev-ref HEAD
git push origin $currentBranch 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "✔ Pushed to GitHub" -ForegroundColor Green
} else {
    Write-Host "✕ GitHub push failed" -ForegroundColor Red
    exit 1
}

# 9. Deploy to Cloudflare (if wrangler.toml exists)
Write-Host "`n[9/9] Deploying to Cloudflare..." -ForegroundColor Yellow
if (Test-Path "wrangler.toml") {
    if (Get-Command wrangler -ErrorAction SilentlyContinue) {
        wrangler deploy 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✔ Cloudflare deploy succeeded" -ForegroundColor Green
        } else {
            Write-Host "✕ Cloudflare deploy failed" -ForegroundColor Red
        }
    } else {
        Write-Host "⚠ wrangler not installed — skipping deploy." -ForegroundColor Magenta
    }
} else {
    Write-Host "⚠ wrangler.toml not found — skipping Cloudflare." -ForegroundColor Magenta
}

Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host "All tasks completed successfully." -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan

