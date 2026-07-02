Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'common.ps1')

$projectRoot = Get-ProjectRootPath -ScriptRoot $PSScriptRoot
$testsPath = Join-Path $projectRoot 'tests\PowerShell'

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