#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Production backup script for D1 schema/data exports and critical config files.
    Run: ./scripts/backup-database.ps1
#>

param(
    [switch]$Full = $false,
    [switch]$Verify
)

$ErrorActionPreference = 'Stop'
$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$backupDir = Join-Path $repoRoot 'backups'
$logsDir = Join-Path $PSScriptRoot '../logs'
$dbName = 'ultimate-arbitrage-db'
$dbExportFile = Join-Path $backupDir "d1_export_$timestamp.sql"

@($backupDir, $logsDir) | ForEach-Object {
    if (-not (Test-Path $_)) {
        New-Item -ItemType Directory -Path $_ | Out-Null
    }
}

$logFile = Join-Path $logsDir "backup_$timestamp.log"

function Write-Log {
    param([string]$Message, [ValidateSet('INFO', 'WARN', 'ERROR', 'SUCCESS')]$Level = 'INFO')
    $timestamp = Get-Date -Format 'HH:mm:ss'
    $logMessage = "[$timestamp] [$Level] $Message"
    Write-Host $logMessage
    Add-Content -Path $logFile -Value $logMessage -ErrorAction SilentlyContinue
}

try {
    Write-Log "════════════════════════════════════════════════════════════" "INFO"
    Write-Log "Production Database Backup Started" "INFO"
    Write-Log "════════════════════════════════════════════════════════════" "INFO"
    Write-Log "Timestamp: $timestamp" "INFO"
    Write-Log "Full Backup: $Full" "INFO"

    Write-Log "Step 1: Exporting D1 database schema/data..." "INFO"
    $wrangler = Get-Command wrangler -ErrorAction SilentlyContinue
    if (-not $wrangler) {
        throw 'Wrangler CLI not found. Install dependencies or run via npm scripts.'
    }

    Push-Location $repoRoot
    try {
        $exportArgs = @('d1', 'export', $dbName, '--remote', '--output', $dbExportFile)
        if ($Full) {
            $exportArgs += '--table'
            $exportArgs += 'trades'
            $exportArgs += '--table'
            $exportArgs += 'admin_events'
            $exportArgs += '--table'
            $exportArgs += 'bot_events'
            $exportArgs += '--table'
            $exportArgs += 'paper_positions'
            $exportArgs += '--table'
            $exportArgs += 'backtest_runs'
        }
        & wrangler @exportArgs | Out-Null
    }
    finally {
        Pop-Location
    }
    Write-Log "  ✓ D1 export saved: $dbExportFile" "SUCCESS"

    Write-Log "Step 2: Backing up critical config files..." "INFO"
    
    $sourceFiles = @(
        'config.json',
        'wrangler.toml',
        'migrations/schema.sql',
        'package.json',
        'index.js'
    )

    $backupManifest = @{
        timestamp = $timestamp
        backupType = $Full ? 'FULL' : 'INCREMENTAL'
        d1Export = $dbExportFile
        files = @()
        checksums = @{}
    }

    foreach ($file in $sourceFiles) {
        $sourcePath = Join-Path $repoRoot $file
        
        if (Test-Path $sourcePath) {
            $filename = Split-Path $sourcePath -Leaf
            $backupPath = Join-Path $backupDir "$filename.$timestamp.bak"
            
            Copy-Item -Path $sourcePath -Destination $backupPath -Force
            $hash = (Get-FileHash -Path $sourcePath -Algorithm SHA256).Hash
            
            $backupManifest.files += @{
                source = $file
                backup = $backupPath
                size = (Get-Item $backupPath).Length
            }
            $backupManifest.checksums[$filename] = $hash
            
            Write-Log "  ✓ Backed up $filename" "SUCCESS"
        }
    }

    Write-Log "Step 3: Saving backup manifest..." "INFO"
    $manifestFile = Join-Path $backupDir "manifest_$timestamp.json"
    $backupManifest | ConvertTo-Json -Depth 10 | Out-File -FilePath $manifestFile -Encoding UTF8
    Write-Log "  ✓ Manifest saved: $manifestFile" "SUCCESS"

    if ($Verify) {
        Write-Log "Step 4: Verifying backups..." "INFO"
        
        $verifyErrors = 0
        foreach ($backup in $backupManifest.files) {
            if (Test-Path $backup.backup) {
                $backupHash = (Get-FileHash -Path $backup.backup -Algorithm SHA256).Hash
                $originalFile = Join-Path $repoRoot $backup.source
                $originalHash = (Get-FileHash -Path $originalFile -Algorithm SHA256).Hash
                
                if ($backupHash -eq $originalHash) {
                    Write-Log "  ✓ Verified: $($backup.source)" "SUCCESS"
                } else {
                    Write-Log "  ✗ Verification failed: $($backup.source) (hash mismatch)" "ERROR"
                    $verifyErrors++
                }
            } else {
                Write-Log "  ✗ Backup file not found: $($backup.backup)" "ERROR"
                $verifyErrors++
            }
        }

        if (Test-Path $dbExportFile) {
            Write-Log "  ✓ Verified D1 export exists" "SUCCESS"
        }
        else {
            Write-Log "  ✗ D1 export missing" "ERROR"
            $verifyErrors++
        }

        if ($verifyErrors -gt 0) {
            Write-Log "Verification completed with $verifyErrors error(s)" "WARN"
        } else {
            Write-Log "All backups verified successfully" "SUCCESS"
        }
    }

    Write-Log "Step 5: Cleaning up old backups..." "INFO"
    $cutoffDate = (Get-Date).AddDays(-30)
    $oldBackups = Get-ChildItem -Path $backupDir -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt $cutoffDate }
    
    $deletedCount = 0
    foreach ($backup in $oldBackups) {
        Remove-Item -Path $backup.FullName -Force -ErrorAction SilentlyContinue
        $deletedCount++
    }
    
    if ($deletedCount -gt 0) {
        Write-Log "  ✓ Deleted $deletedCount old backup(s)" "SUCCESS"
    }

    Write-Log "Step 6: Generating backup report..." "INFO"
    
    $backupStats = Get-ChildItem -Path $backupDir | Measure-Object -Property Length -Sum
    $totalSize = $backupStats.Sum / 1MB
    $backupCount = (Get-ChildItem -Path $backupDir -Filter "*.bak").Count
    
    $report = @"
╔════════════════════════════════════════════════════════════╗
║       PRODUCTION DATABASE BACKUP REPORT                   ║
╚════════════════════════════════════════════════════════════╝

📅 Backup Details
  Timestamp:               $timestamp
  Type:                    $($Full ? 'FULL' : 'INCREMENTAL')
  Backup Directory:        $backupDir
  Manifest File:           $manifestFile

📊 Backup Statistics
  Files Backed Up:         $($backupManifest.files.Count)
  Total Backup Size:       $([Math]::Round($totalSize, 2)) MB
    Total Backups Stored:    $backupCount
  Retention Period:        30 days

✅ Status: BACKUP COMPLETED SUCCESSFULLY

🔄 Restore Instructions:
    1. Import SQL export: wrangler d1 execute $dbName --remote --file=$dbExportFile
    2. Restore config files from the .bak files in $backupDir
    3. Re-run npm run verify:prod

📝 Backup Schedule:
  Recommended: Daily at 02:00 UTC
  Full Backups: Weekly on Sunday

"@

    Write-Log $report "INFO"
    $report | Out-File -FilePath "$backupDir\report_$timestamp.txt" -Encoding UTF8

    Write-Log "════════════════════════════════════════════════════════════" "SUCCESS"
    Write-Log "Backup completed successfully" "SUCCESS"
    Write-Log "════════════════════════════════════════════════════════════" "SUCCESS"
    
    exit 0
}
catch {
    Write-Log "BACKUP FAILED: $_" "ERROR"
    Write-Log "Stack trace: $($_.ScriptStackTrace)" "ERROR"
    exit 1
}
