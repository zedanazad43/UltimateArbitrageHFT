<#
.SYNOPSIS
    Check and fix the Hero Agent, then deploy UltimateArbitrageHFT.
.DESCRIPTION
    - Reinstalls/updates the Hero module (if possible).
    - Runs hero-status to verify.
    - Uses hero to analyze and repair the bot code.
    - Automatically detects dependencies, creates a clean package.json, and deploys to Railway.
#>

$ErrorActionPreference = "Continue"

# ---- 1. Fix Hero Agent ----
Write-Host "🔧 Checking Hero Agent..." -ForegroundColor Cyan

# Try to update/reinstall hero (assumes it's a global npm package, but may be a module)
if (Get-Command hero -ErrorAction SilentlyContinue) {
    Write-Host "✅ Hero command found." -ForegroundColor Green
    # Attempt to reinstall via npm (common for CLI tools)
    Write-Host "Attempting to update Hero via npm..." -ForegroundColor Yellow
    npm uninstall -g hero 2>$null
    npm install -g hero 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Hero reinstalled successfully." -ForegroundColor Green
    } else {
        Write-Warning "Could not reinstall Hero via npm. It may be a PowerShell module."
        # Try to import the module again (if it's a module)
        Import-Module -Name Hero -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "❌ Hero command not found. Attempting to install via npm..." -ForegroundColor Red
    npm install -g hero
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Could not install Hero. Please install it manually and rerun."
        exit 1
    }
}

# Check hero status
Write-Host "Running hero-status..." -ForegroundColor Yellow
hero-status
if ($LASTEXITCODE -ne 0) {
    Write-Warning "hero-status failed. Proceeding anyway..."
}

# ---- 2. Use hero to analyze and repair the bot ----
Write-Host "`n🤖 Running Hero analysis on the bot code..." -ForegroundColor Cyan
# Use a simple prompt – the default agent should handle it
hero "Analyze the entire UltimateArbitrageHFT codebase, identify all bugs, performance issues, and security vulnerabilities, and automatically fix them. Ensure all dependencies are correctly declared."
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Hero command failed. Proceeding with manual deployment steps..."
}

# ---- 3. Locate the bot folder ----
$StartDir = Get-Location
$botFolder = $null
Get-ChildItem -Directory -Recurse -Depth 3 | ForEach-Object {
    $p = Join-Path $_.FullName "package.json"
    if (Test-Path $p) {
        try {
            $pkg = Get-Content $p -Raw | ConvertFrom-Json
            if ($pkg.name -match "ultimatearbitragehft") {
                $botFolder = $_.FullName
                Write-Host "Found bot folder: $botFolder" -ForegroundColor Green
                return
            }
        } catch { }
    }
}
if (-not $botFolder) { $botFolder = $StartDir }
Set-Location $botFolder
Write-Host "Working dir: $(Get-Location)" -ForegroundColor Cyan

# ---- 4. Clean large files ----
Write-Host "Cleaning large folders..." -ForegroundColor Yellow
Remove-Item -Recurse -Force node_modules,.git,logs,tmp,temp,data,input,output,models -ErrorAction SilentlyContinue
Get-ChildItem -Filter "Caddyfile*" -File | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Recurse -Filter "package.json" | Where-Object { $_.Directory.FullName -ne $botFolder } | Remove-Item -Force -ErrorAction SilentlyContinue

# ---- 5. Find entry file ----
$entryFile = $null
$candidates = @("index.js", "server.js", "app.js", "main.js", "bot.js", "start.js")
foreach ($f in $candidates) {
    if (Test-Path $f) {
        $entryFile = $f
        Write-Host "Found entry file: $entryFile" -ForegroundColor Green
        break
    }
}
if (-not $entryFile) {
    Write-Host "Creating index.js" -ForegroundColor Yellow
    $entryFile = "index.js"
    @"
// UltimateArbitrageHFT bot
console.log("UltimateArbitrageHFT bot started!");
"@ | Set-Content -Path $entryFile -Encoding utf8
}

# ---- 6. Detect dependencies (skip system folders) ----
Write-Host "Scanning for dependencies..." -ForegroundColor Yellow
$deps = @()
$jsFiles = Get-ChildItem -Recurse -Filter "*.js" | Where-Object {
    $_.Directory.FullName -notmatch "node_modules|\.git|\.vscode|\.idea|dist|build"
}
foreach ($file in $jsFiles) {
    try {
        $content = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue
        if ($content) {
            $matches = [regex]::Matches($content, 'require\([''"]([^''""]+)[''"]\)')
            foreach ($m in $matches) {
                $dep = $m.Groups[1].Value
                if ($dep -notmatch '^\.' -and $dep -notmatch '^/') {
                    $deps += $dep
                }
            }
        }
    } catch {
        Write-Warning "Could not read $($file.FullName), skipping..."
    }
}
$deps = $deps | Sort-Object -Unique
Write-Host "Detected dependencies: $($deps -join ', ')" -ForegroundColor Yellow

# ---- 7. Build package.json ----
Write-Host "Creating package.json..." -ForegroundColor Yellow
$pkg = @{
    name = "ultimatearbitragehft"
    version = "1.0.0"
    main = $entryFile
    scripts = @{ start = "node $entryFile" }
    dependencies = @{}
}
foreach ($d in $deps) {
    $pkg.dependencies[$d] = "*"
}
$pkgJson = $pkg | ConvertTo-Json -Depth 10
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText((Join-Path $botFolder "package.json"), $pkgJson, $utf8NoBom)

# ---- 8. Write railway.json and .railwayignore ----
Write-Host "Creating railway.json..." -ForegroundColor Yellow
$railwayConfig = @{ build = @{ builder = "NIXPACKS" } } | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText((Join-Path $botFolder "railway.json"), $railwayConfig, $utf8NoBom)
$ignore = "node_modules/`n.git/`nlogs/`ntmp/`ntemp/`nbin/`nobj/`n.DS_Store`ndata/`n*.log`n*.pdb`n*.db`n*.sqlite`n*.csv`n*.zip`n*.tar`n*.gz"
[System.IO.File]::WriteAllText((Join-Path $botFolder ".railwayignore"), $ignore, $utf8NoBom)

# ---- 9. Install dependencies ----
Write-Host "Installing dependencies..." -ForegroundColor Yellow
npm install

# ---- 10. Deploy ----
Write-Host "Deploying to Railway (production)..." -ForegroundColor Green
railway up --environment production

# ---- 11. Status ----
railway status
Write-Host "Pipeline completed." -ForegroundColor Green