# fix_and_deploy.ps1
# === Patch dummy price fetches to cancel response body ===

Write-Host "Patching source files to avoid stalled HTTP responses..." -ForegroundColor Cyan
$files = Get-ChildItem -Path src -Recurse -Include *.ts, *.js, *.mjs

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw

    # Pattern: fetch('https://dummy/price')
    # Replace with: fetch('https://dummy/price').then(r => { r.body?.cancel(); return r })
    $updated = $content -replace "fetch\('https://dummy/price'\)",
        "fetch('https://dummy/price').then(r => { r.body?.cancel(); return r })"

    if ($updated -ne $content) {
        Set-Content $file.FullName -Value $updated
        Write-Host "  Updated $($file.Name)" -ForegroundColor Green
    }
}

Write-Host "`nRedeploying worker..." -ForegroundColor Cyan
npx wrangler deploy