# scripts/upload-secrets.ps1
#
# Reads api_keys.txt and pushes every KEY=VALUE pair to Cloudflare Workers
# as a secret via `wrangler secret put`.
#
# Usage (run from repo root):
#   pwsh -NoProfile -File ./scripts/upload-secrets.ps1
#   pwsh -NoProfile -File ./scripts/upload-secrets.ps1 -KeysFile path/to/api_keys.txt
#   pwsh -NoProfile -File ./scripts/upload-secrets.ps1 -DryRun
#
# Options:
#   -KeysFile <path>   Path to the INI-style keys file  (default: api_keys.txt)
#   -DryRun            Print what would be uploaded without calling wrangler
#   -Section <name>    Only upload secrets from a specific section, e.g. MEXC

[CmdletBinding()]
param(
    [string] $KeysFile = (Join-Path $PSScriptRoot '..' 'api_keys.txt'),
    [switch] $DryRun,
    [string] $Section = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$CanonicalKeyMap = @{
    'BINANC_API_SECRET'   = 'BINANCE_API_SECRET'
    'KUCOIN_SECRET_KEY'   = 'KUCOIN_API_SECRET'
    'BITGET_API_SECRET'   = 'BITGET_SECRET_KEY'
    'BITMART_API_SECRET'  = 'BITMART_SECRET_KEY'
}

$RequiredSecretsBySection = @{
    'BINANCE' = @('BINANCE_API_KEY', 'BINANCE_API_SECRET')
    'KUCOIN'  = @('KUCOIN_API_KEY', 'KUCOIN_API_SECRET', 'KUCOIN_PASSPHRASE')
    'OKX'     = @('OKX_API_KEY', 'OKX_API_SECRET', 'OKX_PASSPHRASE')  # data-only (BaFin)
    'BITGET'  = @('BITGET_API_KEY', 'BITGET_SECRET_KEY', 'BITGET_API_PASSPHRASE')
    'BITMART' = @('BITMART_API_KEY', 'BITMART_SECRET_KEY', 'BITMART_MEMO')
    'HTX'     = @('HTX_API_KEY', 'HTX_API_SECRET')
}

function Resolve-SecretKey {
    param(
        [string] $SectionName,
        [string] $RawKey
    )

    if ($CanonicalKeyMap.ContainsKey($RawKey)) {
        return $CanonicalKeyMap[$RawKey]
    }

    if ($RawKey -eq 'PASSPHRASE') {
        switch ($SectionName) {
            'KUCOIN'  { return 'KUCOIN_PASSPHRASE' }
            'OKX'     { return 'OKX_PASSPHRASE' }
            'BITGET'  { return 'BITGET_API_PASSPHRASE' }
            'BINANCE' { return 'BINANCE_PASSPHRASE' }
        }
    }

    if ($RawKey -eq 'MEMO' -and $SectionName -eq 'BITMART') {
        return 'BITMART_MEMO'
    }

    return $RawKey
}

# ── Resolve file path ─────────────────────────────────────────────────────────
$KeysFile = [System.IO.Path]::GetFullPath($KeysFile)
if (-not (Test-Path $KeysFile)) {
    Write-Error "Keys file not found: $KeysFile"
    exit 1
}

# ── Parse KEY=VALUE lines (skip comments and section headers) ─────────────────
$currentSection = ''
$pairs          = [System.Collections.Generic.List[hashtable]]::new()
$skipped        = 0

foreach ($raw in Get-Content $KeysFile) {
    $line = $raw.Trim()

    # Skip blanks and comment lines
    if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#')) { continue }

    # Section header: [MEXC], [BINANCE], etc.
    if ($line -match '^\[(.+)\]$') {
        $currentSection = $Matches[1].Trim()
        continue
    }

    # KEY=VALUE (split on first '=' only so values may contain '=')
    $eqIdx = $line.IndexOf('=')
    if ($eqIdx -lt 1) { continue }

    $key   = $line.Substring(0, $eqIdx).Trim()
    $value = $line.Substring($eqIdx + 1).Trim()

    if ([string]::IsNullOrWhiteSpace($value)) {
        Write-Warning "Skipping $key in [$currentSection] — value is blank"
        $skipped++
        continue
    }

    $canonicalKey = Resolve-SecretKey -SectionName $currentSection.ToUpper() -RawKey $key

    # Skip template placeholder values
    if ($value -like 'YOUR_*') {
        Write-Warning "Skipping $key — value looks like a placeholder ($value)"
        continue
    }

    # Filter by section if requested
    if ($Section -and $currentSection -ne $Section.ToUpper()) { continue }

    $pairs.Add(@{ Key = $canonicalKey; Value = $value; Section = $currentSection; RawKey = $key })
}

if ($pairs.Count -eq 0) {
    Write-Host "No secrets found to upload (check placeholders or -Section filter)."
    exit 0
}

$keysBySection = @{}
foreach ($pair in $pairs) {
    if (-not $keysBySection.ContainsKey($pair.Section)) {
        $keysBySection[$pair.Section] = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    }

    [void] $keysBySection[$pair.Section].Add($pair.Key)
}

foreach ($sectionName in $RequiredSecretsBySection.Keys) {
    if (-not $keysBySection.ContainsKey($sectionName)) {
        continue
    }

    $missingKeys = @()
    foreach ($requiredKey in $RequiredSecretsBySection[$sectionName]) {
        if (-not $keysBySection[$sectionName].Contains($requiredKey)) {
            $missingKeys += $requiredKey
        }
    }

    if ($missingKeys.Count -gt 0) {
        Write-Warning "[$sectionName] Missing required secret(s): $($missingKeys -join ', ')"
    }
}

# ── Upload ────────────────────────────────────────────────────────────────────
$ok      = 0
$failed  = 0

Write-Host ""
Write-Host "==================================================="
Write-Host " Nexus Arbitrage Hub — Upload Secrets to Cloudflare"
Write-Host "==================================================="
if ($DryRun) { Write-Host " *** DRY RUN — no secrets will be uploaded ***" -ForegroundColor Yellow }
Write-Host ""

foreach ($pair in $pairs) {
    $label = "[$($pair.Section)] $($pair.Key)"
    if ($pair.RawKey -ne $pair.Key) {
        $label += " (from $($pair.RawKey))"
    }

    if ($DryRun) {
        Write-Host "  [DRY-RUN] Would upload: $label" -ForegroundColor Cyan
        $ok++
        continue
    }

    Write-Host "  Uploading $label ..." -NoNewline

    try {
        # Pipe the value into wrangler secret put via stdin
        $pair.Value | npx --yes wrangler secret put $pair.Key 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "wrangler exited with code $LASTEXITCODE" }

        Write-Host " OK" -ForegroundColor Green
        $ok++
    }
    catch {
        Write-Host " FAILED: $_" -ForegroundColor Red
        $failed++
    }
}

Write-Host ""
Write-Host "---------------------------------------------------"
if ($DryRun) {
    Write-Host "Dry run complete. $ok secret(s) would be uploaded."
} else {
    Write-Host "Done. $ok uploaded, $failed failed, $skipped skipped."
}
Write-Host ""

if ($failed -gt 0) { exit 1 }
