@echo off
REM start-proxy-stack.bat — Start local proxy gateway + Cloudflare Quick Tunnel,
REM auto-sync the public tunnel URL into Worker secrets, with retry loop.
SETLOCAL ENABLEDELAYEDEXPANSION
SET REPO=C:\Users\azadz\OneDrive\UltimateArbitrageHFT
SET LOGDIR=%REPO%\logs
IF NOT EXIST "%LOGDIR%" mkdir "%LOGDIR%"

REM 1) Start local gateway (Node) if not already running on port 8080
netstat -ano | find ":8080 .*LISTENING" >nul 2>&1
IF ERRORLEVEL 1 (
  echo [proxy-stack] starting local proxy gateway on :8080...
  START "proxy-gateway" /MIN cmd /c "cd /d %REPO% && node tools\proxy-gateway.cjs >> %LOGDIR%\proxy-gateway.log 2>&1"
  timeout /t 3 >nul
) ELSE (
  echo [proxy-stack] proxy gateway already running on :8080
)

REM 2) Start cloudflared quick tunnel (auto URL)
where cloudflared >nul 2>&1
IF ERRORLEVEL 1 (
  echo [proxy-stack] cloudflared not found on PATH; install it or enable serveo.
  GOTO :eof
)

echo [proxy-stack] starting cloudflared quick tunnel...
:cloudflare_loop
SET "TUNNEL_URL="
FOR /F "tokens=*" %%L IN ('cloudflared tunnel --url http://localhost:8080 2^>^&1') DO (
  echo %%L >> "%LOGDIR%\cloudflared.log"
  SET "LINE=%%L"
  REM cloudflared prints lines like:  TryCloudflare.com  https://<subdomain>.trycloudflare.com
  echo !LINE! | findstr /C:"trycloudflare.com" >nul && (
    FOR /F "tokens=2 delims= " %%U in ("!LINE!") DO SET "TUNNEL_URL=%%U"
  )
)

IF NOT "!TUNNEL_URL!"=="" (
  echo [proxy-stack] tunnel URL: !TUNNEL_URL!
  echo !TUNNEL_URL! | npx --yes wrangler secret put PROXY_URL_2 >> "%LOGDIR%\wrangler-sync.log" 2>&1
  echo !TUNNEL_URL! | npx --yes wrangler secret put EXTERNAL_PROXY_URL >> "%LOGDIR%\wrangler-sync.log" 2>&1
) ELSE (
  echo [proxy-stack] could not parse tunnel URL; retrying in 10s...
  timeout /t 10 >nul
  GOTO :cloudflare_loop
)

echo [proxy-stack] cloudflared tunnel exited, restarting in 5s...
timeout /t 5 >nul
GOTO :cloudflare_loop

ENDLOCAL
GOTO :eof
