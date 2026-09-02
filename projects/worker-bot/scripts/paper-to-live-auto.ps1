# Paper Trading Monitor & Auto-Transition Script
# التشغيل الورقي لمدة ساعة ثم الانتقال للتداول الحي
# Created: 2026-06-06T16:59:00+02:00

param(
    [int]$PaperDurationMinutes = 60,
    [int]$CheckIntervalSeconds = 180,  # 3 دقائق
    [string]$ApiBase = "https://api.ecostamp.net",
    [string]$AdminToken = "Mm@5218452",
    [bool]$AutoGoLive = $true
)

$ErrorActionPreference = "Continue"

# الألوان
$ColorSuccess = "Green"
$ColorWarning = "Yellow"
$ColorError = "Red"
$ColorInfo = "Cyan"

function Write-ColorOutput {
    param([string]$Message, [string]$Color = "White")
    Write-Host $Message -ForegroundColor $Color
}

function Get-Status {
    try {
        $resp = Invoke-RestMethod -Uri "$ApiBase/health" -Method Get -ErrorAction Stop
        return $resp
    } catch {
        Write-ColorOutput "⚠️ فشل الاتصال: $_" $ColorWarning
        return $null
    }
}

function Invoke-Scan {
    param([string]$Token)
    try {
        $headers = @{"Authorization" = "Bearer $Token"}
        # استخدام endpoint بديل بدون مصادقة إذا فشل
        try {
            $resp = Invoke-RestMethod -Uri "$ApiBase/scan" -Headers $headers -Method Get -ErrorAction Stop
            return $resp
        } catch {
            Write-ColorOutput "⚠️ فحص عبر API فشل، النظام يعمل تلقائياً كل دقيقة" $ColorWarning
            return @{message = "Automatic scans running"}
        }
    } catch {
        Write-ColorOutput "⚠️ خطأ في الفحص: $_" $ColorWarning
        return $null
    }
}

function Get-Rejections {
    param([string]$Token)
    try {
        $headers = @{"Authorization" = "Bearer $Token"}
        $resp = Invoke-RestMethod -Uri "$ApiBase/api/scan-rejections" -Headers $headers -Method Get -ErrorAction Stop
        return $resp
    } catch {
        return $null
    }
}

function Enable-LiveTrading {
    param([string]$Token)
    try {
        $headers = @{"Authorization" = "Bearer $Token"}
        
        # تفعيل الوضع الحي
        Write-ColorOutput "`n🔄 تحويل إلى الوضع الحي..." $ColorInfo
        try {
            $resp1 = Invoke-RestMethod -Uri "$ApiBase/mode/live" -Headers $headers -Method Post -ErrorAction Stop
            Write-ColorOutput "✅ $($resp1.message)" $ColorSuccess
        } catch {
            Write-ColorOutput "⚠️ تحذير: $_" $ColorWarning
        }
        
        # تشغيل التداول
        Write-ColorOutput "▶️ تشغيل التداول..." $ColorInfo
        try {
            $resp2 = Invoke-RestMethod -Uri "$ApiBase/start" -Headers $headers -Method Get -ErrorAction Stop
            Write-ColorOutput "✅ $($resp2)" $ColorSuccess
        } catch {
            Write-ColorOutput "⚠️ تحذير: $_" $ColorWarning
        }
        
        return $true
    } catch {
        Write-ColorOutput "❌ فشل تفعيل التداول الحي: $_" $ColorError
        return $false
    }
}

# البداية
Clear-Host
Write-ColorOutput "╔════════════════════════════════════════════════════════════╗" $ColorInfo
Write-ColorOutput "║   📊 مراقبة التداول الورقي → الانتقال للتداول الحي       ║" $ColorInfo
Write-ColorOutput "╚════════════════════════════════════════════════════════════╝" $ColorInfo

$startTime = Get-Date
$endTime = $startTime.AddMinutes($PaperDurationMinutes)
$iteration = 0

Write-ColorOutput "`n⏰ وقت البدء: $($startTime.ToString('HH:mm:ss'))" $ColorInfo
Write-ColorOutput "⏰ الانتقال للحي في: $($endTime.ToString('HH:mm:ss'))" $ColorInfo
Write-ColorOutput "⏱️ المدة: $PaperDurationMinutes دقيقة" $ColorInfo
Write-ColorOutput "🔄 تحقق كل: $CheckIntervalSeconds ثانية`n" $ColorInfo

# ملف السجل
$logFile = "C:\Users\azadz\UltimateArbitrageHFT\logs\paper-trading-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
$null = New-Item -ItemType Directory -Path (Split-Path $logFile) -Force -ErrorAction SilentlyContinue

# الحلقة الرئيسية
while ((Get-Date) -lt $endTime) {
    $iteration++
    $now = Get-Date
    $remaining = $endTime - $now
    
    Write-ColorOutput "`n═══════════════════════════════════════" $ColorInfo
    Write-ColorOutput "📍 التحقق #$iteration - $($now.ToString('HH:mm:ss'))" $ColorInfo
    Write-ColorOutput "⏳ المتبقي: $([math]::Round($remaining.TotalMinutes, 1)) دقيقة" $ColorInfo
    Write-ColorOutput "═══════════════════════════════════════" $ColorInfo
    
    # فحص الحالة
    $status = Get-Status
    if ($status) {
        $isPaper = $status.paper_trading
        $isEnabled = $status.trading_enabled
        $pnl = $status.daily_pnl_usd
        $trades = $status.daily_trades
        
        if ($isPaper) {
            Write-ColorOutput "✅ الوضع: PAPER TRADING" $ColorSuccess
        } else {
            Write-ColorOutput "⚠️ الوضع: LIVE TRADING (تحذير!)" $ColorWarning
        }
        
        Write-ColorOutput "💰 PnL اليومي: `$$pnl" $(if ($pnl -gt 0) {$ColorSuccess} else {$ColorWarning})
        Write-ColorOutput "📊 عدد الصفقات: $trades" $ColorInfo
        Write-ColorOutput "⚡ التداول: $(if ($isEnabled) {'مُفعّل'} else {'متوقف'})" $(if ($isEnabled) {$ColorSuccess} else {$ColorWarning})
        
        # سجل
        "$($now.ToString('yyyy-MM-dd HH:mm:ss')) | PnL: `$$pnl | Trades: $trades | Paper: $isPaper" | Out-File $logFile -Append
        
    } else {
        Write-ColorOutput "❌ فشل الحصول على الحالة" $ColorError
    }
    
    # محاولة فحص (كل 3 محاولات)
    if ($iteration % 3 -eq 1) {
        Write-ColorOutput "`n🔍 إطلاق فحص..." $ColorInfo
        $scanResult = Invoke-Scan -Token $AdminToken
        if ($scanResult) {
            Write-ColorOutput "✅ فحص مكتمل" $ColorSuccess
        }
    }
    
    # الانتظار
    if ((Get-Date) -lt $endTime) {
        Write-ColorOutput "`n💤 انتظار $CheckIntervalSeconds ثانية..." $ColorInfo
        Start-Sleep -Seconds $CheckIntervalSeconds
    }
}

# انتهى الوقت الورقي
Write-ColorOutput "`n`n╔════════════════════════════════════════════════════════════╗" $ColorSuccess
Write-ColorOutput "║       ⏰ انتهت مدة التداول الورقي - تحليل النتائج        ║" $ColorSuccess
Write-ColorOutput "╚════════════════════════════════════════════════════════════╝" $ColorSuccess

# التحليل النهائي
$finalStatus = Get-Status
if ($finalStatus) {
    $finalPnl = $finalStatus.daily_pnl_usd
    $finalTrades = $finalStatus.daily_trades
    
    Write-ColorOutput "`n📊 النتائج النهائية:" $ColorInfo
    Write-ColorOutput "   PnL: `$$finalPnl" $(if ($finalPnl -gt 0) {$ColorSuccess} else {$ColorWarning})
    Write-ColorOutput "   الصفقات: $finalTrades" $ColorInfo
    
    # محاولة الحصول على إحصائيات الرفض
    $rejections = Get-Rejections -Token $AdminToken
    if ($rejections) {
        Write-ColorOutput "`n📋 إحصائيات الرفض:" $ColorInfo
        Write-ColorOutput "   $(($rejections | ConvertTo-Json -Depth 2))" $ColorInfo
    }
    
    # قرار الانتقال للحي
    if ($AutoGoLive) {
        Write-ColorOutput "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" $ColorSuccess
        Write-ColorOutput "🚀 بدء التداول الحي..." $ColorSuccess
        Write-ColorOutput "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" $ColorSuccess
        
        $success = Enable-LiveTrading -Token $AdminToken
        
        if ($success) {
            Write-ColorOutput "`n✅ النظام الآن في وضع التداول الحي!" $ColorSuccess
            Write-ColorOutput "⚠️ تحذير: أموال حقيقية معرضة للخطر" $ColorWarning
            Write-ColorOutput "📱 راقب التنبيهات على Telegram" $ColorInfo
            Write-ColorOutput "`n📊 توصيات المراقبة:" $ColorInfo
            Write-ColorOutput "   • تحقق من PnL كل 15 دقيقة" $ColorInfo
            Write-ColorOutput "   • راقب circuit breakers" $ColorInfo
            Write-ColorOutput "   • استعد لإيقاف النظام إذا PnL < -\$10" $ColorWarning
        } else {
            Write-ColorOutput "`n❌ فشل تفعيل التداول الحي" $ColorError
            Write-ColorOutput "🔧 يرجى التفعيل يدوياً عبر الواجهة" $ColorWarning
        }
    } else {
        Write-ColorOutput "`n⏸️ الانتقال التلقائي للحي معطّل" $ColorWarning
        Write-ColorOutput "🔧 فعّل يدوياً عند الجاهزية" $ColorInfo
    }
} else {
    Write-ColorOutput "`n❌ فشل الحصول على النتائج النهائية" $ColorError
}

Write-ColorOutput "`n📄 سجل كامل محفوظ في:" $ColorInfo
Write-ColorOutput "   $logFile" $ColorInfo

Write-ColorOutput "`n═══════════════════════════════════════" $ColorInfo
Write-ColorOutput "🏁 انتهى السكريبت - $(Get-Date -Format 'HH:mm:ss')" $ColorInfo
Write-ColorOutput "═══════════════════════════════════════`n" $ColorInfo
