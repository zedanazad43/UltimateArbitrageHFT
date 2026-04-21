function Get-ProjectRootPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptRoot
  )

  return Split-Path -Parent $ScriptRoot
}

function Get-DevVarsValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptRoot,
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $rootPath = Get-ProjectRootPath -ScriptRoot $ScriptRoot
  $devVarsPath = Join-Path $rootPath '.dev.vars'
  if (-not (Test-Path $devVarsPath)) {
    return $null
  }

  foreach ($line in [System.IO.File]::ReadAllLines($devVarsPath)) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line.TrimStart().StartsWith('#')) { continue }
    $parts = $line -split '=', 2
    if ($parts.Count -ne 2) { continue }
    if ($parts[0].Trim() -ne $Name) { continue }
    return $parts[1].Trim().Trim('"').Trim("'")
  }

  return $null
}

function Resolve-ScriptRelativePath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptRoot,
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if ([string]::IsNullOrWhiteSpace($Path)) {
    throw 'Path is required.'
  }

  if ([System.IO.Path]::IsPathRooted($Path)) {
    return $Path
  }

  $projectRoot = Get-ProjectRootPath -ScriptRoot $ScriptRoot
  return Join-Path $projectRoot $Path
}

function Get-WranglerVarValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptRoot,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [string]$ConfigPath = ''
  )

  $resolvedConfigPath = if (-not [string]::IsNullOrWhiteSpace($ConfigPath)) {
    Resolve-ScriptRelativePath -ScriptRoot $ScriptRoot -Path $ConfigPath
  }
  else {
    Get-DefaultWranglerConfigPath -ScriptRoot $ScriptRoot
  }

  if (-not (Test-Path $resolvedConfigPath)) {
    return $null
  }

  $inVarsBlock = $false
  foreach ($line in [System.IO.File]::ReadAllLines($resolvedConfigPath)) {
    $trimmedLine = $line.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmedLine) -or $trimmedLine.StartsWith('#')) {
      continue
    }

    if ($trimmedLine -match '^\[vars\]$') {
      $inVarsBlock = $true
      continue
    }

    if ($inVarsBlock -and $trimmedLine.StartsWith('[')) {
      break
    }

    if (-not $inVarsBlock) {
      continue
    }

    $parts = $trimmedLine -split '=', 2
    if ($parts.Count -ne 2) {
      continue
    }

    if ($parts[0].Trim() -ne $Name) {
      continue
    }

    return $parts[1].Trim().Trim('"').Trim("'")
  }

  return $null
}

function Resolve-Setting {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptRoot,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [string]$ExplicitValue = '',
    [string]$PromptMessage = '',
    [switch]$DisablePrompt
  )

  if (-not [string]::IsNullOrWhiteSpace($ExplicitValue)) {
    return $ExplicitValue
  }

  $envValue = [Environment]::GetEnvironmentVariable($Name)
  if (-not [string]::IsNullOrWhiteSpace($envValue)) {
    return $envValue
  }

  $devVarsValue = Get-DevVarsValue -ScriptRoot $ScriptRoot -Name $Name
  if (-not [string]::IsNullOrWhiteSpace($devVarsValue)) {
    return $devVarsValue
  }

  if ($DisablePrompt) {
    return ''
  }

  return Read-Host ($PromptMessage ? $PromptMessage : "Enter $Name")
}

function Get-ValidatedAbsoluteHttpUrl {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  $trimmedValue = $Value.Trim()
  if ([string]::IsNullOrWhiteSpace($trimmedValue)) {
    throw "$Name is required."
  }

  try {
    $uri = [System.Uri]::new($trimmedValue)
  }
  catch {
    throw "$Name must be a valid absolute http(s) URL."
  }

  if (-not $uri.IsAbsoluteUri -or ($uri.Scheme -ne 'http' -and $uri.Scheme -ne 'https')) {
    throw "$Name must be a valid absolute http(s) URL."
  }

  return $uri.AbsoluteUri.TrimEnd('/')
}

function Test-NonInteractiveSession {
  if ($env:CI -match '^(1|true)$') {
    return $true
  }

  if ($env:GITHUB_ACTIONS -match '^(1|true)$') {
    return $true
  }

  if ($env:TF_BUILD -match '^(1|true)$') {
    return $true
  }

  try {
    if ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected -or [Console]::IsErrorRedirected) {
      return $true
    }
  }
  catch {
  }

  return $Host.Name -match 'ServerRemoteHost'
}

function Get-WranglerArgs {
  param(
    [string]$ConfigPath = ''
  )

  $wranglerArgs = @()
  if (-not [string]::IsNullOrWhiteSpace($ConfigPath)) {
    $wranglerArgs += @('--config', $ConfigPath)
  }

  return $wranglerArgs
}

function ConvertTo-NormalizedDelimitedValues {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyString()]
    [string]$Value,
    [string]$Delimiter = ','
  )

  return @(
    $Value -split [regex]::Escape($Delimiter) |
    ForEach-Object { $_.Trim() } |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    Select-Object -Unique
  )
}

function Get-DefaultWranglerConfigPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptRoot
  )

  return Join-Path (Get-ProjectRootPath -ScriptRoot $ScriptRoot) 'wrangler.toml'
}