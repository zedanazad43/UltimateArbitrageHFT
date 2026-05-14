[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$WithSecurityAudit,
    [switch]$Deploy,
    [switch]$Commit,
    [string]$CommitMessage = "chore: production preflight updates",
    [switch]$Push
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][scriptblock]$Script
    )

    Write-Host "`n==================== $Title ====================" -ForegroundColor Cyan
    & $Script
}

Invoke-Step -Title '1) Git status (before)' -Script {
    git status
}

if (-not $SkipInstall) {
    Invoke-Step -Title '2) Install dependencies (clean)' -Script {
        npm ci
    }
}

Invoke-Step -Title '3) Production preflight (lint + tests + build check + secrets check)' -Script {
    npm run preflight:prod
}

if ($WithSecurityAudit) {
    Invoke-Step -Title '4) Security audit (no auto-fix)' -Script {
        npm run audit:security
    }
}

if ($Deploy) {
    Invoke-Step -Title '5) Deploy to Cloudflare Worker' -Script {
        npm run deploy
    }
}

if ($Commit) {
    Invoke-Step -Title '6) Commit staged changes (if any)' -Script {
        git add .
        git commit -m $CommitMessage
    }
}

if ($Push) {
    Invoke-Step -Title '7) Push current branch' -Script {
        git push origin HEAD
    }
}

Invoke-Step -Title '8) Git status (after)' -Script {
    git status
}

Write-Host "`n✅ Production preflight completed successfully." -ForegroundColor Green
Write-Host "ℹ️ Use -Deploy to publish, -Commit/-Push to publish code changes." -ForegroundColor Yellow