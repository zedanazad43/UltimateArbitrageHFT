@echo off
REM start-proxy-stack.bat — Keeps the UltimateArbitrageHFT proxy gateway + serveo tunnel alive.
REM Auto-syncs the new public tunnel URL into Cloudflare Worker secrets.
REM Run at Windows startup (shell:startup) or manually.
REM
REM Requires: Node.js, ssh.exe (Git for Windows), npx/wrangler on PATH, tools/proxy-gateway.cjs,
REM           C:\Users\azadz\.gateway_token, and `wrangler login` already done (OAuth).

SETLOCAL ENABLEDELAYEDEXPANSION
SET REPO=C:\Users\azadz\UltimateArbitrageHFT
SET GWTOKEN_FILE=C:\Users\azadz\.gateway_token
SET LOGDIR=%REPO%\logs
IF NOT EXIST "%LOGDIR%" mkdir "%LOGDIR%"

REM Kill any stale ssh/serveo so we don't stack tunnels.
tasklist /FI "IMAGENAME eq ssh.exe" 2>nul | find "ssh.exe" >nul
IF NOT ERRORLEVEL 1 (
  echo [proxy-stack] killing stale ssh/serveo...
  taskkill /F /IM ssh.exe >nul 2>&1
  timeout /t 2 >nul
)

REM ── 1) Start local gateway (Node) ────────────────────────────────────────────
SET GATEWAY_TOKEN=
IF EXIST "%GWTOKEN_FILE%" SET /P GATEWAY_TOKEN=<"%GWTOKEN_FILE%"
IF "%GATEWAY_TOKEN%"=="" echo [proxy-stack] WARNING: no gateway token at %GWTOKEN_FILE%

tasklist /FI "IMAGENAME eq node.exe" 2>nul | find "node.exe" >nul
IF ERRORLEVEL 1 (
  START "proxy-gateway" /MIN cmd /c "cd /d %REPO% && set GATEWAY_TOKEN=%GATEWAY_TOKEN% && node tools\proxy-gateway.cjs >> %LOGDIR%\proxy-gateway.log 2>&1"
  timeout /t 3 >nul
) ELSE (
  echo [proxy-stack] node gateway already running
)

REM ── 2) Keep serveo tunnel alive (restart on disconnect, sync URL to Cloudflare) ─
:serveo_loop
echo [proxy-stack] starting serveo tunnel...
SET TUNNEL_URL=
FOR /F "tokens=*" %%L IN ('ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -R 80:localhost:8080 serveo.net 2^>^&1') DO (
  echo %%L >> "%LOGDIR%\serveo.log"
  SET "LINE=%%L"
  SET "LINE=!LINE:*Forwarding HTTP traffic from =!"
  IF NOT "!LINE!"=="%%L" SET "TUNNEL_URL=!LINE!"
)
IF NOT "%TUNNEL_URL%"=="" (
  CALL :sync_secret PROXY_URL_1 "%TUNNEL_URL%"
  CALL :sync_secret EXTERNAL_PROXY_URL "%TUNNEL_URL%"
) ELSE (
  echo [proxy-stack] could not parse tunnel URL; not syncing.
)
echo [proxy-stack] serveo tunnel exited (%TIME%), restarting in 5s...
timeout /t 5 >nul
GOTO serveo_loop

ENDLOCAL
GOTO :EOF

:sync_secret
SET "NAME=%~1"
SET "VAL=%~2"
SET "VAL=!VAL:"=!"
echo [proxy-stack] syncing %NAME% -^> %VAL%
(
  echo !VAL!
) | npx --yes wrangler secret put %NAME% >> "%LOGDIR%\wrangler-sync.log" 2>&1
IF ERRORLEVEL 1 (
  echo [proxy-stack] FAILED to sync %NAME% (see %LOGDIR%\wrangler-sync.log)
) ELSE (
  echo [proxy-stack] synced %NAME%
)
GOTO :EOF
