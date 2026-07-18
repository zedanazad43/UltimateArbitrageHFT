@echo off
chcp 65001 >nul
:: ========================================
::  UltimateArbitrageHFT - 24/7 Background Guardian
::  Auto-restarts gateway + serveo tunnel
:: ========================================

echo [%date% %time%] Starting ArbitrageBot Guardian... >> "%USERPROFILE%\arb-bot-guardian.log"

:: Set tokens
set GATEWAY_TOKEN=<SECRET_fdb5b4c9>jS18sl8A6DQ6PXK7J1xiT43zg9077fbba"
set CLOUDFLARE_TOKEN=<SECRET_0dd9db2d>jS18sl8A6DQ6PXK7J1xiT43zg9077fbba"

:: Start local gateway if not running
netstat -ano | findstr ":8080.*LISTENING" >nul 2>&1
if errorlevel 1 (
    echo [%date% %time%] Gateway not running, starting... >> "%USERPROFILE%\arb-bot-guardian.log"
    start "Gateway" /B cmd /c "cd /d C:\Users\azadz\OneDrive\UltimateArbitrageHFT && node tools/proxy-gateway.cjs"
    timeout /t 3 /nobreak >nul
) else (
    echo [%date% %time%] Gateway already running >> "%USERPROFILE%\arb-bot-guardian.log"
)

:: Start serveo tunnel if not running
netstat -ano | findstr ":22.*ESTABLISHED" >nul 2>&1
if errorlevel 1 (
    echo [%date% %time%] Tunnel not running, starting... >> "%USERPROFILE%\arb-bot-guardian.log"
    start "ServeoTunnel" /B ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 80:localhost:8080 serveo.net
    timeout /t 5 /nobreak >nul
) else (
    echo [%date% %time%] Tunnel already running >> "%USERPROFILE%\arb-bot-guardian.log"
)

:: Verify gateway health
curl -s --max-time 5 http://localhost:8080/health >nul 2>&1
if errorlevel 1 (
    echo [%date% %time%] Gateway health check FAILED >> "%USERPROFILE%\arb-bot-guardian.log"
) else (
    echo [%date% %time%] Gateway health check OK >> "%USERPROFILE%\arb-bot-guardian.log"
)

echo [%date% %time%] Guardian check complete >> "%USERPROFILE%\arb-bot-guardian.log"
