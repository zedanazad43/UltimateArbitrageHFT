# fix_stalled_global.ps1 — إضافة غلاف عام لـ fetch يحل تحذيرات HTTP المتوقفة
# ضع هذا الملف في مجلد المشروع الرئيسي (حيث يوجد wrangler.toml)
# ثم نفذه من PowerShell:
#   powershell -ExecutionPolicy Bypass -File .\fix_stalled_global.ps1

$ErrorActionPreference = "Stop"
$srcPath = "src"

# ابحث عن الملف الرئيسي الذي يحتوي على CF_ACCESS_AUD (أحد ثوابت Cloudflare Access)
Write-Host "البحث عن الملف الرئيسي للبوت..." -ForegroundColor Cyan
$mainFiles = Get-ChildItem -Path $srcPath -Recurse -Include *.ts, *.js, *.mjs | 
             Select-String -Pattern "CF_ACCESS_AUD" -List | 
             Select-Object -ExpandProperty Path

if (-not $mainFiles) {
    Write-Host "لم يتم العثور على الملف الرئيسي (يبحث عن 'CF_ACCESS_AUD'). تأكد من وجوده في src/" -ForegroundColor Red
    exit 1
}

$mainFile = $mainFiles[0]
Write-Host "تم العثور على: $mainFile" -ForegroundColor Green

# اقرأ محتوى الملف
$content = Get-Content $mainFile -Raw

# كود الغلاف الذي سنضيفه
$wrapperCode = @'

// ─── Global fetch wrapper – يمنع تحذيرات HTTP المتوقفة تلقائياً ─────────
const _originalFetch = globalThis.fetch;
globalThis.fetch = async function patchedFetch(resource, options) {
  const response = await _originalFetch(resource, options);
  // إذا لم يُقرأ الـ body بعد 1 مللي ثانية، ألغِهِ تلقائياً
  let consumed = false;
  const bodyMethods = ['arrayBuffer', 'blob', 'formData', 'json', 'text'];
  for (const method of bodyMethods) {
    const original = response[method];
    if (typeof original === 'function') {
      response[method] = function (...args) {
        consumed = true;
        return original.apply(response, args);
      };
    }
  }
  // راقب الجسم – إذا لم يُستهلك، ألغِهِ
  setTimeout(() => {
    if (!consumed && response.body && !response.bodyUsed) {
      response.body.cancel();
    }
  }, 1);
  return response;
};

'@

# تحقق إذا كان الغلاف موجوداً مسبقاً لتجنب التكرار
if ($content -match "patchedFetch") {
    Write-Host "الغلاف العالمي لـ fetch موجود مسبقاً. لا حاجة للإضافة." -ForegroundColor Yellow
} else {
    # أدخل الغلاف قبل أول سطر يحتوي على 'const CF_ACCESS_AUD'
    $newContent = $content -replace "(const CF_ACCESS_AUD)", "$wrapperCode`n`$1"
    Set-Content $mainFile -Value $newContent
    Write-Host "تم إدراج غلاف fetch العالمي في $mainFile" -ForegroundColor Green
}

# رفع التعديلات إلى Cloudflare
Write-Host "`nرفع التعديلات إلى Cloudflare..." -ForegroundColor Cyan
npx wrangler deploy

Write-Host "`nتم الانتهاء. انتظر قليلاً ثم شغّل npx wrangler tail لتأكيد اختفاء التحذيرات." -ForegroundColor Green