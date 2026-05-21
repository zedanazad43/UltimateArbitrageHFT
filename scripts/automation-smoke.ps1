#!/usr/bin/env pwsh
<#
.SYNOPSIS
    End-to-end automation for local setup, validation, paper smoke test,
    optional production deploy, and optional live smoke order.

.EXAMPLE
    pwsh -NoProfile -File ./scripts/automation-smoke.ps1 -StartLocalDev

.EXAMPLE
    pwsh -NoProfile -File ./scripts/automation-smoke.ps1 -BaseUrl "https://ultimatearbitragehft.zedanazad43.workers.dev" -AdminToken "<token>" -DeployProduction

.EXAMPLE
    pwsh -NoProfile -File ./scripts/automation-smoke.ps1 -BaseUrl "https://ultimatearbitragehft.zedanazad43.workers.dev" -AdminToken "<token>" -RunLiveSmoke -AllowLiveOrder
#>

[CmdletBinding()]
param(
    [string] $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
    [string] $BaseUrl = 'http://127.0.0.1:8787',
    [string] $AdminToken = $env:ADMIN_TOKEN,
    [switch] $StartLocalDev,
    [switch] $DeployProduction,
    [switch] $RunLiveSmoke,
    [switch] $AllowLiveOrder,
    [switch] $AllowLocalLiveOrder,
    [string] $Exchange = 'binance',
    [string] $Symbol = 'BTCUSDT',
    [double] $Quantity = 0.0001,
    [double] $SizeUsd = 5,
    [int] $HealthWaitSeconds = 120
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Step {
    param(
        [string] $Message,
        [ValidateSet('INFO', 'WARN', 'OK', 'ERR')] [string] $Level = 'INFO'
    )
    $prefix = switch ($Level) {
        'INFO' { '[INFO]' }
        'WARN' { '[WARN]' }
        'OK'   { '[ OK ]' }
        'ERR'  { '[ERR ]' }
    }
    Write-Host "$prefix $Message"
}

function Invoke-Npm {
    param([string[]] $Arguments)

    Push-Location $RepoRoot
    try {
        & npm @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE in '$RepoRoot'. Check package.json scripts and installed dependencies."
        }
    }
    finally {
        Pop-Location
    }
}

function Resolve-AdminToken {
    param([string] $CurrentToken, [string] $Root)
    if (-not [string]::IsNullOrWhiteSpace($CurrentToken)) {
        return $CurrentToken
    }

    $devVarsPath = Join-Path $Root '.dev.vars'
    if (-not (Test-Path $devVarsPath)) {
        return ''
    }

    $line = Get-Content $devVarsPath | Where-Object { $_ -match '^\s*ADMIN_TOKEN\s*=\s*.+$' } | Select-Object -First 1
    if (-not $line) {
        return ''
    }

    return ($line -replace '^\s*ADMIN_TOKEN\s*=\s*', '').Trim()
}

function Invoke-AdminApi {
    param(
        [ValidateSet('GET', 'POST')] [string] $Method,
        [string] $Path,
        [object] $Body,
        [string] $Token,
        [string] $Url
    )

    if ([string]::IsNullOrWhiteSpace($Token)) {
        throw 'Admin token is required for authenticated API calls.'
    }

    $headers = @{ 'x-admin-token' = $Token }
    $uri = "$Url$Path"

    if ($Method -eq 'POST') {
        if ($null -ne $Body) {
            return Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 10)
        }
        return Invoke-RestMethod -Method Post -Uri $uri -Headers $headers
    }

    return Invoke-RestMethod -Method Get -Uri $uri -Headers $headers
}

if ($RunLiveSmoke -and -not $AllowLiveOrder) {
    throw 'Refusing live smoke order without -AllowLiveOrder switch.'
}

$isLocalBaseUrl = $BaseUrl -match '^https?://(127\.0\.0\.1|localhost|0\.0\.0\.0)(:\d+)?/?$'
if ($RunLiveSmoke -and $isLocalBaseUrl -and -not $AllowLocalLiveOrder) {
    throw 'Refusing live smoke order against local URL without -AllowLocalLiveOrder switch.'
}

$devProcess = $null
$needsRollback = $false

try {
    Write-Step "Repository root: $RepoRoot"
    Write-Step "Base URL: $BaseUrl"

    Write-Step 'Installing dependencies'
    Invoke-Npm -Arguments @('install')
    Write-Step 'Dependencies installed' 'OK'

    $devVarsPath = Join-Path $RepoRoot '.dev.vars'
    $devVarsExamplePath = Join-Path $RepoRoot '.dev.vars.example'
    if (-not (Test-Path $devVarsPath) -and (Test-Path $devVarsExamplePath)) {
        Copy-Item $devVarsExamplePath $devVarsPath
        Write-Step 'Created .dev.vars from .dev.vars.example' 'OK'
    }

    Write-Step 'Running local D1 migration'
    Invoke-Npm -Arguments @('run', 'db:migrate:local')
    Write-Step 'Migration completed' 'OK'

    Write-Step 'Running lint'
    Invoke-Npm -Arguments @('run', 'lint')
    Write-Step 'Lint passed' 'OK'

    Write-Step 'Running full test suite'
    Invoke-Npm -Arguments @('run', 'test:all')
    Write-Step 'Tests passed' 'OK'

    Write-Step 'Running build dry-run'
    Invoke-Npm -Arguments @('run', 'build:check')
    Write-Step 'Build dry-run passed' 'OK'

    if ($DeployProduction) {
        Write-Step 'Deploying worker to production'
        Invoke-Npm -Arguments @('run', 'deploy')
        Write-Step 'Deployment completed' 'OK'
    }

    $AdminToken = Resolve-AdminToken -CurrentToken $AdminToken -Root $RepoRoot
    if ([string]::IsNullOrWhiteSpace($AdminToken)) {
        Write-Step 'Admin token missing: skipping API smoke checks.' 'WARN'
        return
    }

    if ($StartLocalDev) {
        Write-Step 'Starting local dev server (npm run dev)'
        $devProcess = Start-Process -FilePath 'npm' -ArgumentList @('run', 'dev') -WorkingDirectory $RepoRoot -PassThru
        Write-Step "Local dev process PID: $($devProcess.Id)"
    }

    Write-Step 'Waiting for /api/health'
    $deadline = (Get-Date).AddSeconds($HealthWaitSeconds)
    $healthy = $false
    while ((Get-Date) -lt $deadline) {
        try {
            $health = Invoke-RestMethod -Uri "$BaseUrl/api/health" -Method Get
            if ($health) {
                $healthy = $true
                break
            }
        }
        catch {}
        Start-Sleep -Seconds 2
    }
    if (-not $healthy) {
        throw "Health check timed out after $HealthWaitSeconds seconds."
    }
    Write-Step 'Health check passed' 'OK'

    Write-Step 'Switching to paper mode'
    Invoke-AdminApi -Method POST -Path '/mode/paper' -Body $null -Token $AdminToken -Url $BaseUrl | Out-Null

    Write-Step 'Starting trading loop'
    Invoke-AdminApi -Method GET -Path '/start' -Body $null -Token $AdminToken -Url $BaseUrl | Out-Null
    $needsRollback = $true

    Write-Step 'Running manual scan'
    $scanResult = Invoke-AdminApi -Method GET -Path '/scan' -Body $null -Token $AdminToken -Url $BaseUrl
    Write-Step ("Scan response: " + (($scanResult | Out-String).Trim()))

    $status = Invoke-AdminApi -Method GET -Path '/api/status' -Body $null -Token $AdminToken -Url $BaseUrl
    Write-Step ("Status mode: " + ($(if ($status.paperTrading) { 'paper' } else { 'live' })))

    if ($RunLiveSmoke) {
        Write-Step 'Switching to live mode for smoke order' 'WARN'
        Invoke-AdminApi -Method POST -Path '/mode/live' -Body $null -Token $AdminToken -Url $BaseUrl | Out-Null

        $orderBody = @{
            symbol = $Symbol
            side = 'BUY'
            quantity = $Quantity
            sizeUsd = $SizeUsd
        }
        Write-Step "Submitting live smoke order: $Exchange $Symbol qty=$Quantity sizeUsd=$SizeUsd" 'WARN'
        $orderResult = Invoke-AdminApi -Method POST -Path "/api/exchange/$Exchange/order" -Body $orderBody -Token $AdminToken -Url $BaseUrl
        Write-Step ("Live order response: " + (($orderResult | Out-String).Trim()))

        $statusAfter = Invoke-AdminApi -Method GET -Path '/api/status' -Body $null -Token $AdminToken -Url $BaseUrl
        Write-Step ("Status after live smoke: " + (($statusAfter | Out-String).Trim()))
    }

    Write-Step 'Automation completed successfully.' 'OK'
}
finally {
    if ($needsRollback -and -not [string]::IsNullOrWhiteSpace($AdminToken)) {
        try {
            Write-Step 'Rollback: switching to paper mode'
            Invoke-AdminApi -Method POST -Path '/mode/paper' -Body $null -Token $AdminToken -Url $BaseUrl | Out-Null
        }
        catch {
            Write-Step "Rollback mode/paper failed: $_" 'WARN'
        }

        try {
            Write-Step 'Rollback: stopping trading loop'
            Invoke-AdminApi -Method GET -Path '/stop' -Body $null -Token $AdminToken -Url $BaseUrl | Out-Null
        }
        catch {
            Write-Step "Rollback stop failed: $_" 'WARN'
        }
    }

    if ($null -ne $devProcess) {
        try {
            Write-Step "Stopping local dev process PID $($devProcess.Id)"
            Stop-Process -Id $devProcess.Id -Force -ErrorAction SilentlyContinue
        }
        catch {
            Write-Step "Stopping local dev process failed: $_" 'WARN'
        }
    }
}
