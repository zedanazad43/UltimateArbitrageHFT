@echo off
chcp 65001 >nul
echo ========================================
echo  UltimateArbitrageHFT - Proxy Manager
echo ========================================
echo.
echo [1/3] Starting proxy-gateway locally...
cd /d "%~dp0.."
start "proxy-gateway" cmd /c "node tools/proxy-gateway.cjs"
timeout /t 2 /nobreak >nul
echo.
echo [2/3] Starting serveo tunnel...
start "serveo-tunnel" cmd /c "ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 80:localhost:8080 serveo.net"
timeout /t 4 /nobreak >nul
echo.
echo [3/3] Running proxy health manager...
node tools/proxy-manager.cjs
echo.
echo ========================================
echo  All proxy services started
echo  Update PROXY_URL_1 with current URL if changed
echo ========================================
pause
