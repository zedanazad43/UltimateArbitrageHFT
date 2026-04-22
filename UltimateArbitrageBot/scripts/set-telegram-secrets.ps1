param(
  [string]$BotToken = '',
  [string]$ChatId = '',
  [string]$ConfigPath = '',
  [switch]$SkipUpload
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'common.ps1')

$botToken = Resolve-Setting -ScriptRoot $PSScriptRoot -Name 'TELEGRAM_BOT_TOKEN' -ExplicitValue $BotToken -PromptMessage 'Enter TELEGRAM_BOT_TOKEN'
$chatId = Resolve-Setting -ScriptRoot $PSScriptRoot -Name 'TELEGRAM_CHAT_ID' -ExplicitValue $ChatId -PromptMessage 'Enter TELEGRAM_CHAT_ID'

if ([string]::IsNullOrWhiteSpace($botToken) -or [string]::IsNullOrWhiteSpace($chatId)) {
  throw "Both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required."
}

$wranglerArgs = Get-WranglerArgs -ConfigPath $ConfigPath

if ($SkipUpload) {
  Write-Host 'Validated Telegram secrets and skipped wrangler upload.'
  return
}

try {
  $botToken | npx wrangler versions secret put TELEGRAM_BOT_TOKEN @wranglerArgs
  $chatId | npx wrangler versions secret put TELEGRAM_CHAT_ID @wranglerArgs
} catch {
  $details = $_.Exception.Message
  if ($_.ErrorDetails -and -not [string]::IsNullOrWhiteSpace($_.ErrorDetails.Message)) {
    $details = $_.ErrorDetails.Message
  }
  throw "Uploading Telegram secrets failed: $details"
}

Write-Host "Telegram secrets uploaded successfully."