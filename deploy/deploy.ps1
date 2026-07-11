<#
.SYNOPSIS
    Auto‑detect dependencies, fix package.json, deploy to Railway.
#>

$ErrorActionPreference = "Continue"

$StartDir = Get-Location
$botFolder = $null
Get-ChildItem -Directory -Recurse -Depth 3 | ForEach-Object {
    $p = Join-Path $_.FullName "package.json"
    if (Test-Path $p) {
        try {
            $pkg = Get-Content $p -Raw | ConvertFrom-Json
            if ($pkg.name -match "ultimatearbitragehft") {
                $botFolder = $_.FullName
                return
            }
        } catch { }
    }
}
if (-not $botFolder) { $botFolder = $StartDir }
Set-Location $botFolder
Write-Host "Working dir: $(Get-Location)" -ForegroundColor Cyan

# Clean large files
Remove-Item -Recurse -Force node_modules,.git,logs,tmp,temp,data,input,output,models -ErrorAction SilentlyContinue
Get-ChildItem -Recurse -Include *.log,*.db,*.sqlite,*.csv,*.zip,*.tar,*.gz,*.pdb,*.dll,*.so,*.exe,*.msi,*.iso,*.dmg,*.mp4,*.avi,*.mov | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Filter "Caddyfile*" -File | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Recurse -Filter "package.json" | Where-Object { $_.Directory.FullName -ne $botFolder } | Remove-Item -Force -ErrorAction SilentlyContinue

# Entry file
$entryFile = $null
$candidates = @("index.js", "server.js", "app.js", "main.js", "bot.js", "start.js")
foreach ($f in $candidates) { if (Test-Path $f) { $entryFile = $f; break } }
if (-not $entryFile) { $entryFile = "index.js"; @"
console.log("UltimateArbitrageHFT bot started!");
"@ | Set-Content -Path $entryFile -Encoding utf8 }

# Detect dependencies from all .js files
$deps = @()
Get-ChildItem -Recurse -Filter "*.js" | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    $content | Select-String -AllMatches 'require\([''"]([^''""]+)[''"]\)' | ForEach-Object { $deps += $_.Matches.Groups[1].Value }
}
$deps = $deps | Where-Object { $_ -notmatch '^\.' -and $_ -notmatch '^/' } | Sort-Object -Unique
Write-Host "Detected dependencies: $($deps -join ', ')" -ForegroundColor Yellow

# Build package.json
$pkg = @{
    name = "ultimatearbitragehft"
    version = "1.0.0"
    main = $entryFile
    scripts = @{ start = "node $entryFile" }
    dependencies = @{}
}
foreach ($d in $deps) { $pkg.dependencies[$d] = "*" }  # Let npm resolve latest versions

$pkgJson = $pkg | ConvertTo-Json -Depth 10
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText((Join-Path $botFolder "package.json"), $pkgJson, $utf8NoBom)

# railway.json (BOM‑free)
$railwayConfig = @{ build = @{ builder = "NIXPACKS" } } | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText((Join-Path $botFolder "railway.json"), $railwayConfig, $utf8NoBom)

# .railwayignore
$ignore = "node_modules/`n.git/`nlogs/`ntmp/`ntemp/`nbin/`nobj/`n.DS_Store`ndata/`n*.log`n*.pdb`n*.db`n*.sqlite`n*.csv`n*.zip`n*.tar`n*.gz"
[System.IO.File]::WriteAllText((Join-Path $botFolder ".railwayignore"), $ignore, $utf8NoBom)

# Install dependencies locally and generate lockfile
Write-Host "Installing detected packages..." -ForegroundColor Yellow
npm install

# Deploy
Write-Host "Deploying to Railway..." -ForegroundColor Green
railway up --environment production