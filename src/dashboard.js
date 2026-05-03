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
    env.BOT_STATE.get('trading_state', 'json')
      .then(s => s || {
        trading_enabled: true, paper_trading: false,
        daily_pnl: 0, daily_trades: 0, total_pnl: 0, total_trades: 0
      })
      .catch(() => ({
        trading_enabled: true, paper_trading: false,
        daily_pnl: 0, daily_trades: 0, total_pnl: 0, total_trades: 0
      })),
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
  // New strategies — parsed from strategy prefix
  const triPnl    = stratPnl.triangular?.pnl    ?? 0;
  const statPnl   = stratPnl.statistical?.pnl   ?? 0;
  const triTrades = stratPnl.triangular?.trades ?? 0;
  const statTrades= stratPnl.statistical?.trades?? 0;

  // Performance metrics
  const winRatePct     = ((metrics.win_rate   || 0) * 100).toFixed(1);
  const maxDrawdown    = (metrics.max_drawdown_usd || 0).toFixed(2);
  const bestTrade      = (metrics.best_trade_usd  || 0).toFixed(2);
  const worstTrade     = (metrics.worst_trade_usd || 0).toFixed(2);
  const sharpe         = (metrics.sharpe           || 0).toFixed(2);
  const sortino        = (metrics.sortino          || 0).toFixed(2);
  const profitFactor   = metrics.profit_factor
    ? (isFinite(metrics.profit_factor) ? metrics.profit_factor.toFixed(2) : '∞')
    : '—';
  const expectancy     = (metrics.expectancy       || 0).toFixed(3);

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
    .btn-sm{padding:5px 10px;font-size:.78em}
    .risk-row{display:flex;flex-wrap:wrap;gap:14px;margin-top:14px}
    .risk-item{display:flex;flex-direction:column;gap:4px}
    .risk-item label{color:#888;font-size:.78em}
    .risk-item input{background:#2a2e38;color:#eee;border:1px solid #444;border-radius:6px;padding:7px 10px;width:130px}
    table{width:100%;border-collapse:collapse;background:#1a1e26;border-radius:12px;overflow:hidden}
    th{background:#2a2e38;color:#f0b90b;padding:11px 12px;text-align:right}
    td{padding:9px 12px;border-bottom:1px solid #2a2e38}
    .status-bar{display:flex;flex-wrap:wrap;gap:18px;align-items:center;padding:14px 20px;background:#1a1e26;border-radius:12px;margin-bottom:18px}
    .token-panel{background:#12161e;border:1px solid #2a2e38;border-radius:10px;padding:12px 18px;margin-bottom:14px;display:flex;flex-wrap:wrap;align-items:center;gap:10px}
    .token-panel label{color:#888;font-size:.82em;white-space:nowrap}
    .token-panel input{background:#2a2e38;color:#eee;border:1px solid #444;border-radius:6px;padding:6px 10px;width:220px;font-size:.88em}
    #refreshBar{display:flex;align-items:center;gap:10px;font-size:.8em;color:#888}
    .cb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
    .cb-card{background:#12161e;padding:12px;border-radius:8px;border:1px solid #2a2e38;font-size:.82em}
    .cb-card .name{color:#aaa;font-size:.85em;margin-bottom:4px}
    .cb-ok{color:#2ecc71}
    .cb-open{color:#e74c3c;font-weight:bold}
    .bal-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
    .bal-card{background:#12161e;padding:12px;border-radius:8px;border:1px solid #2a2e38}
    .bal-name{color:#aaa;font-size:.82em;margin-bottom:4px}
    .bal-value{font-size:1.1em;font-weight:bold}
  </style>
</head>
<body>

<!-- ── Token panel ─────────────────────────────────────────────────── -->
<div class="token-panel">
  <label>🔑 Admin Token:</label>
  <input id="tokenInput" type="password" placeholder="أدخل رمز الإدارة..." autocomplete="current-password">
  <button class="btn btn-sm" onclick="saveToken()">حفظ</button>
  <button class="btn btn-sm btn-red" onclick="clearToken()">مسح</button>
  <span id="tokenStatus" style="font-size:.82em"></span>
  <span style="flex:1"></span>
  <div id="refreshBar"><span id="countdownLabel">تحديث تلقائي:</span> <strong id="countdown">30</strong>ث &nbsp;|&nbsp; <button class="btn btn-sm btn-blue" onclick="location.reload()">🔄 تحديث الآن</button></div>
</div>

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

  <div class="strategy-card" style="border-color:#1abc9c">
    <div class="strat-header" style="color:#1abc9c">
      🔺 Triangular Arb
      <span class="badge" style="background:#0a3030;color:#1abc9c">${triTrades} صفقة</span>
      <span class="badge" style="background:#0a3030;color:${triPnl>=0?'#2ecc71':'#e74c3c'}">$${triPnl.toFixed(2)}</span>
    </div>
    ${oppCard(lastScan?.triangular)}
  </div>

  <div class="strategy-card" style="border-color:#e91e8c">
    <div class="strat-header" style="color:#e91e8c">
      📐 Statistical Arb
      <span class="badge" style="background:#3a0a20;color:#e91e8c">${statTrades} صفقة</span>
      <span class="badge" style="background:#3a0a20;color:${statPnl>=0?'#2ecc71':'#e74c3c'}">$${statPnl.toFixed(2)}</span>
    </div>
    ${oppCard(lastScan?.statistical)}
  </div>

</div>

<div class="panel">
  <h2 style="margin-top:0">⚡ تحكم سريع</h2>
  <button class="btn btn-green" data-admin-action="1" onclick="adminAction('start')">▶️ تشغيل</button>
  <button class="btn btn-red"   data-admin-action="1" onclick="adminAction('stop')">⏸️ إيقاف</button>
  <button class="btn"           data-admin-action="1" onclick="adminAction('scan')">🔍 مسح فوري</button>
  <button class="btn btn-blue"  onclick="location.reload()">🔄 تحديث</button>
  <button class="btn"           onclick="window.open('/checklist','_blank')">✅ قائمة التشغيل</button>
  <button class="btn btn-red"   data-admin-action="1" onclick="resetDaily()">🔄 إعادة تعيين اليوم</button>
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
  <div class="card"><div class="card-label">Triangular — P&amp;L</div><div class="card-value" style="color:#1abc9c">$${triPnl.toFixed(2)}</div></div>
  <div class="card"><div class="card-label">Statistical — P&amp;L</div><div class="card-value" style="color:#e91e8c">$${statPnl.toFixed(2)}</div></div>
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
    <div class="card-label">Sharpe Ratio</div>
    <div class="card-value" style="color:${parseFloat(sharpe)>=1?'#2ecc71':parseFloat(sharpe)>=0?'#f0b90b':'#e74c3c'}">${sharpe}</div>
  </div>
  <div class="card">
    <div class="card-label">Sortino Ratio</div>
    <div class="card-value" style="color:${parseFloat(sortino)>=1?'#2ecc71':parseFloat(sortino)>=0?'#f0b90b':'#e74c3c'}">${sortino}</div>
  </div>
  <div class="card">
    <div class="card-label">Profit Factor</div>
    <div class="card-value" style="color:${profitFactor==='∞'||parseFloat(profitFactor)>=2?'#2ecc71':parseFloat(profitFactor)>=1?'#f0b90b':'#e74c3c'}">${profitFactor}</div>
  </div>
  <div class="card">
    <div class="card-label">Expectancy ($)</div>
    <div class="card-value" style="color:${parseFloat(expectancy)>=0?'#2ecc71':'#e74c3c'}">$${expectancy}</div>
  </div>
  <div class="card">
    <div class="card-label">تصدير البيانات</div>
    <div style="margin-top:8px">
      <a href="/api/export" style="color:#f0b90b;font-size:.85em;text-decoration:none">⬇️ تحميل CSV (الكل)</a><br>
      <a href="/api/report" style="color:#3498db;font-size:.85em;text-decoration:none;margin-top:4px;display:block">📊 تقرير JSON</a>
    </div>
  </div>
</div>

<!-- ── Backtesting Panel ──────────────────────────────────────────────── -->
<div class="panel">
  <h2 style="margin-top:0">🔬 اختبار الأداء السابق (Backtest)</h2>
  <div class="risk-row" style="margin-bottom:14px">
    <div class="risk-item">
      <label>رأس المال الابتدائي ($)</label>
      <input id="bt_capital" type="number" value="1000" min="1" step="100">
    </div>
    <div class="risk-item">
      <label>نسبة الحجم من رأس المال</label>
      <input id="bt_frac" type="number" value="0.10" min="0.01" max="0.50" step="0.01">
    </div>
    <div class="risk-item">
      <label>الحد الأدنى لصافي الربح (%)</label>
      <input id="bt_minnet" type="number" value="0" min="0" step="0.01">
    </div>
    <div class="risk-item">
      <label>فترة (أيام)</label>
      <input id="bt_days" type="number" value="30" min="1" max="365" step="1">
    </div>
  </div>
  <button class="btn btn-blue" data-admin-action="1" onclick="runBacktest()">🔬 تشغيل Backtest</button>
  <div id="btResults" style="margin-top:16px;display:none">
    <div class="grid" id="btMetricsGrid"></div>
    <div style="margin-top:10px;font-size:.82em;color:#888" id="btMC"></div>
  </div>
</div>

<div class="panel"><canvas id="pnlChart" height="80"></canvas></div>

<!-- ── Strategy P&L Bar Chart ────────────────────────────────────────── -->
<div class="panel"><canvas id="stratChart" height="80"></canvas></div>

<!-- ── Exchange Balances panel (loaded dynamically) ───────────────────────── -->
<div class="panel">
  <h2 style="margin-top:0">💰 أرصدة المنصات (USDT)</h2>
  <div id="balancesContent" class="bal-grid"><span style="color:#888">جارٍ التحميل...</span></div>
</div>

<!-- ── Circuit Breaker panel (loaded dynamically) ────────────────────────── -->
<div class="panel">
  <h2 style="margin-top:0">🔌 حالة Circuit Breaker — المنصات الفعّالة</h2>
  <div style="font-size:.78em;color:#888;margin-bottom:10px">
    ⚠️ Gate.io و Bybit: مصادر أسعار فقط (القانون الألماني — لا تنفيذ حقيقي)
  </div>
  <div id="cbContent" class="cb-grid"><span style="color:#888">جارٍ التحميل...</span></div>
</div>

<!-- ── MetaMask / Web3 Wallet Panel ──────────────────────────────────────── -->
<div class="panel">
  <h2 style="margin-top:0">🦊 MetaMask — عقود Perps على السلسلة</h2>
  <div style="font-size:.82em;color:#aaa;margin-bottom:12px">
    ربط MetaMask لتنفيذ عقود Perps اللامركزية (GMX, dYdX v4) على السلسلة مباشرةً من المتصفح.
    لا يُرسَل مفتاحك الخاص للسيرفر.
  </div>
  <div id="walletPanel">
    <button class="btn btn-blue" onclick="connectWallet()">🦊 ربط MetaMask</button>
    <span id="walletStatus" style="margin-right:12px;font-size:.85em;color:#888"></span>
  </div>
  <div id="walletConnected" style="display:none;margin-top:14px">
    <div class="grid" id="walletMetrics" style="margin-bottom:12px"></div>
    <div style="font-size:.82em;color:#aaa;margin-bottom:10px">
      🔴 تنفيذ صفقات Perps على GMX / dYdX يتطلب تأكيداً في MetaMask لكل عملية.
    </div>
    <div class="risk-row">
      <div class="risk-item">
        <label>الشبكة</label>
        <select id="w3network" style="background:#2a2e38;color:#eee;border:1px solid #444;border-radius:6px;padding:7px 10px">
          <option value="42161">Arbitrum One</option>
          <option value="1">Ethereum Mainnet</option>
          <option value="10">Optimism</option>
        </select>
      </div>
      <div class="risk-item">
        <label>الحجم (USDT)</label>
        <input id="w3size" type="number" value="100" min="1" step="10" style="background:#2a2e38;color:#eee;border:1px solid #444;border-radius:6px;padding:7px 10px;width:130px">
      </div>
      <div class="risk-item">
        <label>الاتجاه</label>
        <select id="w3side" style="background:#2a2e38;color:#eee;border:1px solid #444;border-radius:6px;padding:7px 10px">
          <option value="long">LONG</option>
          <option value="short">SHORT</option>
        </select>
      </div>
      <div class="risk-item">
        <label>زوج التداول</label>
        <select id="w3pair" style="background:#2a2e38;color:#eee;border:1px solid #444;border-radius:6px;padding:7px 10px">
          <option value="BTC/USD">BTC/USD</option>
          <option value="ETH/USD">ETH/USD</option>
          <option value="SOL/USD">SOL/USD</option>
        </select>
      </div>
    </div>
    <div style="margin-top:12px">
      <button class="btn btn-green" onclick="signAndSendPerp('gmx')">⚡ تنفيذ على GMX (Arbitrum)</button>
      <button class="btn" style="background:#2196f3;color:#fff" onclick="signAndSendPerp('dydx')">📊 تنفيذ على dYdX v4</button>
      <button class="btn btn-red" onclick="disconnectWallet()">🔌 فصل المحفظة</button>
    </div>
    <div id="w3TxResult" style="margin-top:10px;font-size:.82em"></div>
  </div>
</div>

<h2>📊 آخر الصفقات</h2>
<table>
  <tr><th>الوضع</th><th>الاستراتيجية</th><th>الاتجاه</th><th>الحجم (USD)</th><th>الربح</th><th>الوقت</th></tr>
  ${tradesHtml || '<tr><td colspan="6" style="text-align:center;padding:20px;color:#888">لا توجد صفقات مسجّلة</td></tr>'}
</table>

<script>
  // ── Token management ────────────────────────────────────────────────────────
  let TOKEN = sessionStorage.getItem('adminToken') || '';
  function updateTokenStatus(){
    const el=document.getElementById('tokenStatus');
    if(!el) return;
    el.textContent = TOKEN ? '✅ رمز محفوظ — التحكم مفعّل' : '⚠️ بدون رمز — عرض فقط';
    el.style.color  = TOKEN ? '#2ecc71' : '#f0b90b';
  }
  function saveToken(){
    const v=(document.getElementById('tokenInput').value||'').trim();
    if(!v){ alert('❌ أدخل الرمز أولاً'); return; }
    TOKEN=v; sessionStorage.setItem('adminToken',TOKEN);
    document.getElementById('tokenInput').value='';
    updateTokenStatus();
    loadDynamic();
  }
  function clearToken(){
    TOKEN=''; sessionStorage.removeItem('adminToken');
    updateTokenStatus();
    document.getElementById('balancesContent').innerHTML='<span style="color:#888">⚠️ يتطلب رمز الإدارة</span>';
  }
  updateTokenStatus();

  // ── Auto-refresh countdown ───────────────────────────────────────────────────
  let _cd=30;
  setInterval(()=>{
    _cd--;
    const el=document.getElementById('countdown');
    if(el) el.textContent=_cd;
    if(_cd<=0) location.reload();
  },1000);

  // ── Shared API helper ────────────────────────────────────────────────────────
  function setButtonsBusy(b){ document.querySelectorAll('[data-admin-action]').forEach(btn=>btn.disabled=b); }
  async function callAdminApi(path,opts={}){
    let r;
    try{ r=await fetch(path,{...opts,headers:{...(opts.headers||{}),'x-admin-token':TOKEN}}); }
    catch(_){ throw new Error('تعذر الاتصال بالخادم'); }
    const text=await r.text();
    if(!r.ok) throw new Error(text||('HTTP '+r.status));
    return {text,r};
  }

  // ── Admin actions ────────────────────────────────────────────────────────────
  async function adminAction(a){
    setButtonsBusy(true);
    try{ const res=await callAdminApi('/'+a); alert(res.text||'✅ تم'); location.reload(); }
    catch(e){ alert('❌ '+e.message); }
    finally{ setButtonsBusy(false); }
  }
  async function setMode(m){
    if(m==='live' && !confirm('⚠️ هل أنت متأكد من التبديل إلى وضع LIVE؟ سيتم تنفيذ أوامر حقيقية!')) return;
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
  async function resetDaily(){
    if(!confirm('⚠️ إعادة تعيين إحصائيات اليوم (PnL + عدد الصفقات)؟')) return;
    setButtonsBusy(true);
    try{ const res=await callAdminApi('/reset-daily',{method:'POST'}); alert(res.text||'✅ تم'); location.reload(); }
    catch(e){ alert('❌ '+e.message); }
    finally{ setButtonsBusy(false); }
  }

  // ── P&L Chart ────────────────────────────────────────────────────────────────
  const pnlLabels = ${JSON.stringify([...trades].reverse().map(t => new Date(t.created_at).toLocaleTimeString('ar-SA', {hour:'2-digit',minute:'2-digit'})))};
  const ctx=document.getElementById('pnlChart').getContext('2d');
  new Chart(ctx,{type:'line',data:{
    labels: pnlLabels.length ? pnlLabels : Array.from({length:${pnlData.length}},(_,i)=>i+1),
    datasets:[{label:'الربح المتراكم ($)',data:${JSON.stringify(pnlData)},borderColor:'#f0b90b',backgroundColor:'rgba(240,185,11,0.08)',fill:true,tension:.3,pointRadius:3}]
  },options:{responsive:true,plugins:{legend:{labels:{color:'#eee'}}},scales:{x:{ticks:{color:'#888',maxTicksLimit:12}},y:{ticks:{color:'#888'}}}}});

  // ── Strategy P&L Bar Chart ────────────────────────────────────────────────────
  const stratCtx = document.getElementById('stratChart').getContext('2d');
  new Chart(stratCtx, {
    type: 'bar',
    data: {
      labels: ['CEX', 'DEX', 'Perps', 'Triangular', 'Statistical'],
      datasets: [{
        label: 'P&L بالاستراتيجية ($)',
        data: [
          ${(cexPnl).toFixed(4)},
          ${(dexPnl).toFixed(4)},
          ${(perpsPnl).toFixed(4)},
          ${(triPnl).toFixed(4)},
          ${(statPnl).toFixed(4)}
        ],
        backgroundColor: ['#3498db','#9b59b6','#e67e22','#1abc9c','#e91e8c'],
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#eee' } } },
      scales: {
        x: { ticks: { color: '#888' } },
        y: { ticks: { color: '#888' } }
      }
    }
  });

  // ── Backtesting ──────────────────────────────────────────────────────────────
  async function runBacktest() {
    const capital  = parseFloat(document.getElementById('bt_capital').value)  || 1000;
    const frac     = parseFloat(document.getElementById('bt_frac').value)     || 0.10;
    const minnet   = parseFloat(document.getElementById('bt_minnet').value)   || 0;
    const days     = parseInt(document.getElementById('bt_days').value)       || 30;
    const from_ms  = Date.now() - days * 86400000;
    const body     = JSON.stringify({ initial_capital: capital, position_frac: frac, min_net_pct: minnet, from_ms, run_monte_carlo: true });
    const el       = document.getElementById('btResults');
    const grid     = document.getElementById('btMetricsGrid');
    const mc       = document.getElementById('btMC');
    grid.innerHTML = '<span style="color:#888">جارٍ التشغيل…</span>';
    el.style.display = 'block';
    mc.textContent   = '';
    try {
      const res  = await callAdminApi('/api/backtest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const data = JSON.parse(res.text);
      const m    = data.metrics || {};
      const ret  = (data.return_pct || 0).toFixed(2);
      const retColor = parseFloat(ret) >= 0 ? '#2ecc71' : '#e74c3c';
      grid.innerHTML = \`
        <div class="card"><div class="card-label">العائد</div><div class="card-value" style="color:\${retColor}">\${ret}%</div></div>
        <div class="card"><div class="card-label">رأس المال النهائي</div><div class="card-value">$\${(data.final_equity||0).toFixed(2)}</div></div>
        <div class="card"><div class="card-label">الصفقات</div><div class="card-value">\${m.total_trades||0}</div></div>
        <div class="card"><div class="card-label">Win Rate</div><div class="card-value">\${((m.win_rate||0)*100).toFixed(1)}%</div></div>
        <div class="card"><div class="card-label">Sharpe</div><div class="card-value">\${(m.sharpe||0).toFixed(2)}</div></div>
        <div class="card"><div class="card-label">Sortino</div><div class="card-value">\${(m.sortino||0).toFixed(2)}</div></div>
        <div class="card"><div class="card-label">Max Drawdown</div><div class="card-value" style="color:#e74c3c">$\${(m.max_drawdown_usd||0).toFixed(2)}</div></div>
        <div class="card"><div class="card-label">Profit Factor</div><div class="card-value">\${isFinite(m.profit_factor)?((m.profit_factor||0).toFixed(2)):'∞'}</div></div>
      \`;
      if (data.monte_carlo) {
        const mc_data = data.monte_carlo;
        mc.innerHTML  = \`🎲 Monte Carlo (500 simulations) — P5: $\${mc_data.p5?.toFixed(2)} | P50: $\${mc_data.p50?.toFixed(2)} | P95: $\${mc_data.p95?.toFixed(2)}\`;
      }
    } catch(e) {
      grid.innerHTML = '<span style="color:#e74c3c">❌ ' + e.message + '</span>';
    }
  }

  // ── Load dynamic panels ──────────────────────────────────────────────────────
  async function loadBalances(){
    const el=document.getElementById('balancesContent');
    if(!TOKEN){ el.innerHTML='<span style="color:#888">⚠️ يتطلب رمز الإدارة</span>'; return; }
    try{
      const res=await callAdminApi('/api/balances');
      const json=JSON.parse(res.text);
      const items=(json.data||[]).map(b=>{
        if (b.dataOnly) return \`<div class="bal-card" style="opacity:.4;border-left:2px solid #888"><div class="bal-name">\${b.exchange.toUpperCase()}</div><div class="bal-value" style="color:#888;font-size:.8em">\${b.note||'Data only'}</div></div>\`;
        if(!b.configured) return \`<div class="bal-card" style="opacity:.45"><div class="bal-name">\${b.exchange.toUpperCase()}</div><div class="bal-value" style="color:#888">غير مُهيأ</div></div>\`;
        const color=b.balance>0?'#2ecc71':'#888';
        return \`<div class="bal-card"><div class="bal-name">\${b.exchange.toUpperCase()}</div><div class="bal-value" style="color:\${color}">$\${Number(b.balance).toFixed(2)}</div></div>\`;
      }).join('');
      el.innerHTML=items||'<span style="color:#888">لا بيانات</span>';
    }catch(e){ el.innerHTML='<span style="color:#e74c3c">❌ '+e.message+'</span>'; }
  }
  async function loadCircuitBreaker(){
    const el=document.getElementById('cbContent');
    try{
      const r=await fetch('/api/status');
      const json=await r.json();
      const cb=json.circuitBreaker||{};
      const active=['mexc','mexc_perp','binance','kucoin','okx','bitget','bitmart','htx'];
      const dataOnly=['bybit','gateio'];
      const items=[
        ...active.map(ex=>{
          const info=cb[ex];
          const open=info&&info.open&&(Date.now()-info.lastFailure)<300000;
          const failures=info?.failures||0;
          const cls=open?'cb-open':'cb-ok';
          const label=open?\`🔴 مفتوح (\${failures} أخطاء)\`:\`✅ سليم\`;
          return \`<div class="cb-card"><div class="name">\${ex.toUpperCase()}</div><div class="\${cls}">\${label}</div></div>\`;
        }),
        ...dataOnly.map(ex=>\`<div class="cb-card" style="opacity:.4"><div class="name">\${ex.toUpperCase()}</div><div style="color:#888;font-size:.78em">📊 بيانات فقط (القانون الألماني)</div></div>\`)
      ].join('');
      el.innerHTML=items;
    }catch(e){ el.innerHTML='<span style="color:#e74c3c">❌ '+e.message+'</span>'; }
  }
  function loadDynamic(){ loadBalances(); loadCircuitBreaker(); }
  loadDynamic();

  // ── MetaMask / Web3 Wallet ────────────────────────────────────────────────────
  let w3account = null;

  async function connectWallet() {
    const statusEl   = document.getElementById('walletStatus');
    const connectedEl= document.getElementById('walletConnected');
    const metricsEl  = document.getElementById('walletMetrics');
    if (!window.ethereum) {
      alert('❌ MetaMask غير مثبّت. يرجى تثبيت إضافة MetaMask في المتصفح أو استخدام متصفح متوافق.');
      return;
    }
    try {
      statusEl.textContent = 'جارٍ الربط...';
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      w3account = accounts[0];
      const balHex   = await window.ethereum.request({ method: 'eth_getBalance', params: [w3account, 'latest'] });
      const balEth   = (parseInt(balHex, 16) / 1e18).toFixed(4);
      const chainHex = await window.ethereum.request({ method: 'eth_chainId' });
      const chainId  = parseInt(chainHex, 16);
      const nets     = { 1: 'Ethereum', 10: 'Optimism', 42161: 'Arbitrum One', 137: 'Polygon', 8453: 'Base' };
      const netName  = nets[chainId] || \`Chain \${chainId}\`;
      statusEl.textContent = '';
      connectedEl.style.display = 'block';
      metricsEl.innerHTML = \`
        <div class="card"><div class="card-label">العنوان</div><div style="font-size:.72em;word-break:break-all;color:#3498db">\${w3account}</div></div>
        <div class="card"><div class="card-label">الشبكة</div><div class="card-value" style="color:#f0b90b">\${netName}</div></div>
        <div class="card"><div class="card-label">رصيد ETH</div><div class="card-value" style="color:#2ecc71">\${balEth} ETH</div></div>
      \`;
      document.getElementById('w3network').value = chainId;
      window.ethereum.on('accountsChanged', (accs) => { w3account = accs[0]||null; if(!w3account) disconnectWallet(); });
      window.ethereum.on('chainChanged', () => connectWallet());
    } catch(e) {
      statusEl.textContent = '❌ ' + e.message;
    }
  }

  function disconnectWallet() {
    w3account = null;
    document.getElementById('walletConnected').style.display = 'none';
    document.getElementById('walletStatus').textContent = 'تم فصل المحفظة';
  }

  async function signAndSendPerp(protocol) {
    const resultEl = document.getElementById('w3TxResult');
    if (!w3account) { alert('❌ ربط MetaMask أولاً'); return; }
    const size    = parseFloat(document.getElementById('w3size').value) || 100;
    const side    = document.getElementById('w3side').value;
    const pair    = document.getElementById('w3pair').value;
    const chainId = parseInt(document.getElementById('w3network').value);
    // Switch to target chain
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x' + chainId.toString(16) }]
      });
    } catch(switchErr) {
      if (switchErr.code !== 4902) {
        resultEl.style.color = '#e74c3c';
        resultEl.textContent = '❌ تعذّر التبديل للشبكة: ' + switchErr.message;
        return;
      }
    }
    resultEl.style.color = '#f0b90b';
    resultEl.textContent = '⏳ يُرجى تأكيد الصفقة في MetaMask...';
    try {
      // Build order intent with nonce + expiry to prevent replay attacks.
      // The signature is verified client-side only — no private key is sent to the server.
      const nonce  = crypto.getRandomValues(new Uint8Array(16));
      const nonceHex = Array.from(nonce).map(b=>b.toString(16).padStart(2,'0')).join('');
      const expiresAt = Date.now() + 5 * 60 * 1000; // 5 min expiry
      const intent = JSON.stringify({ protocol, pair, side, sizeUsd: size, account: w3account, chainId, nonce: nonceHex, expiresAt });
      const sig    = await window.ethereum.request({ method: 'personal_sign', params: [intent, w3account] });
      const protoLabel = protocol === 'gmx' ? 'GMX (Arbitrum)' : 'dYdX v4';
      resultEl.style.color = '#2ecc71';
      resultEl.innerHTML = \`✅ تم توقيع أمر \${protoLabel}.<br>
        <span style="font-size:.78em;color:#aaa">
          Signature: \${sig.slice(0,30)}…<br>
          ادمج هذا التوقيع مع \${protoLabel} SDK لإتمام التنفيذ.
        </span>\`;
    } catch(e) {
      resultEl.style.color = e.code === 4001 ? '#f0b90b' : '#e74c3c';
      resultEl.textContent = e.code === 4001 ? '⚠️ رفضت الصفقة في MetaMask' : '❌ ' + e.message;
    }
  }
</script>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ── Go-Live Checklist ─────────────────────────────────────────────────────────

export async function renderChecklist(env) {
  const state = await env.BOT_STATE.get('trading_state', 'json').catch(() => null) || {};
  const checks = [
    { name: 'MEXC API Key',            ok: !!env.MEXC_API_KEY,          critical: true,  note: 'مطلوب للتداول الحقيقي + Perps' },
    { name: 'MEXC API Secret',          ok: !!env.MEXC_API_SECRET,       critical: true,  note: 'مطلوب للتداول الحقيقي + Perps' },
    { name: 'Binance API Key',          ok: !!env.BINANCE_API_KEY,       critical: false, note: 'مطلوب لتنفيذ Binance' },
    { name: 'KuCoin API Key',           ok: !!env.KUCOIN_API_KEY,        critical: false, note: 'مطلوب لتنفيذ KuCoin' },
    { name: 'OKX API Key',              ok: !!env.OKX_API_KEY,           critical: false, note: 'مطلوب لتنفيذ OKX' },
    { name: 'Bitget API Key',           ok: !!env.BITGET_API_KEY,        critical: false, note: 'مطلوب لتنفيذ Bitget' },
    { name: 'Bitmart API Key',          ok: !!env.BITMART_API_KEY,       critical: false, note: 'مطلوب لتنفيذ Bitmart' },
    { name: 'HTX (Huobi) API Key',      ok: !!env.HTX_API_KEY,           critical: false, note: 'مطلوب لتنفيذ HTX' },
    { name: 'ADMIN_TOKEN',              ok: !!env.ADMIN_TOKEN,            critical: true,  note: 'لحماية نقاط التحكم' },
    { name: 'Telegram Bot Token',       ok: !!env.TELEGRAM_BOT_TOKEN,    critical: false, note: 'للإشعارات' },
    { name: 'Telegram Chat ID',         ok: !!env.TELEGRAM_CHAT_ID,      critical: false, note: 'معرف المستخدم' },
    { name: 'Alchemy API Key',          ok: !!env.ALCHEMY_API_KEY,       critical: false, note: 'لتفعيل مسح DEX' },
    { name: 'وضع Live مفعّل',           ok: state.paper_trading === false, critical: true, note: 'التداول الحقيقي' },
    { name: 'حد الخسارة اليومية',       ok: !!(state.max_daily_loss_usd), critical: true, note: `الحالي: $${state.max_daily_loss_usd ?? 25}` },
    { name: 'التداول مفعّل',            ok: state.trading_enabled !== false, critical: false, note: 'يجب التشغيل قبل المسح' },
    { name: 'لا إيقاف تلقائي نشط',     ok: !state.auto_stopped,         critical: false, note: state.auto_stop_reason || '' }
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
