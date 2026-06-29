// ==================================================================
//  ULTIMATE ARBITRAGE BOT - v24.0 "WHALE" (النسخة المتوحشة - الحوت)
//  Live-first · Multi-exchange · Perpetuals · Adaptive Leverage
//  Auto-compound · 40% Safety Margin · Latency Arbitrage · DEX+CEX
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

// Default risk limits – overridable at runtime via /config
const DEFAULT_RISK = {
  MAX_DAILY_LOSS_USD: 25,
  MIN_SECONDS_BETWEEN_TRADES: 30,
  PAPER_TRADING: false,
  MIN_PROFIT_SAFETY_PCT: 0.4,   // only execute when net/gross ≥ 40%
  MAX_PER_TRADE_LOSS_PCT: 0.02, // skip trade if per-trade loss risk > 2%
  MAX_SPREAD_PCT: 5.0           // skip if gross spread > 5% (likely stale/erroneous price)
};

const SUPPORTED_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT',
  'BNBUSDT', 'AVAXUSDT', 'MATICUSDT', 'LINKUSDT', 'UNIUSDT',
  'ADAUSDT', 'DOTUSDT', 'LTCUSDT', 'TRXUSDT', 'NEARUSDT'
];

// ---------- Admin Auth ----------
function checkAdminToken(request, env) {
  if (!env.ADMIN_TOKEN) {
    // No token configured — log a warning and allow; set ADMIN_TOKEN in production
    console.warn('⚠️  ADMIN_TOKEN is not set. Protected endpoints are unguarded.');
    return true;
  }
  const token =
    request.headers.get('x-admin-token') ||
    (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') ||
    new URL(request.url).searchParams.get('token');
  return token === env.ADMIN_TOKEN;
}

// ---------- Execution Lock (prevents concurrent scans) ----------
const LOCK_KEY = 'execution_lock';
const LOCK_TTL_S = 30;

async function acquireExecutionLock(env) {
  try {
    const existing = await env.BOT_STATE.get(LOCK_KEY);
    if (existing) {
      const lock = JSON.parse(existing);
      if (Date.now() - lock.acquired_at < LOCK_TTL_S * 1000) return false;
    }
    await env.BOT_STATE.put(
      LOCK_KEY,
      JSON.stringify({ acquired_at: Date.now() }),
      { expirationTtl: LOCK_TTL_S }
    );
    return true;
  } catch (_) {
    return true; // if KV unavailable, allow execution
  }
}

async function releaseExecutionLock(env) {
  try { await env.BOT_STATE.delete(LOCK_KEY); } catch (_) {}
}

// ---------- Daily Reset ----------
function todayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

function applyDailyResetIfNeeded(state) {
  if (state.daily_reset_date !== todayDateStr()) {
    state.daily_pnl = 0;
    state.daily_trades = 0;
    state.daily_used_usd = 0;
    state.auto_stopped = false;
    state.auto_stop_reason = null;
    state.last_trade_timestamp = 0;
    state.daily_reset_date = todayDateStr();
  }
  return state;
}

// ---------- MarketStreamer Durable Object ----------
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
      this.ws.send(JSON.stringify({
        method: 'SUBSCRIPTION',
        params: [`spot@public.miniTicker.v3.api@${this.symbol}@UTC+8`],
        id: Date.now()
      }));
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
      } catch (_) {}
    };
    this.ws.onerror = (error) => console.error(`[${this.symbol}] WebSocket error:`, error);
    this.ws.onclose = () => {
      this.ws = null;
      setTimeout(() => this.connectWebSocket(), 1000);
    };
  }

  async updateVolatility(priceHistory) {
    if (priceHistory.length < 5) return 1.0;
    const returns = [];
    for (let i = 1; i < priceHistory.length; i++) {
      returns.push((priceHistory[i] - priceHistory[i - 1]) / priceHistory[i - 1]);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    this.volatility = Math.sqrt(variance) * 100 * Math.sqrt(288);
    await this.state.storage.put('volatility', this.volatility);
    return this.volatility;
  }
}

// ---------- Main Worker ----------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/' || path === '/dashboard') return renderDashboard(env);
    if (path === '/checklist') return renderChecklist(env);

    if (path === '/health' || path === '/status') {
      const state = await env.BOT_STATE.get('trading_state', 'json') || {};
      return new Response(JSON.stringify({
        status: 'ok',
        trading_enabled: state.trading_enabled !== false,
        paper_trading: state.paper_trading !== false,
        auto_stopped: state.auto_stopped || false,
        auto_stop_reason: state.auto_stop_reason || null,
        daily_trades: state.daily_trades || 0,
        daily_pnl: state.daily_pnl || 0,
        total_pnl: state.total_pnl || 0,
        equity: (state.initial_capital || CONFIG.RISK.INITIAL_CAPITAL_USD) + (state.total_pnl || 0),
        timestamp: new Date().toISOString()
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ---------- Admin-protected actions ----------
    const PROTECTED = ['/start', '/stop', '/scan', '/mode/paper', '/mode/live', '/config'];
    if (PROTECTED.includes(path)) {
      if (!checkAdminToken(request, env)) {
        return new Response('Unauthorized', { status: 401 });
      }
    }

    if (path === '/start') {
      const state = await env.BOT_STATE.get('trading_state', 'json') || {};
      state.trading_enabled = true;
      state.auto_stopped = false;
      state.auto_stop_reason = null;
      await env.BOT_STATE.put('trading_state', JSON.stringify(state));
      await logAdminEvent(env, 'start', request);
      await sendTelegramAlert(env, '▶️ Trading enabled');
      return new Response('✅ تم تشغيل التداول');
    }

    if (path === '/stop') {
      const state = await env.BOT_STATE.get('trading_state', 'json') || {};
      state.trading_enabled = false;
      await env.BOT_STATE.put('trading_state', JSON.stringify(state));
      await logAdminEvent(env, 'stop', request);
      await sendTelegramAlert(env, '⏸️ Trading disabled');
      return new Response('✅ تم إيقاف التداول');
    }

    if (path === '/scan') {
      ctx.waitUntil(scanAndExecute(env));
      return new Response('✅ بدأ المسح الفوري');
    }

    if (path === '/mode/paper') {
      const state = await env.BOT_STATE.get('trading_state', 'json') || {};
      state.paper_trading = true;
      await env.BOT_STATE.put('trading_state', JSON.stringify(state));
      await sendTelegramAlert(env, '📄 Mode changed: PAPER TRADING');
      return new Response('✅ تم تفعيل وضع التداول الورقي (Paper Mode)');
    }

    if (path === '/mode/live') {
      const state = await env.BOT_STATE.get('trading_state', 'json') || {};
      state.paper_trading = false;
      await env.BOT_STATE.put('trading_state', JSON.stringify(state));
      await sendTelegramAlert(env, '🔴 Mode changed: LIVE TRADING');
      return new Response('✅ تم تفعيل وضع التداول الحقيقي (Live Mode)');
    }

    if (path === '/config' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch (_) {
        return new Response('Invalid JSON', { status: 400 });
      }
      const state = await env.BOT_STATE.get('trading_state', 'json') || {};
      for (const key of ['max_daily_loss_usd', 'min_seconds_between_trades', 'max_per_trade_loss_pct', 'initial_capital', 'max_spread_pct', 'max_trades_per_scan']) {
        if (body[key] !== undefined) {
          const v = parseFloat(body[key]);
          if (!isNaN(v) && v > 0) state[key] = v;
        }
      }
      await env.BOT_STATE.put('trading_state', JSON.stringify(state));
      return new Response(JSON.stringify({ status: 'updated', state }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (path === '/test-ws') {
      const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
      const id = env.MARKET_STREAMER.idFromName(symbol);
      const obj = env.MARKET_STREAMER.get(id);
      await obj.fetch('https://dummy/connect');
      return new Response(`✅ بدأ اتصال WebSocket لـ ${symbol}`);
    }

    return new Response('🤖 Ultimate Arbitrage Bot v24.0 WHALE — Control Center. Open /dashboard', { status: 200 });
  },

  async scheduled(event, env) {
    const state = await env.BOT_STATE.get('trading_state', 'json') || { trading_enabled: true };
    if (!state.trading_enabled) return;
    await scanAndExecute(env);
  },

  async queue(batch, env) {
    // Queue consumer handler — acknowledges all messages from ultimate-arbitrage-queue
    for (const msg of batch.messages) {
      try {
        const body = msg.body;
        if (body && body.type === 'trade') {
          console.log('Queue trade event:', JSON.stringify(body));
        }
        msg.ack();
      } catch (e) {
        console.error('Queue handler error:', e.message);
        msg.retry();
      }
    }
  }
};

// ---------- Dashboard HTML ----------
async function renderDashboard(env) {
  const state = await env.BOT_STATE.get('trading_state', 'json') || {
    trading_enabled: true, paper_trading: false,
    daily_used_usd: 0, daily_pnl: 0, daily_trades: 0, total_trades: 0, total_pnl: 0,
    max_daily_loss_usd: DEFAULT_RISK.MAX_DAILY_LOSS_USD,
    min_seconds_between_trades: DEFAULT_RISK.MIN_SECONDS_BETWEEN_TRADES,
    auto_stopped: false
  };
  const initialCapital = state.initial_capital || CONFIG.RISK.INITIAL_CAPITAL_USD;
  const equity = initialCapital + (state.total_pnl || 0);
  const currentLeverage = calculateAdaptiveLeverage(equity, 0.05, initialCapital);
  let tradesHtml = '';
  let pnlData = [];
  let paperCount = 0;
  let liveCount = 0;
  if (env.DB) {
    try {
      const { results } = await env.DB.prepare(
        `SELECT * FROM trades ORDER BY created_at DESC LIMIT 20`
      ).all();
      tradesHtml = results.map(t => {
        const modeLabel = t.mode === 'live'
          ? '<span style="color:#e74c3c;font-weight:bold">LIVE</span>'
          : '<span style="color:#f0b90b;font-weight:bold">PAPER</span>';
        return `<tr><td>${modeLabel}</td><td>${t.strategy}</td><td>$${Number(t.size_usd).toFixed(2)}</td><td>${Number(t.net_profit_percent).toFixed(4)}%</td><td>${new Date(t.created_at).toLocaleString('ar')}</td></tr>`;
      }).join('');
      let cumPnl = 0;
      pnlData = [...results].reverse().map(t => {
        cumPnl += t.size_usd * t.net_profit_percent / 100;
        return cumPnl.toFixed(2);
      });
      paperCount = results.filter(t => t.mode === 'paper').length;
      liveCount = results.filter(t => t.mode === 'live').length;
    } catch (_) {}
  }
  const paperMode = state.paper_trading !== false;
  const modeColor = paperMode ? '#f0b90b' : '#e74c3c';
  const modeLabel = paperMode ? '📄 PAPER' : '🔴 LIVE';
  const statusColor = state.trading_enabled ? '#2ecc71' : '#e74c3c';
  const autoStopBanner = state.auto_stopped
    ? `<div style="background:#e74c3c;color:#fff;padding:12px 20px;border-radius:8px;margin-bottom:18px;font-weight:bold">🛑 Auto-stopped: ${state.auto_stop_reason || 'limit exceeded'}</div>`
    : '';
  const maxLoss = state.max_daily_loss_usd ?? DEFAULT_RISK.MAX_DAILY_LOSS_USD;
  const minSec = state.min_seconds_between_trades ?? DEFAULT_RISK.MIN_SECONDS_BETWEEN_TRADES;
  const maxPerTradeLoss = state.max_per_trade_loss_pct ?? DEFAULT_RISK.MAX_PER_TRADE_LOSS_PCT;

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Ultimate Arbitrage v24.0 WHALE — Control Center</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
  <style>
    *{box-sizing:border-box}
    body{background:#0b0e14;color:#eee;font-family:'Segoe UI',sans-serif;padding:20px;margin:0}
    h1{color:#f0b90b;font-size:1.5em;margin-bottom:18px}
    h2{color:#f0b90b;font-size:1.1em;margin:18px 0 10px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:18px}
    .card{background:#1a1e26;padding:16px;border-radius:12px}
    .card-label{color:#888;font-size:.78em;margin-bottom:4px}
    .card-value{font-size:1.35em;font-weight:bold}
    .panel{background:#1a1e26;padding:20px;border-radius:12px;margin-bottom:18px}
    .btn{background:#f0b90b;color:#000;padding:9px 16px;border:none;border-radius:8px;margin:4px;cursor:pointer;font-weight:bold;font-size:.88em}
    .btn:hover{opacity:.85}
    .btn-red{background:#e74c3c;color:#fff}
    .btn-green{background:#2ecc71;color:#000}
    .btn-blue{background:#3498db;color:#fff}
    .risk-row{display:flex;flex-wrap:wrap;gap:14px;margin-top:14px}
    .risk-item{display:flex;flex-direction:column;gap:4px}
    .risk-item label{color:#888;font-size:.78em}
    .risk-item input{background:#2a2e38;color:#eee;border:1px solid #444;border-radius:6px;padding:7px 10px;width:130px}
    table{width:100%;border-collapse:collapse;background:#1a1e26;border-radius:12px;overflow:hidden}
    th{background:#2a2e38;color:#f0b90b;padding:11px 12px;text-align:right}
    td{padding:9px 12px;border-bottom:1px solid #2a2e38}
    .status-bar{display:flex;flex-wrap:wrap;gap:18px;align-items:center;padding:14px 20px;background:#1a1e26;border-radius:12px;margin-bottom:18px}
  </style>
</head>
<body>
<h1>🐋 Ultimate Arbitrage Bot v24.0 WHALE — Control Center</h1>

${autoStopBanner}

<div class="status-bar">
  <span>الحالة: <strong style="color:${statusColor}">${state.trading_enabled ? '▶️ مفعّل' : '⏸️ متوقف'}</strong></span>
  <span>الوضع: <strong style="color:${modeColor}">${modeLabel}</strong></span>
  <span>💎 رأس المال الفعلي: <strong style="color:#2ecc71">$${equity.toFixed(2)}</strong></span>
  <span>📈 إجمالي الأرباح: <strong style="color:${(state.total_pnl||0) >= 0 ? '#2ecc71' : '#e74c3c'}">$${(state.total_pnl||0).toFixed(2)}</strong></span>
  <span>📊 ربح اليوم: <strong style="color:${(state.daily_pnl || 0) >= 0 ? '#2ecc71' : '#e74c3c'}">$${(state.daily_pnl || 0).toFixed(2)}</strong></span>
  <span>⚡ رافعة حالية: <strong style="color:#f0b90b">${currentLeverage}x</strong></span>
  <span>🎯 صفقات اليوم: <strong>${state.daily_trades || 0}</strong></span>
  <span>📊 الإجمالي: <strong>${state.total_trades || 0}</strong></span>
</div>

<div class="panel">
  <h2 style="margin-top:0">⚡ تحكم سريع</h2>
  <button class="btn btn-green" data-admin-action="1" onclick="adminAction('start')">▶️ تشغيل التداول</button>
  <button class="btn btn-red" data-admin-action="1" onclick="adminAction('stop')">⏸️ إيقاف التداول</button>
  <button class="btn" data-admin-action="1" onclick="adminAction('scan')">🔍 مسح فوري</button>
  <button class="btn btn-blue" onclick="location.reload()">🔄 تحديث</button>
  <button class="btn" onclick="window.open('/checklist','_blank')">✅ قائمة التشغيل</button>
</div>

<div class="panel">
  <h2 style="margin-top:0">🎛️ إعدادات التشغيل</h2>
  <div style="margin-bottom:14px">
    <strong>وضع التداول:</strong>
    <button class="btn" data-admin-action="1" onclick="setMode('paper')" style="margin-right:8px">📄 Paper (محاكاة)</button>
    <button class="btn btn-red" data-admin-action="1" onclick="setMode('live')">🔴 Live (حقيقي)</button>
    <span style="margin-right:10px;color:${modeColor};font-weight:bold">${modeLabel}</span>
  </div>
  <div class="risk-row">
    <div class="risk-item">
      <label>أقصى خسارة يومية ($)</label>
      <input id="maxDailyLoss" type="number" value="${maxLoss}" min="1" step="1">
    </div>
    <div class="risk-item">
      <label>أقصى خسارة للصفقة (%)</label>
      <input id="maxPerTrade" type="number" value="${maxPerTradeLoss}" min="0.001" step="0.001">
    </div>
    <div class="risk-item">
      <label>فاصل بين الصفقات (ثانية)</label>
      <input id="minSeconds" type="number" value="${minSec}" min="1" step="1">
    </div>
    <div class="risk-item">
      <label>رأس المال الابتدائي ($)</label>
      <input id="initialCapital" type="number" value="${initialCapital}" min="1" step="1">
    </div>
  </div>
  <div style="margin-top:14px">
    <button class="btn" data-admin-action="1" onclick="saveConfig()">💾 حفظ الإعدادات</button>
  </div>
</div>

<div class="grid">
  <div class="card"><div class="card-label">رأس المال الفعلي</div><div class="card-value" style="color:#2ecc71">$${equity.toFixed(2)}</div></div>
  <div class="card"><div class="card-label">إجمالي الأرباح</div><div class="card-value" style="color:${(state.total_pnl||0)>=0?'#2ecc71':'#e74c3c'}">$${(state.total_pnl||0).toFixed(2)}</div></div>
  <div class="card"><div class="card-label">صفقات Live (آخر 20)</div><div class="card-value" style="color:#e74c3c">${liveCount}</div></div>
  <div class="card"><div class="card-label">نسبة النجاح</div><div class="card-value">${((state.win_rate || 0.55) * 100).toFixed(1)}%</div></div>
</div>

<div class="panel"><canvas id="pnlChart"></canvas></div>

<h2>📊 آخر الصفقات</h2>
<table>
  <tr><th>الوضع</th><th>الاستراتيجية</th><th>الحجم (USD)</th><th>الربح</th><th>الوقت</th></tr>
  ${tradesHtml || '<tr><td colspan="5" style="text-align:center;padding:20px;color:#888">لا توجد صفقات مسجّلة</td></tr>'}
</table>

<script>
  const TOKEN = sessionStorage.getItem('adminToken') || (()=>{
    const t = prompt('أدخل Admin Token (اتركه فارغاً للعرض فقط)') || '';
    if(t) sessionStorage.setItem('adminToken', t);
    return t;
  })();
  function setButtonsBusy(isBusy){
    document.querySelectorAll('[data-admin-action]').forEach((btn) => btn.disabled = isBusy);
  }
  const MIN_DAILY_LOSS_USD = 1;
  const MIN_TRADE_INTERVAL_SECONDS = 1;
  const MIN_INITIAL_CAPITAL_USD = 1;
  const MIN_PER_TRADE_LOSS_PCT = 0.001;
  function tryParseJson(text) {
    try { return text ? JSON.parse(text) : null; } catch (_) { return null; }
  }
  async function callAdminApi(path, options = {}) {
    let response;
    try {
      response = await fetch(path, {
        ...options,
        headers: {
          ...(options.headers || {}),
          'x-admin-token': TOKEN
        }
      });
    } catch (_) {
      throw new Error('تعذر الاتصال بالخادم');
    }
    const text = await response.text();
    if (!response.ok) throw new Error(text || ('HTTP ' + response.status));
    return { text, response };
  }
  async function adminAction(a){
    setButtonsBusy(true);
    try {
      const result = await callAdminApi('/' + a);
      alert(result.text || '✅ تم التنفيذ');
      location.reload();
    } catch (e) {
      alert('❌ فشل تنفيذ الأمر: ' + (e?.message || 'خطأ غير متوقع'));
    } finally {
      setButtonsBusy(false);
    }
  }
  async function setMode(m){
    setButtonsBusy(true);
    try {
      const result = await callAdminApi('/mode/' + m);
      alert(result.text || '✅ تم التنفيذ');
      location.reload();
    } catch (e) {
      alert('❌ فشل تغيير الوضع: ' + (e?.message || 'خطأ غير متوقع'));
    } finally {
      setButtonsBusy(false);
    }
  }
  async function saveConfig(){
    const body={
      max_daily_loss_usd: parseFloat(document.getElementById('maxDailyLoss').value),
      max_per_trade_loss_pct: parseFloat(document.getElementById('maxPerTrade').value),
      min_seconds_between_trades: parseFloat(document.getElementById('minSeconds').value),
      initial_capital: parseFloat(document.getElementById('initialCapital').value)
    };
    if (Number.isNaN(body.max_daily_loss_usd) || body.max_daily_loss_usd < MIN_DAILY_LOSS_USD) {
      alert('❌ أقصى خسارة يومية يجب أن تكون ' + MIN_DAILY_LOSS_USD + ' أو أكثر');
      return;
    }
    if (Number.isNaN(body.max_per_trade_loss_pct) || body.max_per_trade_loss_pct < MIN_PER_TRADE_LOSS_PCT) {
      alert('❌ أقصى خسارة للصفقة يجب أن تكون ' + MIN_PER_TRADE_LOSS_PCT + ' أو أكثر');
      return;
    }
    if (Number.isNaN(body.min_seconds_between_trades) || body.min_seconds_between_trades < MIN_TRADE_INTERVAL_SECONDS) {
      alert('❌ فاصل الصفقات يجب أن يكون ' + MIN_TRADE_INTERVAL_SECONDS + ' ثانية أو أكثر');
      return;
    }
    if (Number.isNaN(body.initial_capital) || body.initial_capital < MIN_INITIAL_CAPITAL_USD) {
      alert('❌ رأس المال الابتدائي يجب أن يكون ' + MIN_INITIAL_CAPITAL_USD + ' أو أكثر');
      return;
    }
    setButtonsBusy(true);
    try {
      const result = await callAdminApi('/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const payload = tryParseJson(result.text);
      alert(payload?.status === 'updated' ? '✅ تم حفظ الإعدادات' : (result.text || '✅ تم التنفيذ'));
      location.reload();
    } catch (e) {
      alert('❌ فشل حفظ الإعدادات: ' + (e?.message || 'خطأ غير متوقع'));
    } finally {
      setButtonsBusy(false);
    }
  }
  const ctx = document.getElementById('pnlChart').getContext('2d');
  new Chart(ctx,{type:'line',data:{
    labels:[...Array(${pnlData.length})].map((_,i)=>i+1),
    datasets:[{label:'الربح المتراكم ($)',data:${JSON.stringify(pnlData)},borderColor:'#f0b90b',backgroundColor:'rgba(240,185,11,0.08)',fill:true,tension:.3}]
  },options:{responsive:true,plugins:{legend:{labels:{color:'#eee'}}},scales:{x:{ticks:{color:'#888'}},y:{ticks:{color:'#888'}}}}});
</script>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ---------- Go-Live Checklist ----------
async function renderChecklist(env) {
  const state = await env.BOT_STATE.get('trading_state', 'json') || {};
  let paperTradesCount = 0;
  if (env.DB) {
    try {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM trades WHERE mode = ?`).bind('paper').first();
      paperTradesCount = row?.n || 0;
    } catch (_) {}
  }
  const checks = [
    { name: 'مفتاح MEXC API مضبوط', ok: !!env.MEXC_API_KEY, critical: true, note: 'مطلوب للتداول الحقيقي' },
    { name: 'سر MEXC API مضبوط', ok: !!env.MEXC_API_SECRET, critical: true, note: 'مطلوب للتداول الحقيقي' },
    { name: 'رمز المدير (ADMIN_TOKEN) مضبوط', ok: !!env.ADMIN_TOKEN, critical: true, note: 'لحماية أوامر التحكم' },
    { name: 'رمز Telegram Bot مضبوط', ok: !!env.TELEGRAM_BOT_TOKEN, critical: false, note: 'للتنبيهات' },
    { name: 'وضع التداول الحقيقي مفعّل', ok: state.paper_trading === false, critical: true, note: 'التداول الحقيقي (Live)' },
    { name: 'حد الخسارة اليومية محدد', ok: !!(state.max_daily_loss_usd), critical: true, note: `الحالي: $${state.max_daily_loss_usd || DEFAULT_RISK.MAX_DAILY_LOSS_USD}` },
    { name: 'التداول مفعّل', ok: state.trading_enabled !== false, critical: false, note: 'تشغيل قبل الفحص' },
    { name: 'لا يوجد إيقاف تلقائي نشط', ok: !state.auto_stopped, critical: false, note: state.auto_stop_reason || '' }
  ];
  const criticalOk = checks.filter(c => c.critical).every(c => c.ok);
  const allOk = checks.every(c => c.ok);
  const readinessColor = allOk ? '#2ecc71' : (criticalOk ? '#f0b90b' : '#e74c3c');
  const readinessLabel = allOk
    ? '✅ جاهز للتداول الحقيقي'
    : (criticalOk ? '⚠️ المتطلبات الأساسية مكتملة — يُنصح بمزيد من اختبار Paper' : '🔴 غير جاهز — يُرجى إكمال المتطلبات الحرجة');
  const rows = checks.map(c =>
    `<tr><td>${c.ok ? '✅' : (c.critical ? '🔴' : '⚠️')}</td><td>${c.name}</td><td>${c.note}</td><td>${c.critical ? '<span style="color:#e74c3c;font-weight:bold">مطلوب</span>' : '<span style="color:#888">اختياري</span>'}</td></tr>`
  ).join('');
  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>Go-Live Checklist</title>
<style>body{background:#0b0e14;color:#eee;font-family:'Segoe UI',sans-serif;padding:30px}h1{color:#f0b90b}
.status{background:#1a1e26;padding:14px 20px;border-radius:10px;font-size:1.1em;font-weight:bold;color:${readinessColor};margin-bottom:20px}
table{width:100%;border-collapse:collapse;background:#1a1e26;border-radius:12px;overflow:hidden}
th{background:#2a2e38;color:#f0b90b;padding:11px;text-align:right}td{padding:11px;border-bottom:1px solid #2a2e38}
a{color:#f0b90b;display:inline-block;margin-top:20px}</style></head>
<body><h1>✅ قائمة التحقق قبل التشغيل الحقيقي</h1>
<div class="status">${readinessLabel}</div>
<table><tr><th>الحالة</th><th>البند</th><th>ملاحظة</th><th>أهمية</th></tr>${rows}</table>
<a href="/dashboard">← العودة للوحة التحكم</a></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ---------- Log Admin Event to D1 ----------
async function logAdminEvent(env, action, request) {
  if (!env.DB) return;
  try {
    const ip = request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-forwarded-for') || null;
    await env.DB.prepare(`INSERT INTO admin_events (action, source_ip, created_at) VALUES (?, ?, ?)`)
      .bind(action, ip, Date.now()).run();
  } catch (_) {}
}

// ---------- Price Helpers ----------
// Fetch with hard timeout via AbortController — single slow exchange must not
// stall the whole scan cycle. Default 350ms is generous for global edges.
async function fetchWithTimeout(url, options = {}, timeoutMs = 350) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Direct MEXC spot price — drops the previous Durable-Object round-trip which
// added ~30-80ms with no benefit when the DO wasn't pre-warmed for the symbol.
async function getPrice(env, symbol, source = 'mexc') {
  try {
    const apiUrl = source === 'mexc'
      ? `https://api.mexc.com/api/v3/ticker/price?symbol=${symbol}`
      : `https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${symbol.replace('USDT', '-USDT')}`;
    const resp = await fetchWithTimeout(apiUrl, { cf: { cacheTtl: 1, cacheEverything: true } });
    const data = await resp.json();
    const price = source === 'mexc' ? parseFloat(data.price) : parseFloat(data?.data?.price);
    if (!price || isNaN(price)) return null;
    return { price, exchange: source, fee: source === 'mexc' ? 0.0005 : 0.001 };
  } catch (_) { return null; }
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
    sellToken: token.sell, buyToken: token.buy,
    sellAmount: amount, slippageBps: (CONFIG.ZEROX.SLIPPAGE * 100).toString()
  });
  const resp = await fetch(
    `https://api.0x.org/swap/allowance-holder/price?${params.toString()}`,
    { headers: { '0x-api-key': apiKey, '0x-version': 'v2' } }
  );
  const data = await resp.json();
  if (data.code) return null;
  const buyAmount = parseFloat(ethers.formatUnits(data.buyAmount, token.decimals));
  return { price: 1000 / buyAmount, exchange: '0x', fee: 0.0 };
}

// ---------- Multi-Exchange Price Helpers ----------
async function getBinancePrice(env, symbol) {
  try {
    const resp = await fetchWithTimeout(
      `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`,
      { cf: { cacheTtl: 1, cacheEverything: true } }
    );
    const data = await resp.json();
    const price = parseFloat(data.price);
    if (!price || isNaN(price)) return null;
    return { price, exchange: 'binance', fee: 0.001 };
  } catch (_) { return null; }
}

async function getMEXCPerpPrice(env, symbol) {
  try {
    const perpSymbol = symbol.replace('USDT', '_USDT');
    const resp = await fetchWithTimeout(`https://contract.mexc.com/api/v1/contract/ticker?symbol=${perpSymbol}`);
    const data = await resp.json();
    if (data.success && data.data?.lastPrice) {
      return { price: parseFloat(data.data.lastPrice), exchange: 'mexc_perp', fee: 0.0002 };
    }
  } catch (_) {}
  return null;
}

async function getKuCoinPrice(env, symbol) {
  try {
    const kuSymbol = symbol.endsWith('USDT') ? symbol.slice(0, -4) + '-USDT' : symbol;
    const resp = await fetchWithTimeout(
      `https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${kuSymbol}`,
      { cf: { cacheTtl: 1, cacheEverything: true } }
    );
    const data = await resp.json();
    const price = parseFloat(data?.data?.price);
    if (!price || isNaN(price)) return null;
    return { price, exchange: 'kucoin', fee: 0.001 };
  } catch (_) { return null; }
}

// Adaptive leverage: base 3x, grows log2 with capital, capped 50x, scales with margin
function calculateAdaptiveLeverage(equity, netProfitPct, initialCapital) {
  const ic = initialCapital || CONFIG.RISK.INITIAL_CAPITAL_USD;
  const growthFactor = Math.max(1, equity / ic);
  const baseLev = 3 + Math.floor(Math.log2(growthFactor) * 3);
  const marginScale = Math.min(2.0, netProfitPct / 0.05); // 0.05% as reference margin
  const leverage = Math.round(baseLev * Math.max(0.5, marginScale));
  return Math.max(2, Math.min(50, leverage));
}

// MEXC Futures (perpetuals) order
async function placeMEXCFuturesOrder(env, symbol, side, quantity, leverage) {
  const apiKey = env.MEXC_API_KEY, apiSecret = env.MEXC_API_SECRET;
  if (!apiKey) throw new Error('MEXC_API_KEY is not configured');
  if (!apiSecret) throw new Error('MEXC_API_SECRET is not configured');
  const perpSymbol = symbol.replace('USDT', '_USDT');
  const recvWindow = 5000;
  const timestamp = Date.now();
  // side: 1=open long, 2=open short, 3=close long, 4=close short
  const sideCode = side === 'LONG' ? 1 : 2;
  const orderBody = JSON.stringify({
    symbol: perpSymbol, side: sideCode, openType: 1, type: 5,
    vol: parseFloat(quantity), leverage
  });
  const rawSig = `${timestamp}${apiKey}${recvWindow}${orderBody}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawSig));
  const signature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  const resp = await fetch('https://contract.mexc.com/api/v1/private/order/submit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ApiKey': apiKey,
      'Request-Time': timestamp.toString(),
      'Signature': signature,
      'recv-window': recvWindow.toString()
    },
    body: orderBody
  });
  const data = await resp.json();
  if (!data.success) throw new Error(data.message || `MEXC Futures error`);
  return data;
}

function calculatePositionSize(equity, winRate, riskRewardRatio) {  const baseSize = CONFIG.RISK.BASE_POSITION_SIZE_USD;
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
  if (!apiKey) throw new Error('MEXC_API_KEY is not configured');
  if (!apiSecret) throw new Error('MEXC_API_SECRET is not configured');
  const timestamp = Date.now().toString();
  const params = { symbol, side: side.toUpperCase(), type: 'MARKET', quantity, timestamp };
  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(sorted));
  params.signature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  const body = new URLSearchParams(params).toString();
  const resp = await fetch('https://api.mexc.com/api/v3/order', {
    method: 'POST',
    headers: { 'X-MEXC-APIKEY': apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await resp.json();
  if (data.code) throw new Error(data.msg || `MEXC error ${data.code}`);
  return data;
}

async function sendTelegramAlert(env, msg) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: msg })
    });
  } catch (_) {}
}

// ---------- Core: Whale Scan & Execute (v24.0) ----------
async function scanAndExecute(env) {
  const locked = await acquireExecutionLock(env);
  if (!locked) {
    console.log('⏳ Scan skipped: execution lock is held by another invocation');
    return;
  }
  try {
    let state = await env.BOT_STATE.get('trading_state', 'json') || {
      trading_enabled: true, paper_trading: false,
      daily_used_usd: 0, daily_pnl: 0, daily_trades: 0, total_trades: 0, total_pnl: 0,
      win_rate: 0.55, risk_reward_ratio: 2.0, last_trade_timestamp: 0
    };

    // Apply daily reset first; this may re-enable trading if auto_stopped on previous day
    const wasAutoStopped = state.auto_stopped;
    state = applyDailyResetIfNeeded(state);
    if (wasAutoStopped && state.auto_stopped === false) {
      // Daily reset cleared an automatic stop — re-enable and notify
      state.trading_enabled = true;
      await env.BOT_STATE.put('trading_state', JSON.stringify(state));
      await sendTelegramAlert(env, '🔄 Auto-restarted after daily reset');
      console.log('🔄 Auto-restarted: trading re-enabled after daily reset');
    }

    if (!state.trading_enabled) return;

    const maxDailyLoss = state.max_daily_loss_usd ?? DEFAULT_RISK.MAX_DAILY_LOSS_USD;
    const minSecondsBetween = state.min_seconds_between_trades ?? DEFAULT_RISK.MIN_SECONDS_BETWEEN_TRADES;
    const minSafetyPct = state.min_profit_safety_pct ?? DEFAULT_RISK.MIN_PROFIT_SAFETY_PCT;
    const maxSpreadPct = state.max_spread_pct ?? DEFAULT_RISK.MAX_SPREAD_PCT;
    const paperMode = state.paper_trading !== false;

    // Circuit breaker: daily loss limit
    const dailyPnl = state.daily_pnl || 0;
    if (dailyPnl < 0 && Math.abs(dailyPnl) >= maxDailyLoss) {
      state.trading_enabled = false;
      state.auto_stopped = true;
      state.auto_stop_reason = `تجاوز حد الخسارة اليومية ($${maxDailyLoss})`;
      await env.BOT_STATE.put('trading_state', JSON.stringify(state));
      await sendTelegramAlert(env, `🛑 Auto-stopped: ${state.auto_stop_reason}`);
      console.log(`🛑 ${state.auto_stop_reason}`);
      return;
    }

    // Cooldown between trades
    const lastTradeTs = state.last_trade_timestamp || 0;
    if (lastTradeTs && (Date.now() - lastTradeTs) / 1000 < minSecondsBetween) {
      console.log(`⏳ Cooldown active — ${minSecondsBetween}s between trades`);
      return;
    }

    // Auto-compounded equity: initial capital + all-time profits
    const initialCapital = state.initial_capital || CONFIG.RISK.INITIAL_CAPITAL_USD;
    const equity = initialCapital + (state.total_pnl || 0);

    // ---------- PHASE 1: Parallel scan across ALL symbols ----------
    // Previously this loop walked symbols sequentially, multiplying per-symbol
    // RTT by 15. We now fan out across every symbol (and each symbol fans out
    // across its 5 price sources), so the total scan latency = slowest single
    // (symbol × source) pair, not the SUM. Expect ~15× lower decision latency.
    const scanResults = await Promise.allSettled(
      SUPPORTED_SYMBOLS.map(async (symbol) => {
        const [rMEXC, rZeroX, rBinance, rPerp, rKuCoin] = await Promise.allSettled([
          getPrice(env, symbol, 'mexc'),
          get0xPrice(env, symbol),
          getBinancePrice(env, symbol),
          getMEXCPerpPrice(env, symbol),
          getKuCoinPrice(env, symbol)
        ]);
        const sources = [
          rMEXC.status === 'fulfilled' ? rMEXC.value : null,
          rZeroX.status === 'fulfilled' ? rZeroX.value : null,
          rBinance.status === 'fulfilled' ? rBinance.value : null,
          rPerp.status === 'fulfilled' ? rPerp.value : null,
          rKuCoin.status === 'fulfilled' ? rKuCoin.value : null
        ].filter(Boolean);
        if (sources.length < 2) return null;

        // Volatility guard: skip if max observed spread looks like stale data
        const prices = sources.map(s => s.price);
        const priceMin = Math.min(...prices);
        const priceMax = Math.max(...prices);
        const maxObservedSpread = ((priceMax - priceMin) / priceMin) * 100;
        if (maxObservedSpread > maxSpreadPct) {
          return { symbol, skipped: 'spread_guard', spread: maxObservedSpread };
        }

        // Find best (buy, sell) pair across all sources
        let bestOpp = null;
        for (let i = 0; i < sources.length; i++) {
          for (let j = 0; j < sources.length; j++) {
            if (i === j) continue;
            const buyEx = sources[i];
            const sellEx = sources[j];
            if (sellEx.price <= buyEx.price) continue;
            const grossPct = ((sellEx.price - buyEx.price) / buyEx.price) * 100;
            const totalFeePct = (buyEx.fee + sellEx.fee) * 100;
            const netPct = grossPct - totalFeePct;
            if (netPct <= 0) continue;
            const safetyFactor = netPct / grossPct;
            if (safetyFactor < minSafetyPct) continue;
            if (!bestOpp || netPct > bestOpp.netPct) {
              bestOpp = { symbol, buyEx, sellEx, grossPct, netPct, safetyFactor };
            }
          }
        }
        return bestOpp;
      })
    );

    // Collect & rank opportunities; execute up to MAX_TRADES_PER_SCAN per cycle.
    const opportunities = scanResults
      .filter(r => r.status === 'fulfilled' && r.value && r.value.buyEx)
      .map(r => r.value)
      .sort((a, b) => b.netPct - a.netPct);

    const maxTradesPerScan = Math.max(1, Math.min(5, state.max_trades_per_scan || 1));

    let executedThisCycle = 0;
    for (const opp of opportunities) {
      if (executedThisCycle >= maxTradesPerScan) break;
      try {
        const { symbol, buyEx, sellEx, netPct, safetyFactor } = opp;

        // Adaptive leverage: grows with capital
        const leverage = calculateAdaptiveLeverage(equity, netPct, initialCapital);
        const baseSize = calculatePositionSize(equity, state.win_rate || 0.55, state.risk_reward_ratio || 2.0);
        const sizeUsd = Math.min(baseSize * leverage, equity * 0.5);
        const amount = (sizeUsd / buyEx.price).toFixed(6);
        const mode = paperMode ? 'paper' : 'live';
        const direction = `${buyEx.exchange.toUpperCase()}→${sellEx.exchange.toUpperCase()}`;

        console.log(`🐋 ${symbol} | ${direction} | net: ${netPct.toFixed(4)}% | safety: ${(safetyFactor*100).toFixed(1)}% | lev: ${leverage}x | $${sizeUsd.toFixed(2)}`);

        if (paperMode) {
          await sendTelegramAlert(env, `📄 [PAPER] 🐋 ${symbol}\n${direction}\nحجم: $${sizeUsd.toFixed(2)} | رافعة: ${leverage}x\nصافي: ${netPct.toFixed(4)}% | أمان: ${(safetyFactor*100).toFixed(1)}%`);
        } else {
          try {
            const isPerp = buyEx.exchange.includes('perp') || sellEx.exchange.includes('perp');
            if (isPerp) {
              const side = sellEx.exchange.includes('perp') ? 'SHORT' : 'LONG';
              await placeMEXCFuturesOrder(env, symbol, side, amount, leverage);
            } else if (buyEx.exchange === 'mexc') {
              await placeMarketOrderMEXC(env, symbol, 'BUY', amount);
            } else if (sellEx.exchange === 'mexc') {
              await placeMarketOrderMEXC(env, symbol, 'SELL', amount);
            } else {
              await placeMEXCFuturesOrder(env, symbol, 'LONG', amount, leverage);
            }
            await sendTelegramAlert(env, `✅ [LIVE] 🐋 ${symbol}\n${direction}\nحجم: $${sizeUsd.toFixed(2)} | رافعة: ${leverage}x\nصافي: ${netPct.toFixed(4)}% | أمان: ${(safetyFactor*100).toFixed(1)}%`);
          } catch (orderErr) {
            console.error(`❌ Order failed ${symbol}:`, orderErr.message);
            await sendTelegramAlert(env, `❌ فشل تنفيذ ${symbol}: ${orderErr.message}`);
            continue;
          }
        }

        // Update state — auto-compound profits
        const tradePnl = sizeUsd * netPct / 100;
        state.daily_used_usd = (state.daily_used_usd || 0) + sizeUsd;
        state.daily_pnl = (state.daily_pnl || 0) + tradePnl;
        state.total_pnl = (state.total_pnl || 0) + tradePnl;
        state.daily_trades = (state.daily_trades || 0) + 1;
        state.total_trades = (state.total_trades || 0) + 1;
        state.last_trade_timestamp = Date.now();

        if (env.DB) {
          try {
            await env.DB.prepare(
              `INSERT INTO trades (strategy, size_usd, net_profit_percent, mode, created_at) VALUES (?, ?, ?, ?, ?)`
            ).bind(direction, sizeUsd, netPct, mode, Date.now()).run();
          } catch (dbErr) {
            console.error('D1 log error:', dbErr.message);
          }
        }

        executedThisCycle++;
      } catch (e) {
        console.error('❌ Execution error:', e.message);
      }
    }

    // Single persist after all writes for this cycle
    if (executedThisCycle > 0) {
      await env.BOT_STATE.put('trading_state', JSON.stringify(state));
    }
  } finally {
    await releaseExecutionLock(env);
  }
}
