<#
.SYNOPSIS
    Fix VS Code extension manifest, launch Chrome remote debugging, and set up ADB.
#>

# 1. Fix engines field if package.json exists and has publisher/name
$pkgPath = "package.json"
if (Test-Path $pkgPath) {
    $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
    if ($pkg.publisher -and $pkg.name -and -not $pkg.engines) {
        Write-Host "Adding engines field to package.json..." -ForegroundColor Yellow
        $pkg | Add-Member -MemberType NoteProperty -Name "engines" -Value @{ vscode = "^1.74.0" }
        $pkg | ConvertTo-Json -Depth 10 | Set-Content $pkgPath -Encoding utf8
        Write-Host "Done. Run npx @vscode/vsce package now." -ForegroundColor Green
    }
}

# 2. Launch Chrome with remote debugging
$port = 9222
Write-Host "Launching Chrome with remote debugging on port $port..." -ForegroundColor Yellow
Start-Process chrome -ArgumentList "--remote-debugging-port=$port", "--user-data-dir=$env:TEMP\chrome-remote-debug"

# 3. Check ADB and forward port if device connected
$adb = (Get-Command adb -ErrorAction SilentlyContinue).Source
if ($adb) {
    $devices = adb devices | Select-String "device$"
    if ($devices) {
        Write-Host "Android device found – forwarding port $port..." -ForegroundColor Green
        adb forward tcp:$port tcp:$port
    }
}

Write-Host "`nOpen chrome://inspect, enable network discovery, add localhost:$port" -ForegroundColor Cyan