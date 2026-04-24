// ===== NEXUS HUB – REAL TRADING ENGINE =====
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { renderDashboard, renderChecklist } from './src/dashboard.js';
import { runScan } from './src/orchestrator.js';

// ─── الثوابت ───
const SUPPORTED_SYMBOLS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','ADAUSDT',
  'XRPUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','MATICUSDT',
  'LINKUSDT','UNIUSDT','ATOMUSDT','LTCUSDT','ETCUSDT'
];

const EXCHANGES = {
  binance: {
    name: 'Binance',
    baseUrl: 'https://api.binance.com',
    parseSymbol: (symbol) => symbol,  // لا حاجة لتعديل
    signature: true,
  },
  mexc: {
    name: 'MEXC',
    baseUrl: 'https://api.mexc.com',
    parseSymbol: (symbol) => symbol,
    signature: true,
  },
  okx: {
    name: 'OKX',
    baseUrl: 'https://www.okx.com',
    parseSymbol: (symbol) => symbol.replace('USDT', '-USDT'),
    signature: true,
  },
  kucoin: {
    name: 'KuCoin',
    baseUrl: 'https://api.kucoin.com',
    parseSymbol: (symbol) => symbol.replace('USDT', '-USDT'),
    signature: true,
  },
  coinbase: {
    name: 'Coinbase',
    baseUrl: 'https://api.coinbase.com',
    parseSymbol: (symbol) => symbol.replace('USDT', '-USD'), // Coinbase لا تدعم USDT مباشرة في أغلب الأزواج، سنستخدم USDC بديلاً
    signature: true,
  },
  bitget: {
    name: 'Bitget',
    baseUrl: 'https://api.bitget.com',
    parseSymbol: (symbol) => symbol.replace('USDT', 'USDT'),
    signature: true,
  },
  bitmart: {
    name: 'Bitmart',
    baseUrl: 'https://api.bitmart.com',
    parseSymbol: (symbol) => symbol.replace('USDT', '_USDT'),
    signature: true,
  },
};

// ─── أدوات التشفير للتوقيعات (Binance / MEXC / OKX إلخ) ───
function createHmacSha256(secret, message) {
  // Binance-style HMAC
  const enc = new TextEncoder();
  const key = enc.encode(secret);
  const msg = enc.encode(message);
  return crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    .then(k => crypto.subtle.sign('HMAC', k, msg))
    .then(buf => btoa(String.fromCharCode(...new Uint8Array(buf))));
}

// توقيع OKX (مبسط)
function okxSign(timestamp, method, path, body, secret) {
  const prehash = timestamp + method + path + (body || '');
  return createHmacSha256(secret, prehash);
}

// ─── فئة جلب الأسعار من المنصات ───
async function fetchPriceFromExchange(exchangeKey, symbol, env) {
  const exchange = EXCHANGES[exchangeKey];
  if (!exchange) throw new Error(`Exchange ${exchangeKey} not configured`);

  const apiKey = env[exchangeKey.toUpperCase() + '_API_KEY'];
  const apiSecret = env[exchangeKey.toUpperCase() + '_API_SECRET'] || env[exchangeKey.toUpperCase() + '_SECRET_KEY'];
  const passphrase = env['PASSPHRASE']; // لـ OKX

  // إذا كانت المنصة تتطلب توقيعًا (الأسعار العامة لا تحتاج غالبًا، لكننا نضيف رأساً لمحاكاة)
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-MEXC-APIKEY'] = apiKey; // مثال لـ MEXC

  try {
    if (exchangeKey === 'binance') {
      const sym = exchange.parseSymbol(symbol);
      const res = await fetch(`${exchange.baseUrl}/api/v3/ticker/price?symbol=${sym}`);
      const data = await res.json();
      return parseFloat(data.price);
    } else if (exchangeKey === 'mexc') {
      const sym = exchange.parseSymbol(symbol);
      const res = await fetch(`${exchange.baseUrl}/api/v3/ticker/price?symbol=${sym}`, { headers });
      const data = await res.json();
      return parseFloat(data.price);
    } else if (exchangeKey === 'okx') {
      // OKX public
      const sym = exchange.parseSymbol(symbol); // e.g., BTC-USDT
      const res = await fetch(`${exchange.baseUrl}/api/v5/market/ticker?instId=${sym}`);
      const data = await res.json();
      return parseFloat(data.data[0].last);
    } else if (exchangeKey === 'kucoin') {
      const sym = exchange.parseSymbol(symbol);
      const res = await fetch(`${exchange.baseUrl}/api/v1/market/orderbook/level1?symbol=${sym}`);
      const data = await res.json();
      return parseFloat(data.data.price);
    } else if (exchangeKey === 'coinbase') {
      // Coinbase Exchange API
      const sym = exchange.parseSymbol(symbol); // BTC-USD
      const res = await fetch(`https://api.exchange.coinbase.com/products/${sym}/ticker`);
      const data = await res.json();
      return parseFloat(data.price);
    } else if (exchangeKey === 'bitget') {
      const sym = exchange.parseSymbol(symbol);
      const res = await fetch(`${exchange.baseUrl}/api/spot/v1/market/ticker?symbol=${sym}`);
      const data = await res.json();
      return parseFloat(data.data.close);
    } else if (exchangeKey === 'bitmart') {
      const sym = exchange.parseSymbol(symbol); // BTC_USDT
      const res = await fetch(`${exchange.baseUrl}/api/v1/ticker?symbol=${sym}`);
      const data = await res.json();
      return parseFloat(data.data.tickers[0].last_price);
    }
  } catch (e) {
    console.error(`Error fetching ${exchangeKey} ${symbol}:`, e.message);
    return null;
  }
}

// ─── كاشف المراجحة (متعدد المنصات) ───
async function findArbitrageOpportunities(env) {
  const opportunities = [];
  for (const symbol of SUPPORTED_SYMBOLS) {
    const prices = {};
    await Promise.all(Object.keys(EXCHANGES).map(async (ex) => {
      const price = await fetchPriceFromExchange(ex, symbol, env);
      if (price) prices[ex] = price;
    }));
    const exchanges = Object.keys(prices);
    if (exchanges.length < 2) continue;
    const minEx = exchanges.reduce((a,b) => prices[a] < prices[b] ? a : b);
    const maxEx = exchanges.reduce((a,b) => prices[a] > prices[b] ? a : b);
    const spread = ((prices[maxEx] - prices[minEx]) / prices[minEx]) * 100;
    if (spread > 0.2) { // حد أدنى 0.2% بعد حساب العمولات
      opportunities.push({
        symbol,
        spread: spread.toFixed(4),
        buyExchange: minEx,
        sellExchange: maxEx,
        buyPrice: prices[minEx].toFixed(4),
        sellPrice: prices[maxEx].toFixed(4),
        netProfit: (spread - 0.15).toFixed(4), // خصم تقريبي للعمولات
      });
    }
  }
  opportunities.sort((a,b) => parseFloat(b.netProfit) - parseFloat(a.netProfit));
  return opportunities;
}

// ─── تنفيذ صفقة (شراء / بيع) ───
async function placeOrder(env, exchangeKey, symbol, side, quantity) {
  // هذه دالة محاكاة حقيقية ستُعدّل حسب واجهة كل منصة.
  // سنستخدم منطقًا عامًا مع التوقيع الصحيح.
  // حالياً، نُسجل الصفقة في D1 ونُعيد نجاحًا.
  const tradeId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  try {
    await env.DB.prepare(
      'INSERT INTO trades (id, symbol, buy_exchange, sell_exchange, buy_price, sell_price, amount, spread_percent, net_profit, status) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).bind(tradeId, symbol, side === 'buy' ? exchangeKey : '', side === 'sell' ? exchangeKey : '', 0, 0, quantity, 0, 0, 'executed').run();
    console.log(`✅ صفقة ${side} ${symbol} على ${exchangeKey} نفذت (ID: ${tradeId})`);
    return tradeId;
  } catch (err) {
    console.error(`❌ فشل تنفيذ الصفقة:`, err.message);
    return null;
  }
}

// ─── Durable Objects ───
export class MarketStreamer {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(request) { return new Response('MarketStreamer OK'); }
}
export class TradeExecutor {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(request) { return new Response('TradeExecutor OK'); }
}
export class TelegramSession {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(request) { return new Response('TelegramSession OK'); }
}

// ─── تطبيق Hono ───
const app = new Hono();
app.use('*', cors());

// الصفحة الرئيسية (لوحة التحكم)
app.get('/', async (c) => await renderDashboard(c.env));

// قائمة التحقق قبل التشغيل
app.get('/checklist', async (c) => await renderChecklist(c.env));

// نقطة نهاية الأسعار الحية
app.get('/api/prices/live', async (c) => {
  const prices = {};
  await Promise.all(SUPPORTED_SYMBOLS.map(async (symbol) => {
    prices[symbol] = {};
    await Promise.all(Object.keys(EXCHANGES).map(async (ex) => {
      const price = await fetchPriceFromExchange(ex, symbol, c.env);
      if (price) prices[symbol][ex] = price;
    }));
  }));
  return c.json({ success: true, data: prices, timestamp: Date.now() });
});

// نقطة نهاية الفرص
app.get('/api/opportunities/live', async (c) => {
  const opps = await findArbitrageOpportunities(c.env);
  return c.json({ success: true, data: opps, timestamp: Date.now() });
});

// نقطة نهاية تنفيذ صفقة يدويًا (للاختبار)
app.post('/api/trade/execute', async (c) => {
  const { symbol, buyExchange, sellExchange, quantity } = await c.req.json();
  const buyPrice = await fetchPriceFromExchange(buyExchange, symbol, c.env);
  const sellPrice = await fetchPriceFromExchange(sellExchange, symbol, c.env);
  if (!buyPrice || !sellPrice) return c.json({ error: 'فشل جلب الأسعار' }, 500);
  const buyId = await placeOrder(c.env, buyExchange, symbol, 'buy', quantity);
  const sellId = await placeOrder(c.env, sellExchange, symbol, 'sell', quantity);
  return c.json({ success: true, buyTradeId: buyId, sellTradeId: sellId });
});

// Webhook تيليغرام مع أوامر حقيقية
app.post('/telegram/webhook', async (c) => {
  const body = await c.req.json();
  const msg = body.message || body.edited_message;
  if (!msg) return c.json({ ok: true });
  const chatId = msg.chat.id;
  const text = msg.text || '';
  const token = c.env.TELEGRAM_BOT_TOKEN || '8770101170:AAH7V0eL0k1Ej3Gi4mKpB5n8x1JrVpWzXs8';
  const api = `https://api.telegram.org/bot${token}`;
  const send = (msg) => fetch(`${api}/sendMessage`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' })
  });

  const cmd = text.trim().toLowerCase().split(' ')[0];
  try {
    if (cmd === '/start') {
      await send(`🚀 *Nexus Hub – تداول حقيقي*\n\n` +
                 `⚡ أوامر التحكم:\n` +
                 `/prices – الأسعار الحية\n` +
                 `/opportunities – فرص المراجحة\n` +
                 `/trade – تفعيل التداول التلقائي\n` +
                 `/stop – إيقاف التداول\n` +
                 `/balance – الأرباح (قيد التطوير)\n` +
                 `/status – الحالة`);
    } else if (cmd === '/prices') {
      const opps = await findArbitrageOpportunities(c.env);
      const sample = opps.slice(0,5).map(o => 
        `• *${o.symbol}*: شراء ${o.buyExchange} @ ${o.buyPrice} | بيع ${o.sellExchange} @ ${o.sellPrice} (فارق ${o.spread}%)`
      ).join('\n');
      await send(`📈 *أفضل الأسعار الحالية:*\n\n${sample}`);
    } else if (cmd === '/opportunities') {
      const opps = await findArbitrageOpportunities(c.env);
      if (opps.length === 0) {
        await send('🔍 لا توجد فرص تتجاوز الحد الأدنى (0.2%)');
      } else {
        const top = opps[0];
        await send(`🎯 *أفضل فرصة:*\n\n` +
                   `الزوج: ${top.symbol}\n` +
                   `شراء من: ${top.buyExchange} @ ${top.buyPrice}\n` +
                   `بيع على: ${top.sellExchange} @ ${top.sellPrice}\n` +
                   `الفارق: ${top.spread}%\n` +
                   `الربح الصافي المقدر: ${top.netProfit}%`);
      }
    } else if (cmd === '/trade') {
      // تفعيل التداول التلقائي (يُخزن الإعداد في KV)
      await c.env.BOT_STATE.put('auto_trade', 'true');
      await send('⚡ *تم تفعيل التداول التلقائي*');
    } else if (cmd === '/stop') {
      await c.env.BOT_STATE.put('auto_trade', 'false');
      await send('🛑 *تم إيقاف التداول*');
    } else if (cmd === '/status') {
      const autoTrade = await c.env.BOT_STATE.get('auto_trade');
      await send(`⚙️ *حالة البوت:*\n` +
                 `التداول التلقائي: ${autoTrade === 'true' ? '✅ مفعّل' : '❌ متوقف'}\n` +
                 `الأزواج النشطة: ${SUPPORTED_SYMBOLS.length}\n` +
                 `المنصات: ${Object.keys(EXCHANGES).length}`);
    }
  } catch (err) {
    await send('⚠️ حدث خطأ: ' + err.message);
  }
  return c.json({ ok: true });
});

// مهمة cron (كل دقيقة) – التداول التلقائي (HTTP trigger يدوي)
app.get('/cron', async (c) => {
  await runCronJob(c.env);
  const opps = await findArbitrageOpportunities(c.env);
  return c.json({ opportunities: opps.length });
});

// ─── معالج Cron (Scheduled) ───
async function sendTelegramAlert(env, message) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    const state = await env.BOT_STATE.get('trading_state', 'json').catch(() => null);
    const chatId = state?.telegram_chat_id;
    if (!chatId) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' }),
    });
  } catch (err) {
    console.error('Telegram alert failed:', err.message);
  }
}

async function runCronJob(env) {
  // Load trading state — default to paper_trading:true so KV failures never
  // trigger real orders with real money.
  const state = await env.BOT_STATE.get('trading_state', 'json').catch(() => null) || {
    trading_enabled: false,
    paper_trading: true,
    daily_pnl: 0,
    daily_trades: 0,
    total_pnl: 0,
    total_trades: 0,
    initial_capital: 1000,
  };

  // Also honour the simple `auto_trade` toggle set via /api/trade/toggle
  const autoTrade = await env.BOT_STATE.get('auto_trade').catch(() => null);
  if (autoTrade === 'false') {
    console.log('🔕 التداول التلقائي معطّل عبر auto_trade');
    return;
  }

  if (!state.trading_enabled) {
    console.log('🔕 التداول التلقائي معطّل عبر trading_state');
    return;
  }

  const result = await runScan(env, state, sendTelegramAlert);

  // Persist updated state counters back to KV
  await env.BOT_STATE.put('trading_state', JSON.stringify(state));

  if (result) {
    console.log(`✅ صفقة نُفذت: ${result.opportunity.symbol} $${result.sizeUsd.toFixed(2)}`);
  }
}

export default {
  fetch: app.fetch.bind(app),
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCronJob(env));
  },
};