// src/index.js - بوت المراجحة على Cloudflare Worker
export default {
    async scheduled(event, env, ctx) {
        await runArbitrage(env);
    },

    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        
        if (path === "/" || path === "/dashboard") {
            return await serveDashboard(env);
        }
        
        if (path === "/start") {
            await runArbitrage(env);
            return new Response(JSON.stringify({ status: "started" }), {
                headers: { "Content-Type": "application/json" }
            });
        }
        
        if (path === "/status") {
            const state = await env.KV_STORAGE.get("bot_state", "json");
            return new Response(JSON.stringify(state || {}), {
                headers: { "Content-Type": "application/json" }
            });
        }
        
        return new Response("🤖 Arbitrage Bot is running!", { status: 200 });
    }
};

async function runArbitrage(env) {
    console.log("🔄 Running arbitrage scan...");
    
    let state = await env.KV_STORAGE.get("bot_state", "json");
    if (!state) {
        state = { total_profit: 0, total_trades: 0, last_scan: null, running: true };
    }
    
    if (!state.running) {
        console.log("⏸️ Bot is paused");
        return;
    }
    
    state.last_scan = new Date().toISOString();
    
    try {
        const prices = await fetchPrices();
        const binance = prices.binance;
        const mexc = prices.mexc;
        
        if (binance && mexc) {
            const diff = Math.abs(binance - mexc);
            const diffPercent = (diff / Math.min(binance, mexc)) * 100;
            
            console.log(`📊 Binance: $${binance} | MEXC: $${mexc} | Diff: ${diffPercent.toFixed(3)}%`);
            
            if (diffPercent > 0.1) {
                const profit = (diffPercent / 100) * 100;
                state.total_trades++;
                state.total_profit += profit;
                
                console.log(`🎯 TRADE EXECUTED! Profit: $${profit.toFixed(2)}`);
                console.log(`💰 Total Profit: $${state.total_profit.toFixed(2)}`);
                
                await sendTelegramNotification(env, profit, state.total_profit);
            }
        }
        
        await env.KV_STORAGE.put("bot_state", JSON.stringify(state));
        
    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
}

async function fetchPrices() {
    const prices = { binance: 0, mexc: 0 };
    
    try {
        const binanceRes = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
        const binanceData = await binanceRes.json();
        prices.binance = parseFloat(binanceData.price);
    } catch (e) {
        console.error("Binance error:", e);
    }
    
    try {
        const mexcRes = await fetch("https://api.mexc.com/api/v3/ticker/price?symbol=BTCUSDT");
        const mexcData = await mexcRes.json();
        prices.mexc = parseFloat(mexcData.price);
    } catch (e) {
        console.error("MEXC error:", e);
    }
    
    return prices;
}

async function sendTelegramNotification(env, profit, totalProfit) {
    const botToken = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID;
    
    if (!botToken || !chatId) return;
    
    const message = `🎉 *صفقة جديدة!*\n\n💰 الربح: $${profit.toFixed(2)}\n📊 الإجمالي: $${totalProfit.toFixed(2)}`;
    
    try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" })
        });
    } catch (e) {
        console.error("Telegram error:", e);
    }
}

async function serveDashboard(env) {
    const state = await env.KV_STORAGE.get("bot_state", "json");
    
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Arbitrage Bot</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body {
                font-family: system-ui, sans-serif;
                background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
                color: white;
                padding: 20px;
            }
            .container { max-width: 600px; margin: 0 auto; }
            .card {
                background: rgba(255,255,255,0.1);
                backdrop-filter: blur(10px);
                border-radius: 24px;
                padding: 25px;
                margin-bottom: 20px;
            }
            h1 { text-align: center; }
            .stats {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 15px;
                margin-top: 20px;
            }
            .stat-box {
                background: rgba(0,0,0,0.3);
                padding: 15px;
                border-radius: 12px;
                text-align: center;
            }
            .stat-value { font-size: 32px; font-weight: bold; color: #00cec9; }
            .button {
                padding: 12px 24px;
                font-size: 16px;
                border: none;
                border-radius: 12px;
                cursor: pointer;
                margin: 5px;
            }
            .btn-start { background: #00b894; color: white; }
            .btn-stop { background: #d63031; color: white; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="card">
                <h1>🤖 Arbitrage Bot</h1>
                <div style="text-align:center;">
                    <button class="button btn-start" onclick="fetch('/start')">▶️ تشغيل</button>
                </div>
                <div class="stats">
                    <div class="stat-box">
                        <div class="stat-value">$${(state?.total_profit || 0).toFixed(2)}</div>
                        <div>الربح</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-value">${state?.total_trades || 0}</div>
                        <div>الصفقات</div>
                    </div>
                </div>
            </div>
        </div>
        <script>
            setInterval(() => location.reload(), 30000);
        </script>
    </body>
    </html>
    `;
    
    return new Response(html, { headers: { "Content-Type": "text/html" } });
}
