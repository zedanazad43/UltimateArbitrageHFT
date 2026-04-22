param(
  [string]$ApiKey = '',
  [string]$ApiSecret = '',
  [string]$ConfigPath = '',
  [switch]$SkipUpload,
  [switch]$NoPrompt
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'common.ps1')

$disablePrompt = $NoPrompt -or (Test-NonInteractiveSession)

$resolvedApiKey = Resolve-Setting `
  -ScriptRoot $PSScriptRoot `
  -Name 'MEXC_API_KEY' `
  -ExplicitValue $ApiKey `
  -PromptMessage 'Enter MEXC_API_KEY' `
  -DisablePrompt:$disablePrompt

$resolvedApiSecret = Resolve-Setting `
  -ScriptRoot $PSScriptRoot `
  -Name 'MEXC_API_SECRET' `
  -ExplicitValue $ApiSecret `
  -PromptMessage 'Enter MEXC_API_SECRET' `
  -DisablePrompt:$disablePrompt

if ([string]::IsNullOrWhiteSpace($resolvedApiKey)) {
  throw 'MEXC_API_KEY is required. Pass -ApiKey, set MEXC_API_KEY in the environment, or add it to .dev.vars.'
}

if ([string]::IsNullOrWhiteSpace($resolvedApiSecret)) {
  throw 'MEXC_API_SECRET is required. Pass -ApiSecret, set MEXC_API_SECRET in the environment, or add it to .dev.vars.'
}

$wranglerArgs = Get-WranglerArgs -ConfigPath $ConfigPath

if ($SkipUpload) {
  Write-Host 'Validated MEXC secrets and skipped wrangler upload.'
  return
}

try {
  $resolvedApiKey | npx wrangler versions secret put MEXC_API_KEY @wranglerArgs
  $resolvedApiSecret | npx wrangler versions secret put MEXC_API_SECRET @wranglerArgs
} catch {
  $details = $_.Exception.Message
  if ($_.ErrorDetails -and -not [string]::IsNullOrWhiteSpace($_.ErrorDetails.Message)) {
    $details = $_.ErrorDetails.Message
  }
  throw "Uploading MEXC secrets failed: $details"
}

Write-Host 'MEXC secrets uploaded successfully.'
