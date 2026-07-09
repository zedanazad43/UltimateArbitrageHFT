@echo off
REM ============================================================
REM  fix-nat.bat — Windows NAT / Firewall fix for Docker stack
REM  Ports: 8787 (Arbitrage), 8788 (Hero Agent), 8789 (Stampbook)
REM
REM  RUN AS ADMINISTRATOR
REM ============================================================

echo.
echo ============================================================
echo   UltimateArbitrageHFT — Windows NAT / Firewall Setup
echo ============================================================
echo.

REM Check for admin privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: This script must be run as Administrator.
    echo Right-click and select "Run as administrator".
    pause
    exit /b 1
)

echo [1/4] Adding Windows Firewall inbound rules...
netsh advfirewall firewall delete rule name="UltimateArbitrageHFT-8787" >nul 2>&1
netsh advfirewall firewall delete rule name="HeroSuperAgent-8788"       >nul 2>&1
netsh advfirewall firewall delete rule name="Stampbook-8789"            >nul 2>&1

netsh advfirewall firewall add rule name="UltimateArbitrageHFT-8787" dir=in action=allow protocol=TCP localport=8787 profile=any
netsh advfirewall firewall add rule name="HeroSuperAgent-8788"        dir=in action=allow protocol=TCP localport=8788 profile=any
netsh advfirewall firewall add rule name="Stampbook-8789"             dir=in action=allow protocol=TCP localport=8789 profile=any
echo    Done.

echo.
echo [2/4] Updating hosts file (127.0.0.1 aliases)...
set HOSTS_FILE=%SystemRoot%\System32\drivers\etc\hosts

REM Remove old entries silently
findstr /v "ultimate-arbitrage-hft hero-super-agent stampbook" "%HOSTS_FILE%" > "%TEMP%\hosts.tmp"
(
  type "%TEMP%\hosts.tmp"
  echo 127.0.0.1 ultimate-arbitrage-hft
  echo 127.0.0.1 hero-super-agent
  echo 127.0.0.1 stampbook
) > "%HOSTS_FILE%"
del "%TEMP%\hosts.tmp"
echo    Done.

echo.
echo [3/4] Creating Docker bridge network (crypto-network)...
docker network inspect crypto-network >nul 2>&1
if %errorLevel% equ 0 (
    echo    Network already exists, skipping.
) else (
    docker network create --driver bridge crypto-network
    echo    Done.
)

echo.
echo [4/4] Enabling WSL2 / Hyper-V NAT port forwarding...
netsh interface portproxy delete v4tov4 listenport=8787 >nul 2>&1
netsh interface portproxy delete v4tov4 listenport=8788 >nul 2>&1
netsh interface portproxy delete v4tov4 listenport=8789 >nul 2>&1

for /f "tokens=*" %%i in ('wsl hostname -I 2^>nul') do set WSL_IP=%%i
if defined WSL_IP (
    netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=8787 connectaddress=%WSL_IP% connectport=8787
    netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=8788 connectaddress=%WSL_IP% connectport=8788
    netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=8789 connectaddress=%WSL_IP% connectport=8789
    echo    Port forwarding to WSL2 (%WSL_IP%) configured.
) else (
    echo    WSL2 not detected — skipping port proxy (native Docker Desktop).
)

echo.
echo ============================================================
echo   SETUP COMPLETE
echo   Services will be available at:
echo     http://localhost:8787  (Arbitrage Bot)
echo     http://localhost:8788  (Hero Super Agent)
echo     http://localhost:8789  (Stampbook)
echo ============================================================
echo.
echo Next: docker-compose up -d
echo.
pause
