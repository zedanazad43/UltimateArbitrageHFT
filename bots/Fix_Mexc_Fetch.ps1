# Fix_Mexc_Fetch.ps1
$sourcePath = "src"

Write-Host "البحث عن طلبات contract.mexc.com غير المعالجة..." -ForegroundColor Cyan
$files = Get-ChildItem -Path $sourcePath -Recurse -Include *.ts, *.js, *.mjs

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $original = $content

    # 1. replace all fetch('https://contract.mexc.com/...') with a version that cancels body
    $content = $content -replace "fetch\s*\(\s*['`"]https://contract\.mexc\.com/([^'`"]+)['`"]\s*\)",
                                    "fetch('https://contract.mexc.com/`$1').then(r => { r.body?.cancel(); return r })"

    # 2. also handle if followed by await immediately
    $content = $content -replace "await\s+fetch\s*\(\s*['`"]https://contract\.mexc\.com/([^'`"]+)['`"]\s*\)",
                                    "await fetch('https://contract.mexc.com/`$1').then(r => { r.body?.cancel(); return r })"

    if ($content -ne $original) {
        Set-Content $file.FullName -Value $content
        Write-Host "  تم إصلاح $($file.Name)" -ForegroundColor Green
    }
}

Write-Host "`nرفع التعديلات إلى Cloudflare..." -ForegroundColor Cyan
npx wrangler deploy