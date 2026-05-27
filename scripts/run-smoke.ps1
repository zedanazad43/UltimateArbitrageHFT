[CmdletBinding()]
param(
    [string] $Token = '',
    [string] $BaseUrl = '',
    [string] $CustomBaseUrl = 'https://api.ecostamp.net',
    [string] $ExpectedWorkerName = 'ultimatearbitragehft',
    [switch] $RequireReadyForLive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedToken = if ($Token) { $Token } else { $env:WORKFLOW_ADMIN_TOKEN }
if (-not $resolvedToken) { $resolvedToken = $env:ADMIN_TOKEN }
if (-not $resolvedToken) {
    throw 'Provide -Token or set WORKFLOW_ADMIN_TOKEN/ADMIN_TOKEN.'
}

$env:WORKFLOW_ADMIN_TOKEN = $resolvedToken
$env:EXPECTED_WORKER_NAME = $ExpectedWorkerName
$env:CUSTOM_BASE_URL = $CustomBaseUrl
$env:REQUIRE_READY_FOR_LIVE = if ($RequireReadyForLive.IsPresent) { 'true' } else { 'false' }
if ($BaseUrl) {
    $env:BASE_URL = $BaseUrl
} else {
    Remove-Item Env:BASE_URL -ErrorAction SilentlyContinue
}

node ./scripts/verify-production-endpoints.js
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host 'Smoke verification passed.' -ForegroundColor Green
