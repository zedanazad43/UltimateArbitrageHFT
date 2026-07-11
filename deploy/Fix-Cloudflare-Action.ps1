# Fix Cloudflare GitHub Action Deployment Issues

# 1. Remove 'persist' from [observability] in wrangler.toml
$wranglerToml = "wrangler.toml"

if (Test-Path $wranglerToml) {
    $content = Get-Content $wranglerToml
    $observabilityOpened = $false
    $fixedContent = @()

    foreach ($line in $content) {
        if ($line.Trim() -match "^\[observability\]$") {
            $observabilityOpened = $true
            $fixedContent += $line
            continue
        }

        if ($observabilityOpened) {
            # Remove any line with 'persist'
            if ($line.Trim() -match "^persist\s*=") {
                continue
            }
            # End observability if we hit a new section
            if ($line.Trim() -match "^\[.*\]$") {
                $observabilityOpened = $false
            }
        }
        $fixedContent += $line
    }
    $fixedContent | Set-Content $wranglerToml
    Write-Host "✅ Fixed: Removed 'persist' from [observability] in wrangler.toml"
} else {
    Write-Warning "wrangler.toml not found in the current directory."
}

# 2. Reminder to check your GitHub repository secrets for Cloudflare
Write-Host ""
Write-Host "⚠️  Ensure your GitHub repository secrets are set correctly:"
Write-Host "    - CLOUDFLARE_API_TOKEN"
Write-Host "    - CLOUDFLARE_ACCOUNT_ID"
Write-Host "Visit: https://github.com/zedanazad43/ArbitrageBot/settings/secrets/actions"
Write-Host ""

# 3. Optional: Ensure 'wrangler' is in devDependencies
if (Test-Path "package.json") {
    $package = Get-Content "package.json" -Raw | ConvertFrom-Json
    if (-not ($package.devDependencies.PSObject.Properties.Name -contains "wrangler")) {
        Write-Host "⚠️  'wrangler' is not found in devDependencies. To add it, run:" -ForegroundColor Yellow
        Write-Host "    npm install --save-dev wrangler"
    } else {
        Write-Host "✅ 'wrangler' found in devDependencies."
    }
} else {
    Write-Warning "package.json not found, skipping devDependencies check."
}