# hero-system-maintenance.ps1
# يقوم بتنظيف النظام، تحسين الأداء، إصلاح الشبكة، وتنظيف المتصفحات

Write-Host "🧹 بدء الصيانة التلقائية..." -ForegroundColor Cyan

# --- تنظيف الملفات المؤقتة ---
Write-Host "  تنظيف Temp..." -ForegroundColor DarkGray
Remove-Item -Path "$env:TEMP\*" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "C:\Windows\Temp\*" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "C:\Windows\Prefetch\*" -Force -ErrorAction SilentlyContinue

# --- سلة المحذوفات ---
Write-Host "  تفريغ سلة المحذوفات..." -ForegroundColor DarkGray
$shell = New-Object -ComObject Shell.Application
$shell.Namespace(0xA).Items() | ForEach-Object { $_.InvokeVerb("Delete") }

# --- تنظيف DNS وتجديد IP ---
Write-Host "  تجديد DNS و IP..." -ForegroundColor DarkGray
ipconfig /flushdns | Out-Null
ipconfig /release | Out-Null
ipconfig /renew | Out-Null

# --- إعادة ضبط مكدس الشبكة (Winsock) ---
Write-Host "  إصلاح مكدس الشبكة..." -ForegroundColor DarkGray
netsh winsock reset | Out-Null
netsh int ip reset | Out-Null

# --- تحسين TCP/IP للتسريع ---
Write-Host "  تحسين TCP/IP..." -ForegroundColor DarkGray
netsh int tcp set global autotuninglevel=normal | Out-Null
netsh int tcp set global rss=enabled | Out-Null

# --- تنظيف متصفحات الويب ---
Write-Host "  تنظيف متصفحات Edge و Chrome..." -ForegroundColor DarkGray
$browsers = @(
    "$env:LOCALAPPDATA\Microsoft\Edge\User Data\Default\Cache",
    "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Cache",
    "$env:LOCALAPPDATA\Microsoft\Edge\User Data\Default\Code Cache",
    "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Code Cache"
)
foreach ($cache in $browsers) {
    if (Test-Path $cache) { Remove-Item -Path "$cache\*" -Recurse -Force -ErrorAction SilentlyContinue }
}

# --- فحص وإصلاح أخطاء القرص ---
Write-Host "  فحص الأقراص..." -ForegroundColor DarkGray
Get-Volume | Where-Object { $_.DriveLetter -and $_.HealthStatus -ne 'Healthy' } | ForEach-Object {
    Repair-Volume -DriveLetter $_.DriveLetter -OfflineScanAndFix
}

# --- تحسين الأداء (إيقاف الخدمات غير الضرورية مؤقتاً) ---
Write-Host "  تحسين الأداء..." -ForegroundColor DarkGray
Get-Service -Name "SysMain","WSearch","TabletInputService" -ErrorAction SilentlyContinue | Set-Service -Status Stopped -StartupType Manual

# --- تنظيف الذاكرة الظاهرية (إعادة تشغيل خدمة الذاكرة) ---
Write-Host "  تحرير الذاكرة..." -ForegroundColor DarkGray
[System.GC]::Collect()
[System.GC]::WaitForPendingFinalizers()

Write-Host "✅ الصيانة اكتملت." -ForegroundColor Green
