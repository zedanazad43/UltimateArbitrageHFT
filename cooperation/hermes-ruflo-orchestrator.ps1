$ErrorActionPreference = 'Stop'

function Run-Step($name, [scriptblock]$block) {
  try {
    & $block
    Write-Host "[OK] $name" -ForegroundColor Green
  } catch {
    Write-Host "[WARN] $name failed: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

$RUFLO_PATH = 'C:\Projects\ruflo'
if (-not (Test-Path $RUFLO_PATH)) { throw "ruflo path not found: $RUFLO_PATH" }

Set-Location 'C:\Projects\UltimateArbitrageHFT'
Write-Host "==> Hermes Orchestrator: discover -> analyze -> plan -> execute"

# 1) Discover project state
Run-Step "git status" { git status --short }
Run-Step "node version" { node -v }
Run-Step "npm version" { npm -v }

# 2) Call ruflo as helper (adjust command based on ruflo README)
Set-Location $RUFLO_PATH
if (Test-Path "package.json") {
  Run-Step "ruflo help (npm run)" { npm run --silent }
}

# 3) Return to main repo and continue pipeline
Set-Location 'C:\Projects\UltimateArbitrageHFT'
Run-Step "install deps" {
  if (Test-Path "package-lock.json") { npm ci } else { npm install }
}

Write-Host "==> Hermes+ruflo orchestration done"
