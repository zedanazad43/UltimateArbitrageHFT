# run_bot.ps1 - سكريبت تشغيل البوت
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   MEGA ARBITRAGE BOT LAUNCHER" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# الانتقال إلى المجلد الصحيح
Set-Location "C:\MegaArbitrageBot"

# التحقق من وجود Python
$pythonVersion = python --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Python is not installed. Please install Python 3.9+" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Python: $pythonVersion" -ForegroundColor Green

# إنشاء البيئة الافتراضية
if (-not (Test-Path "venv")) {
    Write-Host "📦 Creating virtual environment..." -ForegroundColor Yellow
    python -m venv venv
}

# تفعيل البيئة
Write-Host "🔧 Activating virtual environment..." -ForegroundColor Yellow
& .\venv\Scripts\Activate.ps1

# تثبيت المكتبات
Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
pip install -r requirements.txt

# التحقق من وجود ملف المفاتيح
if (-not (Test-Path "keys\api_keys.txt")) {
    Write-Host "⚠️ API keys file not found!" -ForegroundColor Red
    Write-Host "Please create keys\api_keys.txt with your API keys" -ForegroundColor Yellow
    exit 1
}

# تشغيل البوت
Write-Host "🚀 Starting bot..." -ForegroundColor Green
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

python main_bot.py

Write-Host ""
Write-Host "👋 Bot stopped" -ForegroundColor Cyan
