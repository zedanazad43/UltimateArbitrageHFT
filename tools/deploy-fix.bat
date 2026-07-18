@echo off
chcp 65001 >nul
echo ========================================
echo  ArbitrageBot - Deploy Fix
echo ========================================
echo.
echo [1/3] Fix wrangler.toml duplicate [vars]
powershell -Command "(Get-Content wrangler.toml) -replace '\[vars\]\r?\n', '' | Set-Content wrangler.toml"
echo.
echo [2/3] Deploy to Cloudflare
cd /d C:\Users\azadz\OneDrive\UltimateArbitrageHFT
npx wrangler deploy
echo.
echo [3/3] Verify
curl -s -o nul -w "HTTP %%{http_code}\n" https://ultimatearbitragehft.zedanazad43.workers.dev/health
echo.
echo ========================================
echo  Done
echo ========================================
pause
