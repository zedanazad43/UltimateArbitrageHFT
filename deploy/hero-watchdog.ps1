taskkill /F /IM node.exe 2>$null
Start-Sleep 2
cd "C:\Users\azadz\OneDrive\UltimateArbitrageHFT"
$env:OPENROUTER_API_KEY = Get-Content "C:\Users\azadz\.openrouter_key.txt" -Raw
Start-Process powershell -ArgumentList "-NoExit -Command $env:OPENROUTER_API_KEY='$env:OPENROUTER_API_KEY'; node .\orchestrator.js" -WindowStyle Minimized
