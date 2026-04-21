Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'common.ps1')

$rootPath = Get-ProjectRootPath -ScriptRoot $PSScriptRoot
Set-Location $rootPath

$checks = @(
  @{ Name = 'Worker health'; Script = { & ".\scripts\invoke-admin-action.ps1" -Action health | Out-Host } },
  @{ Name = 'Admin token helper'; Script = { & ".\scripts\set-admin-token.ps1" -SkipUpload | Out-Host } },
  @{ Name = 'Telegram secrets helper'; Script = { & ".\scripts\set-telegram-secrets.ps1" -BotToken 'test-token' -ChatId '1771005847' -SkipUpload | Out-Host } },
  @{ Name = 'Telegram webhook test'; Script = { & ".\scripts\test-telegram-webhook.ps1" -Command '/status' -ChatId '1771005847' | Out-Host } },
  @{ Name = 'Allowed chats updater'; Script = {
      $tmp = Join-Path $env:TEMP ("wrangler-validate-" + [guid]::NewGuid().ToString() + ".toml")
      Copy-Item ".\wrangler.toml" $tmp
      try {
        & ".\scripts\set-allowed-chats.ps1" -ChatIds '1771005847,123456789,1771005847' -ConfigPath $tmp | Out-Host
        Get-Content $tmp | Select-String 'ALLOWED_CHAT_IDS' | Out-Host
      } finally {
        if (Test-Path $tmp) {
          Remove-Item $tmp -Force
        }
      }
    } }
)

foreach ($check in $checks) {
  Write-Host "[validate] $($check.Name)"
  & $check.Script
}

Write-Host 'Operational validation completed successfully.'