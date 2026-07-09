param(
  [string]$Command = '/status',
  [string]$WebhookUrl = 'https://ultimate-arbitrage-hft.zedanazad43.workers.dev/telegram/webhook',
  [string]$ChatId = '',
  [string]$FirstName = 'Webhook',
  [string]$Username = 'ultimate_arbitrage_bot_test',
  [switch]$NoPrompt
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'common.ps1')

$disablePrompt = $NoPrompt -or (Test-NonInteractiveSession)
$resolvedChatId = Resolve-Setting -ScriptRoot $PSScriptRoot -Name 'TELEGRAM_CHAT_ID' -ExplicitValue $ChatId -PromptMessage 'Enter TELEGRAM_CHAT_ID' -DisablePrompt:$disablePrompt
if ([string]::IsNullOrWhiteSpace($resolvedChatId)) {
  $allowedChatIds = Get-WranglerVarValue -ScriptRoot $PSScriptRoot -Name 'ALLOWED_CHAT_IDS'
  if (-not [string]::IsNullOrWhiteSpace($allowedChatIds)) {
    $resolvedChatId = (ConvertTo-NormalizedDelimitedValues -Value $allowedChatIds | Select-Object -First 1)
  }
}
if ([string]::IsNullOrWhiteSpace($resolvedChatId) -and -not $disablePrompt) {
  $resolvedChatId = Read-Host 'Enter TELEGRAM_CHAT_ID'
}
if ([string]::IsNullOrWhiteSpace($resolvedChatId)) {
  throw 'TELEGRAM_CHAT_ID is required. Pass -ChatId, set TELEGRAM_CHAT_ID in the environment, add it to .dev.vars, or define ALLOWED_CHAT_IDS in wrangler.toml.'
}

$trimmedWebhookUrl = Get-ValidatedAbsoluteHttpUrl -Name 'WebhookUrl' -Value $WebhookUrl

$payload = @{
  update_id = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  message   = @{
    message_id = 999
    date       = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    from       = @{
      id            = [int64]$resolvedChatId
      is_bot        = $false
      first_name    = $FirstName
      username      = $Username
      language_code = 'en'
    }
    chat       = @{
      id         = [int64]$resolvedChatId
      type       = 'private'
      first_name = $FirstName
      username   = $Username
    }
    text       = $Command
  }
} | ConvertTo-Json -Depth 8

try {
  $response = Invoke-RestMethod -Method Post -Uri $trimmedWebhookUrl -ContentType 'application/json' -Body $payload
  $response | ConvertTo-Json -Depth 8
}
catch {
  $details = $_.Exception.Message
  if ($_.ErrorDetails -and -not [string]::IsNullOrWhiteSpace($_.ErrorDetails.Message)) {
    $details = $_.ErrorDetails.Message
  }
  throw "Testing Telegram webhook failed: $details"
}