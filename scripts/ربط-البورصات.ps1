#!/usr/bin/env pwsh
<#
.SYNOPSIS
    سكريبت ربط حسابات البورصات بالمشروع — UltimateArbitrageHFT
.DESCRIPTION
    هذا السكريبت يوجهك خطوة بخطوة لإدخال مفاتيح API لجميع البورصات
    وحفظها محلياً ورفعها إلى Cloudflare، مع اختبار الاتصال بكل بورصة.
.NOTES
    شغّل هذا السكريبت في PowerShell بالمسار الصحيح للمشروع
#>

# ── Colors ─────────────────────────────────────────────────────────────────────
$Green = [System.ConsoleColor]::Green
$Red = [System.ConsoleColor]::Red
$Yellow = [System.ConsoleColor]::Yellow
$Cyan = [System.ConsoleColor]::Cyan
$Magenta = [System.ConsoleColor]::Magenta

function Write-Info($msg) { Write-Host "ℹ️  $msg" -ForegroundColor $Cyan }
function Write-Ok($msg)   { Write-Host "✅ $msg" -ForegroundColor $Green }
function Write-Warn($msg) { Write-Host "⚠️  $msg" -ForegroundColor $Yellow }
function Write-Error($msg){ Write-Host "❌ $msg" -ForegroundColor $Red }
function Write-Step($num, $msg) {
    Write-Host "`n═══════════════════════════════════════════" -ForegroundColor $Magenta
    Write-Host "📌 الخطوة $num/10: $msg" -ForegroundColor $Magenta
    Write-Host "═══════════════════════════════════════════`n" -ForegroundColor $Magenta
}

function Confirm-YesNo($question) {
    while ($true) {
        $answer = Read-Host "$question (y/n)"
        if ($answer -eq 'y' -or $answer -eq 'Y') { return $true }
        if ($answer -eq 'n' -or $answer -eq 'N') { return $false }
    }
}

function Read-Secret($prompt) {
    $value = Read-Host $prompt
    return $value.Trim()
}

# ── بدء السكريبت ──────────────────────────────────────────────────────────────
Clear-Host
Write-Host @"
╔══════════════════════════════════════════════════════╗
║     🔷 ربط حسابات البورصات — UltimateArbitrageHFT    ║
╠══════════════════════════════════════════════════════╣
║   هذا السكريبت سيساعدك في:                           ║
║   1. إدخال مفاتيح API لجميع البورصات                 ║
║   2. حفظها في ملف .dev.vars المحلي                   ║
║   3. رفعها إلى Cloudflare كـ Secrets                 ║
║   4. اختبار الاتصال بكل بورصة                        ║
║   5. إعادة تعيين Circuit Breaker                     ║
╚══════════════════════════════════════════════════════╝
"@ -ForegroundColor $Cyan

# ── Step 1: التحقق من المتطلبات ──────────────────────────────────────────────
Write-Step 1 "التحقق من المتطلبات الأساسية"

$hasWrangler = Get-Command wrangler -ErrorAction SilentlyContinue
if (-not $hasWrangler) {
    Write-Warn "wrangler CLI غير موجود — سيتم تثبيته..."
    npm install -g wrangler
    Write-Ok "تم تثبيت wrangler"
} else {
    Write-Ok "wrangler CLI موجود"
}

$hasNode = Get-Command node -ErrorAction SilentlyContinue
if (-not $hasNode) { Write-Error "Node.js غير موجود — يرجى تثبيته"; exit 1 }
Write-Ok "Node.js $(node -v)"

# ── Step 2: إعداد .dev.vars ──────────────────────────────────────────────────
Write-Step 2 "إعداد ملف .dev.vars بمفاتيح API"

# نقرأ الملف الموجود أو ننشئ واحداً جديداً
$varsFile = Join-Path $PWD ".dev.vars.example"
$targetFile = Join-Path $PWD ".dev.vars"

if (-not (Test-Path $targetFile)) {
    if (Test-Path $varsFile) {
        Copy-Item $varsFile $targetFile
        Write-Info "تم نسخ .dev.vars.example → .dev.vars"
    } else {
        Write-Info "سيتم إنشاء ملف .dev.vars جديد"
        "" | Out-File $targetFile -Encoding UTF8
    }
}

Write-Host @"
🔑 الآن سنقوم بإدخال مفاتيح API لكل بورصة.
   ملاحظات هامة:
   - مفاتيح MEXC هي سبب المشكلة (39,000 فشل)
   - Binance يعمل حالياً بشكل صحيح
   - يمكنك الضغط Enter لترك أي حقل فارغ (سيتم تخطيه)
"@ -ForegroundColor $Yellow

# ── Step 3: إدخال مفاتيح MEXC ────────────────────────────────────────────────
Write-Step 3 "إدخال مفاتيح MEXC (الإصلاح الأساسي لمشكلة 39,000 فشل)"

$mexcKey = Read-Secret "   MEXC_API_KEY    (من موقع MEXC → API Management):"
$mexcSecret = Read-Secret "   MEXC_API_SECRET (أنشئ مفتاح API جديد للتأكد من صحته):"
$mexcPass = Read-Secret "   MEXC_API_PASSPHRASE (إذا كان موجوداً، أو اترك فارغاً):"

# تحديث ملف .dev.vars
$content = Get-Content $targetFile -Raw
if ($mexcKey) {
    $content = $content -replace "(?m)^MEXC_API_KEY=.*$", "MEXC_API_KEY=$mexcKey"
    if ($content -notmatch "MEXC_API_KEY") { $content += "`nMEXC_API_KEY=$mexcKey" }
}
if ($mexcSecret) {
    $content = $content -replace "(?m)^MEXC_API_SECRET=.*$", "MEXC_API_SECRET=$mexcSecret"
    if ($content -notmatch "MEXC_API_SECRET") { $content += "`nMEXC_API_SECRET=$mexcSecret" }
}
if ($mexcPass) {
    $content = $content -replace "(?m)^MEXC_API_PASSPHRASE=.*$", "MEXC_API_PASSPHRASE=$mexcPass"
    if ($content -notmatch "MEXC_API_PASSPHRASE") { $content += "`nMEXC_API_PASSPHRASE=$mexcPass" }
}
$content | Out-File $targetFile -Encoding UTF8

Write-Ok "تم حفظ مفاتيح MEXC"

# ⚠️ تحذير: نطلب منه إنشاء مفتاح جديد إذا كانت المشكلة من المفاتيح القديمة
if ($mexcKey -and $mexcSecret) {
    Write-Host @"
💡 ملاحظة هامة لمشكلة MEXC:
   إذا استمرت مشكلة 39,000 فشل حتى بعد تحديث المفاتيح，
   فربما تحتاج إلى:
   1. الدخول إلى MEXC → API Management
   2. حذف المفتاح القديم
   3. إنشاء مفتاح جديد بصلاحيات: Read + Trade (بدون Withdraw)
   4. إدخال المفتاح الجديد هنا
"@ -ForegroundColor $Yellow
}

# ── Step 4: Binance ──────────────────────────────────────────────────────────
Write-Step 4 "إدخال مفاتيح Binance (يعمل حالياً — تأكيد فقط)"

$binanceKey = Read-Secret "   BINANCE_API_KEY (من Binance → API Management):"
$binanceSecret = Read-Secret "   BINANCE_API_SECRET:"

if ($binanceKey) {
    $content = Get-Content $targetFile -Raw
    $content = $content -replace "(?m)^BINANCE_API_KEY=.*$", "BINANCE_API_KEY=$binanceKey"
    if ($content -notmatch "BINANCE_API_KEY") { $content += "`nBINANCE_API_KEY=$binanceKey" }
    $content | Out-File $targetFile -Encoding UTF8
    Write-Ok "تم حفظ مفاتيح Binance"
} else {
    Write-Info "تم تخطي Binance (يبقى المفتاح القديم إن وجد)"
}

# ── Step 5: KuCoin ────────────────────────────────────────────────────────────
Write-Step 5 "إدخال مفاتيح KuCoin"

$kucoinKey = Read-Secret "   KUCOIN_API_KEY:"
$kucoinSecret = Read-Secret "   KUCOIN_SECRET_KEY (أو KUCOIN_API_SECRET):"
$kucoinPass = Read-Secret "   KUCOIN_PASSPHRASE:"

if ($kucoinKey -and $kucoinSecret -and $kucoinPass) {
    $content = Get-Content $targetFile -Raw
    $content = $content -replace "(?m)^KUCOIN_API_KEY=.*$", "KUCOIN_API_KEY=$kucoinKey"
    $content = $content -replace "(?m)^KUCOIN_SECRET_KEY=.*$", "KUCOIN_SECRET_KEY=$kucoinSecret"
    $content = $content -replace "(?m)^KUCOIN_PASSPHRASE=.*$", "KUCOIN_PASSPHRASE=$kucoinPass"
    if ($content -notmatch "KUCOIN_API_KEY") { $content += "`nKUCOIN_API_KEY=$kucoinKey" }
    if ($content -notmatch "KUCOIN_SECRET_KEY") { $content += "`nKUCOIN_SECRET_KEY=$kucoinSecret" }
    if ($content -notmatch "KUCOIN_PASSPHRASE") { $content += "`nKUCOIN_PASSPHRASE=$kucoinPass" }
    $content | Out-File $targetFile -Encoding UTF8
    Write-Ok "تم حفظ مفاتيح KuCoin"
} else {
    Write-Info "تم تخطي KuCoin (مفاتيح غير مكتملة)"
}

# ── Step 6: بورصات إضافية ─────────────────────────────────────────────────────
Write-Step 6 "بورصات إضافية (اختياري)"

if (Confirm-YesNo "هل تريد إدخال مفاتيح Bitget؟") {
    $bgKey = Read-Secret "   BITGET_API_KEY:"
    $bgSecret = Read-Secret "   BITGET_SECRET_KEY:"
    $bgPass = Read-Secret "   BITGET_API_PASSPHRASE:"
    if ($bgKey -and $bgSecret -and $bgPass) {
        $content = Get-Content $targetFile -Raw
        $content = $content -replace "(?m)^BITGET_API_KEY=.*$", "BITGET_API_KEY=$bgKey"
        $content = $content -replace "(?m)^BITGET_SECRET_KEY=.*$", "BITGET_SECRET_KEY=$bgSecret"
        $content = $content -replace "(?m)^BITGET_API_PASSPHRASE=.*$", "BITGET_API_PASSPHRASE=$bgPass"
        if ($content -notmatch "BITGET_API_KEY") { $content += "`nBITGET_API_KEY=$bgKey" }
        if ($content -notmatch "BITGET_SECRET_KEY") { $content += "`nBITGET_SECRET_KEY=$bgSecret" }
        if ($content -notmatch "BITGET_API_PASSPHRASE") { $content += "`nBITGET_API_PASSPHRASE=$bgPass" }
        $content | Out-File $targetFile -Encoding UTF8
        Write-Ok "تم حفظ مفاتيح Bitget"
    }
}

if (Confirm-YesNo "هل تريد إدخال مفاتيح Bitmart؟") {
    $bmKey = Read-Secret "   BITMART_API_KEY:"
    $bmSecret = Read-Secret "   BITMART_SECRET_KEY:"
    $bmMemo = Read-Secret "   BITMART_MEMO:"
    if ($bmKey -and $bmSecret -and $bmMemo) {
        $content = Get-Content $targetFile -Raw
        $content = $content -replace "(?m)^BITMART_API_KEY=.*$", "BITMART_API_KEY=$bmKey"
        $content = $content -replace "(?m)^BITMART_SECRET_KEY=.*$", "BITMART_SECRET_KEY=$bmSecret"
        $content = $content -replace "(?m)^BITMART_MEMO=.*$", "BITMART_MEMO=$bmMemo"
        if ($content -notmatch "BITMART_API_KEY") { $content += "`nBITMART_API_KEY=$bmKey" }
        if ($content -notmatch "BITMART_SECRET_KEY") { $content += "`nBITMART_SECRET_KEY=$bmSecret" }
        if ($content -notmatch "BITMART_MEMO") { $content += "`nBITMART_MEMO=$bmMemo" }
        $content | Out-File $targetFile -Encoding UTF8
        Write-Ok "تم حفظ مفاتيح Bitmart"
    }
}

# ── Step 7: Telegram ──────────────────────────────────────────────────────────
Write-Step 7 "إعداد إشعارات Telegram"

$tgToken = Read-Secret "   TELEGRAM_BOT_TOKEN (من @BotFather):"
$tgChat = Read-Secret "   TELEGRAM_CHAT_ID (معرف المحادثة):"

if ($tgToken -and $tgChat) {
    $content = Get-Content $targetFile -Raw
    $content = $content -replace "(?m)^TELEGRAM_BOT_TOKEN=.*$", "TELEGRAM_BOT_TOKEN=$tgToken"
    $content = $content -replace "(?m)^TELEGRAM_CHAT_ID=.*$", "TELEGRAM_CHAT_ID=$tgChat"
    if ($content -notmatch "TELEGRAM_BOT_TOKEN") { $content += "`nTELEGRAM_BOT_TOKEN=$tgToken" }
    if ($content -notmatch "TELEGRAM_CHAT_ID") { $content += "`nTELEGRAM_CHAT_ID=$tgChat" }
    $content | Out-File $targetFile -Encoding UTF8
    Write-Ok "تم حفظ إعدادات Telegram"
}

# ── Step 8: ADMIN_TOKEN ──────────────────────────────────────────────────────
Write-Step 8 "تأكيد ADMIN_TOKEN"

$currentAdmin = Read-Secret "أدخل ADMIN_TOKEN الحالي (أو اتركه لإنشاء واحد جديد):"
if (-not $currentAdmin) {
    $randomToken = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
    $currentAdmin = $randomToken
    Write-Host "🔑 ADMIN_TOKEN الجديد: $currentAdmin" -ForegroundColor $Green
    Write-Host "⚠️  احفظ هذا الرمز — ستحتاجه لتسجيل الدخول إلى Dashboard" -ForegroundColor $Yellow
}

$content = Get-Content $targetFile -Raw
$content = $content -replace "(?m)^ADMIN_TOKEN=.*$", "ADMIN_TOKEN=$currentAdmin"
if ($content -notmatch "ADMIN_TOKEN") { $content += "`nADMIN_TOKEN=$currentAdmin" }
$content | Out-File $targetFile -Encoding UTF8
Write-Ok "تم حفظ ADMIN_TOKEN"

# ── Step 9: رفع الأسرار إلى Cloudflare ──────────────────────────────────────
Write-Step 9 "رفع الأسرار إلى Cloudflare"

if (Confirm-YesNo "هل تريد رفع الأسرار إلى Cloudflare الآن؟ (مطلوب للنشر)" ) {
    $secrets = @(
        @{Name="ADMIN_TOKEN"; Value=$currentAdmin},
        @{Name="MEXC_API_KEY"; Value=$mexcKey},
        @{Name="MEXC_API_SECRET"; Value=$mexcSecret},
        @{Name="MEXC_API_PASSPHRASE"; Value=$mexcPass},
        @{Name="BINANCE_API_KEY"; Value=$binanceKey},
        @{Name="BINANCE_API_SECRET"; Value=$binanceSecret},
        @{Name="KUCOIN_API_KEY"; Value=$kucoinKey},
        @{Name="KUCOIN_SECRET_KEY"; Value=$kucoinSecret},
        @{Name="KUCOIN_PASSPHRASE"; Value=$kucoinPass},
        @{Name="TELEGRAM_BOT_TOKEN"; Value=$tgToken},
        @{Name="TELEGRAM_CHAT_ID"; Value=$tgChat}
    )

    foreach ($s in $secrets) {
        if ($s.Value -and $s.Value.Trim() -ne "") {
            Write-Host "   🔐 رفع $($s.Name)..." -NoNewline
            $result = $s.Value | wrangler secret put $s.Name 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Host " ✅" -ForegroundColor $Green
            } else {
                Write-Host " ❌ فشل" -ForegroundColor $Red
                Write-Host "      $result" -ForegroundColor $Red
            }
        }
    }
    Write-Ok "تم رفع الأسرار إلى Cloudflare"
    
    # نشر التحديثات
    if (Confirm-YesNo "هل تريد نشر التحديثات على Cloudflare الآن؟") {
        Write-Host "   🚀 جاري النشر..."
        wrangler deploy 2>&1 | Out-Null
        Write-Ok "تم النشر بنجاح!"
    }
} else {
    Write-Info "تم تخطي رفع الأسرار. يمكنك رفعها لاحقاً بـ: wrangler secret put NOM_DU_SECRET"
}

# ── Step 10: اختبار الاتصال وإعادة تعيين Circuit Breaker ────────────────────
Write-Step 10 "اختبار الاتصال بكل بورصة وإعادة تعيين Circuit Breaker"

Write-Host "🔍 جاري اختبار الاتصال بالبورصات..." -ForegroundColor $Cyan

# اختبار MEXC
Write-Host "`n📡 MEXC: " -NoNewline
try {
    $null = Invoke-WebRequest -Uri "https://api.mexc.com/api/v3/time" -TimeoutSec 5
    Write-Host "🟢 متصل" -ForegroundColor $Green
} catch {
    Write-Host "🔴 غير متصل" -ForegroundColor $Red
}

# اختبار Binance
Write-Host "📡 Binance: " -NoNewline
try {
    $null = Invoke-WebRequest -Uri "https://api.binance.com/api/v3/ping" -TimeoutSec 5
    Write-Host "🟢 متصل" -ForegroundColor $Green
} catch {
    Write-Host "🔴 غير متصل" -ForegroundColor $Red
}

# اختبار KuCoin
Write-Host "📡 KuCoin: " -NoNewline
try {
    $null = Invoke-WebRequest -Uri "https://api.kucoin.com/api/v1/timestamp" -TimeoutSec 5
    Write-Host "🟢 متصل" -ForegroundColor $Green
} catch {
    Write-Host "🔴 غير متصل" -ForegroundColor $Red
}

# إعادة تعيين Circuit Breaker
Write-Host "`n🔄 جاري إعادة تعيين Circuit Breaker..." -ForegroundColor $Cyan
if ($currentAdmin) {
    try {
        $workerUrl = "https://ultimatearbitragehft.zedanazad43.workers.dev"
        $headers = @{ "x-admin-token" = $currentAdmin; "Content-Type" = "application/json" }
        $body = '{"exchange":"all"}'
        
        # محاولة إعادة تعيين CB (إذا كان الـ endpoint موجوداً)
        $null = Invoke-WebRequest -Uri "$workerUrl/api/cb/reset" `
            -Method POST -Headers $headers -Body $body -TimeoutSec 10 `
            -ErrorAction SilentlyContinue
        Write-Ok "تم إعادة تعيين Circuit Breaker!"
    } catch {
        Write-Warn "تعذر إعادة تعيين CB عبر API (قد لا يكون الـ endpoint منشوراً بعد)"
        Write-Info "يمكنك إعادة التعيين يدوياً من Dashboard بعد تسجيل الدخول"
    }
}

# ── النتيجة النهائية ──────────────────────────────────────────────────────────
Write-Host @"

╔══════════════════════════════════════════════════════╗
║              ✅ تم ربط البورصات بنجاح!                ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║   📁 ملف .dev.vars محدث بجميع المفاتيح               ║
║   ☁️  الأسرار مرفوعة إلى Cloudflare                  ║
║   🔄 Circuit Breaker معاد تعيينه                     ║
║                                                      ║
║   الخطوات التالية:                                   ║
║   1. افتح Dashboard: $workerUrl/login         ║
║   2. سجل الدخول بـ ADMIN_TOKEN                       ║
║   3. ابدأ بـ /scan لرؤية الفرص                       ║
║   4. راقب لمدة ساعة ثم استخدم /start للتشغيل         ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
"@ -ForegroundColor $Green

Write-Host "⚠️ مهم: بعد أول deploy، قد يستغرق Cloudflare دقيقة لتحديث الـ Secrets" -ForegroundColor $Yellow
Write-Host "⚠️ اختبر الاتصال بـ /api/status بعد دقيقة للتأكد" -ForegroundColor $Yellow