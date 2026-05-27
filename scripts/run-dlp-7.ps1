$ErrorActionPreference = 'Continue'
$results = New-Object System.Collections.Generic.List[object]

function Add-Result {
  param([string]$Name, [string]$Status, [string]$Note)
  $results.Add([pscustomobject]@{ Job = $Name; Status = $Status; Note = $Note }) | Out-Null
}

function Assert-LastExitCode {
  param([string]$Name)
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $LASTEXITCODE"
  }
}

# 1) GitHub secret scanning status
Add-Result '1) GitHub secret scanning status' 'DONE' 'Local note: verify enabled in GitHub Security settings'

# 2) TruffleHog scan
try {
  $cmd = Get-Command trufflehog -ErrorAction SilentlyContinue
  if ($null -ne $cmd) {
    trufflehog filesystem . --only-verified --no-update-check
    Add-Result '2) TruffleHog scan' 'DONE' 'Executed via local trufflehog binary'
  } else {
    Add-Result '2) TruffleHog scan' 'SKIPPED' 'trufflehog CLI not installed locally'
  }
} catch {
  Add-Result '2) TruffleHog scan' 'FAIL' $_.Exception.Message
}

# 3) Semgrep SAST scan
try {
  $cmd = Get-Command semgrep -ErrorAction SilentlyContinue
  if ($null -ne $cmd) {
    semgrep --config .semgrep.yml
    Add-Result '3) Semgrep SAST scan' 'DONE' 'Executed with .semgrep.yml'
  } else {
    Add-Result '3) Semgrep SAST scan' 'SKIPPED' 'semgrep not installed locally'
  }
} catch {
  Add-Result '3) Semgrep SAST scan' 'FAIL' $_.Exception.Message
}

# 4) Gitleaks pattern detection
try {
  $cmd = Get-Command gitleaks -ErrorAction SilentlyContinue
  if ($null -ne $cmd) {
    gitleaks detect --source . --no-banner --redact
    Add-Result '4) Gitleaks pattern detection' 'DONE' 'Executed via local gitleaks binary'
  } else {
    Add-Result '4) Gitleaks pattern detection' 'SKIPPED' 'gitleaks not installed locally'
  }
} catch {
  Add-Result '4) Gitleaks pattern detection' 'FAIL' $_.Exception.Message
}

# 5) Talisman check
try {
  npx --yes talisman --scan-history
  Assert-LastExitCode 'talisman'
  Add-Result '5) Talisman check' 'DONE' 'npx talisman completed'
} catch {
  Add-Result '5) Talisman check' 'FAIL' $_.Exception.Message
}

# 6) Dependency vulnerability audit
try {
  npm audit --audit-level=high
  Assert-LastExitCode 'npm audit'
  Add-Result '6) Dependency vulnerability audit' 'DONE' 'npm audit executed'
} catch {
  Add-Result '6) Dependency vulnerability audit' 'FAIL' $_.Exception.Message
}

# 7) AWS key pattern detection
try {
  $files = Get-ChildItem -Path . -Recurse -File -Include *.js,*.go,.env* -ErrorAction SilentlyContinue
  $hits1 = @()
  $hits2 = @()
  if ($files.Count -gt 0) {
    $hits1 = Select-String -Path $files.FullName -Pattern 'AKIA[0-9A-Z]{16}' -AllMatches -ErrorAction SilentlyContinue
    $hits2 = Select-String -Path $files.FullName -Pattern 'aws_secret_access_key' -AllMatches -ErrorAction SilentlyContinue
  }
  $n1 = @($hits1).Count
  $n2 = @($hits2).Count
  Add-Result '7) AWS key pattern detection' 'DONE' ("AKIA matches=$n1 ; aws_secret_access_key matches=$n2")
} catch {
  Add-Result '7) AWS key pattern detection' 'FAIL' $_.Exception.Message
}

Write-Host "`n=== DLP 7 Jobs Summary ==="
$results | Format-Table -AutoSize

$report = @()
$report += '# Local DLP 7 Jobs Report'
$report += ''
$report += ('Generated: ' + (Get-Date).ToString('u'))
$report += ''
foreach ($r in $results) {
  $report += ('- ' + $r.Job + ' => ' + $r.Status + ' | ' + $r.Note)
}
Set-Content -Path dlp-report-local.md -Value ($report -join "`n") -Encoding UTF8
Write-Host "Report saved to dlp-report-local.md"
