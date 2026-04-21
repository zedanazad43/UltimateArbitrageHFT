// ==================================================================
//  ULTIMATE ARBITRAGE BOT - v23.0 (ORCHESTRATED CONTROL CENTER)
//  Paper-first · Risk-guarded · Admin-protected · Auto-stop
//  Execution lock · Daily reset · Full Runtime Controls dashboard
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
  MAX_DAILY_TRADES: 20,
  MIN_SECONDS_BETWEEN_TRADES: 30,
  PAPER_TRADING: true
};

const SUPPORTED_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'];

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

    if (path === '/dashboard') return renderDashboard(env);
    if (path === '/checklist') return renderChecklist(env);

    if (path === '/health') {
      const state = await env.BOT_STATE.get('trading_state', 'json') || {};
      return new Response(JSON.stringify({
        status: 'ok',
        trading_enabled: state.trading_enabled !== false,
        paper_trading: state.paper_trading !== false,
        auto_stopped: state.auto_stopped || false,
        auto_stop_reason: state.auto_stop_reason || null,
        daily_trades: state.daily_trades || 0,
        daily_pnl: state.daily_pnl || 0,
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
      for (const key of ['max_daily_loss_usd', 'max_daily_trades', 'min_seconds_between_trades']) {
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

    return new Response('🤖 Ultimate Arbitrage Bot v23.0 — Control Center', { status: 200 });
  },

  async scheduled(event, env) {
    const state = await env.BOT_STATE.get('trading_state', 'json') || { trading_enabled: true };
    if (!state.trading_enabled) return;
    await scanAndExecute(env);
  }
};

// ---------- Dashboard HTML ----------
async function renderDashboard(env) {
  const state = await env.BOT_STATE.get('trading_state', 'json') || {
    trading_enabled: true, paper_trading: true,
    daily_used_usd: 0, daily_pnl: 0, daily_trades: 0, total_trades: 0, win_rate: 0.55,
    max_daily_loss_usd: DEFAULT_RISK.MAX_DAILY_LOSS_USD,
    max_daily_trades: DEFAULT_RISK.MAX_DAILY_TRADES,
    min_seconds_between_trades: DEFAULT_RISK.MIN_SECONDS_BETWEEN_TRADES,
    auto_stopped: false
  };
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
  const maxTrades = state.max_daily_trades ?? DEFAULT_RISK.MAX_DAILY_TRADES;
  const minSec = state.min_seconds_between_trades ?? DEFAULT_RISK.MIN_SECONDS_BETWEEN_TRADES;

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Ultimate Arbitrage v23.0 — Control Center</title>
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
<h1>🔥 Ultimate Arbitrage Bot v23.0 — Control Center</h1>

${autoStopBanner}

<div class="status-bar">
  <span>الحالة: <strong style="color:${statusColor}">${state.trading_enabled ? '▶️ مفعّل' : '⏸️ متوقف'}</strong></span>
  <span>الوضع: <strong style="color:${modeColor}">${modeLabel}</strong></span>
  <span>💰 حجم اليوم: <strong>$${(state.daily_used_usd || 0).toFixed(2)}</strong></span>
  <span>📈 صافي اليوم: <strong style="color:${(state.daily_pnl || 0) >= 0 ? '#2ecc71' : '#e74c3c'}">$${(state.daily_pnl || 0).toFixed(2)}</strong></span>
  <span>🎯 صفقات اليوم: <strong>${state.daily_trades || 0} / ${maxTrades}</strong></span>
  <span>📊 الإجمالي: <strong>${state.total_trades || 0}</strong></span>
</div>

<div class="panel">
  <h2 style="margin-top:0">⚡ تحكم سريع</h2>
  <button class="btn btn-green" onclick="adminAction('start')">▶️ تشغيل التداول</button>
  <button class="btn btn-red" onclick="adminAction('stop')">⏸️ إيقاف التداول</button>
  <button class="btn" onclick="adminAction('scan')">🔍 مسح فوري</button>
  <button class="btn btn-blue" onclick="location.reload()">🔄 تحديث</button>
  <button class="btn" onclick="window.open('/checklist','_blank')">✅ قائمة التشغيل</button>
</div>

<div class="panel">
  <h2 style="margin-top:0">🎛️ إعدادات التشغيل</h2>
  <div style="margin-bottom:14px">
    <strong>وضع التداول:</strong>
    <button class="btn" onclick="setMode('paper')" style="margin-right:8px">📄 Paper (محاكاة)</button>
    <button class="btn btn-red" onclick="setMode('live')">🔴 Live (حقيقي)</button>
    <span style="margin-right:10px;color:${modeColor};font-weight:bold">${modeLabel}</span>
  </div>
  <div class="risk-row">
    <div class="risk-item">
      <label>أقصى خسارة يومية ($)</label>
      <input id="maxDailyLoss" type="number" value="${maxLoss}" min="1" step="1">
    </div>
    <div class="risk-item">
      <label>أقصى صفقات يومية</label>
      <input id="maxDailyTrades" type="number" value="${maxTrades}" min="1" step="1">
    </div>
    <div class="risk-item">
      <label>فاصل بين الصفقات (ثانية)</label>
      <input id="minSeconds" type="number" value="${minSec}" min="1" step="1">
    </div>
  </div>
  <div style="margin-top:14px">
    <button class="btn" onclick="saveConfig()">💾 حفظ الإعدادات</button>
  </div>
</div>

<div class="grid">
  <div class="card"><div class="card-label">صفقات Paper (آخر 20)</div><div class="card-value" style="color:#f0b90b">${paperCount}</div></div>
  <div class="card"><div class="card-label">صفقات Live (آخر 20)</div><div class="card-value" style="color:#e74c3c">${liveCount}</div></div>
  <div class="card"><div class="card-label">حد الخسارة اليومية</div><div class="card-value">$${maxLoss}</div></div>
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
  async function adminAction(a){
    const r = await fetch('/'+a,{headers:{'x-admin-token':TOKEN}});
    alert(await r.text()); location.reload();
  }
  async function setMode(m){
    const r = await fetch('/mode/'+m,{headers:{'x-admin-token':TOKEN}});
    alert(await r.text()); location.reload();
  }
  async function saveConfig(){
    const body={
      max_daily_loss_usd: parseFloat(document.getElementById('maxDailyLoss').value),
      max_daily_trades: parseFloat(document.getElementById('maxDailyTrades').value),
      min_seconds_between_trades: parseFloat(document.getElementById('minSeconds').value)
    };
    await fetch('/config',{method:'POST',headers:{'Content-Type':'application/json','x-admin-token':TOKEN},body:JSON.stringify(body)});
    alert('✅ تم حفظ الإعدادات'); location.reload();
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
    { name: 'وضع المحاكاة (Paper) مفعّل', ok: state.paper_trading !== false, critical: false, note: 'يجب اختبار Paper أولاً' },
    { name: 'صفقات محاكاة مسجّلة', ok: paperTradesCount > 0, critical: false, note: `${paperTradesCount} صفقة محاكاة` },
    { name: 'حد الخسارة اليومية محدد', ok: !!(state.max_daily_loss_usd), critical: true, note: `الحالي: $${state.max_daily_loss_usd || DEFAULT_RISK.MAX_DAILY_LOSS_USD}` },
    { name: 'حد الصفقات اليومية محدد', ok: !!(state.max_daily_trades), critical: false, note: `الحالي: ${state.max_daily_trades || DEFAULT_RISK.MAX_DAILY_TRADES}` },
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
async function getPrice(env, symbol, source = 'mexc') {
  try {
    const id = env.MARKET_STREAMER.idFromName(symbol);
    const obj = env.MARKET_STREAMER.get(id);
    const resp = await obj.fetch('https://dummy/price');
    const data = await resp.json();
    if (data.price > 0) return { price: data.price, exchange: source, fee: 0.0005 };
  } catch (_) {}
  const apiUrl = source === 'mexc'
    ? `https://api.mexc.com/api/v3/ticker/price?symbol=${symbol}`
    : `https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${symbol.replace('USDT', '-USDT')}`;
  const resp = await fetch(apiUrl);
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

// ---------- Core: Risk-guarded Scan & Execute ----------
async function scanAndExecute(env) {
  // Prevent concurrent executions with a KV-backed lock
  const locked = await acquireExecutionLock(env);
  if (!locked) {
    console.log('⏳ Scan skipped: execution lock is held by another invocation');
    return;
  }
  try {
    let state = await env.BOT_STATE.get('trading_state', 'json') || {
      trading_enabled: true, paper_trading: true,
      daily_used_usd: 0, daily_pnl: 0, daily_trades: 0, total_trades: 0,
      win_rate: 0.55, risk_reward_ratio: 2.0, last_trade_timestamp: 0
    };

    if (!state.trading_enabled) return;

    // Daily counter reset
    state = applyDailyResetIfNeeded(state);

    // Read risk limits (runtime-configurable, fall back to defaults)
    const maxDailyLoss = state.max_daily_loss_usd ?? DEFAULT_RISK.MAX_DAILY_LOSS_USD;
    const maxDailyTrades = state.max_daily_trades ?? DEFAULT_RISK.MAX_DAILY_TRADES;
    const minSecondsBetween = state.min_seconds_between_trades ?? DEFAULT_RISK.MIN_SECONDS_BETWEEN_TRADES;
    const paperMode = state.paper_trading !== false;

    // Guard: daily trade count
    if ((state.daily_trades || 0) >= maxDailyTrades) {
      state.trading_enabled = false;
      state.auto_stopped = true;
      state.auto_stop_reason = `تجاوز حد الصفقات اليومية (${maxDailyTrades})`;
      await env.BOT_STATE.put('trading_state', JSON.stringify(state));
      await sendTelegramAlert(env, `🛑 Auto-stopped: ${state.auto_stop_reason}`);
      console.log(`🛑 ${state.auto_stop_reason}`);
      return;
    }

    // Guard: daily loss limit
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

    // Guard: cooldown between trades
    const lastTradeTs = state.last_trade_timestamp || 0;
    if (lastTradeTs && (Date.now() - lastTradeTs) / 1000 < minSecondsBetween) {
      console.log(`⏳ Cooldown active — ${minSecondsBetween}s between trades`);
      return;
    }

    const equity = CONFIG.RISK.INITIAL_CAPITAL_USD + dailyPnl;

    for (const symbol of SUPPORTED_SYMBOLS) {
      try {
        const [mexcPrice, zeroPrice] = await Promise.all([
          getPrice(env, symbol, 'mexc'),
          get0xPrice(env, symbol)
        ]);
        if (!mexcPrice || !zeroPrice) continue;

        console.log(`📊 ${symbol}: MEXC=$${mexcPrice.price.toFixed(4)} | 0x=$${zeroPrice.price.toFixed(4)}`);

        const diffMEXCto0x = ((zeroPrice.price - mexcPrice.price) / mexcPrice.price) * 100;
        const diff0xtoMEXC = ((mexcPrice.price - zeroPrice.price) / zeroPrice.price) * 100;
        let bestDiff = 0, direction = null;
        if (diffMEXCto0x > CONFIG.PROFIT.SCALPING) { bestDiff = diffMEXCto0x; direction = 'MEXC_TO_0X'; }
        if (diff0xtoMEXC > CONFIG.PROFIT.SCALPING && diff0xtoMEXC > bestDiff) { bestDiff = diff0xtoMEXC; direction = '0X_TO_MEXC'; }
        if (!direction) continue;

        console.log(`🎯 فرصة ${symbol}: ${direction} | فرق: ${bestDiff.toFixed(4)}%`);

        const sizeUsd = calculatePositionSize(equity, state.win_rate || 0.55, state.risk_reward_ratio || 2.0);
        const amount = (sizeUsd / (direction === 'MEXC_TO_0X' ? mexcPrice.price : zeroPrice.price)).toFixed(6);
        const mode = paperMode ? 'paper' : 'live';

        if (paperMode) {
          // Simulate — no real order placed
          console.log(`📄 [PAPER] ${symbol} ${direction} | Edge: ${bestDiff.toFixed(4)}% | Size: $${sizeUsd.toFixed(2)}`);
          await sendTelegramAlert(env, `📄 [PAPER] ${symbol}\n${direction}\nحجم: $${sizeUsd.toFixed(2)}\nربح متوقع: ${bestDiff.toFixed(4)}%`);
        } else {
          // Live — real MEXC order
          try {
            if (direction === 'MEXC_TO_0X') {
              await placeMarketOrderMEXC(env, symbol, 'BUY', amount);
            } else {
              await placeMarketOrderMEXC(env, symbol, 'SELL', amount);
            }
            await sendTelegramAlert(env, `✅ [LIVE] صفقة ${symbol}\n${direction}\nحجم: $${sizeUsd.toFixed(2)}\nربح: ${bestDiff.toFixed(4)}%`);
          } catch (orderErr) {
            console.error(`❌ Order failed for ${symbol}:`, orderErr.message);
            await sendTelegramAlert(env, `❌ فشل تنفيذ صفقة ${symbol}: ${orderErr.message}`);
            continue; // don't update counters on order failure
          }
        }

        // Update state counters
        state.daily_used_usd = (state.daily_used_usd || 0) + sizeUsd;
        state.daily_pnl = (state.daily_pnl || 0) + sizeUsd * bestDiff / 100;
        state.daily_trades = (state.daily_trades || 0) + 1;
        state.total_trades = (state.total_trades || 0) + 1;
        state.last_trade_timestamp = Date.now();
        await env.BOT_STATE.put('trading_state', JSON.stringify(state));

        // Log to D1
        if (env.DB) {
          try {
            await env.DB.prepare(
              `INSERT INTO trades (strategy, size_usd, net_profit_percent, mode, created_at) VALUES (?, ?, ?, ?, ?)`
            ).bind(direction, sizeUsd, bestDiff, mode, Date.now()).run();
          } catch (dbErr) {
            console.error('D1 log error:', dbErr.message);
          }
        }

        break; // one trade per scan cycle
      } catch (e) {
        console.error(`❌ Error scanning ${symbol}:`, e.message);
      }
    }
  } finally {
    await releaseExecutionLock(env);
  }
}