param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('health', 'status', 'dashboard', 'start', 'stop', 'scan', 'test-alert')]
  [string]$Action,

  [string]$BaseUrl = 'https://ultimate-arbitrage-hft.zedanazad43.workers.dev',
  [string]$AdminToken = '',
  [switch]$UseQueryToken,
  [switch]$NoPrompt
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'common.ps1')

$protectedActions = @('start', 'stop', 'scan', 'test-alert')
$disablePrompt = $NoPrompt -or (Test-NonInteractiveSession)
$resolvedAdminToken = if ($protectedActions -contains $Action) {
  Resolve-Setting -ScriptRoot $PSScriptRoot -Name 'ADMIN_TOKEN' -ExplicitValue $AdminToken -PromptMessage 'Enter ADMIN_TOKEN' -DisablePrompt:$disablePrompt
}
else {
  $AdminToken
}

if ($protectedActions -contains $Action -and [string]::IsNullOrWhiteSpace($resolvedAdminToken)) {
  throw 'ADMIN_TOKEN is required for protected actions. Pass -AdminToken, set ADMIN_TOKEN in the environment, or add it to .dev.vars.'
}

$actionPath = switch ($Action) {
  'test-alert' { 'debug/fail' }
  'status' { 'status' }
  default { $Action }
}
$trimmedBaseUrl = Get-ValidatedAbsoluteHttpUrl -Name 'BaseUrl' -Value $BaseUrl
$uriBuilder = [System.UriBuilder]::new("$trimmedBaseUrl/$actionPath")
$headers = @{}

if ($protectedActions -contains $Action) {
  if ($UseQueryToken) {
    $uriBuilder.Query = "token=$([System.Uri]::EscapeDataString($resolvedAdminToken))"
  }
  else {
    $headers['x-admin-token'] = $resolvedAdminToken
    $headers['Authorization'] = "Bearer $resolvedAdminToken"
  }
}

try {
  $response = Invoke-WebRequest -UseBasicParsing -Method Get -Uri $uriBuilder.Uri.AbsoluteUri -Headers $headers
  $response.Content
}
catch {
  $details = $_.Exception.Message
  if ($_.ErrorDetails -and -not [string]::IsNullOrWhiteSpace($_.ErrorDetails.Message)) {
    $details = $_.ErrorDetails.Message
  }
  throw "Admin action '$Action' failed: $details"
}
