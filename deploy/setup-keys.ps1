$ErrorActionPreference = "Stop"
$API_FILE = "C:\Users\azadz\OneDrive\Desktop\API.txt"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  FULL KEY SETUP + DEPLOY" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1. Read API.txt
Write-Host "`n[1/6] Reading API.txt..." -ForegroundColor Yellow
if (-not (Test-Path $API_FILE)) { Write-Host "ERROR: $API_FILE not found" -ForegroundColor Red; exit 1 }
$raw = Get-Content $API_FILE -Raw
$keys = @{}
$raw -split "`n" | % { if ($_ -match '^\s*([A-Z_]+)\s*[=:]\s*(.+)\s*$') { $keys[$matches[1]] = $matches[2].Trim() } }
Write-Host "  Found $($keys.Count) keys" -ForegroundColor Green
$keys.Keys | Sort | % { Write-Host "    $_" }

# 2. Coinbase check
Write-Host "`n[2/6] Coinbase keys..." -ForegroundColor Yellow
$cbk = $keys['COINBASE_API_KEY']; $cbs = $keys['COINBASE_SECRET_KEY']
if (-not $cbk -or -not $cbs) { Write-Host "ERROR: Coinbase keys missing. Available: $($keys.Keys -join ', ')" -ForegroundColor Red; exit 1 }
Write-Host "  COINBASE_API_KEY    = $($cbk.Substring(0,4))****" -ForegroundColor Green
Write-Host "  COINBASE_SECRET_KEY = $($cbs.Substring(0,4))****" -ForegroundColor Green

# 3. .dev.vars
Write-Host "`n[3/6] Updating .dev.vars..." -ForegroundColor Yellow
$dv = @{}
if (Test-Path .dev.vars) { Get-Content .dev.vars | % { if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.+)\s*$') { $dv[$matches[1]] = $matches[2] } } }
$dv['COINBASE_API_KEY'] = $cbk; $dv['COINBASE_SECRET_KEY'] = $cbs
$dv.GetEnumerator() | Sort Name | % { "$($_.Name)=$($_.Value)" } | Set-Content .dev.vars
Write-Host "  Done" -ForegroundColor Green

# 4. Cloudflare
Write-Host "`n[4/6] Uploading to Cloudflare..." -ForegroundColor Yellow
$env:COINBASE_API_KEY = $cbk
$env:COINBASE_SECRET_KEY = $cbs
echo $cbk | npx wrangler secret put COINBASE_API_KEY --name ultimatearbitragehft
echo $cbs | npx wrangler secret put COINBASE_SECRET_KEY --name ultimatearbitragehft
Write-Host "  Done" -ForegroundColor Green

# 5. Verify
Write-Host "`n[5/6] Verifying Cloudflare secrets..." -ForegroundColor Yellow
npx wrangler secret list --name ultimatearbitragehft

# 6. Production check
Write-Host "`n[6/6] Checking production..." -ForegroundColor Yellow
try {
  $r = Invoke-RestMethod "https://ultimatearbitragehft.zedanazad43.workers.dev/api/market/price/BTCUSDT" -TimeoutSec 10
  $ex = ($r.PSObject.Properties | ? { $_.Name -ne 'symbol' }).Name -join ', '
  Write-Host "  Sources: $ex" -ForegroundColor Cyan
  if ($ex -match 'coinbase') { Write-Host "  Coinbase LIVE" -ForegroundColor Green }
  else { Write-Host "  Coinbase not yet in quotes" -ForegroundColor Yellow }
} catch { Write-Host "  Could not reach: $_" -ForegroundColor Yellow }

Write-Host "`nDONE. Next: git push origin main to deploy" -ForegroundColor Cyan
