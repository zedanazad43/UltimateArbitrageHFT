<#
.SYNOPSIS
    Launch Chrome with remote debugging and set up ADB port forwarding (if Android device detected).
.DESCRIPTION
    Opens a new Chrome instance with the --remote-debugging-port flag.
    If ADB is installed and a device is connected, forwards the port so you can
    inspect Chrome tabs on the Android device via desktop DevTools.
.PARAMETER Port
    The port to use for remote debugging (default: 9222).
.PARAMETER AndroidPort
    The port to forward to on the Android device (default: same as Port).
.EXAMPLE
    .\chrome-remote-debug.ps1 -Port 9223
#>

param(
    [int]$Port = 9222,
    [int]$AndroidPort = $Port
)

Write-Host "🔧 Chrome Remote Debugging Setup" -ForegroundColor Cyan
Write-Host "   Port: $Port, Android device port: $AndroidPort" -ForegroundColor Gray

# 1. Launch Chrome with remote debugging
$chromeArgs = @(
    "--remote-debugging-port=$Port",
    "--user-data-dir=$env:TEMP\chrome-remote-debug-$Port"
)
Write-Host "`n🚀 Launching Chrome with remote debugging..." -ForegroundColor Yellow
Start-Process -FilePath "chrome" -ArgumentList $chromeArgs -WindowStyle Normal
Write-Host "✅ Chrome started. Open chrome://inspect in any Chrome window." -ForegroundColor Green

# 2. Check ADB and Android device
$adbPath = (Get-Command adb -ErrorAction SilentlyContinue).Source
if ($adbPath) {
    Write-Host "`n📱 ADB found: $adbPath" -ForegroundColor Green
    $devices = adb devices 2>$null | Select-String -Pattern "device$"
    if ($devices) {
        Write-Host "✅ Android device detected." -ForegroundColor Green
        Write-Host "🔗 Forwarding port $Port to device port $AndroidPort..." -ForegroundColor Yellow
        adb forward tcp:$Port tcp:$AndroidPort
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Port forwarding set up." -ForegroundColor Green
        } else {
            Write-Warning "Port forwarding failed. Check device connection."
        }
    } else {
        Write-Warning "No Android device connected. Connect via USB and enable USB debugging."
    }
} else {
    Write-Host "`nℹ️ ADB not found. To debug Android devices, install ADB and ensure a device is connected." -ForegroundColor Yellow
}

# 3. Instructions
Write-Host "`n📌 Next steps:"
Write-Host "  1. Open chrome://inspect in any Chrome window." -ForegroundColor White
Write-Host "  2. Make sure 'Discover network targets' is ON." -ForegroundColor White
Write-Host "  3. Add localhost:$Port if not already listed." -ForegroundColor White
if ($adbPath -and $devices) {
    Write-Host "  4. On your Android device, open Chrome and navigate to any page." -ForegroundColor White
    Write-Host "  5. You should see the device tabs appear in chrome://inspect." -ForegroundColor White
}
Write-Host "`n✅ Script finished. Happy debugging!" -ForegroundColor Cyan