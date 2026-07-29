# =========================
# FINAL INTEGRATION SCRIPT
# Local + GitHub + Cloudflare Wrangler chooser/deploy
# Repo: https://github.com/zedanazad43/UltimateArbitrageHFT/tree/2fc386219b2f306c4e1b51bf384b5bc5e76bdacd
# =========================
$ErrorActionPreference = "Stop"

# ---------- CONFIG ----------
$RepoPath      = "C:\Projects\UltimateArbitrageHFT"
$RemoteUrl     = "https://github.com/zedanazad43/UltimateArbitrageHFT.git"
$PinnedCommit  = "2fc386219b2f306c4e1b51bf384b5bc5e76bdacd"
$EnvName       = ""   # "" => top-level wrangler env
$SecretName    = "DEVELOPER_API_TOKEN"
$AutoDeploy    = $true
$AllowHardResetToPinned = $true
# ----------------------------

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }

function Test-Cmd($name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($null -eq $cmd) { throw "Required command not found: $name" }
}

function Remove-FunctionBlock {
    param([string]$Text,[string]$FuncName)
    $pattern = "(?ms)(^|\n)\s*(async\s+)?function\s+$FuncName\s*\([^)]*\)\s*\{"
    $m = [regex]::Match($Text, $pattern)
    if (-not $m.Success) { return $Text }

    $start = $m.Index + $m.Groups[1].Length
    $openBrace = $Text.IndexOf("{", $m.Index)
    if ($openBrace -lt 0) { return $Text }

    $depth = 0; $end = -1
    for ($i = $openBrace; $i -lt $Text.Length; $i++) {
        $ch = $Text[$i]
        if ($ch -eq "{") { $depth++ }
        elseif ($ch -eq "}") {
            $depth--
            if ($depth -eq 0) { $end = $i; break }
        }
    }
    if ($end -lt 0) { return $Text }

    $before = $Text.Substring(0, $start)
    $after  = $Text.Substring($end + 1)
    return ($before + "`r`n" + $after)
}

# ---------- Preflight ----------
Write-Step "Checking required CLIs"
Test-Cmd git
Test-Cmd node
Test-Cmd npm
Test-Cmd wrangler
Write-Ok "git/node/npm/wrangler available"

if (-not (Test-Path $RepoPath)) { throw "Repo path not found: $RepoPath" }

Set-Location $RepoPath
Write-Ok "Using local path: $RepoPath"

# ---------- Validate repo ----------
Write-Step "Validating local git repository"
git rev-parse --show-toplevel | Out-Null
$LocalRoot = (git rev-parse --show-toplevel).Trim()
Write-Ok "Local git root: $LocalRoot"
$origin = ""
try { $origin = (git remote get-url origin).Trim() } catch {}
if ([string]::IsNullOrWhiteSpace($origin)) {
Write-Warn "No origin remote found. Setting origin to GitHub URL."
git remote add origin $RemoteUrl
$origin = (git remote get-url origin).Trim()
}
Write-Ok "Origin remote: $origin"

# ---------- Fetch and compare ----------
Write-Step "Fetching from GitHub and comparing commit state"
git fetch --all --prune
$current = (git rev-parse HEAD).Trim()
Write-Host "Local HEAD : $current"
Write-Host "Pinned     : $PinnedCommit"
$dirty = $false
$gs = git status --porcelain
if (-not [string]::IsNullOrWhiteSpace($gs)) { $dirty = $true }
# heuristic health checks
$indexExists = Test-Path "index.js"
$pkgExists   = Test-Path "package.json"
$pkgValid    = $true
if (-not $pkgExists) { $pkgValid = $false }
else {
$pkgRaw = Get-Content "package.json" -Raw
if ([string]::IsNullOrWhiteSpace($pkgRaw)) { $pkgValid = $false }
else {
try { $null = $pkgRaw | ConvertFrom-Json } catch { $pkgValid = $false }
}
}
$localLooksUnhealthy = (-not $indexExists) -or (-not $pkgValid)
Write-Host "Dirty workspace: $dirty"
Write-Host "Local health   : $(-not $localLooksUnhealthy)"

# choose best source
if ($AllowHardResetToPinned -and ($localLooksUnhealthy -or $dirty) -and ($current -ne $PinnedCommit)) {
Write-Warn "Local appears risky (dirty/unhealthy). Resetting to pinned GitHub commit."
git reset --hard $PinnedCommit
$current = (git rev-parse HEAD).Trim()
Write-Ok "Now on pinned commit: $current"
} else {
Write-Ok "Keeping local working tree as best source."
}

# ---------- Backup ----------
Write-Step "Creating backup snapshot"

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = ".backup-$ts"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

foreach ($f in @("index.js","package.json","wrangler.toml")) {
if (Test-Path $f) { Copy-Item $f "$backupDir\$f" -Force }
}
Write-Ok "Backup created at $backupDir"

# ---------- Apply project fixes ----------
Write-Step "Applying index.js duplicate-function cleanup"
if (-not (Test-Path "index.js")) { throw "index.js not found after selection" }
$raw = Get-Content "index.js" -Raw
$fixed = $raw
$fixed = Remove-FunctionBlock -Text $fixed -FuncName "checkRateLimit"
$fixed = Remove-FunctionBlock -Text $fixed -FuncName "applyRateLimitHeaders"
$fixed = [regex]::Replace($fixed, "(\r?\n){3,}", "`r`n`r`n")
Set-Content "index.js" $fixed -Encoding UTF8
Write-Ok "index.js cleaned"

Write-Step "Validating/repairing package.json"
$pkgValid2 = $true

if (-not (Test-Path "package.json")) { $pkgValid2 = $false }
else {
$pkgRaw2 = Get-Content "package.json" -Raw
if ([string]::IsNullOrWhiteSpace($pkgRaw2)) { $pkgValid2 = $false }
else {
try { $null = $pkgRaw2 | ConvertFrom-Json } catch { $pkgValid2 = $false }
}
}
if (-not $pkgValid2) {
$pkgObj = [ordered]@{
name    = "ultimatearbitragehft"
version = "1.0.0"
private = $true
scripts = [ordered]@{
deploy = "wrangler deploy --env=`"`""
}
}

($pkgObj | ConvertTo-Json -Depth 10) | Set-Content "package.json" -Encoding UTF8
Write-Warn "package.json was invalid; minimal valid file written."
} else {

Write-Ok "package.json valid"

}

Write-Step "Wrangler config advisory check"
if (Test-Path "wrangler.toml") {
$w = Get-Content "wrangler.toml" -Raw

if ($w -match "pages_build_output_dir") {
Write-Warn "Found pages_build_output_dir. Ensure it is in correct context for Workers/Pages."
} else {

Write-Ok "No pages_build_output_dir warning trigger found."
}
}

# ---------- Install ----------
Write-Step "Installing dependencies"

if (Test-Path "package-lock.json") { npm ci } else { npm install }

Write-Ok "Dependencies installed"

# ---------- Cloudflare/Wrangler connectivity ----------

Write-Step "Checking required tools"
Test-Cmd git
Test-Cmd node
Test-Cmd npm
Test-Cmd wrangler
Write-Ok "Required tools are available: git/node/npm/wrangler"

Write-Step "Checking Wrangler authentication/connectivity"
wrangler whoami
Write-Ok "Wrangler authenticated"

Write-Step "Ensuring secret is set on explicit env"
if ($EnvName -eq "") {
wrangler secret put $SecretName --env=""
} else {
wrangler secret put $SecretName -e $EnvName
}
Write-Ok "Secret configured"

# ---------- Deploy ----------
if ($AutoDeploy) {
Write-Step "Deploying with explicit environment"
if ($EnvName -eq "") {
wrangler deploy --env=""
} else {
wrangler deploy -e $EnvName
}
Write-Ok "Deploy completed"
} else {
Write-Warn "AutoDeploy is disabled; skipping deploy."
}

# ---------- Summary ----------
Write-Step "Final status summary"
git status --short
Write-Host "Local HEAD: $(git rev-parse HEAD)"
Write-Host "Pinned   : $PinnedCommit"
Write-Ok "Script finished."