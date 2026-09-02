$secret = 'bg_e977938b6455d4e3dcf9f37924216a42'
Set-Content -Path "$env:TEMP\bitget_secret.txt" -Value $secret -NoNewline
$env:BITGET_API_KEY = $secret
Set-Location 'C:\Users\azadz\OneDrive\UltimateArbitrageHFT'
npx wrangler secret put BITGET_API_KEY 2>&1 | Select-Object -Last 10
