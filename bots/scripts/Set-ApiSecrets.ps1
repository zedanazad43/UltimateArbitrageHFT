#Requires -Version 7.0
<#
.SYNOPSIS
    Reads API keys from api_keys.txt and uploads them as Wrangler secrets.

.DESCRIPTION
    Parses an INI-style api_keys.txt file and uploads each recognised
    exchange key/secret as a Cloudflare Workers secret via `wrangler secret put`.

.PARAMETER KeysFile
    Path to api_keys.txt. Defaults to <repo-root>/api_keys.txt.

.PARAMETER ConfigPath
    Path to wrangler.toml. Defaults to <repo-root>/wrangler.toml.

.PARAMETER SkipUpload
    Parse and validate the file but do not upload secrets.

.PARAMETER NoPrompt
    Suppress all interactive prompts.

.EXAMPLE
    # Upload all secrets from the default api_keys.txt
    pwsh -File Set-ApiSecrets.ps1

.EXAMPLE
    # Dry-run (validate only)
    pwsh -File Set-ApiSecrets.ps1 -SkipUpload

.EXAMPLE
    # Custom file path
    pwsh -File Set-ApiSecrets.ps1 -KeysFile C:\keys\api_keys.txt
#>
param(
    [string]$KeysFile   = '',
    [string]$ConfigPath = '',
    [switch]$SkipUpload,
    [switch]$NoPrompt
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'common.ps1')

# ── Resolve paths ────────────────────────────────────────────────────────────
$projectRoot = Get-ProjectRootPath -ScriptRoot $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($KeysFile)) {
    $KeysFile = Join-Path $projectRoot 'api_keys.txt'
}
elseif (-not [System.IO.Path]::IsPathRooted($KeysFile)) {
    $KeysFile = Join-Path $projectRoot $KeysFile
}

if (-not (Test-Path $KeysFile)) {
    throw "api_keys.txt not found at: $KeysFile`nCreate it from the template (see api_keys.txt in the repo root)."
}

$wranglerArgs = Get-WranglerArgs -ConfigPath $ConfigPath

# ── INI parser ───────────────────────────────────────────────────────────────
function Read-IniFile {
    param([string]$Path)
    $result  = @{}
    $section = ''
    foreach ($raw in (Get-Content -Path $Path)) {
        $line = $raw.Trim()
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#') -or $line.StartsWith(';')) { continue }
        if ($line -match '^\[(.+)\]$') {
            $section = $Matches[1].Trim().ToUpper()
            if (-not $result.ContainsKey($section)) { $result[$section] = @{} }
            continue
        }
        $parts = $line -split '=', 2
        if ($parts.Count -ne 2 -or [string]::IsNullOrWhiteSpace($section)) { continue }
        $key = $parts[0].Trim().ToUpper()
        $val = $parts[1].Trim().Trim('"').Trim("'")
        $result[$section][$key] = $val
    }
    return $result
}

# ── Secret mapping: section → (ini-key → wrangler-secret-name) ────────────
$secretMap = [ordered]@{
    MEXC         = [ordered]@{ API_KEY = 'MEXC_API_KEY';          API_SECRET = 'MEXC_API_SECRET' }
    BINANCE      = [ordered]@{ API_KEY = 'BINANCE_API_KEY';       API_SECRET = 'BINANCE_API_SECRET' }
    OKX          = [ordered]@{ API_KEY = 'OKX_API_KEY';           API_SECRET = 'OKX_API_SECRET' }
    BITGET       = [ordered]@{ API_KEY = 'BITGET_API_KEY';        API_SECRET = 'BITGET_API_SECRET' }
    BITMART      = [ordered]@{ ACCESS_KEY = 'BITMART_ACCESS_KEY'; PRIVATE_KEY = 'BITMART_PRIVATE_KEY' }
    HYPERLIQUID  = [ordered]@{ API_KEY = 'HYPERLIQUID_API_KEY';   API_SECRET = 'HYPERLIQUID_API_SECRET' }
    POLYMARKET   = [ordered]@{ API_KEY = 'POLYMARKET_API_KEY';    API_SECRET = 'POLYMARKET_API_SECRET' }
    PRIMEXBT     = [ordered]@{ CLIENT_ID = 'PRIMEXBT_CLIENT_ID' }
    METAMASK     = [ordered]@{ ADDRESS = 'METAMASK_ADDRESS';      PRIVATE_KEY = 'METAMASK_PRIVATE_KEY' }
}

# ── Parse ─────────────────────────────────────────────────────────────────────
$ini = Read-IniFile -Path $KeysFile
Write-Host "📄 Parsed api_keys.txt — sections found: $($ini.Keys -join ', ')"

# ── Collect upload jobs ───────────────────────────────────────────────────────
$jobs = [System.Collections.Generic.List[hashtable]]::new()
$skipped = 0

foreach ($section in $secretMap.Keys) {
    if (-not $ini.ContainsKey($section)) { continue }
    foreach ($iniKey in $secretMap[$section].Keys) {
        $secretName = $secretMap[$section][$iniKey]
        $value = $ini[$section].ContainsKey($iniKey) ? $ini[$section][$iniKey] : ''
        if ([string]::IsNullOrWhiteSpace($value) -or $value -like '*your_*' -or $value -like '*YOUR_*') {
            Write-Host "  ⚠️  Skipping $secretName (placeholder/empty)"
            $skipped++
            continue
        }
        $jobs.Add(@{ SecretName = $secretName; Value = $value })
    }
}

if ($jobs.Count -eq 0) {
    Write-Host "`n⚠️  No real secrets found. Fill in api_keys.txt with your actual keys and re-run."
    exit 0
}

Write-Host "`n🔑 Secrets to upload: $($jobs.Count)  |  Skipped (empty/placeholder): $skipped"
foreach ($j in $jobs) { Write-Host "   • $($j.SecretName)" }

if ($SkipUpload) {
    Write-Host "`n✅ Validation complete. Re-run without -SkipUpload to upload secrets."
    exit 0
}

# ── Upload ────────────────────────────────────────────────────────────────────
$failed = 0
foreach ($j in $jobs) {
    try {
        Write-Host "  ↑ Uploading $($j.SecretName) ..."
        $j.Value | npx wrangler versions secret put $j.SecretName @wranglerArgs
        Write-Host "  ✅ $($j.SecretName) uploaded."
    }
    catch {
        $msg = $_.Exception.Message
        Write-Warning "  ❌ Failed to upload $($j.SecretName): $msg"
        $failed++
    }
}

if ($failed -gt 0) {
    throw "$failed secret(s) failed to upload. Check the output above."
}

Write-Host "`n🐋 All secrets uploaded successfully. Bot is ready for live trading."
