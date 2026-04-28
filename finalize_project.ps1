# === 1. Worker Name Standardization ===
$OldWorker = "ultimate-arbitrage-hft"
$NewWorker = "arbitrage-bot"

# List of potential config/script files
$files = @(
    ".\wrangler.toml",
    ".\deploy.ps1"
) + (Get-ChildItem -Recurse -Path .\.github\workflows\ -Include *.yml,*.yaml | Select-Object -ExpandProperty FullName)

Write-Host "`n=== Ensuring unified worker name: '$NewWorker' ===`n"
foreach ($file in $files) {
    if (Test-Path $file) {
        (Get-Content $file) -replace $OldWorker, $NewWorker | Set-Content $file
        Write-Host "✅ Updated $file"
    }
}

# === 2. Secrets Safety Checks ===
$secretFiles = @(".\api_keys.txt", ".\.env")
foreach ($secFile in $secretFiles) {
    if (Test-Path $secFile) {
        $badLines = Get-Content $secFile | Select-String 'YOUR_'
        if ($badLines) {
            Write-Warning "WARNING: Placeholder values exist in $secFile. Replace them with real secrets before deployment."
            $badLines | Select-Object -First 5 | ForEach-Object { Write-Host $_.Line }
        } else {
            Write-Host "✅ $secFile has no obvious placeholder values."
        }
    }
}

# === 3. .gitignore and Repository Hygiene ===
if (Test-Path ".gitignore") {
    $g = Get-Content .gitignore
    $recommended = @(".env", "api_keys.txt", "*.env", "*.secret*", "*.bak", "secrets.env")
    foreach ($pattern in $recommended) {
        if ($g -notcontains $pattern) {
            Add-Content .gitignore $pattern
            Write-Host "Added $pattern to .gitignore"
        }
    }
} else {
    $recommended = @(".env", "api_keys.txt", "*.env", "*.secret*", "*.bak", "secrets.env")
    Set-Content .gitignore ($recommended -join "`n")
    Write-Host "Created .gitignore with recommended patterns"
}

Write-Host "`n=== .gitignore updated, check below for sensitive files ==="
Get-ChildItem -Force | Where-Object { $_.Name -like ".env" -or $_.Name -like "api_keys.txt" } | ForEach-Object { Write-Host "⚠️  $($_.Name) should NEVER be pushed to a public repo." }

# === 4. Merge/PR Reminder ===
Write-Host "`n=== Next steps: Merge your branch to main (on GitHub UI) after verifying all is well ==="
Write-Host "Go to: https://github.com/zedanazad43/UltimateArbitrageHFT/pulls"

# === 5. Documentation/README Suggestion ===
if (Test-Path ".\README.md") {
    (Get-Content .\README.md) -replace $OldWorker, $NewWorker | Set-Content .\README.md
    Write-Host "README.md references updated to new worker name."
} else {
    Write-Host "`nNo README.md found. It's best practice to create one. Here's a starter template:"
    Write-Host @"
# UltimateArbitrageHFT

Deployed Cloudflare Worker: \`arbitrage-bot\`

## Setup
1. Copy \`api_keys.txt\` or \`.env\` **with real keys/secrets** to the project root.
2. Run \`npm install\`
3. Run tests: \`npm test\` (all must PASS)
4. Deploy: \`npm run deploy\` or \`wrangler deploy\`
5. **Secrets are managed via \`api_keys.txt\` or \`.env\`. These files MUST NOT be in version control!**

Check \`.gitignore\` is correct!

## Live Worker
https://arbitrage-bot.zedanazad43.workers.dev

## Contributing / Deployment
...
"@
}

Write-Host "`n=== Script complete! Project is ready for production 🚀 ==="