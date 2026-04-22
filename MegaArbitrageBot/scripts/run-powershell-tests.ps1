# run-powershell-tests.ps1
# Runs the MegaArbitrageBot Pester test suite.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'common.ps1')

$botRoot   = Get-BotRootPath -ScriptRoot $PSScriptRoot
$testsPath = Join-Path $botRoot 'tests\PowerShell'

if (-not (Test-Path $testsPath)) {
  throw "PowerShell tests folder not found: $testsPath"
}

$pesterModule = Get-Module -ListAvailable Pester | Select-Object -First 1
if (-not $pesterModule) {
  throw 'Pester is not installed. Install the PowerShell Pester module to run the automated tests.'
}

Import-Module Pester -MinimumVersion 3.4.0 -ErrorAction Stop | Out-Null
$result = Invoke-Pester -Path $testsPath -PassThru

if ($result.FailedCount -gt 0) {
  throw "PowerShell tests failed: $($result.FailedCount) failure(s)."
}

Write-Host 'PowerShell tests passed successfully.'
