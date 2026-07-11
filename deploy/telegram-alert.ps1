$botToken = ''
$chatId   = ''
if (-not $botToken -or -not $chatId) { exit 0 }
$body = @{
    model = 'orchestrator-master'
    messages = @( @{ role = 'user'; content = 'Analyze the crypto market and suggest one arbitrage opportunity. Keep under 500 chars.' } )
} | ConvertTo-Json
try {
    $analysis = Invoke-RestMethod -Uri 'http://localhost:8000/v1/chat/completions' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 30
    $text = $analysis.choices[0].message.content
} catch { $text = 'Orchestrator unreachable' }
$uri = "https://api.telegram.org/bot$botToken/sendMessage"
Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json' -Body (@{ chat_id = $chatId; text = $text; parse_mode = 'HTML' } | ConvertTo-Json) | Out-Null
