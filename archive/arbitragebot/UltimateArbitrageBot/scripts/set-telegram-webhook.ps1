param(
  [string]$BotToken = '',
  [string]$WebhookUrl = 'https://ultimate-arbitrage-hft.zedanazad43.workers.dev/telegram/webhook',
  [string]$SecretToken = '',
  [switch]$DropPendingUpdates,
  [switch]$NoPrompt
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'common.ps1')

$resolvedBotToken = Resolve-Setting -ScriptRoot $PSScriptRoot -Name 'TELEGRAM_BOT_TOKEN' -ExplicitValue $BotToken -PromptMessage 'Enter TELEGRAM_BOT_TOKEN' -DisablePrompt:($NoPrompt -or (Test-NonInteractiveSession))
if ([string]::IsNullOrWhiteSpace($resolvedBotToken)) {
  throw 'TELEGRAM_BOT_TOKEN is required. Pass -BotToken, set TELEGRAM_BOT_TOKEN in the environment, or add it to .dev.vars.'
}

$trimmedWebhookUrl = Get-ValidatedAbsoluteHttpUrl -Name 'WebhookUrl' -Value $WebhookUrl

$body = @{
  url                  = $trimmedWebhookUrl
  drop_pending_updates = [bool]$DropPendingUpdates
}

if (-not [string]::IsNullOrWhiteSpace($SecretToken)) {
  $body.secret_token = $SecretToken
}

try {
  $response = Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$resolvedBotToken/setWebhook" -Body $body
  if (-not $response.ok) {
    throw ($response | ConvertTo-Json -Depth 8)
  }
  $response | ConvertTo-Json -Depth 8
}
catch {
  $details = $_.Exception.Message
  if ($_.ErrorDetails -and -not [string]::IsNullOrWhiteSpace($_.ErrorDetails.Message)) {
    $details = $_.ErrorDetails.Message
  }
  throw "Setting Telegram webhook failed: $details"
}