# hero-start.ps1 – Complete integration (FreeBuff, Telegram, Cloudflare)
$projectDir = "$HOME\OneDrive\UltimateArbitrageHFT"
$openRouterKey = [Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY', 'User')
if (-not $openRouterKey) { $openRouterKey = $env:OPENROUTER_API_KEY }
if (-not $openRouterKey) { Write-Host "❌ OpenRouter key missing"; exit 1 }
$env:OPENROUTER_API_KEY = $openRouterKey

# --- Orchestrator with FreeBuff tool ---
$orchestratorJS = @"
import http from 'http';
const PORT = 8000;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '$openRouterKey';
const OLLAMA_URL = 'http://127.0.0.1:11434/v1/chat/completions';
const FREEBUFF_URL = 'http://localhost:3000/v1/chat/completions';

async function callOpenRouter(messages) {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENROUTER_KEY },
        body: JSON.stringify({ model: 'anthropic/claude-haiku-4.5', messages })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error?.message || resp.status);
    return data.choices?.[0]?.message?.content || JSON.stringify(data);
}

async function callOllama(messages) {
    const resp = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama3.2', messages })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error?.message || resp.status);
    return data.choices?.[0]?.message?.content || JSON.stringify(data);
}

async function callFreeBuff(messages) {
    try {
        const resp = await fetch(FREEBUFF_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'freebuff-agent', messages })
        });
        if (!resp.ok) throw new Error('FreeBuff unavailable');
        const data = await resp.json();
        return data.choices?.[0]?.message?.content || JSON.stringify(data);
    } catch { throw new Error('FreeBuff not reachable'); }
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    if (req.url === '/v1/models' || req.url === '/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [
            { id: 'claude-haiku-4.5', object: 'model' },
            { id: 'ollama-llama3', object: 'model' },
            { id: 'freebuff-agent', object: 'model' }
        ]}));
        return;
    }

    if (req.url === '/v1/chat/completions') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const payload = JSON.parse(body);
                const requestedModel = payload.model || 'orchestrator-master';
                const messages = payload.messages || [];

                let reply;
                if (requestedModel === 'freebuff-agent' || 
                    (requestedModel === 'orchestrator-master' && messages.length && 
                     messages[messages.length-1].content.toLowerCase().includes('freebuff'))) {
                    try { reply = await callFreeBuff(messages); } 
                    catch { reply = 'FreeBuff agent is not running locally. Start it on port 3000.'; }
                } else if (requestedModel !== 'orchestrator-master' && requestedModel !== 'auto') {
                    try { reply = await callOpenRouter(messages); } 
                    catch { 
                        try { reply = await callOllama(messages); } 
                        catch { reply = 'All AI models are offline.'; }
                    }
                } else {
                    try { reply = await callOpenRouter(messages); } 
                    catch { 
                        try { reply = await callOllama(messages); } 
                        catch { reply = 'All AI models are offline.'; }
                    }
                }

                const answer = {
                    id: 'chatcmpl-' + Date.now(),
                    object: 'chat.completion',
                    created: Date.now(),
                    model: requestedModel,
                    choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }]
                };
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(answer));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Hero orchestrator (Claude + Ollama + FreeBuff) running');
});

server.listen(PORT, () => console.log('Orchestrator with FreeBuff tool on http://localhost:' + PORT));
"@
Set-Content -Path "$projectDir\orchestrator.js" -Value $orchestratorJS -Encoding UTF8

# Restart orchestrator
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2
Start-Process powershell -ArgumentList "-NoExit -Command `$env:OPENROUTER_API_KEY='$openRouterKey'; cd '$projectDir'; node .\orchestrator.js" -WindowStyle Minimized
Start-Sleep 5
if (Test-NetConnection -ComputerName localhost -Port 8000 -InformationLevel Quiet) {
    Write-Host "✅ Orchestrator running" -ForegroundColor Green
} else {
    Write-Host "⚠️ Orchestrator may not have started – check minimized window" -ForegroundColor Yellow
}

# --- Telegram alerts ---
$telegramScript = @"
`$botToken = '$env:TELEGRAM_BOT_TOKEN'
`$chatId   = '$env:TELEGRAM_CHAT_ID'
if (-not `$botToken -or -not `$chatId) { exit 0 }
`$body = @{
    model = 'orchestrator-master'
    messages = @( @{ role = 'user'; content = 'Analyze the crypto market and suggest one arbitrage opportunity. Keep under 500 chars.' } )
} | ConvertTo-Json
try {
    `$analysis = Invoke-RestMethod -Uri 'http://localhost:8000/v1/chat/completions' -Method Post -ContentType 'application/json' -Body `$body -TimeoutSec 30
    `$text = `$analysis.choices[0].message.content
} catch { `$text = 'Orchestrator unreachable' }
`$uri = "https://api.telegram.org/bot`$botToken/sendMessage"
Invoke-RestMethod -Uri `$uri -Method Post -ContentType 'application/json' -Body (@{ chat_id = `$chatId; text = `$text; parse_mode = 'HTML' } | ConvertTo-Json) | Out-Null
"@
Set-Content -Path "$projectDir\telegram-alert.ps1" -Value $telegramScript -Encoding UTF8

schtasks /Delete /TN "HeroTelegramAlert" /F 2>$null
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -File `"$projectDir\telegram-alert.ps1`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration (New-TimeSpan -Days 365)
Register-ScheduledTask -TaskName "HeroTelegramAlert" -Action $action -Trigger $trigger -Force | Out-Null
Write-Host "✅ Telegram alert scheduled (every 10 min)" -ForegroundColor Green

# --- Cloudflare tunnel ---
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile "$env:TEMP\cloudflared.exe"
    Move-Item -Force "$env:TEMP\cloudflared.exe" "$env:USERPROFILE\cloudflared.exe"
}
$tunnelLog = "$projectDir\tunnel.log"
Start-Process cloudflared -ArgumentList "tunnel --url http://localhost:8000" -RedirectStandardOutput $tunnelLog -WindowStyle Hidden
Start-Sleep 5
$tunnelUrl = (Get-Content $tunnelLog -Tail 10 | Select-String -Pattern "https://.*\.trycloudflare\.com").Matches.Value | Select-Object -First 1
if ($tunnelUrl) { Write-Host "✅ Cloudflare tunnel: $tunnelUrl" -ForegroundColor Green; $tunnelUrl | Out-File "$projectDir\tunnel-url.txt" }
else { Write-Host "⚠️ Tunnel started – URL in $tunnelLog" -ForegroundColor Yellow }

Write-Host "`n🎉 All integrations active. Use 'copilot-ask'."
