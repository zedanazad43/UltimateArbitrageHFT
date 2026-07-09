param(
    [Nullable[int]]$MinConfidenceScore,

    [Nullable[int]]$MinHistoryPoints,

    [string]$ConfigPath = '',

    [switch]$Deploy
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'common.ps1')

if ($null -eq $MinConfidenceScore -and $null -eq $MinHistoryPoints) {
    throw 'Specify at least one setting: -MinConfidenceScore or -MinHistoryPoints.'
}

if ($null -ne $MinConfidenceScore -and ($MinConfidenceScore -lt 0 -or $MinConfidenceScore -gt 100)) {
    throw 'MinConfidenceScore must be between 0 and 100.'
}

if ($null -ne $MinHistoryPoints -and $MinHistoryPoints -lt 1) {
    throw 'MinHistoryPoints must be at least 1.'
}

$resolvedConfigPath = if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    Get-DefaultWranglerConfigPath -ScriptRoot $PSScriptRoot
}
else {
    $ConfigPath
}

$resolvedPath = Resolve-Path $resolvedConfigPath
$content = Get-Content $resolvedPath -Raw

function Set-TomlVarValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TomlContent,
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    $replacement = '{0} = "{1}"' -f $Name, $Value
    $escapedName = [regex]::Escape($Name)
    $pattern = '(?m)^{0}\s*=\s*".*"\s*$' -f $escapedName

    if ($TomlContent -match $pattern) {
        return [regex]::Replace($TomlContent, $pattern, $replacement)
    }

    $varsHeaderPattern = '(?m)^\[vars\]\s*$'
    if ($TomlContent -match $varsHeaderPattern) {
        return [regex]::Replace($TomlContent, $varsHeaderPattern, "[vars]`r`n$replacement")
    }

    return $TomlContent.TrimEnd() + "`r`n`r`n[vars]`r`n$replacement`r`n"
}

if ($null -ne $MinConfidenceScore) {
    $content = Set-TomlVarValue -TomlContent $content -Name 'MIN_CONFIDENCE_SCORE' -Value $MinConfidenceScore
}

if ($null -ne $MinHistoryPoints) {
    $content = Set-TomlVarValue -TomlContent $content -Name 'MIN_HISTORY_POINTS' -Value $MinHistoryPoints
}

Set-Content -Path $resolvedPath -Value $content -NoNewline

$updatedConfidence = Get-WranglerVarValue -ScriptRoot $PSScriptRoot -Name 'MIN_CONFIDENCE_SCORE' -ConfigPath $resolvedPath
$updatedHistory = Get-WranglerVarValue -ScriptRoot $PSScriptRoot -Name 'MIN_HISTORY_POINTS' -ConfigPath $resolvedPath

Write-Host "Updated strategy vars in $resolvedPath"
Write-Host "MIN_CONFIDENCE_SCORE=$updatedConfidence"
Write-Host "MIN_HISTORY_POINTS=$updatedHistory"

if ($Deploy) {
    $projectRoot = Get-ProjectRootPath -ScriptRoot $PSScriptRoot
    Push-Location $projectRoot
    try {
        & npx wrangler deploy
    }
    finally {
        Pop-Location
    }
}