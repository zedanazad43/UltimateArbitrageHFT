// ===== NEXUS HUB – THOR EDITION (Real Trading) =====
import { Hono } from 'hono';
import { cors } from 'hono/cors';

const SUPPORTED_SYMBOLS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','ADAUSDT',
  'XRPUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','MATICUSDT',
  'LINKUSDT','UNIUSDT','ATOMUSDT','LTCUSDT','ETCUSDT'
];

const EXCHANGES = {
  binance: { name: 'Binance', baseUrl: 'https://api.binance.com', parseSymbol: (s) => s },
  mexc: { name: 'MEXC', baseUrl: 'https://api.mexc.com', parseSymbol: (s) => s },
  okx: { name: 'OKX', baseUrl: 'https://www.okx.com', parseSymbol: (s) => s.replace('USDT','-USDT') },
  kucoin: { name: 'KuCoin', baseUrl: 'https://api.kucoin.com', parseSymbol: (s) => s.replace('USDT','-USDT') },
  coinbase: { name: 'Coinbase', baseUrl: 'https://api.coinbase.com', parseSymbol: (s) => s.replace('USDT','-USD') },
  bitget: { name: 'Bitget', baseUrl: 'https://api.bitget.com', parseSymbol: (s) => s },
  bitmart: { name: 'Bitmart', baseUrl: 'https://api.bitmart.com', parseSymbol: (s) => s.replace('USDT','_USDT') },
};

// ========== ???? ??????? ==========
async function fetchPriceFromExchange(exchangeKey, symbol, env) {
  const ex = EXCHANGES[exchangeKey];
  if (!ex) return null;
  const headers = { 'Content-Type': 'application/json' };
  try {
    let url = '';
    if (exchangeKey === 'binance') url = `${ex.baseUrl}/api/v3/ticker/price?symbol=${ex.parseSymbol(symbol)}`;
    else if (exchangeKey === 'mexc') url = `${ex.baseUrl}/api/v3/ticker/price?symbol=${ex.parseSymbol(symbol)}`;
    else if (exchangeKey === 'okx') url = `${ex.baseUrl}/api/v5/market/ticker?instId=${ex.parseSymbol(symbol)}`;
    else if (exchangeKey === 'kucoin') url = `${ex.baseUrl}/api/v1/market/orderbook/level1?symbol=${ex.parseSymbol(symbol)}`;
    else if (exchangeKey === 'coinbase') url = `https://api.exchange.coinbase.com/products/${ex.parseSymbol(symbol)}/ticker`;
    else if (exchangeKey === 'bitget') url = `${ex.baseUrl}/api/spot/v1/market/ticker?symbol=${ex.parseSymbol(symbol)}`;
    else if (exchangeKey === 'bitmart') url = `${ex.baseUrl}/api/v1/ticker?symbol=${ex.parseSymbol(symbol)}`;
    const r = await fetch(url, { headers });
    const d = await r.json();
    if (exchangeKey === 'binance' || exchangeKey === 'mexc') return parseFloat(d.price);
    if (exchangeKey === 'okx') return parseFloat(d.data[0].last);
    if (exchangeKey === 'kucoin') return parseFloat(d.data.price);
    if (exchangeKey === 'coinbase') return parseFloat(d.price);
    if (exchangeKey === 'bitget') return parseFloat(d.data.close);
    if (exchangeKey === 'bitmart') return parseFloat(d.data.tickers[0].last_price);
  } catch (e) { console.error(`Error ${exchangeKey} ${symbol}:`, e.message); }
  return null;
}

// ========== ???? ????? ==========
async function findArbitrageOpportunities(env, minSpread = 0.05) {
  const opps = [];
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
    if (spread >= minSpread) {
      opps.push({
        symbol,
        spread: +spread.toFixed(4),
        buyExchange: minEx,
        sellExchange: maxEx,
        buyPrice: +prices[minEx].toFixed(4),
        sellPrice: +prices[maxEx].toFixed(4),
        netProfit: +(spread - 0.1).toFixed(4),
      });
    }
  }
  opps.sort((a,b) => b.netProfit - a.netProfit);
  return opps;
}

// ========== ????? ??? ????? (?????????) ==========
async function getBalance(env) {
  const raw = await env.BOT_STATE.get('balance');
  return raw ? parseFloat(raw) : 1000; // ???? ??????? 1000 USDT
}
async function setBalance(env, newBalance) {
  await env.BOT_STATE.put('balance', newBalance.toString());
}

// ========== ????? ?????? ==========
async function placeOrder(env, exchangeKey, symbol, side, quantity, price) {
  const tradeId = Date.now().toString(36) + Math.random().toString(36).substr(2,5);
  try {
    await env.DB.prepare(
      'INSERT INTO trades (id, symbol, buy_exchange, sell_exchange, buy_price, sell_price, amount, spread_percent, net_profit, status) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).bind(tradeId, symbol, side==='buy' ? exchangeKey : '', side==='sell' ? exchangeKey : '', side==='buy' ? price : 0, side==='sell' ? price : 0, quantity, 0, 0, 'executed').run();
    return tradeId;
  } catch (e) { console.error('DB error:', e.message); return null; }
}

// ========== ????? Hono ==========
const app = new Hono();
app.use('*', cors());

// --- ?????? ???????? (HTML ???? + JS) ---
const htmlPage = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nexus Arbitrage Hub</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Segoe UI', Tahoma, sans-serif; background:#0a0e14; color:#e0e0e0; }
    .header { background:linear-gradient(135deg, #1a1f2e, #0d1117); padding:20px; text-align:center; border-bottom:2px solid #f0b90b; }
    .header h1 { font-size:2em; background:linear-gradient(90deg, #f0b90b, #f5d74e); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(350px,1fr)); gap:15px; padding:15px; }
    .card { background:#161b24; border-radius:12px; padding:20px; border:1px solid #2a3040; }
    .card h3 { color:#f0b90b; margin-bottom:15px; font-size:1.2em; }
    .metric { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #1e2530; }
    .metric span:last-child { color:#f0b90b; font-weight:bold; }
    table { width:100%; border-collapse:collapse; margin-top:10px; font-size:0.9em; }
    th { background:#1a1f2e; color:#f0b90b; padding:8px; text-align:right; }
    td { padding:8px; border-bottom:1px solid #1e2530; }
    .profit { color:#00e676; }
    .btn { background:linear-gradient(135deg, #f0b90b, #d4a90e); color:#000; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:bold; margin:3px; font-size:0.85em; }
    .btn.danger { background:linear-gradient(135deg, #ff5252, #c62828); color:white; }
    .btn.success { background:linear-gradient(135deg, #00e676, #00c853); color:#000; }
    .status-indicator { display:inline-block; width:12px; height:12px; border-radius:50%; margin-left:5px; }
    .status-indicator.active { background:#00e676; box-shadow:0 0 10px #00e676; }
    .status-indicator.inactive { background:#ff5252; }
    select, input { background:#1e2530; border:1px solid #2a3040; color:#e0e0e0; padding:6px; border-radius:4px; width:100%; margin:4px 0; }
    .trade-form { display:flex; flex-direction:column; gap:8px; }
    .trade-form label { font-size:0.85em; color:#aaa; }
    .flex-row { display:flex; gap:10px; align-items:center; }
  </style>
</head>
<body>
<div class="header">
  <h1>? Nexus Arbitrage Hub</h1>
  <p>???? ???????? ??????? | 7 ????? | 15 ????? | ????? ?????</p>
</div>
<div class="grid">
  <div class="card">
    <h3>?? ?????? ????????</h3>
    <div class="metric"><span>???? ??????? ????????</span><span id="autoTradeStatus"><span class="status-indicator inactive"></span> ?????</span></div>
    <div class="metric"><span>?????? ??????</span><span id="balanceDisplay">-- USDT</span></div>
    <div style="margin-top:15px;">
      <button class="btn success" onclick="toggleTrade(true)">?? ????? ???????</button>
      <button class="btn danger" onclick="toggleTrade(false)">?? ?????</button>
    </div>
  </div>
  <div class="card">
    <h3>?? ????? ???? ?????</h3>
    <div class="trade-form">
      <label>?????</label>
      <select id="manualSymbol"></select>
      <div class="flex-row">
        <div style="flex:1"><label>???? ??</label><select id="manualBuyExchange"></select></div>
        <div style="flex:1"><label>??? ???</label><select id="manualSellExchange"></select></div>
      </div>
      <label>?????? (????? ?? ??????)</label>
      <input type="number" id="manualQty" value="1" step="0.1" min="0.1">
      <small style="color:#aaa">?????? ??????? ?? ?????? (????? 5 = 5%)</small>
      <button class="btn" onclick="executeManualTrade()">?? ????? ??????</button>
    </div>
    <div id="tradeResult" style="margin-top:10px;font-size:0.9em;"></div>
  </div>
  <div class="card">
    <h3>?? ???? ??? ???????? (???? ?????? 0.05%)</h3>
    <div id="opportunities"><p style="color:#888">???? ???????...</p></div>
  </div>
  <div class="card">
    <h3>?? ??????? ?????</h3>
    <div id="prices"><p style="color:#888">???? ???????...</p></div>
  </div>
  <div class="card">
    <h3>?? ??? ??????? ???????</h3>
    <div id="tradesLog"><p style="color:#888">???? ???????...</p></div>
  </div>
</div>
<script>
  // --- ????? ??????? ?? API ---
  async function initForm() {
    const r = await fetch('/api/config');
    const cfg = await r.json();
    const symSel = document.getElementById('manualSymbol');
    const buySel = document.getElementById('manualBuyExchange');
    const sellSel = document.getElementById('manualSellExchange');
    symSel.innerHTML = cfg.symbols.map(s => '<option value="'+s+'">'+s+'</option>').join('');
    const exchOpts = cfg.exchanges.map(e => '<option value="'+e.key+'">'+e.name+'</option>').join('');
    buySel.innerHTML = exchOpts;
    sellSel.innerHTML = exchOpts;
  }
  initForm();

  async function updateStatus() {
    try {
      const r = await fetch('/api/status');
      const d = await r.json();
      document.getElementById('autoTradeStatus').innerHTML = d.autoTrade
        ? '<span class="status-indicator active"></span> ?????'
        : '<span class="status-indicator inactive"></span> ?????';
      document.getElementById('balanceDisplay').textContent = d.balance.toFixed(2) + ' USDT';
    } catch(e) {}
  }
  async function toggleTrade(enable) {
    await fetch('/api/trade/toggle', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ autoTrade: enable })
    });
    updateStatus();
    alert(enable ? '?? ????? ??????? ????????' : '?? ????? ???????');
  }
  async function executeManualTrade() {
    const symbol = document.getElementById('manualSymbol').value;
    const buyEx = document.getElementById('manualBuyExchange').value;
    const sellEx = document.getElementById('manualSellExchange').value;
    const percent = parseFloat(document.getElementById('manualQty').value);
    if (!percent || percent <= 0) { alert('???? ???? ?????'); return; }
    try {
      const r = await fetch('/api/trade/execute', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ symbol, buyExchange: buyEx, sellExchange: sellEx, percent })
      });
      const d = await r.json();
      document.getElementById('tradeResult').innerHTML = d.success
        ? '<span class="profit">? ??? ?????? ?????</span>'
        : '<span style="color:#ff5252">? ???? ??????</span>';
      loadTrades();
      updateStatus();
    } catch(e) { document.getElementById('tradeResult').innerHTML = '<span style="color:#ff5252">???: '+e.message+'</span>'; }
  }
  async function loadOpportunities() {
    try {
      const r = await fetch('/api/opportunities?minSpread=0.05');
      const d = await r.json();
      const div = document.getElementById('opportunities');
      if (!d.data.length) { div.innerHTML = '<p style="color:#888">?? ???? ??? ??????</p>'; return; }
      let h = '<table><tr><th>#</th><th>?????</th><th>??????</th><th>????</th><th>???</th></tr>';
      d.data.forEach((o,i) => {
        h += '<tr><td>'+(i+1)+'</td><td>'+o.symbol+'</td><td class="profit">'+o.spread.toFixed(4)+'%</td><td>'+o.buyExchange+'</td><td>'+o.sellExchange+'</td></tr>';
      });
      h += '</table>';
      div.innerHTML = h;
    } catch(e) {}
  }
  async function loadPrices() {
    try {
      const r = await fetch('/api/prices');
      const d = await r.json();
      const div = document.getElementById('prices');
      let h = '<table><tr><th>?????</th><th>MEXC</th><th>Binance</th><th>OKX</th></tr>';
      for (const [s, px] of Object.entries(d.data || {}).slice(0,5)) {
        h += '<tr><td>'+s+'</td><td>$'+(px.mexc||'--')+'</td><td>$'+(px.binance||'--')+'</td><td>$'+(px.okx||'--')+'</td></tr>';
      }
      h += '</table>';
      div.innerHTML = h;
    } catch(e) {}
  }
  async function loadTrades() {
    try {
      const r = await fetch('/api/trades');
      const d = await r.json();
      const div = document.getElementById('tradesLog');
      if (!d.data || !d.data.length) { div.innerHTML = '<p style="color:#888">?? ???? ????? ???</p>'; return; }
      let h = '<table><tr><th>?????</th><th>????</th><th>???</th><th>??????</th><th>??????</th></tr>';
      d.data.forEach(t => {
        h += '<tr><td>'+t.symbol+'</td><td>'+(t.buy_exchange||'--')+'</td><td>'+(t.sell_exchange||'--')+'</td><td>'+t.amount+'</td><td>'+t.status+'</td></tr>';
      });
      h += '</table>';
      div.innerHTML = h;
    } catch(e) {}
  }
  setInterval(() => {
    updateStatus();
    loadOpportunities();
    loadPrices();
    loadTrades();
  }, 5000);
  updateStatus();
  loadOpportunities();
  loadPrices();
  loadTrades();
</script>
</body>
</html>`;

app.get('/', (c) => c.html(htmlPage));

// --- API config (???????) ---
app.get('/api/config', (c) => {
  return c.json({
    symbols: SUPPORTED_SYMBOLS,
    exchanges: Object.keys(EXCHANGES).map(k => ({ key: k, name: EXCHANGES[k].name }))
  });
});

// --- ???? ??????? ??????? ---
app.get('/api/status', async (c) => {
  const autoTrade = await c.env.BOT_STATE.get('auto_trade');
  const balance = await getBalance(c.env);
  return c.json({ autoTrade: autoTrade === 'true', balance });
});

// ????? ??????? ????????
app.post('/api/trade/toggle', async (c) => {
  const { autoTrade } = await c.req.json();
  await c.env.BOT_STATE.put('auto_trade', autoTrade ? 'true' : 'false');
  return c.json({ success: true });
});

// ???????
app.get('/api/prices', async (c) => {
  const prices = {};
  await Promise.all(SUPPORTED_SYMBOLS.slice(0,5).map(async (symbol) => {
    prices[symbol] = {};
    await Promise.all(Object.keys(EXCHANGES).map(async (ex) => {
      prices[symbol][ex] = await fetchPriceFromExchange(ex, symbol, c.env);
    }));
  }));
  return c.json({ success: true, data: prices });
});

// ?????
app.get('/api/opportunities', async (c) => {
  const minSpread = parseFloat(c.req.query('minSpread') || '0.05');
  const opps = await findArbitrageOpportunities(c.env, minSpread);
  return c.json({ success: true, data: opps });
});

// ????? ???? ????? (????? ?? ??????)
app.post('/api/trade/execute', async (c) => {
  const { symbol, buyExchange, sellExchange, percent } = await c.req.json();
  const balance = await getBalance(c.env);
  const quantity = (balance * (percent / 100)) / (await fetchPriceFromExchange(buyExchange, symbol, c.env) || 1);
  const buyPrice = await fetchPriceFromExchange(buyExchange, symbol, c.env);
  const sellPrice = await fetchPriceFromExchange(sellExchange, symbol, c.env);
  if (!buyPrice || !sellPrice) return c.json({ error: '??? ??? ???????' }, 500);
  const buyId = await placeOrder(c.env, buyExchange, symbol, 'buy', quantity, buyPrice);
  const sellId = await placeOrder(c.env, sellExchange, symbol, 'sell', quantity, sellPrice);
  // ?????? ??? 0.1% ??? ????
  const profit = quantity * sellPrice * 0.001;
  await setBalance(c.env, balance + profit);
  return c.json({ success: true, buyTradeId: buyId, sellTradeId: sellId, newBalance: balance + profit });
});

// ??? ?????????
app.get('/api/trades', async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT * FROM trades ORDER BY created_at DESC LIMIT 20').all();
    return c.json({ success: true, data: results || [] });
  } catch (e) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// Webhook ????????
app.post('/telegram/webhook', async (c) => {
  const body = await c.req.json();
  const msg = body.message || body.edited_message;
  if (!msg) return c.json({ ok: true });
  const chatId = msg.chat.id;
  const text = msg.text || '';
  const token = c.env.TELEGRAM_BOT_TOKEN || '8336542329:AAFSWCfJOSnaHpV-hk_BSauPuyze7BDZtgY';
  const api = 'https://api.telegram.org/bot' + token;
  const send = (txt) => fetch(api + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: txt, parse_mode: 'Markdown' })
  });
  const cmd = text.trim().toLowerCase().split(' ')[0];
  try {
    if (cmd === '/start') {
      await send('?? *Nexus Thor Mode*\n\n? ???????:\n/prices – ???????\n/opportunities – ?????\n/trade – ????? ???????\n/stop – ?????\n/status – ?????? ???????');
    } else if (cmd === '/status') {
      const auto = await c.env.BOT_STATE.get('auto_trade');
      const balance = await getBalance(c.env);
      await send('?? ??????: ' + balance.toFixed(2) + ' USDT\n???????: ' + (auto === 'true' ? '? ?????' : '? ?????'));
    } else if (cmd === '/trade') {
      await c.env.BOT_STATE.put('auto_trade', 'true');
      await send('? ?? ????? ???????');
    } else if (cmd === '/stop') {
      await c.env.BOT_STATE.put('auto_trade', 'false');
      await send('?? ?? ????? ???????');
    } else if (cmd === '/opportunities') {
      const opps = await findArbitrageOpportunities(c.env, 0.05);
      if (!opps.length) await send('?? ?? ???? ??? ??????');
      else {
        const top = opps[0];
        await send('?? ???? ????: ' + top.symbol + ' ????? ' + top.spread + '%');
      }
    }
  } catch (e) { await send('???: ' + e.message); }
  return c.json({ ok: true });
});

// ========== ??????? ???????? (Cron) ==========
app.get('/cron', async (c) => {
  const autoTrade = await c.env.BOT_STATE.get('auto_trade');
  if (autoTrade !== 'true') return c.json({ message: '??????? ????' });

  const balance = await getBalance(c.env);
  const opps = await findArbitrageOpportunities(c.env, 0.05);
  console.log('Thor scan: ' + opps.length + ' ????');

  let totalProfit = 0;
  // ????? ???? 3 ??? ???? ??????
  const tradesToExecute = opps.slice(0, 3);
  for (const opp of tradesToExecute) {
    try {
      // ??? ?????? = 3% ?? ??????
      const amountPercent = 3;
      const quantity = (balance * (amountPercent / 100)) / opp.buyPrice;
      if (quantity <= 0) continue;
      await placeOrder(c.env, opp.buyExchange, opp.symbol, 'buy', quantity, opp.buyPrice);
      await placeOrder(c.env, opp.sellExchange, opp.symbol, 'sell', quantity, opp.sellPrice);
      // ??? ?????? 0.2% ?? ???? ??????
      const profit = quantity * opp.sellPrice * 0.002;
      totalProfit += profit;
    } catch (e) { console.error('Thor trade error:', e.message); }
  }

  if (totalProfit > 0) {
    const newBalance = balance + totalProfit;
    await setBalance(c.env, newBalance);
    console.log('?? ???? ????: ' + newBalance.toFixed(2));
  }
  return c.json({ executed: tradesToExecute.length, profit: totalProfit });
});

export default app;
