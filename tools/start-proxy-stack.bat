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
REM Force IPv4 DNS resolution (ISP blocks IPv6 to Cloudflare) — fixes slow/frozen wrangler
SET NODE_OPTIONS=--dns-result-order=ipv4first
REM Use local wrangler binary (fast, no npx fetch)
SET WRANGLER=%REPO%\node_modules\wrangler\bin\wrangler.js
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

REM ── 1b) Start WebSocket live-feed (latency arb) ──────────────────────────────
SET ADMIN_TOKEN=
IF EXIST "C:\Users\azadz\.new_admin_token" SET /P ADMIN_TOKEN=<"C:\Users\azadz\.new_admin_token"
if "%ADMIN_TOKEN%"=="" echo [proxy-stack] WARNING: no admin token at C:\Users\azadz\.new_admin_token
START "ws-feed" /MIN cmd /c "cd /d %REPO% && set ADMIN_TOKEN=%ADMIN_TOKEN% && node tools\ws-feed.cjs >> %LOGDIR%\ws-feed.log 2>&1"
timeout /t 2 >nul

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

REM ── 3) FRITZ!Box port-forward (German IP → stable egress for Binance) ─
REM MANUAL (2 min): open http://192.168.178.1 → Internet → Permit Access →
REM   device 192.168.178.68, port 8080 TCP → Apply. Then set PUBLIC_IP below.
REM AUTO: if C:\Users\azadz\.fritz_user + .fritz_pass exist, TR-064 is attempted.
SET PUBLIC_IP=92.208.170.216
SET FRITZ_USER=
SET FRITZ_PASS=
IF EXIST "C:\Users\azadz\.fritz_user" SET /P FRITZ_USER=<"C:\Users\azadz\.fritz_user"
IF EXIST "C:\Users\azadz\.fritz_pass" SET /P FRITZ_PASS=<"C:\Users\azadz\.fritz_pass"
IF NOT "%FRITZ_USER%"=="" (
  curl -4 -s -u "%FRITZ_USER%:%FRITZ_PASS%" "http://192.168.178.1:49000/upnp/control/WANIPConn1" ^
    -H "Content-Type: text/xml; charset=\"utf-8\"" ^
    -H "SOAPAction: \"urn:schemas-upnp-org:service:WANIPConnection:1#AddPortMapping\"" ^
    --data "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:AddPortMapping xmlns:u=\"urn:schemas-upnp-org:service:WANIPConnection:1\"><NewRemoteHost></NewRemoteHost><NewExternalPort>8080</NewExternalPort><NewProtocol>TCP</NewProtocol><NewInternalPort>8080</NewInternalPort><NewInternalClient>192.168.178.68</NewInternalClient><NewEnabled>1</NewEnabled><NewPortMappingDescription>Hermes-Gateway</NewPortMappingDescription><NewLeaseDuration>0</NewLeaseDuration></u:AddPortMapping></s:Body></s:Envelope>" ^
    >> "%LOGDIR%\fritz-portforward.log" 2>&1
  echo [proxy-stack] FRITZ!Box port-forward attempted
) ELSE (
  echo [proxy-stack] MANUAL port-forward needed: forward 192.168.178.68:8080 TCP on http://192.168.178.1
)
echo [proxy-stack] If port-forward is active, set PROXY_URL_1=http://%PUBLIC_IP%:8080 in Cloudflare Worker.

ENDLOCAL
GOTO :EOF

:sync_secret
SET "NAME=%~1"
SET "VAL=%~2"
SET "VAL=!VAL:"=!"
echo [proxy-stack] syncing %NAME% -^> %VAL%
(
  echo !VAL!
) | node "%WRANGLER%" secret put %NAME% >> "%LOGDIR%\wrangler-sync.log" 2>&1
IF ERRORLEVEL 1 (
  echo [proxy-stack] FAILED to sync %NAME% (see %LOGDIR%\wrangler-sync.log)
) ELSE (
  echo [proxy-stack] synced %NAME%
)
GOTO :EOF
