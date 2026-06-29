#Requires -Version 7.0
# common.ps1 — shared helpers for MegaArbitrageBot scripts

function Get-BotRootPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptRoot
  )
  return Split-Path -Parent $ScriptRoot
}

function Get-EnvFilePath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptRoot
  )
  return Join-Path (Get-BotRootPath -ScriptRoot $ScriptRoot) '.env'
}

function Read-EnvFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$EnvFilePath
  )
  $values = @{}
  if (-not (Test-Path $EnvFilePath)) { return $values }
  foreach ($line in (Get-Content -Path $EnvFilePath)) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line.TrimStart().StartsWith('#')) { continue }
    $parts = $line -split '=', 2
    if ($parts.Count -ne 2) { continue }
    $key   = $parts[0].Trim()
    $value = $parts[1].Trim().Trim('"').Trim("'")
    $values[$key] = $value
  }
  return $values
}

function Resolve-BotSetting {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptRoot,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [string]$ExplicitValue   = '',
    [string]$PromptMessage   = '',
    [switch]$DisablePrompt
  )

  if (-not [string]::IsNullOrWhiteSpace($ExplicitValue)) { return $ExplicitValue }

  $envValue = [Environment]::GetEnvironmentVariable($Name)
  if (-not [string]::IsNullOrWhiteSpace($envValue)) { return $envValue }

  $existing = (Read-EnvFile -EnvFilePath (Get-EnvFilePath -ScriptRoot $ScriptRoot))[$Name]
  if (-not [string]::IsNullOrWhiteSpace($existing)) { return $existing }

  if ($DisablePrompt) { return '' }

  return Read-Host (if ($PromptMessage) { $PromptMessage } else { "Enter $Name" })
}

function Test-NonInteractiveBotSession {
  if ($env:CI           -match '^(1|true)$') { return $true }
  if ($env:GITHUB_ACTIONS -match '^(1|true)$') { return $true }
  if ($env:TF_BUILD      -match '^(1|true)$') { return $true }
  try {
    if ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected -or [Console]::IsErrorRedirected) {
      return $true
    }
  } catch {}
  return $Host.Name -match 'ServerRemoteHost'
}

function Get-ValidatedAbsoluteHttpUrl {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$Value
  )
  $trimmed = $Value.Trim()
  if ([string]::IsNullOrWhiteSpace($trimmed)) { throw "$Name is required." }
  try { $uri = [System.Uri]::new($trimmed) } catch {
    throw "$Name must be a valid absolute http(s) URL."
  }
  if (-not $uri.IsAbsoluteUri -or ($uri.Scheme -ne 'http' -and $uri.Scheme -ne 'https')) {
    throw "$Name must be a valid absolute http(s) URL."
  }
  return $uri.AbsoluteUri.TrimEnd('/')
}
