# تأكد أنك تملك HTMLAgilityPack عبر NuGet لأول مرة (لمرة واحدة فقط)
if (-not (Get-PackageProvider -Name NuGet -ErrorAction SilentlyContinue)) {
    Install-PackageProvider -Name NuGet -Force
}

if (-not (Get-Module -ListAvailable -Name HtmlAgilityPack)) {
  Install-Module -Name HtmlAgilityPack -Scope CurrentUser -Force
}

Import-Module HtmlAgilityPack

# رابط موقعك
$siteUrl = "https://ultimatearbitragehft.zedanazad43.workers.dev/"

# 1. جلب الصفحة
try {
    $response = Invoke-WebRequest -Uri $siteUrl -UseBasicParsing
    Write-Host "`nتم تحميل الصفحة بنجاح: $siteUrl`n"
    $html = $response.Content
} catch {
    Write-Host "تعذر تحميل الصفحة: $siteUrl"
    return
}

# 2. تحليل كود الـ HTML واستخراج الأزرار
[HtmlAgilityPack.HtmlDocument]$doc = New-Object HtmlAgilityPack.HtmlDocument
$doc.LoadHtml($html)
$buttons = $doc.DocumentNode.SelectNodes("//button | //input[@type='button' or @type='submit']")

if ($null -eq $buttons) {
    Write-Host "لم يتم العثور على أي زر في الصفحة."
    return
}

Write-Host "`nتقرير أزرار الموقع:"
$counter = 1
foreach ($btn in $buttons) {
    $id      = $btn.GetAttributeValue("id", "")
    $btnType = $btn.Name
    $txt     = $btn.GetAttributeValue("value", $btn.InnerText)
    $onclick = $btn.GetAttributeValue("onclick", "")
    if ($onclick -ne "") {
        $status = "✅ الزر فيه Event مباشر (onclick)"
    } else {
        $status = "⚠️ الزر ليس فيه Event مباشر (تحقق من وجود Listeners بالجافاسكريبت)."
    }
    Write-Host ("زر رقم $counter: النوع=$btnType، النصّ/قيمة='$txt'، id='$id'، حالة التفعيل: $status")
    $counter++
}

Write-Host "`nانتهى التقرير."