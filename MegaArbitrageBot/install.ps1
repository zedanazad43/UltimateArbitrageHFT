# install.ps1 - تثبيت البوت لأول مرة
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   MEGA ARBITRAGE BOT INSTALLER" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# الانتقال إلى المجلد الصحيح
Set-Location "C:\MegaArbitrageBot"

# التحقق من وجود Python
$pythonVersion = python --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Python is not installed." -ForegroundColor Red
    Write-Host "Please install Python 3.9+ from https://python.org" -ForegroundColor Yellow
    exit 1
}
Write-Host "✅ Python: $pythonVersion" -ForegroundColor Green

# إنشاء البيئة الافتراضية
Write-Host "📦 Creating virtual environment..." -ForegroundColor Yellow
python -m venv venv

# تفعيل البيئة
Write-Host "🔧 Activating virtual environment..." -ForegroundColor Yellow
& .\venv\Scripts\Activate.ps1

# تحديث pip
Write-Host "📦 Upgrading pip..." -ForegroundColor Yellow
python -m pip install --upgrade pip

# تثبيت المكتبات
Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
pip install -r requirements.txt

Write-Host ""
Write-Host "✅ Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Edit 'keys\api_keys.txt' and add your real API keys" -ForegroundColor Yellow
Write-Host "2. Run '.\run_bot.ps1' to start the bot" -ForegroundColor Yellow
Write-Host ""
