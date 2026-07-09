param(
  [Parameter(Mandatory = $true)]
  [string]$ChatIds,

  [string]$ConfigPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'common.ps1')

$resolvedConfigPath = if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  Get-DefaultWranglerConfigPath -ScriptRoot $PSScriptRoot
} else {
  Resolve-ScriptRelativePath -ScriptRoot $PSScriptRoot -Path $ConfigPath
}

$resolvedPath = Resolve-Path $resolvedConfigPath
$content = Get-Content $resolvedPath -Raw
$normalized = ConvertTo-NormalizedDelimitedValues -Value $ChatIds

if ($normalized.Count -eq 0) {
  throw 'At least one chat id is required.'
}

$replacement = 'ALLOWED_CHAT_IDS = "' + ($normalized -join ',') + '"'

if ($content -match '(?m)^ALLOWED_CHAT_IDS\s*=\s*".*"\s*$') {
  $content = [regex]::Replace($content, '(?m)^ALLOWED_CHAT_IDS\s*=\s*".*"\s*$', $replacement)
} else {
  $content = $content.TrimEnd() + "`r`n" + $replacement + "`r`n"
}

Set-Content -Path $resolvedPath -Value $content -NoNewline
Write-Host "Updated ALLOWED_CHAT_IDS in $resolvedPath to: $($normalized -join ',')"