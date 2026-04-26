// nexus/src/dashboard.js — Unified Nexus Hub Dashboard

import { getRecentTrades, getStrategyPnL, getPerformanceMetrics } from './db.js';
import { calculateAdaptiveLeverage }                               from './risk.js';

const DEFAULT_RISK = {
  MAX_DAILY_LOSS_USD:          25,
  MIN_SECONDS_BETWEEN_TRADES:  30,
  MAX_PER_TRADE_LOSS_PCT:      0.02,
  MAX_SPREAD_PCT:              5.0
};

// ── Main dashboard ────────────────────────────────────────────────────────────

export async function renderDashboard(env) {
  const [state, lastScan, trades, stratPnl, metrics] = await Promise.all([
    env.BOT_STATE.get('trading_state', 'json').then(s => s || {
      trading_enabled: true, paper_trading: false,
      daily_pnl: 0, daily_trades: 0, total_pnl: 0, total_trades: 0
    }),
    env.BOT_STATE.get('nexus_last_scan', 'json').catch(() => null),
    getRecentTrades(env, 20),
    getStrategyPnL(env),
    getPerformanceMetrics(env)
  ]);

  const initialCapital  = state.initial_capital ?? 1000;
  const equity          = initialCapital + (state.total_pnl || 0);
  const currentLeverage = calculateAdaptiveLeverage(equity, 0.05, initialCapital);
  const paperMode       = state.paper_trading !== false;
  const modeColor       = paperMode ? '#f0b90b' : '#e74c3c';
  const modeLabel       = paperMode ? '📄 PAPER' : '🔴 LIVE';
  const statusColor     = state.trading_enabled ? '#2ecc71' : '#e74c3c';
  const maxLoss         = state.max_daily_loss_usd           ?? DEFAULT_RISK.MAX_DAILY_LOSS_USD;
  const minSec          = state.min_seconds_between_trades   ?? DEFAULT_RISK.MIN_SECONDS_BETWEEN_TRADES;
  const maxPerTrade     = state.max_per_trade_loss_pct       ?? DEFAULT_RISK.MAX_PER_TRADE_LOSS_PCT;
  const lastScanTime    = lastScan?.timestamp
    ? new Date(lastScan.timestamp).toLocaleString('ar')
    : 'لم يتم المسح بعد';

  const autoStopBanner = state.auto_stopped
    ? `<div style="background:#e74c3c;color:#fff;padding:12px 20px;border-radius:8px;margin-bottom:18px;font-weight:bold">
        🛑 تم الإيقاف التلقائي: ${state.auto_stop_reason || 'تجاوز الحد المسموح به'}
       </div>`
    : '';

  // Strategy P&L
  const cexPnl    = stratPnl.cex?.pnl    ?? 0;
  const dexPnl    = stratPnl.dex?.pnl    ?? 0;
  const perpsPnl  = stratPnl.perps?.pnl  ?? 0;
  const cexTrades   = stratPnl.cex?.trades   ?? 0;
  const dexTrades   = stratPnl.dex?.trades   ?? 0;
  const perpsTrades = stratPnl.perps?.trades ?? 0;

  // Performance metrics
  const winRatePct     = ((metrics.win_rate   || 0) * 100).toFixed(1);
  const maxDrawdown    = (metrics.max_drawdown_usd || 0).toFixed(2);
  const bestTrade      = (metrics.best_trade_usd  || 0).toFixed(2);
  const worstTrade     = (metrics.worst_trade_usd || 0).toFixed(2);
  const sharpe         = (metrics.sharpe           || 0).toFixed(2);

  // Opportunity card HTML helper
  function oppCard(opp) {
    if (!opp) return `<div style="color:#888;font-size:.85em">لا توجد فرصة في آخر مسح</div>`;
    return `
      <div style="font-size:.82em;color:#aaa">${opp.symbol} | ${opp.direction}</div>
      <div style="font-size:.88em;margin-top:4px">
        صافي: <strong style="color:#2ecc71">${opp.netPct.toFixed(4)}%</strong>
        &nbsp;|&nbsp; أمان: ${(opp.safetyFactor * 100).toFixed(1)}%
      </div>
      <div style="font-size:.78em;color:#888;margin-top:2px">
        شراء: $${Number(opp.buyPrice).toFixed(2)} &nbsp;→&nbsp; بيع: $${Number(opp.sellPrice).toFixed(2)}
      </div>`;
  }

  // Cumulative P&L chart data
  let cumPnl = 0;
  const pnlData = [...trades].reverse().map(t => {
    cumPnl += (t.size_usd || 0) * (t.net_profit_percent || 0) / 100;
    return cumPnl.toFixed(2);
  });

  // Trade history table
  const tradesHtml = trades.map(t => {
    const modeCell = t.mode === 'live'
      ? '<span style="color:#e74c3c;font-weight:bold">LIVE</span>'
      : '<span style="color:#f0b90b;font-weight:bold">PAPER</span>';
    const parts    = (t.strategy || '').split(':');
    const stratType = parts[0]?.toUpperCase() || '—';
    const stratDir  = parts[1] || '';
    const pnlColor  = Number(t.net_profit_percent) >= 0 ? '#2ecc71' : '#e74c3c';
    return `<tr>
      <td>${modeCell}</td>
      <td><span style="color:#3498db;font-weight:bold">${stratType}</span></td>
      <td style="font-size:.85em">${stratDir}</td>
      <td>$${Number(t.size_usd).toFixed(2)}</td>
      <td style="color:${pnlColor}">${Number(t.net_profit_percent).toFixed(4)}%</td>
      <td style="font-size:.82em">${new Date(t.created_at).toLocaleString('ar')}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Nexus Arbitrage System — Control Center</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
  <style>
    *{box-sizing:border-box}
    body{background:#0b0e14;color:#eee;font-family:'Segoe UI',sans-serif;padding:20px;margin:0}
    h1{color:#f0b90b;font-size:1.5em;margin-bottom:4px}
    .subtitle{color:#888;font-size:.85em;margin-bottom:18px}
    h2{color:#f0b90b;font-size:1.1em;margin:18px 0 10px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:18px}
    .card{background:#1a1e26;padding:16px;border-radius:12px}
    .card-label{color:#888;font-size:.78em;margin-bottom:4px}
    .card-value{font-size:1.35em;font-weight:bold}
    .panel{background:#1a1e26;padding:20px;border-radius:12px;margin-bottom:18px}
    .strategy-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:18px}
    .strategy-card{background:#1a1e26;padding:16px;border-radius:12px;border-top:3px solid}
    .strat-header{font-weight:bold;margin-bottom:10px;display:flex;flex-wrap:wrap;align-items:center;gap:6px}
    .badge{padding:3px 7px;border-radius:5px;font-size:.72em;font-weight:bold}
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

<h1>🔷 Nexus Arbitrage System — Control Center</h1>
<div class="subtitle">منظومة موحدة: CEX + DEX + Perps &nbsp;|&nbsp; آخر مسح: ${lastScanTime}</div>

${autoStopBanner}

<div class="status-bar">
  <span>الحالة: <strong style="color:${statusColor}">${state.trading_enabled ? '▶️ مفعّل' : '⏸️ متوقف'}</strong></span>
  <span>الوضع: <strong style="color:${modeColor}">${modeLabel}</strong></span>
  <span>💎 رأس المال: <strong style="color:#2ecc71">$${equity.toFixed(2)}</strong></span>
  <span>📈 إجمالي الأرباح: <strong style="color:${(state.total_pnl||0)>=0?'#2ecc71':'#e74c3c'}">$${(state.total_pnl||0).toFixed(2)}</strong></span>
  <span>📊 ربح اليوم: <strong style="color:${(state.daily_pnl||0)>=0?'#2ecc71':'#e74c3c'}">$${(state.daily_pnl||0).toFixed(2)}</strong></span>
  <span>⚡ رافعة: <strong style="color:#f0b90b">${currentLeverage}x</strong></span>
  <span>🎯 صفقات اليوم: <strong>${state.daily_trades||0}</strong></span>
  <span>📊 الإجمالي: <strong>${state.total_trades||0}</strong></span>
</div>

<h2>🔍 آخر فرص المسح — الاستراتيجيات الثلاث</h2>
<div class="strategy-grid">

  <div class="strategy-card" style="border-color:#3498db">
    <div class="strat-header" style="color:#3498db">
      📊 CEX Arbitrage
      <span class="badge" style="background:#1a3a5c;color:#3498db">${cexTrades} صفقة</span>
      <span class="badge" style="background:#1a3a5c;color:${cexPnl>=0?'#2ecc71':'#e74c3c'}">$${cexPnl.toFixed(2)}</span>
    </div>
    ${oppCard(lastScan?.cex)}
  </div>

  <div class="strategy-card" style="border-color:#9b59b6">
    <div class="strat-header" style="color:#9b59b6">
      🌐 DEX Cross-Chain
      <span class="badge" style="background:#2d1a4a;color:#9b59b6">${dexTrades} صفقة</span>
      <span class="badge" style="background:#2d1a4a;color:${dexPnl>=0?'#2ecc71':'#e74c3c'}">$${dexPnl.toFixed(2)}</span>
    </div>
    ${oppCard(lastScan?.dex)}
  </div>

  <div class="strategy-card" style="border-color:#e67e22">
    <div class="strat-header" style="color:#e67e22">
      ⚡ Perps Arbitrage
      <span class="badge" style="background:#4a2a0a;color:#e67e22">${perpsTrades} صفقة</span>
      <span class="badge" style="background:#4a2a0a;color:${perpsPnl>=0?'#2ecc71':'#e74c3c'}">$${perpsPnl.toFixed(2)}</span>
    </div>
    ${oppCard(lastScan?.perps)}
  </div>

</div>

<div class="panel">
  <h2 style="margin-top:0">⚡ تحكم سريع</h2>
  <button class="btn btn-green" data-admin-action="1" onclick="adminAction('start')">▶️ تشغيل</button>
  <button class="btn btn-red"   data-admin-action="1" onclick="adminAction('stop')">⏸️ إيقاف</button>
  <button class="btn"           data-admin-action="1" onclick="adminAction('scan')">🔍 مسح فوري</button>
  <button class="btn btn-blue"  onclick="location.reload()">🔄 تحديث</button>
  <button class="btn"           onclick="window.open('/checklist','_blank')">✅ قائمة التشغيل</button>
</div>

<div class="panel">
  <h2 style="margin-top:0">🎛️ إعدادات التشغيل</h2>
  <div style="margin-bottom:14px">
    <strong>وضع التداول:</strong>
    <button class="btn"     data-admin-action="1" onclick="setMode('paper')">📄 Paper</button>
    <button class="btn btn-red" data-admin-action="1" onclick="setMode('live')">🔴 Live</button>
    <span style="margin-right:10px;color:${modeColor};font-weight:bold">${modeLabel}</span>
  </div>
  <div class="risk-row">
    <div class="risk-item">
      <label>أقصى خسارة يومية ($)</label>
      <input id="maxDailyLoss" type="number" value="${maxLoss}" min="1" step="1">
    </div>
    <div class="risk-item">
      <label>أقصى خسارة للصفقة (%)</label>
      <input id="maxPerTrade" type="number" value="${maxPerTrade}" min="0.001" step="0.001">
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
  <div class="card"><div class="card-label">CEX — P&amp;L</div><div class="card-value" style="color:#3498db">$${cexPnl.toFixed(2)}</div></div>
  <div class="card"><div class="card-label">DEX — P&amp;L</div><div class="card-value" style="color:#9b59b6">$${dexPnl.toFixed(2)}</div></div>
  <div class="card"><div class="card-label">Perps — P&amp;L</div><div class="card-value" style="color:#e67e22">$${perpsPnl.toFixed(2)}</div></div>
  <div class="card"><div class="card-label">إجمالي الصفقات</div><div class="card-value">${state.total_trades||0}</div></div>
</div>

<h2>📈 مقاييس الأداء</h2>
<div class="grid">
  <div class="card">
    <div class="card-label">نسبة الربح (Win Rate)</div>
    <div class="card-value" style="color:${parseFloat(winRatePct)>=50?'#2ecc71':'#e74c3c'}">${winRatePct}%</div>
    <div style="font-size:.78em;color:#888;margin-top:4px">${metrics.win_trades||0} ربح / ${metrics.loss_trades||0} خسارة</div>
  </div>
  <div class="card">
    <div class="card-label">أقصى تراجع (Max Drawdown)</div>
    <div class="card-value" style="color:#e74c3c">$${maxDrawdown}</div>
  </div>
  <div class="card">
    <div class="card-label">أفضل صفقة</div>
    <div class="card-value" style="color:#2ecc71">$${bestTrade}</div>
  </div>
  <div class="card">
    <div class="card-label">أسوأ صفقة</div>
    <div class="card-value" style="color:#e74c3c">$${worstTrade}</div>
  </div>
  <div class="card">
    <div class="card-label">Sharpe Ratio (تقريبي)</div>
    <div class="card-value" style="color:${parseFloat(sharpe)>=1?'#2ecc71':parseFloat(sharpe)>=0?'#f0b90b':'#e74c3c'}">${sharpe}</div>
  </div>
  <div class="card">
    <div class="card-label">تصدير البيانات</div>
    <div style="margin-top:8px">
      <a href="/api/export" style="color:#f0b90b;font-size:.85em;text-decoration:none">⬇️ تحميل CSV (الكل)</a><br>
      <a href="/api/report" style="color:#3498db;font-size:.85em;text-decoration:none;margin-top:4px;display:block">📊 تقرير JSON</a>
    </div>
  </div>
</div>

<div class="panel"><canvas id="pnlChart"></canvas></div>

<h2>📊 آخر الصفقات</h2>
<table>
  <tr><th>الوضع</th><th>الاستراتيجية</th><th>الاتجاه</th><th>الحجم (USD)</th><th>الربح</th><th>الوقت</th></tr>
  ${tradesHtml || '<tr><td colspan="6" style="text-align:center;padding:20px;color:#888">لا توجد صفقات مسجّلة</td></tr>'}
</table>

<script>
  const TOKEN = sessionStorage.getItem('adminToken') || (()=>{
    const t = prompt('أدخل Admin Token (اتركه فارغاً للعرض فقط)') || '';
    if(t) sessionStorage.setItem('adminToken',t);
    return t;
  })();
  function setButtonsBusy(b){ document.querySelectorAll('[data-admin-action]').forEach(btn=>btn.disabled=b); }
  async function callAdminApi(path,opts={}){
    let r;
    try{ r=await fetch(path,{...opts,headers:{...(opts.headers||{}),'x-admin-token':TOKEN}}); }
    catch(_){ throw new Error('تعذر الاتصال بالخادم'); }
    const text=await r.text();
    if(!r.ok) throw new Error(text||('HTTP '+r.status));
    return {text,r};
  }
  async function adminAction(a){
    setButtonsBusy(true);
    try{ const res=await callAdminApi('/'+a); alert(res.text||'✅ تم'); location.reload(); }
    catch(e){ alert('❌ '+e.message); }
    finally{ setButtonsBusy(false); }
  }
  async function setMode(m){
    setButtonsBusy(true);
    try{ await callAdminApi('/mode/'+m,{method:'POST'}); location.reload(); }
    catch(e){ alert('❌ '+e.message); }
    finally{ setButtonsBusy(false); }
  }
  async function saveConfig(){
    const body={
      max_daily_loss_usd:         parseFloat(document.getElementById('maxDailyLoss').value),
      max_per_trade_loss_pct:     parseFloat(document.getElementById('maxPerTrade').value),
      min_seconds_between_trades: parseFloat(document.getElementById('minSeconds').value),
      initial_capital:            parseFloat(document.getElementById('initialCapital').value)
    };
    for(const[k,v]of Object.entries(body)){
      if(isNaN(v)||v<=0){ alert('❌ قيمة غير صحيحة: '+k); return; }
    }
    setButtonsBusy(true);
    try{
      await callAdminApi('/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      alert('✅ تم حفظ الإعدادات'); location.reload();
    }catch(e){ alert('❌ '+e.message); }
    finally{ setButtonsBusy(false); }
  }
  const ctx=document.getElementById('pnlChart').getContext('2d');
  new Chart(ctx,{type:'line',data:{
    labels:[...Array(${pnlData.length})].map((_,i)=>i+1),
    datasets:[{label:'الربح المتراكم ($)',data:${JSON.stringify(pnlData)},borderColor:'#f0b90b',backgroundColor:'rgba(240,185,11,0.08)',fill:true,tension:.3}]
  },options:{responsive:true,plugins:{legend:{labels:{color:'#eee'}}},scales:{x:{ticks:{color:'#888'}},y:{ticks:{color:'#888'}}}}});
</script>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ── Go-Live Checklist ─────────────────────────────────────────────────────────

export async function renderChecklist(env) {
  const state = await env.BOT_STATE.get('trading_state', 'json') || {};
  const checks = [
    { name: 'MEXC API Key',          ok: !!env.MEXC_API_KEY,          critical: true,  note: 'مطلوب للتداول الحقيقي' },
    { name: 'MEXC API Secret',        ok: !!env.MEXC_API_SECRET,       critical: true,  note: 'مطلوب للتداول الحقيقي' },
    { name: 'ADMIN_TOKEN',            ok: !!env.ADMIN_TOKEN,            critical: true,  note: 'لحماية نقاط التحكم' },
    { name: 'Telegram Bot Token',     ok: !!env.TELEGRAM_BOT_TOKEN,    critical: false, note: 'للإشعارات' },
    { name: 'Telegram Chat ID',       ok: !!env.TELEGRAM_CHAT_ID,      critical: false, note: 'معرف المستخدم' },
    { name: 'Alchemy API Key',        ok: !!env.ALCHEMY_API_KEY,       critical: false, note: 'لتفعيل مسح DEX' },
    { name: 'وضع Live مفعّل',         ok: state.paper_trading === false, critical: true, note: 'التداول الحقيقي' },
    { name: 'حد الخسارة اليومية',     ok: !!(state.max_daily_loss_usd), critical: true, note: `الحالي: $${state.max_daily_loss_usd ?? 25}` },
    { name: 'التداول مفعّل',          ok: state.trading_enabled !== false, critical: false, note: 'يجب التشغيل قبل المسح' },
    { name: 'لا إيقاف تلقائي نشط',   ok: !state.auto_stopped,         critical: false, note: state.auto_stop_reason || '' }
  ];
  const criticalOk = checks.filter(c => c.critical).every(c => c.ok);
  const allOk      = checks.every(c => c.ok);
  const color      = allOk ? '#2ecc71' : criticalOk ? '#f0b90b' : '#e74c3c';
  const label      = allOk
    ? '✅ جاهز للتداول الحقيقي'
    : criticalOk ? '⚠️ المتطلبات الأساسية مكتملة — يُنصح بمزيد من اختبار Paper'
    : '🔴 غير جاهز — يُرجى إكمال المتطلبات الحرجة';
  const rows = checks.map(c =>
    `<tr>
      <td>${c.ok ? '✅' : c.critical ? '🔴' : '⚠️'}</td>
      <td>${c.name}</td>
      <td>${c.note}</td>
      <td>${c.critical ? '<span style="color:#e74c3c;font-weight:bold">مطلوب</span>' : '<span style="color:#888">اختياري</span>'}</td>
    </tr>`
  ).join('');

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>Nexus — Go-Live Checklist</title>
  <style>
    body{background:#0b0e14;color:#eee;font-family:'Segoe UI',sans-serif;padding:30px}
    h1{color:#f0b90b}
    .status{background:#1a1e26;padding:14px 20px;border-radius:10px;font-size:1.1em;font-weight:bold;color:${color};margin-bottom:20px}
    table{width:100%;border-collapse:collapse;background:#1a1e26;border-radius:12px;overflow:hidden}
    th{background:#2a2e38;color:#f0b90b;padding:11px;text-align:right}
    td{padding:11px;border-bottom:1px solid #2a2e38}
    a{color:#f0b90b;display:inline-block;margin-top:20px}
  </style>
</head>
<body>
  <h1>✅ قائمة التحقق قبل التشغيل — Nexus Hub</h1>
  <div class="status">${label}</div>
  <table>
    <tr><th>الحالة</th><th>البند</th><th>ملاحظة</th><th>أهمية</th></tr>
    ${rows}
  </table>
  <a href="/">← العودة للوحة التحكم</a>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
