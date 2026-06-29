param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('paper', 'live')]
  [string]$Mode,

  [string]$BaseUrl = 'https://ultimate-arbitrage-hft.zedanazad43.workers.dev',
  [string]$AdminToken = '',
  [switch]$NoPrompt
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'common.ps1')

$disablePrompt = $NoPrompt -or (Test-NonInteractiveSession)
$resolvedAdminToken = Resolve-Setting `
  -ScriptRoot $PSScriptRoot `
  -Name 'ADMIN_TOKEN' `
  -ExplicitValue $AdminToken `
  -PromptMessage 'Enter ADMIN_TOKEN' `
  -DisablePrompt:$disablePrompt

if ([string]::IsNullOrWhiteSpace($resolvedAdminToken)) {
  throw 'ADMIN_TOKEN is required. Pass -AdminToken, set ADMIN_TOKEN in the environment, or add it to .dev.vars.'
}

$trimmedBaseUrl = Get-ValidatedAbsoluteHttpUrl -Name 'BaseUrl' -Value $BaseUrl
$uri = "$trimmedBaseUrl/mode/$Mode"

try {
  $response = Invoke-WebRequest -UseBasicParsing -Method Get -Uri $uri `
    -Headers @{ 'x-admin-token' = $resolvedAdminToken }
  Write-Host $response.Content
} catch {
  $details = $_.Exception.Message
  if ($_.ErrorDetails -and -not [string]::IsNullOrWhiteSpace($_.ErrorDetails.Message)) {
    $details = $_.ErrorDetails.Message
  }
  throw "Setting trading mode to '$Mode' failed: $details"
}
