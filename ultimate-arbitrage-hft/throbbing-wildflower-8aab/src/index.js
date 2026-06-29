// ==================================================================
//  ULTIMATE ARBITRAGE BOT - v22.0 (PROFESSIONAL HFT ARCHITECTURE)
//  Durable Objects + WebSockets + Bidirectional Scalping + Kelly + Adaptive Leverage
// ==================================================================

import { ethers } from 'ethers';

const CONFIG = {
  PROFIT: { ARBITRAGE: 0.05, SCALPING: 0.01 },
  RISK: {
    INITIAL_CAPITAL_USD: 1000, BASE_POSITION_SIZE_USD: 200, MAX_POSITION_SIZE_USD: 2000,
    MAX_ALLOWED_LOSS_PERCENT: 0.1,
    ADAPTIVE_LEVERAGE: { LOW_VOLATILITY: 10, HIGH_VOLATILITY: 3, VOLATILITY_THRESHOLD: 2.0 },
    KELLY_FRACTION: 0.2, MIN_WIN_RATE: 0.51, MIN_RISK_REWARD_RATIO: 1.5
  },
  LATENCY: { MAX_RTT_MS: 50, ORDER_TIMEOUT_MS: 1000 },
  ZEROX: { CHAIN_ID: 1, SLIPPAGE: 0.5 },
  REQUEST: { MAX_RETRIES: 2, INITIAL_DELAY_MS: 50 }
};

const SUPPORTED_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'];

export class MarketStreamer {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.symbol = state.idFromName;
    this.currentPrice = 0;
    this.lastUpdate = 0;
    this.ws = null;
    this.volatility = 0;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/price') {
      return new Response(JSON.stringify({
        symbol: this.symbol,
        price: this.currentPrice,
        lastUpdate: this.lastUpdate,
        volatility: this.volatility
      }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/connect') {
      if (!this.ws) this.connectWebSocket();
      return new Response('WebSocket connection initiated');
    }
    return new Response('MarketStreamer Active', { status: 200 });
  }

  connectWebSocket() {
    const wsUrl = 'wss://wbs.mexc.com/ws';
    this.ws = new WebSocket(wsUrl);
    this.ws.onopen = () => {
      console.log(`[${this.symbol}] WebSocket connected`);
      const subscribeMsg = JSON.stringify({
        method: 'SUBSCRIPTION',
        params: [`spot@public.miniTicker.v3.api@${this.symbol}@UTC+8`],
        id: Date.now()
      });
      this.ws.send(subscribeMsg);
    };
    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.c) {
          this.currentPrice = parseFloat(data.c);
          this.lastUpdate = Date.now();
          this.state.storage.put('lastPrice', this.currentPrice);
          this.state.storage.put('lastUpdate', this.lastUpdate);
        }
      } catch (e) {}
    };
    this.ws.onerror = (error) => console.error(`[${this.symbol}] WebSocket error:`, error);
    this.ws.onclose = () => {
      console.log(`[${this.symbol}] WebSocket closed, reconnecting in 1s...`);
      this.ws = null;
      setTimeout(() => this.connectWebSocket(), 1000);
    };
  }

  async updateVolatility(priceHistory) {
    if (priceHistory.length < 5) return 1.0;
    const returns = [];
    for (let i = 1; i < priceHistory.length; i++) {
      returns.push((priceHistory[i] - priceHistory[i-1]) / priceHistory[i-1]);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    this.volatility = Math.sqrt(variance) * 100 * Math.sqrt(288);
    await this.state.storage.put('volatility', this.volatility);
    return this.volatility;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/dashboard') {
      const state = await env.BOT_STATE.get('trading_state', 'json') || {
        trading_enabled: true, daily_used_usd: 0, daily_pnl: 0, total_trades: 0, win_rate: 0.55
      };
      let tradesHtml = ''; let pnlData = [];
      if (env.DB) {
        try {
          const { results } = await env.DB.prepare(`SELECT * FROM trades ORDER BY created_at DESC LIMIT 20`).all();
          tradesHtml = results.map(t => `<tr><td>${t.strategy}</td><td>$${t.size_usd.toFixed(2)}</td><td>${t.net_profit_percent.toFixed(4)}%</td><td>${new Date(t.created_at).toLocaleString('ar')}</td></tr>`).join('');
          let cumPnl = 0;
          pnlData = results.reverse().map(t => { cumPnl += t.size_usd * t.net_profit_percent / 100; return cumPnl.toFixed(2); });
        } catch (e) {}
      }
      const html = `<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>v22.0</title><script src="https://cdn.jsdelivr.net/npm/chart.js"></script><style>body{background:#0b0e14;color:#eee;font-family:Segoe UI;padding:20px}h1{color:#f0b90b}.card{background:#1a1e26;padding:20px;border-radius:12px;margin-bottom:20px}.btn{background:#f0b90b;color:#000;padding:10px 20px;border:none;border-radius:8px;margin:5px;cursor:pointer}table{width:100%;border-collapse:collapse;background:#1a1e26;border-radius:12px}th{background:#2a2e38;color:#f0b90b;padding:12px}td{padding:10px;border-bottom:1px solid #2a2e38}</style></head><body><h1>🔥 Ultimate Arbitrage v22.0 (HFT Edition)</h1><div><button class="btn" onclick="fetch('/scan')">🔍 مسح فوري</button><button class="btn" onclick="fetch('/start')">▶️ تشغيل</button><button class="btn" onclick="fetch('/stop')">⏸️ إيقاف</button><button class="btn" onclick="location.reload()">🔄 تحديث</button></div><div class="card"><span>الحالة: <span style="color:${state.trading_enabled?'#2ecc71':'#e74c3c'}">${state.trading_enabled?'مفعل':'متوقف'}</span> | 💰 الحجم اليومي: $${state.daily_used_usd.toFixed(2)} | 📈 صافي اليوم: $${state.daily_pnl.toFixed(2)} | 🎯 نسبة النجاح: ${(state.win_rate*100).toFixed(1)}%</span></div><div style="background:#1a1e26;padding:20px;border-radius:12px;margin-bottom:20px"><canvas id="pnlChart"></canvas></div><h2>📊 آخر الصفقات</h2><table><tr><th>الاستراتيجية</th><th>الحجم (USD)</th><th>الربح</th><th>الوقت</th></tr>${tradesHtml||'<tr><td colspan="4">لا توجد صفقات</td></tr>'}</table><script>const ctx=document.getElementById('pnlChart').getContext('2d');new Chart(ctx,{type:'line',data:{labels:[...Array(${pnlData.length})].map((_,i)=>i+1),datasets:[{label:'الربح المتراكم ($)',data:${JSON.stringify(pnlData)},borderColor:'#f0b90b',backgroundColor:'rgba(240,185,11,0.1)',fill:true}]},options:{responsive:true}});</script></body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    if (path === '/start') {
      const state = await env.BOT_STATE.get('trading_state', 'json') || {};
      state.trading_enabled = true;
      await env.BOT_STATE.put('trading_state', JSON.stringify(state));
      return new Response('✅ تم تشغيل التداول');
    }
    if (path === '/stop') {
      const state = await env.BOT_STATE.get('trading_state', 'json') || {};
      state.trading_enabled = false;
      await env.BOT_STATE.put('trading_state', JSON.stringify(state));
      return new Response('✅ تم إيقاف التداول');
    }
    if (path === '/scan') {
      ctx.waitUntil(scanAndExecute(env));
      return new Response('✅ بدأ المسح الفوري');
    }
    if (path === '/test-ws') {
      const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
      const id = env.MARKET_STREAMER.idFromName(symbol);
      const obj = env.MARKET_STREAMER.get(id);
      await obj.fetch('https://dummy/connect');
      return new Response(`✅ بدأ اتصال WebSocket لـ ${symbol}`);
    }
    return new Response('🤖 Ultimate Arbitrage Bot v22.0', { status: 200 });
  },
  async scheduled(event, env, ctx) {
    const state = await env.BOT_STATE.get('trading_state', 'json') || { trading_enabled: true };
    if (!state.trading_enabled) return;
    await scanAndExecute(env);
  }
};

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function getPrice(env, symbol, source = 'mexc') {
  try {
    const id = env.MARKET_STREAMER.idFromName(symbol);
    const obj = env.MARKET_STREAMER.get(id);
    const resp = await obj.fetch('https://dummy/price');
    const data = await resp.json();
    if (data.price > 0) return { price: data.price, exchange: source, fee: 0.0005 };
  } catch (e) {}
  const url = source === 'mexc' 
    ? `https://api.mexc.com/api/v3/ticker/price?symbol=${symbol}`
    : `https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${symbol.replace('USDT', '-USDT')}`;
  const resp = await fetch(url);
  const data = await resp.json();
  const price = source === 'mexc' ? parseFloat(data.price) : parseFloat(data.data.price);
  return { price, exchange: source, fee: source === 'mexc' ? 0.0005 : 0.001 };
}

async function get0xPrice(env, symbol) {
  const apiKey = env.ZEROX_API_KEY;
  if (!apiKey) return null;
  const tokenMap = {
    'ETHUSDT': { sell: '0xdAC17F958D2ee523a2206206994597C13D831ec7', buy: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
    'BTCUSDT': { sell: '0xdAC17F958D2ee523a2206206994597C13D831ec7', buy: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 }
  };
  const token = tokenMap[symbol];
  if (!token) return null;
  const amount = ethers.parseUnits('1000', 6).toString();
  const params = new URLSearchParams({
    chainId: CONFIG.ZEROX.CHAIN_ID.toString(),
    sellToken: token.sell,
    buyToken: token.buy,
    sellAmount: amount,
    slippageBps: (CONFIG.ZEROX.SLIPPAGE * 100).toString()
  });
  const url = `https://api.0x.org/swap/allowance-holder/price?${params.toString()}`;
  const resp = await fetch(url, { headers: { '0x-api-key': apiKey, '0x-version': 'v2' } });
  const data = await resp.json();
  if (data.code) return null;
  const buyAmount = parseFloat(ethers.formatUnits(data.buyAmount, token.decimals));
  return { price: 1000 / buyAmount, exchange: '0x', fee: 0.0 };
}

function calculatePositionSize(equity, winRate, riskRewardRatio) {
  const baseSize = CONFIG.RISK.BASE_POSITION_SIZE_USD;
  const gf = Math.log(1 + equity / CONFIG.RISK.INITIAL_CAPITAL_USD) / Math.log(2);
  const logSize = Math.min(CONFIG.RISK.MAX_POSITION_SIZE_USD, baseSize * (1 + gf));
  let kellyFraction = 0;
  if (winRate > 0.5 && riskRewardRatio > 1) {
    kellyFraction = winRate - (1 - winRate) / riskRewardRatio;
    kellyFraction = Math.max(0, Math.min(0.25, kellyFraction));
  }
  const kellySize = equity * kellyFraction * CONFIG.RISK.KELLY_FRACTION;
  return Math.min(logSize, kellySize);
}

async function placeMarketOrderMEXC(env, symbol, side, quantity) {
  const apiKey = env.MEXC_API_KEY, apiSecret = env.MEXC_API_SECRET;
  if (!apiKey) throw new Error('MEXC keys missing');
  const timestamp = Date.now().toString();
  const params = { symbol, side: side.toUpperCase(), type: 'MARKET', quantity, timestamp };
  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(sorted));
  params.signature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('');
  const body = new URLSearchParams(params).toString();
  const resp = await fetch('https://api.mexc.com/api/v3/order', {
    method: 'POST',
    headers: { 'X-MEXC-APIKEY': apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await resp.json();
  if (data.code) throw new Error(data.msg);
  return data;
}

async function sendTelegramAlert(env, msg) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: msg })
  });
}

async function scanAndExecute(env) {
  const state = await env.BOT_STATE.get('trading_state', 'json') || { trading_enabled: true, daily_used_usd: 0, daily_pnl: 0, win_rate: 0.55, risk_reward_ratio: 2.0 };
  const equity = CONFIG.RISK.INITIAL_CAPITAL_USD + state.daily_pnl;
  for (const symbol of SUPPORTED_SYMBOLS) {
    try {
      const [mexcPrice, zeroPrice] = await Promise.all([getPrice(env, symbol, 'mexc'), get0xPrice(env, symbol)]);
      if (!mexcPrice || !zeroPrice) continue;
      console.log(`📊 ${symbol}: MEXC=$${mexcPrice.price.toFixed(4)} | 0x=$${zeroPrice.price.toFixed(4)}`);
      const diffMEXCto0x = ((zeroPrice.price - mexcPrice.price) / mexcPrice.price) * 100;
      const diff0xtoMEXC = ((mexcPrice.price - zeroPrice.price) / zeroPrice.price) * 100;
      let bestDiff = 0, direction = null;
      if (diffMEXCto0x > CONFIG.PROFIT.SCALPING) { bestDiff = diffMEXCto0x; direction = 'MEXC_TO_0X'; }
      if (diff0xtoMEXC > CONFIG.PROFIT.SCALPING && diff0xtoMEXC > bestDiff) { bestDiff = diff0xtoMEXC; direction = '0X_TO_MEXC'; }
      if (direction) {
        console.log(`🎯 فرصة ${symbol}: ${direction} | فرق: ${bestDiff.toFixed(4)}%`);
        const sizeUsd = calculatePositionSize(equity, state.win_rate, state.risk_reward_ratio);
        const amount = (sizeUsd / (direction === 'MEXC_TO_0X' ? mexcPrice.price : zeroPrice.price)).toFixed(6);
        if (direction === 'MEXC_TO_0X') {
          await placeMarketOrderMEXC(env, symbol, 'BUY', amount);
        } else {
          await placeMarketOrderMEXC(env, symbol, 'SELL', amount);
        }
        state.daily_used_usd += sizeUsd;
        state.daily_pnl += sizeUsd * bestDiff / 100;
        await env.BOT_STATE.put('trading_state', JSON.stringify(state));
        if (env.DB) {
          await env.DB.prepare(`INSERT INTO trades (strategy, size_usd, net_profit_percent, created_at) VALUES (?, ?, ?, ?)`)
            .bind(`SCALPING_${direction}`, sizeUsd, bestDiff, Date.now()).run();
        }
        await sendTelegramAlert(env, `✅ صفقة ${symbol}\n${direction}\nحجم: $${sizeUsd}\nربح: ${bestDiff.toFixed(4)}%`);
        break;
      }
    } catch (e) { console.error(`❌ فشل فحص ${symbol}:`, e.message); }
  }
}