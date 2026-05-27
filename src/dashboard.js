// nexus/src/dashboard.js — Unified Nexus Hub Dashboard

import { getRecentTrades, getStrategyPnL, getPerformanceMetrics } from './db.js';
import { calculateAdaptiveLeverage }                               from './risk.js';

const DEFAULT_RISK = {
  MAX_DAILY_LOSS_USD:          25,
  DAILY_LIMIT_USD:             500,
  MIN_SECONDS_BETWEEN_TRADES:  30,
  MAX_PER_TRADE_LOSS_PCT:      0.02,
  MAX_SPREAD_PCT:              5.0
};

function parseDateSafe(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const normalized = raw.includes(' ') && !raw.includes('T') ? raw.replace(' ', 'T') : raw;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateTimeAr(value) {
  const d = parseDateSafe(value);
  return d ? d.toLocaleString('ar') : '—';
}

function formatTimeAr(value) {
  const d = parseDateSafe(value);
  return d ? d.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }) : '—';
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export async function renderDashboard(env) {
  const [state, lastScan, trades, stratPnl, metrics] = await Promise.all([
    env.BOT_STATE.get('trading_state', 'json')
      .then(s => s || {
        trading_enabled: false, paper_trading: false,
        daily_pnl: 0, daily_trades: 0, total_pnl: 0, total_trades: 0
      })
      .catch(() => ({
        trading_enabled: false, paper_trading: false,
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
  const dailyLimit      = state.daily_limit_usd             ?? DEFAULT_RISK.DAILY_LIMIT_USD;
  const minSec          = state.min_seconds_between_trades   ?? DEFAULT_RISK.MIN_SECONDS_BETWEEN_TRADES;
  const maxPerTrade     = state.max_per_trade_loss_pct       ?? DEFAULT_RISK.MAX_PER_TRADE_LOSS_PCT;
  const positionSizeUsd = state.position_size_usd            ?? 5;
  const scanSymbolMode = String(state.scan_symbol_mode || 'cex_union');
  const maxDynamicSymbols = Math.max(15, Math.min(2000, Number(state.max_dynamic_symbols || 500)));
  const maxMetaMaskSymbols = Math.max(100, Math.min(20000, Number(state.max_metamask_symbols || 10000)));
  const scanQuoteAssets = Array.isArray(state.scan_quote_assets) && state.scan_quote_assets.length
    ? state.scan_quote_assets.join(',')
    : 'USDT,USDC,FDUSD,BUSD,DAI,TUSD,BTC,ETH';
  const useDynamicSymbols = !Array.isArray(state.supported_symbols) || state.supported_symbols.length === 0;
  const multiStrategyLive = state.multi_strategy_live !== false;
  const maxLiveTradesPerScan = Math.max(1, Math.min(5, Math.floor(state.max_live_trades_per_scan ?? 3)));
  const strategyFlags   = {
    cex: state?.strategy_flags?.cex !== false,
    dex: state?.strategy_flags?.dex !== false,
    perps: state?.strategy_flags?.perps !== false,
    funding: state?.strategy_flags?.funding !== false,
    triangular: state?.strategy_flags?.triangular !== false,
    statistical: state?.strategy_flags?.statistical !== false,
  };
  const lastScanTime    = lastScan?.timestamp
    ? formatDateTimeAr(lastScan.timestamp)
    : 'لم يتم المسح بعد';
  const tvBaseSymbol = String(lastScan?.cex?.symbol || lastScan?.perps?.symbol || 'BTCUSDT')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const tvSymbol = `BINANCE:${tvBaseSymbol}`;

  const autoStopBanner = state.auto_stopped
    ? `<div style="background:#e74c3c;color:#fff;padding:12px 20px;border-radius:8px;margin-bottom:18px;font-weight:bold">
        🛑 تم الإيقاف التلقائي: ${state.auto_stop_reason || 'تجاوز الحد المسموح به'}
       </div>`
    : '';

  const adminTokenBanner = !env.ADMIN_TOKEN
    ? `<div style="background:#e67e22;color:#fff;padding:12px 20px;border-radius:8px;margin-bottom:18px;font-weight:bold;line-height:1.8">
        ⚠️ ADMIN_TOKEN غير مُهيَّأ — النظام يعمل الآن في <strong>وضع مفتوح</strong> لتسهيل الإعداد.
        فعّل الحماية لاحقاً عبر: <code style="background:rgba(0,0,0,.25);padding:2px 6px;border-radius:4px">wrangler secret put ADMIN_TOKEN</code>
        ثم أعد النشر.
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

  // HTML attribute escaper — prevents XSS in server-interpolated input value="…"
  const esc = (v) => String(v ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  function formatMoneyAdaptive(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    const abs = Math.abs(n);
    if (abs >= 1) return n.toFixed(2);
    if (abs >= 0.01) return n.toFixed(4);
    if (abs >= 0.0001) return n.toFixed(6);
    return n.toFixed(8);
  }

  // Opportunity card HTML helper
  function oppCard(opp) {
    if (!opp) return `<div style="color:#888;font-size:.85em">لا توجد فرصة في آخر مسح</div>`;
    const netPct = Number(opp.netPct);
    const safetyFactor = Number(opp.safetyFactor);
    const buyPrice = opp.buyPrice ?? opp.buy_price ?? opp.entryPrice;
    const sellPrice = opp.sellPrice ?? opp.sell_price ?? opp.exitPrice;
    const netPctLabel = Number.isFinite(netPct) ? netPct.toFixed(4) : '0.0000';
    const safetyLabel = Number.isFinite(safetyFactor) ? (safetyFactor * 100).toFixed(1) : '0.0';
    return `
      <div style="font-size:.82em;color:#aaa">${opp.symbol || '—'} | ${opp.direction || '—'}</div>
      <div style="font-size:.88em;margin-top:4px">
        صافي: <strong style="color:#2ecc71">${netPctLabel}%</strong>
        &nbsp;|&nbsp; أمان: ${safetyLabel}%
      </div>
      <div style="font-size:.78em;color:#888;margin-top:2px">
        شراء: $${formatMoneyAdaptive(buyPrice)} &nbsp;→&nbsp; بيع: $${formatMoneyAdaptive(sellPrice)}
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
      <td style="font-size:.82em">${formatDateTimeAr(t.created_at)}</td>
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
    .grid-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
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

<!-- ── Top bar ─────────────────────────────────────────────────────── -->
<div class="token-panel">
  <span style="flex:1"></span>
  <div id="refreshBar"><span id="countdownLabel">تحديث تلقائي:</span> <strong id="countdown">30</strong>ث &nbsp;|&nbsp; <button class="btn btn-sm btn-blue" onclick="triggerRefresh(true)">🔄 تحديث الآن</button></div>
  <a class="btn btn-sm btn-red" href="/logout" style="text-decoration:none;margin-right:6px">🔓 خروج</a>
</div>

<h1>🔷 Nexus Arbitrage System — Control Center</h1>
<div class="subtitle">منظومة موحدة: CEX + DEX + Perps &nbsp;|&nbsp; آخر مسح: ${lastScanTime}</div>

${adminTokenBanner}
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
  <button class="btn btn-blue"  onclick="triggerRefresh(true)">🔄 تحديث</button>
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
      <label>حد الحجم اليومي ($)</label>
      <input id="dailyLimitUsd" type="number" value="${dailyLimit}" min="1" step="1" title="إجمالي الحجم المسموح تداوله يومياً">
      <span style="font-size:.72em;color:#888">يُستخدم كفرامل أمان قبل التنفيذ الحي</span>
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
    <div class="risk-item">
      <label>حجم المركز الافتراضي ($)</label>
      <input id="positionSizeUsd" type="number" value="${positionSizeUsd}" min="1" max="500" step="1" title="الحد الأدنى 1 USDT — الحد الأقصى 500 USDT">
      <span style="font-size:.72em;color:#888">ابتدئ بـ 5 USDT لاختبار آمن</span>
    </div>
    <div class="risk-item">
      <label>تعدد الاستراتيجيات (LIVE)</label>
      <label style="color:#eee;font-size:.85em;display:flex;align-items:center;gap:6px">
        <input id="multiStrategyLive" type="checkbox" ${multiStrategyLive ? 'checked' : ''}>
        تنفيذ أكثر من استراتيجية في نفس دورة المسح
      </label>
    </div>
    <div class="risk-item">
      <label>أقصى صفقات لكل دورة LIVE</label>
      <input id="maxLiveTradesPerScan" type="number" value="${maxLiveTradesPerScan}" min="1" max="5" step="1">
    </div>
    <div class="risk-item">
      <label>وضع اختيار الرموز</label>
      <select id="scanSymbolMode" style="background:#2a2e38;color:#eee;border:1px solid #444;border-radius:6px;padding:7px 10px">
        <option value="cex_union" ${scanSymbolMode === 'cex_union' ? 'selected' : ''}>CEX Union (أوسع تغطية)</option>
        <option value="cex_intersection" ${scanSymbolMode === 'cex_intersection' ? 'selected' : ''}>CEX Intersection (أكثر تحفظاً)</option>
        <option value="wallet_readable" ${scanSymbolMode === 'wallet_readable' ? 'selected' : ''}>Wallet Readable (ملائم لـ MetaMask)</option>
      </select>
    </div>
    <div class="risk-item">
      <label>عدد الرموز الديناميكية</label>
      <input id="maxDynamicSymbols" type="number" value="${maxDynamicSymbols}" min="15" max="2000" step="5" title="عدد أزواج USDT المفحوصة ديناميكياً">
    </div>
    <div class="risk-item">
      <label>سقف رموز MetaMask</label>
      <input id="maxMetaMaskSymbols" type="number" value="${maxMetaMaskSymbols}" min="100" max="20000" step="50" title="سقف الرموز المقروءة من قوائم Web3 العامة">
    </div>
    <div class="risk-item">
      <label>Quote Assets للمسح</label>
      <input id="scanQuoteAssets" type="text" value="${scanQuoteAssets}" placeholder="USDT,USDC,BTC,ETH" style="min-width:240px">
      <span style="font-size:.72em;color:#888">مثال: USDT,USDC,BTC,ETH</span>
    </div>
    <div class="risk-item">
      <label>استخدام اكتشاف ديناميكي</label>
      <label style="color:#eee;font-size:.85em;display:flex;align-items:center;gap:6px">
        <input id="useDynamicSymbols" type="checkbox" ${useDynamicSymbols ? 'checked' : ''}>
        تفعيل المسح على كل رموز CEX المتاحة (بدلاً من قائمة ثابتة)
      </label>
    </div>
  </div>
  <div style="margin-top:8px;font-size:.75em;color:#888">ملاحظة: المسح الشامل جدًا يرفع الحمل. القيمة المقترحة للبداية: 300–500 رمز.</div>
  <div style="margin-top:14px">
    <button class="btn" data-admin-action="1" onclick="saveConfig()">💾 حفظ الإعدادات</button>
    <button class="btn btn-blue" data-admin-action="1" onclick="enableFullUniversePreset()">🌐 تفعيل وضع كل الرموز (MEXC/BINANCE/BITGET + MetaMask)</button>
  </div>
</div>

<div class="panel">
  <h2 style="margin-top:0">🧠 تفعيل الاستراتيجيات</h2>
  <div style="font-size:.82em;color:#888;margin-bottom:10px">
    فعّل/عطّل كل استراتيجية مباشرة من الواجهة. يتم حفظ الإعدادات في حالة البوت.
  </div>
  <div class="risk-row" style="gap:18px">
    <label><input type="checkbox" id="flag_cex" ${strategyFlags.cex ? 'checked' : ''}> CEX Arbitrage</label>
    <label><input type="checkbox" id="flag_dex" ${strategyFlags.dex ? 'checked' : ''}> DEX Cross-Chain</label>
    <label><input type="checkbox" id="flag_perps" ${strategyFlags.perps ? 'checked' : ''}> Perps Arbitrage</label>
    <label><input type="checkbox" id="flag_funding" ${strategyFlags.funding ? 'checked' : ''}> Funding Rate</label>
    <label><input type="checkbox" id="flag_triangular" ${strategyFlags.triangular ? 'checked' : ''}> Triangular</label>
    <label><input type="checkbox" id="flag_statistical" ${strategyFlags.statistical ? 'checked' : ''}> Statistical</label>
  </div>
  <div style="margin-top:14px">
    <button class="btn" data-admin-action="1" onclick="saveConfig()">💾 حفظ إعدادات الاستراتيجيات</button>
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

<!-- ── TradingView Live Chart (free widget) ───────────────────────────── -->
<div class="panel">
  <h2 style="margin-top:0">📉 TradingView Live Chart</h2>
  <div style="font-size:.8em;color:#888;margin-bottom:10px">
    عرض مباشر مجاني للسعر على الرمز الأكثر نشاطاً حالياً (${tvBaseSymbol}).
  </div>
  <div class="grid-two">
    <div class="tradingview-widget-container" style="height:420px;min-height:420px;background:#12161e;border:1px solid #2a2e38;border-radius:10px;overflow:hidden">
      <div id="tvChartWidget" style="height:100%;width:100%"></div>
    </div>
    <div style="background:#12161e;border:1px solid #2a2e38;border-radius:10px;padding:14px;line-height:1.9;color:#ccc">
      <div style="font-weight:bold;color:#f0b90b;margin-bottom:6px">Market Intelligence</div>
      <div>• المصدر الأساسي للتنفيذ الفعلي يبقى من مزودي الأسعار داخل البوت.</div>
      <div>• TradingView هنا للقراءة والتحليل السريع قبل التشغيل الحي.</div>
      <div>• يمكنك اختبار الاستراتيجية على Paper أولاً ثم تفعيل Live.</div>
      <div style="margin-top:10px;font-size:.8em;color:#888">رمز الرسم الحالي: ${tvSymbol}</div>
    </div>
  </div>
</div>

<div class="panel">
  <h2 style="margin-top:0">📈 Open Source Live Chart (Lightweight Charts)</h2>
  <div style="font-size:.8em;color:#888;margin-bottom:10px">
    مخطط مباشر مجاني ومفتوح المصدر (MIT) مبني على TradingView Lightweight Charts ويقرأ السعر من API البوت.
  </div>
  <div id="ossChart" style="height:300px;min-height:300px;background:#12161e;border:1px solid #2a2e38;border-radius:10px;overflow:hidden"></div>
  <div id="ossChartMeta" style="margin-top:10px;font-size:.78em;color:#888">الرمز: ${tvBaseSymbol} | المصدر: /api/market/price/${tvBaseSymbol}</div>
</div>

<div class="panel">
  <h2 style="margin-top:0">🧩 تكاملات مجانية ومفتوحة المصدر</h2>
  <div style="font-size:.8em;color:#888;margin-bottom:10px">
    حالة مزودي البيانات/الرسم/التنفيذ المجانيين المستخدمين لتقوية البوت.
  </div>
  <div id="freeSourcesGrid" class="bal-grid"><span style="color:#888">جارٍ التحميل...</span></div>
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
  <button class="btn" onclick="loadBacktestRuns()" style="margin-right:4px">📋 تاريخ الاختبارات</button>
  <div id="btResults" style="margin-top:16px;display:none">
    <div class="grid" id="btMetricsGrid"></div>
    <div style="margin-top:10px;font-size:.82em;color:#888" id="btMC"></div>
  </div>
  <div id="btRunsPanel" style="margin-top:14px;display:none">
    <table style="margin-top:0;font-size:.82em">
      <thead><tr><th>التاريخ</th><th>الصفقات</th><th>العائد %</th><th>Sharpe</th><th>Max DD</th></tr></thead>
      <tbody id="btRunsBody"></tbody>
    </table>
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

<div class="panel">
  <h2 style="margin-top:0">🧭 جاهزية منصات التنفيذ</h2>
  <div style="font-size:.78em;color:#888;margin-bottom:10px">
    MEXC و Binance و Bitget للتنفيذ المركزي، وMetaMask لتوقيع Web3 فقط.
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
    <input
      id="platformsSearch"
      type="text"
      oninput="filterPlatformsGrid()"
      placeholder="ابحث: mexc / web3 / configured"
      style="background:#0f131b;border:1px solid #2a3042;color:#ddd;border-radius:8px;padding:8px 10px;min-width:240px;flex:1"
    />
    <button onclick="loadPlatformsGrid({ force: true, manual: true })" style="padding:8px 12px;border-radius:8px;border:1px solid #2a3042;background:#1a2030;color:#ddd;cursor:pointer">تحديث الآن</button>
    <span id="platformsUpdatedAt" style="font-size:.76em;color:#888">آخر تحديث: —</span>
  </div>
  <div id="platformsFetchStatus" style="font-size:.76em;color:#888;margin-bottom:10px">⏳ جاري تحميل بيانات المنصات...</div>
  <div id="platformsGrid" class="bal-grid"><span style="color:#888">جارٍ التحميل...</span></div>
</div>

<!-- ── Circuit Breaker panel (loaded dynamically) ────────────────────────── -->
<div class="panel">
  <h2 style="margin-top:0">🔌 حالة Circuit Breaker — المنصات الفعّالة</h2>
  <div style="font-size:.78em;color:#888;margin-bottom:10px">
    ⚠️ Gate.io و Bybit: مصادر أسعار فقط (القانون الألماني — لا تنفيذ حقيقي)
  </div>
  <div id="cbContent" class="cb-grid"><span style="color:#888">جارٍ التحميل...</span></div>
</div>

<!-- ── Perps Status Panel (loaded dynamically) ───────────────────────────── -->
<div class="panel">
  <h2 style="margin-top:0">⚡ حالة Perps — العقود الدائمة</h2>
  <div style="font-size:.78em;color:#888;margin-bottom:10px">
    مصادر أسعار Perps: MEXC Futures (تنفيذ) + Binance USDM + OKX Swap + Bybit (بيانات فقط).
    يتم التنفيذ الحقيقي عبر MEXC Futures أو Spot Hedge في حالة عدم توفر MEXC Futures.
  </div>
  <div id="perpsStatusContent" class="bal-grid"><span style="color:#888">جارٍ التحميل...</span></div>
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
        <div style="font-size:.72em;color:#888;margin-top:4px">يتم تحميل الأزواج تلقائياً من كتالوج /api/symbols/catalog</div>
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

<!-- ── 🧠 Bot Memory & Self-Learning Panel ─────────────────────────────── -->
<div class="panel">
  <h2 style="margin-top:0">🧠 الذاكرة والتعلم الذاتي</h2>
  <div style="font-size:.82em;color:#aaa;margin-bottom:12px">
    يراكم البوت الخبرة عبر تقييمات دورية ذاتية. نتائج كل تقييم تُحفظ وتُستخدم لضبط أوزان الاستراتيجيات تلقائياً ضمن حدود أمان محددة.
    كل تعديل ذاتي مقيّد بحدود (<strong style="color:#f0b90b">+0.1 / -0.1</strong> لكل دورة، بين 0.2 و 2.0).
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">
    <button class="btn btn-blue" data-admin-action="1" onclick="runSelfEvaluate()">🔬 تشغيل تقييم ذاتي</button>
    <button class="btn" onclick="loadBotMemory()">📂 تحميل الذاكرة</button>
    <button class="btn btn-red" data-admin-action="1" onclick="resetBotMemory()">🗑️ مسح الذاكرة</button>
  </div>
  <div id="selfEvalResult" style="font-size:.82em;color:#888;background:#12161e;border-radius:8px;padding:12px;white-space:pre-wrap;display:none;margin-bottom:12px"></div>
  <div id="botMemoryPanel" style="display:none">
    <div class="grid" id="botMemoryStats"></div>
    <div id="botMemoryRecommendations" style="margin-top:12px;font-size:.82em;color:#aaa;background:#12161e;border-radius:8px;padding:12px"></div>
  </div>
</div>

<!-- ── AI Analysis Panel ─────────────────────────────────────────────────── -->
<div class="panel">
  <h2 style="margin-top:0">🤖 تحليل الفرصة بالذكاء الاصطناعي</h2>
  <div style="font-size:.82em;color:#aaa;margin-bottom:12px">
    أدخل بيانات الفرصة وسيحللها نموذج الذكاء الاصطناعي ويعطيك توصية فورية.
  </div>
  <div class="risk-row" style="margin-bottom:12px">
    <div class="risk-item">
      <label>الزوج (Symbol)</label>
      <input id="ai_symbol" type="text" value="${esc(lastScan?.cex?.symbol || lastScan?.dex?.symbol)}" placeholder="BTC/USDT" style="background:#2a2e38;color:#eee;border:1px solid #444;border-radius:6px;padding:7px 10px;width:140px">
    </div>
    <div class="risk-item">
      <label>الاستراتيجية</label>
      <select id="ai_strategy" style="background:#2a2e38;color:#eee;border:1px solid #444;border-radius:6px;padding:7px 10px">
        <option value="cex">CEX</option>
        <option value="dex">DEX</option>
        <option value="perps">Perps</option>
        <option value="triangular">Triangular</option>
        <option value="statistical">Statistical</option>
      </select>
    </div>
    <div class="risk-item">
      <label>الاتجاه</label>
      <input id="ai_direction" type="text" value="${esc(lastScan?.cex?.direction)}" placeholder="buy_mexc_sell_binance" style="background:#2a2e38;color:#eee;border:1px solid #444;border-radius:6px;padding:7px 10px;width:190px">
    </div>
    <div class="risk-item">
      <label>سعر الشراء ($)</label>
      <input id="ai_buyPrice" type="number" value="${esc(lastScan?.cex?.buyPrice)}" step="0.000001" placeholder="0.0" style="background:#2a2e38;color:#eee;border:1px solid #444;border-radius:6px;padding:7px 10px;width:130px">
    </div>
    <div class="risk-item">
      <label>سعر البيع ($)</label>
      <input id="ai_sellPrice" type="number" value="${esc(lastScan?.cex?.sellPrice)}" step="0.000001" placeholder="0.0" style="background:#2a2e38;color:#eee;border:1px solid #444;border-radius:6px;padding:7px 10px;width:130px">
    </div>
    <div class="risk-item">
      <label>صافي الربح (%)</label>
      <input id="ai_netPct" type="number" value="${esc(lastScan?.cex?.netPct)}" step="0.0001" placeholder="0.05" style="background:#2a2e38;color:#eee;border:1px solid #444;border-radius:6px;padding:7px 10px;width:120px">
    </div>
  </div>
  <button class="btn btn-blue" data-admin-action="1" onclick="runAiAnalysis()">🤖 تحليل بالذكاء الاصطناعي</button>
  <div id="aiResult" style="margin-top:14px;font-size:.88em;line-height:1.7;display:none;background:#12161e;border-radius:8px;padding:14px;border-right:3px solid #3498db"></div>
</div>

<!-- ── Temporal Workflow Panel ──────────────────────────────────────────── -->
<div class="panel">
  <h2 style="margin-top:0">⏱️ Temporal — جلسة التداول المستدامة</h2>
  <div style="font-size:.82em;color:#aaa;margin-bottom:12px">
    Temporal يضمن استمرار جلسة التداول حتى في حالة إعادة تشغيل الـ Worker.
    يتطلب تهيئة <code style="background:#2a2e38;padding:2px 6px;border-radius:4px">TEMPORAL_API_KEY</code>.
  </div>
  <div style="margin-bottom:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
    <button class="btn btn-green" data-admin-action="1" onclick="temporalStart()">▶️ تشغيل Temporal</button>
    <button class="btn btn-red"   data-admin-action="1" onclick="temporalStop(false)">⏸️ إيقاف ناعم</button>
    <button class="btn btn-red"   data-admin-action="1" onclick="temporalStop(true)" style="opacity:.8">🛑 إنهاء فوري</button>
    <button class="btn btn-blue"  onclick="temporalStatus()">📊 الحالة</button>
    <button class="btn"           data-admin-action="1" onclick="temporalMode(true)">📄 Paper</button>
    <button class="btn btn-red"   data-admin-action="1" onclick="temporalMode(false)">🔴 Live</button>
  </div>
<div id="temporalResult" style="font-size:.82em;color:#888;background:#12161e;border-radius:8px;padding:12px;white-space:pre-wrap;display:none"></div>
</div>

<!-- ── Executable integrations panel ─────────────────────────────────────── -->
<div class="panel">
  <h2 style="margin-top:0">🔌 التكاملات التنفيذية الأربعة</h2>
  <div style="font-size:.82em;color:#888;margin-bottom:10px">
    Hummingbot + Freqtrade + CrewAI + AutoGPT
  </div>
  <div>
    <button class="btn btn-blue" onclick="loadExecutableIntegrationsStatus()">📊 الحالة</button>
    <button class="btn btn-green" data-admin-action="1" onclick="runExecutableIntegration('hummingbot')">▶️ Hummingbot</button>
    <button class="btn btn-green" data-admin-action="1" onclick="runExecutableIntegration('freqtrade')">▶️ Freqtrade</button>
    <button class="btn btn-green" data-admin-action="1" onclick="runExecutableIntegration('crewai')">▶️ CrewAI</button>
    <button class="btn btn-green" data-admin-action="1" onclick="runExecutableIntegration('autogpt')">▶️ AutoGPT</button>
    <button class="btn" data-admin-action="1" onclick="runAllExecutableIntegrations()">🚀 تشغيل الأربعة معًا</button>
  </div>
  <div id="execIntegrationsResult" style="font-size:.82em;color:#888;background:#12161e;border-radius:8px;padding:12px;white-space:pre-wrap;display:none;margin-top:10px"></div>
</div>

<!-- ── R2 Log Archives Panel ────────────────────────────────────────────── -->
<div class="panel">
  <h2 style="margin-top:0">🗄️ أرشيف ملفات السجلات (R2)</h2>
  <button class="btn btn-blue" onclick="loadLogArchives()">📂 تحميل قائمة الأرشيف</button>
  <div id="logsContent" style="margin-top:12px;font-size:.82em;display:none">
    <table style="margin-top:0">
      <thead><tr><th>اسم الملف</th><th>الحجم (KB)</th><th>تاريخ الرفع</th><th>عدد الصفوف</th></tr></thead>
      <tbody id="logsTableBody"></tbody>
    </table>
    <div id="logsMore" style="margin-top:8px;font-size:.8em;color:#888"></div>
  </div>
</div>

<div class="panel">
  <h2 style="margin-top:0">🔗 مزامنة الواجهة مع API</h2>
  <div id="apiSyncStatus" style="font-size:.82em;color:#888;margin-bottom:10px">جارٍ مزامنة البيانات…</div>
  <div class="grid">
    <div class="card"><div class="card-label">/api/status</div><div id="apiStatusCard" style="font-size:.88em;color:#aaa">—</div></div>
    <div class="card"><div class="card-label">/api/trades</div><div id="apiTradesCard" style="font-size:.88em;color:#aaa">—</div></div>
    <div class="card"><div class="card-label">/api/pnl</div><div id="apiPnlCard" style="font-size:.88em;color:#aaa">—</div></div>
    <div class="card"><div class="card-label">/api/report</div><div id="apiReportCard" style="font-size:.88em;color:#aaa">—</div></div>
    <div class="card"><div class="card-label">/api/logs</div><div id="apiLogsCard" style="font-size:.88em;color:#aaa">—</div></div>
  </div>
</div>

<h2>📊 آخر الصفقات</h2>
<table>
  <thead><tr><th>الوضع</th><th>الاستراتيجية</th><th>الاتجاه</th><th>الحجم (USD)</th><th>الربح</th><th>الوقت</th></tr></thead>
  <tbody id="recentTradesBody">
    ${tradesHtml || '<tr><td colspan="6" style="text-align:center;padding:20px;color:#888">لا توجد صفقات مسجّلة</td></tr>'}
  </tbody>
</table>

<script>
  // Free TradingView widget for quick visual validation before execution.
  (function initTradingViewWidget(){
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: '${tvSymbol}',
      interval: '15',
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      allow_symbol_change: true,
      support_host: 'https://www.tradingview.com',
      container_id: 'tvChartWidget'
    });
    const target = document.getElementById('tvChartWidget');
    if (target) target.appendChild(script);
  })();

  const OPEN_SOURCE_SYMBOL = '${tvBaseSymbol}';
  let _ossChart = null;
  let _ossSeries = null;
  let _ossLoaded = false;

  function _loadLightweightChartsLib(){
    return new Promise((resolve, reject) => {
      if (window.LightweightCharts) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('تعذر تحميل مكتبة Lightweight Charts'));
      document.head.appendChild(script);
    });
  }

  async function initOpenSourceChart(){
    if (_ossLoaded) return;
    const container = document.getElementById('ossChart');
    if (!container) return;

    await _loadLightweightChartsLib();

    const chart = window.LightweightCharts.createChart(container, {
      layout: { background: { color: '#12161e' }, textColor: '#cfd3dc' },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.06)' },
        horzLines: { color: 'rgba(255,255,255,0.06)' }
      },
      rightPriceScale: { borderColor: '#2a2e38' },
      timeScale: { borderColor: '#2a2e38', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 }
    });

    const areaSeriesOptions = {
      lineColor: '#2ecc71',
      topColor: 'rgba(46, 204, 113, 0.34)',
      bottomColor: 'rgba(46, 204, 113, 0.03)',
      lineWidth: 2,
    };
    const lineSeriesOptions = {
      color: '#2ecc71',
      lineWidth: 2,
    };

    let series;
    if (typeof chart.addAreaSeries === 'function') {
      series = chart.addAreaSeries(areaSeriesOptions);
    } else if (typeof chart.addSeries === 'function' && window.LightweightCharts?.AreaSeries) {
      series = chart.addSeries(window.LightweightCharts.AreaSeries, areaSeriesOptions);
    } else if (typeof chart.addLineSeries === 'function') {
      series = chart.addLineSeries(lineSeriesOptions);
    } else {
      throw new Error('نسخة Lightweight Charts الحالية لا تدعم إنشاء السلسلة المطلوبة');
    }

    _ossChart = chart;
    _ossSeries = series;
    _ossLoaded = true;

    const resize = () => {
      const width = container.clientWidth || 600;
      const height = container.clientHeight || 300;
      chart.applyOptions({ width, height });
      chart.timeScale().fitContent();
    };
    resize();
    window.addEventListener('resize', resize);
  }

  function _bestPriceFromPayload(payload){
    const data = payload?.data || {};
    const picks = [
      data.binance,
      data.bybit,
      data.okx,
      data.bitget,
      data.coinbase,
      data.kraken,
      data.alpaca,
      data.ibkr,
      data.alpha_vantage,
      data.twelve_data,
    ];
    for (const p of picks) {
      const n = Number(p);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  }

  async function updateOpenSourceChartPrice(){
    if (!_ossSeries) return;
    try {
      const res = await callAdminApi('/api/market/price/' + encodeURIComponent(OPEN_SOURCE_SYMBOL));
      const payload = JSON.parse(res.text);
      const price = _bestPriceFromPayload(payload);
      if (!Number.isFinite(price) || price <= 0) return;

      const point = {
        time: Math.floor(Date.now() / 1000),
        value: Number(price),
      };
      _ossSeries.update(point);

      const meta = document.getElementById('ossChartMeta');
      if (meta) {
        meta.textContent = 'الرمز: ' + OPEN_SOURCE_SYMBOL + ' | آخر سعر: ' + Number(price).toFixed(6) + ' | آخر تحديث: ' + new Date().toLocaleTimeString('ar');
      }
    } catch (e) {
      console.warn('[oss-chart] update failed:', e.message || e);
    }
  }

  function _renderFreeSourceCard(source){
    const ok = !!source.configured;
    const border = ok ? '#2ecc71' : '#e67e22';
    const status = ok ? '<span style="color:#2ecc71">✅ جاهز</span>' : '<span style="color:#e67e22">⚠️ يحتاج تهيئة</span>';
    const missing = Array.isArray(source.missing) && source.missing.length
      ? '<div style="font-size:.74em;color:#e67e22;margin-top:6px">Missing: ' + source.missing.join(', ') + '</div>'
      : '';

    return '<div class="bal-card" style="border:1px solid ' + border + '">' +
      '<div class="bal-name">' + String(source.name || source.id || '').toUpperCase() + '</div>' +
      '<div style="font-size:.78em;color:#888;margin-top:4px">' + (source.type || 'integration') + '</div>' +
      '<div style="margin-top:8px;font-size:.82em">' + status + '</div>' +
      '<div style="font-size:.76em;color:#aaa;margin-top:4px">' + (source.note || '') + '</div>' +
      missing +
    '</div>';
  }

  async function loadFreeSources(){
    const grid = document.getElementById('freeSourcesGrid');
    if (!grid) return;
    try {
      const res = await callAdminApi('/api/free-sources');
      const payload = JSON.parse(res.text);
      const sources = Array.isArray(payload?.sources) ? payload.sources : [];
      grid.innerHTML = sources.length
        ? sources.map(_renderFreeSourceCard).join('')
        : '<span style="color:#888">لا توجد تكاملات مجانية معروضة</span>';
    } catch (e) {
      grid.innerHTML = '<span style="color:#e74c3c">❌ ' + (e.message || 'تعذر تحميل التكاملات') + '</span>';
    }
  }

  // ── Auto-refresh countdown ───────────────────────────────────────────────────
  const AUTO_REFRESH_SECONDS = 30;
  let _cd = AUTO_REFRESH_SECONDS;
  let _refreshBusy = false;

  function _setCountdown(value){
    const el = document.getElementById('countdown');
    if (el) el.textContent = String(value);
  }

  function _setCountdownLabel(text){
    const el = document.getElementById('countdownLabel');
    if (el) el.textContent = text;
  }

  function _logSettledFailures(results, scope){
    results.forEach((res) => {
      if (res.status === 'rejected') {
        console.error('[' + scope + '] refresh task failed:', res.reason?.message || res.reason);
      }
    });
  }

  async function triggerRefresh(manual = false){
    if (_refreshBusy) return;
    _refreshBusy = true;
    _setCountdownLabel(manual ? '⏳ جاري التحديث…' : '🔄 تحديث تلقائي…');
    try {
      const results = await Promise.allSettled([loadDynamic(), loadApiSnapshot(), loadFreeSources(), updateOpenSourceChartPrice()]);
      _logSettledFailures(results, 'dashboard');
    } finally {
      _refreshBusy = false;
      _cd = AUTO_REFRESH_SECONDS;
      _setCountdown(_cd);
      _setCountdownLabel('تحديث تلقائي:');
    }
  }

  setInterval(() => {
    if (_refreshBusy) return;
    _cd -= 1;
    _setCountdown(_cd);
    if (_cd <= 0) triggerRefresh(false);
  }, 1000);

  // ── Shared API helper ────────────────────────────────────────────────────────
  // When ADMIN_TOKEN is configured, auth is handled via HttpOnly session cookie.
  // Without ADMIN_TOKEN we run in open setup mode and call APIs directly.
  const adminConfigured = ${JSON.stringify(Boolean(env.ADMIN_TOKEN))};
  function setButtonsBusy(b){ document.querySelectorAll('[data-admin-action]').forEach(btn=>btn.disabled=b); }
  function disableAdminUi(){
    if(adminConfigured) return;
    document.querySelectorAll('[data-admin-action]').forEach(btn=>{
      btn.title='وضع مفتوح (بدون ADMIN_TOKEN) — فعّل التوكن للحماية الإنتاجية';
    });
  }
  async function callAdminApi(path,opts={}){
    let r;
    try{
      r = adminConfigured
        ? await fetch(path,{credentials:'same-origin',...opts})
        : await fetch(path,opts);
    }
    catch(_){ throw new Error('تعذر الاتصال بالخادم'); }
    if(adminConfigured && r.status===401){ window.location='/login'; return {text:'',r}; }
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
      daily_limit_usd:            parseFloat(document.getElementById('dailyLimitUsd').value),
      max_per_trade_loss_pct:     parseFloat(document.getElementById('maxPerTrade').value),
      min_seconds_between_trades: parseFloat(document.getElementById('minSeconds').value),
      initial_capital:            parseFloat(document.getElementById('initialCapital').value),
      position_size_usd:          parseFloat(document.getElementById('positionSizeUsd')?.value || '5'),
      multi_strategy_live:        !!document.getElementById('multiStrategyLive')?.checked,
      max_live_trades_per_scan:   parseInt(document.getElementById('maxLiveTradesPerScan')?.value || '3', 10),
      scan_symbol_mode:           document.getElementById('scanSymbolMode')?.value || 'cex_union',
      max_dynamic_symbols:        parseInt(document.getElementById('maxDynamicSymbols')?.value || '500', 10),
      max_metamask_symbols:       parseInt(document.getElementById('maxMetaMaskSymbols')?.value || '10000', 10),
      scan_quote_assets:          String(document.getElementById('scanQuoteAssets')?.value || '').split(',').map(v=>v.trim()).filter(Boolean),
      use_dynamic_symbols:        !!document.getElementById('useDynamicSymbols')?.checked,
      strategy_flags: {
        cex:         !!document.getElementById('flag_cex')?.checked,
        dex:         !!document.getElementById('flag_dex')?.checked,
        perps:       !!document.getElementById('flag_perps')?.checked,
        funding:     !!document.getElementById('flag_funding')?.checked,
        triangular:  !!document.getElementById('flag_triangular')?.checked,
        statistical: !!document.getElementById('flag_statistical')?.checked,
      }
    };
    const numericKeys=['max_daily_loss_usd','daily_limit_usd','max_per_trade_loss_pct','min_seconds_between_trades','initial_capital','max_live_trades_per_scan','position_size_usd','max_dynamic_symbols','max_metamask_symbols'];
    for(const k of numericKeys){
      const v=Number(body[k]);
      if(!Number.isFinite(v)||v<=0){ alert('❌ قيمة غير صحيحة: '+k); return; }
    }
    // Enforce position size safety bounds in the UI
    if (body.position_size_usd < 1 || body.position_size_usd > 500) {
      alert('❌ حجم المركز يجب أن يكون بين 1 و 500 USDT'); return;
    }
    setButtonsBusy(true);
    try{
      await callAdminApi('/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      alert('✅ تم حفظ الإعدادات'); location.reload();
    }catch(e){ alert('❌ '+e.message); }
    finally{ setButtonsBusy(false); }
  }

  async function enableFullUniversePreset(){
    if (!confirm('⚠️ تفعيل مسح واسع لكل الرموز يزيد الحمل وقد يرفع زمن الدورة. المتابعة؟')) return;
    setButtonsBusy(true);
    try {
      const body = {
        use_dynamic_symbols: true,
        scan_symbol_mode: 'cex_union',
        max_dynamic_symbols: 500,
        max_metamask_symbols: 20000,
        scan_quote_assets: ['USDT', 'USDC', 'FDUSD', 'BUSD', 'DAI', 'TUSD', 'BTC', 'ETH'],
        strategy_flags: {
          cex: true,
          dex: true,
          perps: true,
          funding: true,
          triangular: true,
          statistical: true,
        }
      };
      await callAdminApi('/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      alert('✅ تم تفعيل وضع كل الرموز بنجاح');
      location.reload();
    } catch (e) {
      alert('❌ ' + e.message);
    } finally {
      setButtonsBusy(false);
    }
  }
  async function resetDaily(){
    if(!confirm('⚠️ إعادة تعيين إحصائيات اليوم (PnL + عدد الصفقات)؟')) return;
    setButtonsBusy(true);
    try{ const res=await callAdminApi('/reset-daily',{method:'POST'}); alert(res.text||'✅ تم'); location.reload(); }
    catch(e){ alert('❌ '+e.message); }
    finally{ setButtonsBusy(false); }
  }

  // ── P&L Chart ────────────────────────────────────────────────────────────────
  const pnlLabels = ${JSON.stringify([...trades].reverse().map(t => formatTimeAr(t.created_at)))};

  function _parseDateSafe(value){
    if (value == null || value === '') return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') {
      const ms = value < 1e12 ? value * 1000 : value;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const raw = String(value).trim();
    if (!raw) return null;
    if (/^\\d+$/.test(raw)) {
      const n = Number(raw);
      const ms = n < 1e12 ? n * 1000 : n;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const normalized = raw.includes(' ') && !raw.includes('T') ? raw.replace(' ', 'T') : raw;
    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function _fmtDateTimeAr(value){
    const d = _parseDateSafe(value);
    return d ? d.toLocaleString('ar') : '—';
  }
  try {
    const ctx=document.getElementById('pnlChart').getContext('2d');
    new Chart(ctx,{type:'line',data:{
      labels: pnlLabels.length ? pnlLabels : Array.from({length:${pnlData.length}},(_,i)=>i+1),
      datasets:[{label:'الربح المتراكم ($)',data:${JSON.stringify(pnlData)},borderColor:'#f0b90b',backgroundColor:'rgba(240,185,11,0.08)',fill:true,tension:.3,pointRadius:3}]
    },options:{responsive:true,plugins:{legend:{labels:{color:'#eee'}}},scales:{x:{ticks:{color:'#888',maxTicksLimit:12}},y:{ticks:{color:'#888'}}}}});
    } catch(_chartErr){ console.warn('P&L chart init failed:', _chartErr); }

    // ── Strategy P&L Bar Chart ────────────────────────────────────────────────────
    try {
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
    } catch(_chartErr){ console.warn('Strategy chart init failed:', _chartErr); }
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

  async function loadBacktestRuns() {
    const panel = document.getElementById('btRunsPanel');
    const tbody = document.getElementById('btRunsBody');
    panel.style.display = 'block';
    tbody.innerHTML = '<tr><td colspan="5" style="color:#888;text-align:center">جارٍ التحميل…</td></tr>';
    try {
      const res  = await callAdminApi('/api/backtest/runs');
      const data = JSON.parse(res.text);
      const runs = data.runs || [];
      if (!runs.length) { tbody.innerHTML = '<tr><td colspan="5" style="color:#888;text-align:center">لا يوجد تاريخ اختبارات</td></tr>'; return; }
      tbody.innerHTML = runs.map(r => {
        const m    = r.metrics || {};
        const ret  = (r.return_pct || 0).toFixed(2);
        const date = _fmtDateTimeAr(r.created_at);
        const retColor = parseFloat(ret) >= 0 ? '#2ecc71' : '#e74c3c';
        return \`<tr>
          <td style="font-size:.82em">\${date}</td>
          <td>\${m.total_trades||0}</td>
          <td style="color:\${retColor}">\${ret}%</td>
          <td>\${(m.sharpe||0).toFixed(2)}</td>
          <td style="color:#e74c3c">$\${(m.max_drawdown_usd||0).toFixed(2)}</td>
        </tr>\`;
      }).join('');
    } catch(e) {
      tbody.innerHTML = \`<tr><td colspan="5" style="color:#e74c3c">❌ \${e.message}</td></tr>\`;
    }
  }

  // ── Load dynamic panels ──────────────────────────────────────────────────────
  async function loadBalances(){
    const el=document.getElementById('balancesContent');
    try{
      const res=await callAdminApi('/api/balances');
      const json=JSON.parse(res.text);
      const exchanges=json.data||[];
      const anyConfigured=exchanges.some(b=>b.configured&&!b.dataOnly);
      const items=exchanges.map(b=>{
        if (b.dataOnly) return \`<div class="bal-card" style="opacity:.4;border-left:2px solid #888"><div class="bal-name">\${b.exchange.toUpperCase()}</div><div class="bal-value" style="color:#888;font-size:.8em">\${b.note||'Data only'}</div></div>\`;
        if(!b.configured){
          const missingKeysList=(b.missing_keys||[]).join(', ');
          const hint=missingKeysList?\`<div style="font-size:.72em;color:#e67e22;margin-top:4px;word-break:break-all">🔑 أضف: \${missingKeysList}</div>\`:'';
          return \`<div class="bal-card" style="border:1px solid #e67e22"><div class="bal-name">\${b.exchange.toUpperCase()}</div><div class="bal-value" style="color:#888;font-size:.85em">غير مُهيأ</div>\${hint}</div>\`;
        }
        if (b.error) {
          const msg = String(b.error || 'Balance fetch failed').slice(0, 120);
          return \`<div class="bal-card" style="border:1px solid #e67e22"><div class="bal-name">\${b.exchange.toUpperCase()}</div><div class="bal-value" style="color:#e67e22;font-size:.82em">تعذر جلب الرصيد</div><div style="font-size:.72em;color:#888;margin-top:4px;word-break:break-word">\${msg}</div></div>\`;
        }
        const color=b.balance>0?'#2ecc71':'#888';
        return \`<div class="bal-card"><div class="bal-name">\${b.exchange.toUpperCase()}</div><div class="bal-value" style="color:\${color}">$\${Number(b.balance).toFixed(2)}</div></div>\`;
      }).join('');
      const setupBanner=!anyConfigured
        ?\`<div style="background:#c0392b;color:#fff;padding:10px 14px;border-radius:8px;margin-bottom:12px;font-size:.85em">
            ⚠️ <strong>لا توجد مفاتيح API مُعيَّنة — لن تعمل الصفقات الحقيقية.</strong><br>
            أضف أسرار المنصات باستخدام:<br>
            <code style="background:rgba(0,0,0,.3);padding:2px 5px;border-radius:4px">wrangler secret put MEXC_API_KEY</code> (وهكذا لكل مفتاح).<br>
            راجع <a href="/checklist" style="color:#f0b90b">قائمة الإعداد</a> لمزيد من التفاصيل.
           </div>\`
        :\`\`;
      el.innerHTML=setupBanner+(items||'<span style="color:#888">لا بيانات</span>');
    }catch(e){ el.innerHTML='<span style="color:#e74c3c">❌ '+e.message+'</span>'; }
  }
  async function loadCircuitBreaker(){
    const el=document.getElementById('cbContent');
    try{
      const { text } = await callAdminApi('/api/status');
      const json=JSON.parse(text);
      const cb=json.circuitBreaker||{};
      const active=['mexc','mexc_perp','binance_perp','binance','kucoin','bitget','bitmart','htx'];
      const dataOnly=['bybit','gateio','bybit_perp'];
      const items=[
        ...active.map(ex=>{
          const info=cb[ex];
          const open=info&&info.open&&(Date.now()-info.lastFailure)<300000;
          const failures=info?.failures||0;
          const cls=open?'cb-open':'cb-ok';
          const label=open?\`🔴 مفتوح (\${failures} أخطاء)\`:\`✅ سليم\`;
          const isDataOnly=['binance_perp'].includes(ex);
          return \`<div class="cb-card"\${isDataOnly?' style="opacity:.75"':''}><div class="name">\${ex.toUpperCase()}</div><div class="\${cls}">\${label}\${isDataOnly?' <span style="font-size:.72em;color:#888">(feed)</span>':''}</div></div>\`;
        }),
        ...dataOnly.map(ex=>\`<div class="cb-card" style="opacity:.4"><div class="name">\${ex.toUpperCase()}</div><div style="color:#888;font-size:.78em">📊 بيانات فقط</div></div>\`)
      ].join('');
      el.innerHTML=items;
    }catch(e){ el.innerHTML='<span style="color:#e74c3c">❌ '+e.message+'</span>'; }
  }
  async function loadPerpsStatus(){
    const el=document.getElementById('perpsStatusContent');
    if(!el) return;
    try{
      const res=await callAdminApi('/api/perps');
      const json=JSON.parse(res.text);
      const exList=(json.exchangeStatus||[]).map(ex=>{
        const statusColor=ex.status==='ok'?'#2ecc71':'#e74c3c';
        const statusLabel=ex.status==='ok'?'✅ نشط':'🔴 مفتوح';
        return \`<div class="bal-card"><div class="bal-name">\${ex.exchange.toUpperCase()}</div><div style="color:\${statusColor};font-size:.85em">\${statusLabel}</div></div>\`;
      }).join('');
      const mexcBadge=json.mexcFuturesConfigured
        ?'<span style="color:#2ecc71;font-weight:bold">✅ MEXC Futures مُهيأ</span>'
        :'<span style="color:#e74c3c;font-weight:bold">⚠️ MEXC Futures: أضف MEXC_API_KEY و MEXC_API_SECRET</span>';
      const perpOpp=json.lastPerpsOpp;
      const perpCard=perpOpp
        ?\`<div style="margin-top:8px;font-size:.82em;color:#aaa">\${perpOpp.symbol} |\${perpOpp.direction} | صافي: <strong style="color:#2ecc71">\${perpOpp.netPct.toFixed(4)}%</strong></div>\`
        :'<div style="font-size:.82em;color:#888;margin-top:8px">لا توجد فرصة perp في آخر مسح</div>';
      el.innerHTML=\`<div style="margin-bottom:10px">\${mexcBadge}</div><div style="font-size:.78em;color:#888;margin-bottom:10px">\${json.executionNote||''}</div><div class="bal-grid">\${exList}</div>\${perpCard}\`;
    }catch(e){ el.innerHTML='<span style="color:#e74c3c">❌ '+e.message+'</span>'; }
  }
  async function loadExecutableIntegrationsStatus(){
    const el=document.getElementById('execIntegrationsResult');
    if(!el) return;
    el.style.display='block';
    el.textContent='جارٍ التحميل...';
    try{
      const res=await callAdminApi('/api/integrations/executive/status');
      const json=JSON.parse(res.text);
      const lines=(json.integrations||[]).map(item=>{
        const cfg=item.configured?'✅':'⚠️';
        const status=item.reachable===true?'متصل':(item.reachable===false?'غير متصل':'غير مفحوص');
        return \`\${cfg} \${item.integration.toUpperCase()} | configured=\${item.configured?'yes':'no'} | status=\${status}\`;
      });
      el.textContent=lines.join('\\n')||'لا توجد بيانات';
    }catch(e){
      el.textContent='❌ '+e.message;
    }
  }
  async function runExecutableIntegration(integration){
    setButtonsBusy(true);
    try{
      const res=await callAdminApi('/api/integrations/executive/execute',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          integration,
          payload:{ trigger:'dashboard', requested_at:new Date().toISOString() }
        })
      });
      const json=JSON.parse(res.text);
      const el=document.getElementById('execIntegrationsResult');
      if(el){
        el.style.display='block';
        el.textContent=JSON.stringify(json,null,2);
      }
    }catch(e){ alert('❌ '+e.message); }
    finally{ setButtonsBusy(false); }
  }
  async function runAllExecutableIntegrations(){
    if(!confirm('تشغيل التكاملات التنفيذية الأربعة الآن؟')) return;
    setButtonsBusy(true);
    try{
      const res=await callAdminApi('/api/integrations/executive/execute-all',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          defaultPayload:{ trigger:'dashboard_all', requested_at:new Date().toISOString() }
        })
      });
      const json=JSON.parse(res.text);
      const el=document.getElementById('execIntegrationsResult');
      if(el){
        el.style.display='block';
        el.textContent=JSON.stringify(json,null,2);
      }
    }catch(e){ alert('❌ '+e.message); }
    finally{ setButtonsBusy(false); }
  }
  const PLATFORM_REFRESH_MS = 30000;
  const PLATFORM_BACKOFF_BASE_MS = 2000;
  const PLATFORM_BACKOFF_MAX_MS = 30000;
  const _platformsState = {
    all: [],
    query: '',
    inFlight: false,
    retryCount: 0,
    retryTimer: null,
  };

  function _setPlatformsStatus(msg, color='#888'){
    const el = document.getElementById('platformsFetchStatus');
    if (!el) return;
    el.style.color = color;
    el.textContent = msg;
  }

  function _setPlatformsUpdatedAtLabel(value){
    const el = document.getElementById('platformsUpdatedAt');
    if (!el) return;
    el.textContent = 'آخر تحديث: ' + (value || '—');
  }

  function _renderPlatformsFromState(){
    const grid = document.getElementById('platformsGrid');
    if (!grid) return;
    const q = (_platformsState.query || '').trim().toLowerCase();
    const filtered = !q
      ? _platformsState.all
      : _platformsState.all.filter((p) => {
          const haystack = [
            p.name,
            p.type,
            p.executionMode,
            ...(p.strategies || []),
            p.configured ? 'configured' : 'unconfigured',
            p.configured ? 'مهيأ' : 'غير مهيأ',
          ].join(' ').toLowerCase();
          return haystack.includes(q);
        });

    grid.innerHTML = filtered.map(_renderPlatformCard).join('') ||
      '<span style="color:#888">لا توجد منصات مطابقة</span>';
  }

  function filterPlatformsGrid(){
    const input = document.getElementById('platformsSearch');
    _platformsState.query = input ? input.value : '';
    _renderPlatformsFromState();
  }

  function _schedulePlatformsRetry(){
    if (_platformsState.retryTimer) return;
    const delayMs = Math.min(
      PLATFORM_BACKOFF_BASE_MS * (2 ** Math.max(0, _platformsState.retryCount - 1)),
      PLATFORM_BACKOFF_MAX_MS
    );
    _setPlatformsStatus('⚠️ تعذر جلب المنصات. إعادة المحاولة خلال ' + Math.round(delayMs / 1000) + ' ثانية...', '#e67e22');
    _platformsState.retryTimer = setTimeout(() => {
      _platformsState.retryTimer = null;
      loadPlatformsGrid({ fromRetry: true });
    }, delayMs);
  }

  async function loadDynamic(){
    disableAdminUi();
    const results = await Promise.allSettled([
      loadBalances(),
      loadCircuitBreaker(),
      loadPerpsStatus(),
      loadExecutableIntegrationsStatus(),
      loadPlatformsGrid({ force: true }),
      loadFreeSources(),
      updateOpenSourceChartPrice(),
    ]);
    _logSettledFailures(results, 'dynamic-panels');
  }
  initOpenSourceChart().then(() => updateOpenSourceChartPrice()).catch((e) => {
    const meta = document.getElementById('ossChartMeta');
    if (meta) meta.textContent = '❌ تعذر تهيئة المخطط المفتوح المصدر: ' + (e.message || e);
  });
  loadDynamic();
  setInterval(() => updateOpenSourceChartPrice(), 15000);
  setInterval(() => loadFreeSources(), 60000);

  // ── Platform cards — dynamic refresh every 30 s ─────────────────────────────
  function _renderPlatformCard(p){
    const isConfigured = !!p.configured;
    const isDataOnly = !!p.dataOnly;
    const isWeb3 = p.type === 'web3';
    const borderColor  = isWeb3 ? '#3498db' : isDataOnly ? '#888' : (isConfigured ? '#2ecc71' : '#e67e22');
    const balLine      = isWeb3
      ? \`<div style="font-size:.8em;color:#3498db;margin-top:4px">🌐 Web3 only</div>\`
      : isDataOnly
        ? \`<div style="font-size:.78em;color:#888;margin-top:4px">📊 بيانات فقط</div>\`
      : isConfigured && p.error
        ? \`<div style="font-size:.8em;color:#e67e22;margin-top:4px">❌ تعذر جلب الرصيد</div>\`
      : isConfigured && p.balance != null
        ? \`<div style="font-size:.88em;color:#2ecc71;margin-top:4px">$\${Number(p.balance).toFixed(2)} USDT</div>\`
        : isConfigured
          ? \`<div style="font-size:.8em;color:#888;margin-top:4px">جارٍ جلب الرصيد…</div>\`
          : \`<div style="font-size:.72em;color:#e67e22;margin-top:4px">🔑 غير مُهيأ</div>\`;
    const statusLabel = isWeb3
      ? \`<span style="color:#3498db">✅ Web3</span>\`
      : isDataOnly
        ? \`<span style="color:#888">📊 بيانات فقط</span>\`
      : isConfigured
        ? \`<span style="color:#2ecc71">✅ مُهيأ</span>\`
        : \`<span style="color:#e67e22">⚠️ غير مُهيأ</span>\`;
    const updatedLine = \`<div style="font-size:.72em;color:#888;margin-top:4px">آخر تحديث: \${p._fetchedAt || '—'}</div>\`;
    const safeData = JSON.stringify(p).replace(/'/g,"&#39;");
    return \`<div class="bal-card" style="border:1px solid \${borderColor};cursor:pointer" onclick="showPlatformModal('\${safeData}')">
      <div class="bal-name">\${p.name.toUpperCase()}</div>
      <div style="font-size:.8em">\${statusLabel}</div>
      \${balLine}
      \${updatedLine}
    </div>\`;
  }

  async function loadPlatformsGrid(opts = {}){
    const grid = document.getElementById('platformsGrid');
    if (!grid) return;
    if (_platformsState.inFlight && !opts.force) return;
    _platformsState.inFlight = true;
    try {
      const res  = await callAdminApi('/api/platforms');
      const data = JSON.parse(res.text);
      if (!data || data.success !== true) {
        throw new Error('استجابة غير صالحة من /api/platforms');
      }
      const fetchedAt = new Date().toLocaleTimeString('ar');
      const platforms = Array.isArray(data.platforms) ? data.platforms : [];
      _platformsState.all = platforms.map((p) => ({ ...p, _fetchedAt: fetchedAt }));
      _platformsState.retryCount = 0;
      if (_platformsState.retryTimer) {
        clearTimeout(_platformsState.retryTimer);
        _platformsState.retryTimer = null;
      }
      _setPlatformsUpdatedAtLabel(fetchedAt);
      _setPlatformsStatus('✅ تم تحديث ' + platforms.length + ' منصة', '#2ecc71');
      _renderPlatformsFromState();
    } catch(e) {
      _platformsState.retryCount += 1;
      if (!_platformsState.all.length) {
        grid.innerHTML = \`<span style="color:#e74c3c">❌ \${e.message}</span>\`;
      }
      _setPlatformsStatus('❌ فشل التحديث: ' + e.message, '#e74c3c');
      _schedulePlatformsRetry();
    } finally {
      _platformsState.inFlight = false;
    }
  }
  setInterval(() => loadPlatformsGrid(), PLATFORM_REFRESH_MS);

  // ── Platform detail modal ────────────────────────────────────────────────────
  function showPlatformModal(rawJson){
    let p;
    try { p = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson; } catch(_){ return; }
    const errText = p.error
      ? String(p.error).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
      : '';
    const balText = p.type === 'web3'
      ? '🌐 Web3 — لا رصيد مركزي'
      : p.balance != null
        ? \`$\${Number(p.balance).toFixed(2)} USDT\`
        : '—';
    const missingList = (p.missingKeys||[]).length
      ? \`<ul style="margin:4px 0 0 16px;padding:0;color:#e67e22">\${(p.missingKeys||[]).map(k=>\`<li style="font-size:.82em">\${k}</li>\`).join('')}</ul>\`
      : '<span style="color:#2ecc71;font-size:.82em">لا توجد مفاتيح ناقصة</span>';
    const stratList = (p.strategies||[]).map(s=>\`<span style="background:#12161e;border-radius:4px;padding:2px 6px;font-size:.78em;margin:2px;display:inline-block">\${s}</span>\`).join(' ');
    document.getElementById('platformModalBody').innerHTML = \`
      <h3 style="margin:0 0 14px;color:#f0b90b">\${p.name.toUpperCase()} <span style="font-size:.7em;color:#888">\${p.type}</span></h3>
      <table style="width:100%;border-collapse:collapse;font-size:.88em">
        <tr><td style="color:#888;padding:5px 0;width:140px">وضع التنفيذ</td><td><code>\${p.executionMode}</code></td></tr>
        <tr><td style="color:#888;padding:5px 0">الحالة</td><td>\${p.configured?'<span style="color:#2ecc71">✅ مُهيأ</span>':'<span style="color:#e67e22">⚠️ غير مُهيأ</span>'}</td></tr>
        <tr><td style="color:#888;padding:5px 0">آخر تحديث</td><td>\${p._fetchedAt || '—'}</td></tr>
        <tr><td style="color:#888;padding:5px 0">رصيد USDT</td><td style="color:#2ecc71;font-weight:bold">\${balText}</td></tr>
        \${errText ? \`<tr><td style="color:#888;padding:5px 0">خطأ الرصيد</td><td style="color:#e67e22;font-size:.82em">\${errText}</td></tr>\` : ''}
        <tr><td style="color:#888;padding:5px 0">الاستراتيجيات</td><td>\${stratList||'—'}</td></tr>
        <tr><td style="color:#888;padding:5px 0">مفاتيح ناقصة</td><td>\${missingList}</td></tr>
        <tr><td style="color:#888;padding:5px 0;vertical-align:top">ملاحظات</td><td style="font-size:.82em;color:#ccc">\${p.note||'—'}</td></tr>
      </table>
    \`;
    document.getElementById('platformModal').style.display='flex';
  }
  function closePlatformModal(){
    document.getElementById('platformModal').style.display='none';
  }
  document.addEventListener('click', e=>{
    const modal = document.getElementById('platformModal');
    if (modal && e.target === modal) modal.style.display='none';
  });
  async function loadApiSnapshot(){
    const syncEl=document.getElementById('apiSyncStatus');
    const statusEl=document.getElementById('apiStatusCard');
    const tradesEl=document.getElementById('apiTradesCard');
    const pnlEl=document.getElementById('apiPnlCard');
    const reportEl=document.getElementById('apiReportCard');
    const logsEl=document.getElementById('apiLogsCard');
    try{
      const [statusSettle,tradesSettle,pnlSettle,reportSettle,logsSettle]=await Promise.allSettled([
        callAdminApi('/api/status'),
        callAdminApi('/api/trades?limit=20'),
        callAdminApi('/api/pnl'),
        callAdminApi('/api/report'),
        callAdminApi('/api/logs')
      ]);
      const statusOk = statusSettle.status === 'fulfilled';
      const tradesOk = tradesSettle.status === 'fulfilled';
      const pnlOk    = pnlSettle.status === 'fulfilled';
      const reportOk = reportSettle.status === 'fulfilled';
      const logsOk   = logsSettle.status === 'fulfilled';

      const statusJson = statusOk ? JSON.parse(statusSettle.value.text) : null;
      const tradesJson = tradesOk ? JSON.parse(tradesSettle.value.text) : null;
      const pnlJson    = pnlOk    ? JSON.parse(pnlSettle.value.text)    : null;
      const reportJson = reportOk ? JSON.parse(reportSettle.value.text) : null;
      const logsJson   = logsOk   ? JSON.parse(logsSettle.value.text)   : null;

      if (statusOk && statusJson) {
        const statusColor = statusJson.trading_enabled ? '#2ecc71' : '#e74c3c';
        const statusLabel = statusJson.trading_enabled ? '▶️ مفعّل' : '⏸️ متوقف';
        const modeLabel = statusJson.paper_trading !== false ? 'Paper' : 'Live';
        statusEl.innerHTML = 'الحالة: <strong style="color:' + statusColor + '">' + statusLabel + '</strong><br>الوضع: ' + modeLabel;
      } else {
        statusEl.textContent = 'خطأ';
      }

      const rows = Array.isArray(tradesJson?.data) ? tradesJson.data : [];
      tradesEl.textContent = tradesOk ? (rows.length + ' صفقة (آخر تحديث)') : 'خطأ';
      pnlEl.textContent = pnlOk ? (Object.keys(pnlJson?.data || {}).length + ' استراتيجيات') : 'خطأ';
      reportEl.textContent = reportOk
        ? ('WinRate ' + ((((reportJson?.data || {}).win_rate || 0) * 100).toFixed(1)) + '% | PF ' + ((reportJson?.data || {}).profit_factor ? Number((reportJson?.data || {}).profit_factor).toFixed(2) : '—'))
        : 'خطأ';
      if (logsOk) {
        const archiveCount = Array.isArray(logsJson?.objects) ? logsJson.objects.length : null;
        const adminCount = Array.isArray(logsJson?.data?.admin) ? logsJson.data.admin.length : 0;
        const botCount = Array.isArray(logsJson?.data?.bot) ? logsJson.data.bot.length : 0;
        logsEl.textContent = archiveCount != null ? (archiveCount + ' ملف') : ((adminCount + botCount) + ' حدث');
      } else {
        logsEl.textContent = 'خطأ';
      }

      const okCount = [statusOk, tradesOk, pnlOk, reportOk, logsOk].filter(Boolean).length;
      syncEl.style.color = okCount === 5 ? '#2ecc71' : (okCount > 0 ? '#f0b90b' : '#e74c3c');
      syncEl.textContent = okCount === 5
        ? '✅ الواجهة متصلة بنقاط API الخلفية.'
        : okCount > 0
          ? ('⚠️ مزامنة جزئية: ' + okCount + '/5 APIs متاحة.')
          : '❌ تعذر مزامنة الواجهة مع API.';

      const tbody=document.getElementById('recentTradesBody');
      if(tbody){
        tbody.innerHTML=rows.length?rows.map(t=>{
          const modeCell=t.mode==='live'
            ? '<span style="color:#e74c3c;font-weight:bold">LIVE</span>'
            : '<span style="color:#f0b90b;font-weight:bold">PAPER</span>';
          const parts=(t.strategy||'').split(':');
          const stratType=parts[0]?.toUpperCase()||'—';
          const stratDir=parts[1]||'';
          const pnlColor=Number(t.net_profit_percent)>=0?'#2ecc71':'#e74c3c';
          return \`<tr>
            <td>\${modeCell}</td>
            <td><span style="color:#3498db;font-weight:bold">\${stratType}</span></td>
            <td style="font-size:.85em">\${stratDir}</td>
            <td>$\${Number(t.size_usd).toFixed(2)}</td>
            <td style="color:\${pnlColor}">\${Number(t.net_profit_percent).toFixed(4)}%</td>
            <td style="font-size:.82em">\${_fmtDateTimeAr(t.created_at)}</td>
          </tr>\`;
        }).join(''):'<tr><td colspan="6" style="text-align:center;padding:20px;color:#888">لا توجد صفقات مسجّلة</td></tr>';
      }
    }catch(e){
      syncEl.style.color='#e74c3c';
      syncEl.textContent='❌ تعذر مزامنة الواجهة مع API: '+e.message;
      [statusEl,tradesEl,pnlEl,reportEl,logsEl].forEach(el=>{ if(el) el.textContent='خطأ'; });
    }
  }
  loadApiSnapshot();

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

  function _toDexPair(symbol){
    const normalized = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const quotes = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'DAI', 'TUSD', 'BTC', 'ETH'];
    for (const quote of quotes) {
      if (!normalized.endsWith(quote) || normalized.length <= quote.length) continue;
      const base = normalized.slice(0, -quote.length);
      const mappedQuote = (quote === 'USDT' || quote === 'USDC' || quote === 'FDUSD' || quote === 'BUSD' || quote === 'DAI' || quote === 'TUSD')
        ? 'USD'
        : quote;
      return base + '/' + mappedQuote;
    }
    return null;
  }

  async function loadWalletPairsCatalog(){
    const pairEl = document.getElementById('w3pair');
    if (!pairEl) return;
    try {
      const quotesRaw = String(document.getElementById('scanQuoteAssets')?.value || 'USDT,USDC,BTC,ETH');
      const quotes = encodeURIComponent(quotesRaw);
      const res = await callAdminApi('/api/symbols/catalog?includeMetaMask=true&maxMetaMask=20000&maxScan=500&quotes=' + quotes);
      const payload = JSON.parse(res.text);
      const preferred = Array.isArray(payload?.aggregate?.walletReadableCex) && payload.aggregate.walletReadableCex.length
        ? payload.aggregate.walletReadableCex
        : (Array.isArray(payload?.aggregate?.cexUnion) ? payload.aggregate.cexUnion : []);

      const top = preferred.slice(0, 300)
        .map(_toDexPair)
        .filter(Boolean);

      if (!top.length) return;
      const current = pairEl.value;
      pairEl.innerHTML = top.map((p) => '<option value="' + p + '">' + p + '</option>').join('');
      if (current && top.includes(current)) pairEl.value = current;
    } catch (e) {
      console.warn('[wallet-pairs] catalog load failed:', e.message || e);
    }
  }

  loadWalletPairsCatalog();

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

  // ── AI Analysis ──────────────────────────────────────────────────────────────
  async function runAiAnalysis() {    const el = document.getElementById('aiResult');
    const opportunity = {
      symbol:    document.getElementById('ai_symbol').value.trim(),
      strategy:  document.getElementById('ai_strategy').value,
      direction: document.getElementById('ai_direction').value.trim(),
      buyPrice:  parseFloat(document.getElementById('ai_buyPrice').value) || 0,
      sellPrice: parseFloat(document.getElementById('ai_sellPrice').value) || 0,
      netPct:    parseFloat(document.getElementById('ai_netPct').value)   || 0,
    };
    if (!opportunity.symbol) { alert('❌ أدخل رمز الزوج أولاً'); return; }
    el.style.display = 'block';
    el.style.color = '#888';
    el.textContent = '⏳ جارٍ التحليل...';
    setButtonsBusy(true);
    try {
      const res  = await callAdminApi('/api/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportunity }),
      });
      const data = JSON.parse(res.text);
      el.style.color = '#eee';
      el.innerHTML = \`<strong style="color:#3498db">🤖 \${data.provider === 'github-models' ? 'GitHub Models (GPT-4.1)' : 'Cloudflare Workers AI'}:</strong><br><br>\${(data.analysis || data.error || JSON.stringify(data)).replace(/\\n/g,'<br>')}\`;
    } catch(e) {
      el.style.color = '#e74c3c';
      el.textContent = '❌ ' + e.message;
    } finally { setButtonsBusy(false); }
  }

  // ── Bot Memory & Self-Learning ───────────────────────────────────────────────
  async function runSelfEvaluate() {
    const el = document.getElementById('selfEvalResult');
    el.style.display = 'block'; el.style.color = '#888'; el.textContent = '⏳ جارٍ التقييم الذاتي...';
    setButtonsBusy(true);
    try {
      const res  = await callAdminApi('/api/strategies/self-evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = JSON.parse(res.text);
      el.style.color = '#2ecc71';
      const recs = (data.recommendations || []).join('\\n• ') || 'لا توجد توصيات';
      el.textContent = \`✅ اكتمل التقييم الذاتي\\nالنتيجة: \${data.score ?? '—'} | الحالة: \${data.status || '—'}\\n\\nالتوصيات:\\n• \${recs}\`;
    } catch(e) { el.style.color = '#e74c3c'; el.textContent = '❌ ' + e.message; }
    finally { setButtonsBusy(false); }
  }

  async function loadBotMemory() {
    const panel = document.getElementById('botMemoryPanel');
    const stats = document.getElementById('botMemoryStats');
    const recs  = document.getElementById('botMemoryRecommendations');
    panel.style.display = 'block';
    stats.innerHTML = '<span style="color:#888">⏳ جارٍ تحميل الذاكرة...</span>';
    try {
      const res  = await callAdminApi('/api/memory');
      const data = JSON.parse(res.text);
      const m    = data.memory || {};
      const weights = m.strategyWeights || {};
      const wKeys = Object.keys(weights);
      if (!data.hasData) {
        stats.innerHTML = '<span style="color:#888">لا توجد بيانات ذاكرة بعد — شغّل تقييماً ذاتياً لبدء التعلم.</span>';
        recs.innerHTML = '';
        return;
      }
      stats.innerHTML = wKeys.map(k => \`
        <div class="card">
          <div class="card-label">🎯 \${k}</div>
          <div style="font-size:1.3em;font-weight:bold;color:\${(weights[k]||1) >= 1 ? '#2ecc71' : '#e74c3c'}">\${(weights[k] ?? 1).toFixed(2)}</div>
          <div style="font-size:.75em;color:#888">وزن الاستراتيجية</div>
        </div>
      \`).join('') || '<span style="color:#888">لا توجد أوزان محفوظة بعد</span>';
      const recList = (m.recommendations || []);
      recs.innerHTML = recList.length
        ? '<strong style="color:#f0b90b">📋 آخر التوصيات:</strong><br>' + recList.map(r => '• ' + r).join('<br>')
        : '<span style="color:#888">لا توجد توصيات محفوظة</span>';
    } catch(e) {
      stats.innerHTML = '<span style="color:#e74c3c">❌ ' + e.message + '</span>';
    }
  }

  async function resetBotMemory() {
    if (!confirm('⚠️ هل أنت متأكد من مسح كامل ذاكرة البوت والتعلم المتراكم؟')) return;
    setButtonsBusy(true);
    try {
      await callAdminApi('/api/memory/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      document.getElementById('botMemoryPanel').style.display = 'none';
      document.getElementById('selfEvalResult').style.display = 'none';
      alert('✅ تم مسح الذاكرة');
    } catch(e) { alert('❌ ' + e.message); }
    finally { setButtonsBusy(false); }
  }

  // ── Temporal Workflow ────────────────────────────────────────────────────────
  async function temporalStart() {
    const el = document.getElementById('temporalResult');
    el.style.display = 'block'; el.style.color = '#888'; el.textContent = '⏳ جارٍ التشغيل...';
    setButtonsBusy(true);
    try {
      const res  = await callAdminApi('/api/temporal/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = JSON.parse(res.text);
      el.style.color = '#2ecc71';
      el.textContent = \`✅ تم تشغيل Temporal\\nWorkflow ID: \${data.workflowId || '—'}\`;
    } catch(e) { el.style.color='#e74c3c'; el.textContent='❌ '+e.message; }
    finally { setButtonsBusy(false); }
  }
  async function temporalStop(force) {
    const el = document.getElementById('temporalResult');
    if (force && !confirm('⚠️ إنهاء فوري للجلسة؟')) return;
    el.style.display = 'block'; el.style.color = '#888'; el.textContent = '⏳ جارٍ الإيقاف...';
    setButtonsBusy(true);
    try {
      const res  = await callAdminApi('/api/temporal/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force }) });
      const data = JSON.parse(res.text);
      el.style.color = '#f0b90b';
      el.textContent = \`✅ \${force ? 'تم الإنهاء الفوري' : 'تم الإيقاف الناعم'}\\n\${JSON.stringify(data.result || '', null, 2)}\`;
    } catch(e) { el.style.color='#e74c3c'; el.textContent='❌ '+e.message; }
    finally { setButtonsBusy(false); }
  }
  async function temporalStatus() {
    const el = document.getElementById('temporalResult');
    el.style.display = 'block'; el.style.color = '#888'; el.textContent = '⏳ جارٍ الجلب...';
    try {
      const res  = await callAdminApi('/api/temporal/status');
      const data = JSON.parse(res.text);
      const st   = data.status || {};
      el.style.color = '#eee';
      el.textContent =
        \`📊 الحالة: \${st.trading_enabled ? '▶️ مفعّل' : '⏸️ متوقف'} | وضع: \${st.paper_trading !== false ? 'Paper' : 'Live'}\\n\` +
        \`الدورة: \${st.cycle_count ?? '—'} | آخر مسح: \${st.last_scan_at ? new Date(st.last_scan_at).toLocaleString('ar') : '—'}\\n\` +
        \`Workflow: \${data.description?.workflowId ?? '—'} [\${data.description?.status?.name ?? '—'}]\`;
    } catch(e) { el.style.color='#e74c3c'; el.textContent='❌ '+e.message; }
  }
  async function temporalMode(paper) {
    const el = document.getElementById('temporalResult');
    el.style.display = 'block'; el.style.color = '#888'; el.textContent = '⏳ جارٍ التغيير...';
    setButtonsBusy(true);
    try {
      const res  = await callAdminApi('/api/temporal/mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paper }) });
      const data = JSON.parse(res.text);
      el.style.color = '#2ecc71';
      el.textContent = \`✅ تم التبديل إلى \${data.mode === 'paper' ? 'Paper' : 'Live'}\`;
    } catch(e) { el.style.color='#e74c3c'; el.textContent='❌ '+e.message; }
    finally { setButtonsBusy(false); }
  }

  // ── R2 Log Archives ──────────────────────────────────────────────────────────
  async function loadLogArchives() {
    const panel  = document.getElementById('logsContent');
    const tbody  = document.getElementById('logsTableBody');
    const moreEl = document.getElementById('logsMore');
    panel.style.display = 'block';
    tbody.innerHTML = '<tr><td colspan="4" style="color:#888;text-align:center">جارٍ التحميل…</td></tr>';
    try {
      const res  = await callAdminApi('/api/logs/archives');
      const data = JSON.parse(res.text);
      const objs = data.objects || [];
      if (!objs.length) { tbody.innerHTML = '<tr><td colspan="4" style="color:#888;text-align:center">لا يوجد أرشيف</td></tr>'; return; }
      tbody.innerHTML = objs.map(o => {
        const kb   = (o.size / 1024).toFixed(1);
        const date = _fmtDateTimeAr(o.uploaded);
        const rows = o.customMetadata?.rows ?? '—';
        const key  = o.key || '';
        return \`<tr>
          <td style="font-size:.8em;word-break:break-all">\${key}</td>
          <td>\${kb}</td>
          <td style="font-size:.82em">\${date}</td>
          <td>\${rows}</td>
        </tr>\`;
      }).join('');
      moreEl.textContent = data.truncated ? \`عرض أول 50 ملف — يوجد المزيد\` : \`إجمالي: \${objs.length} ملف\`;
    } catch(e) {
      tbody.innerHTML = \`<tr><td colspan="4" style="color:#e74c3c">❌ \${e.message}</td></tr>\`;
    }
  }
</script>
<!-- ── Platform detail modal ────────────────────────────────────────────────── -->
<div id="platformModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9999;align-items:center;justify-content:center">
  <div style="background:#1a2030;border:1px solid #2a3042;border-radius:12px;padding:28px;max-width:520px;width:90%;position:relative;max-height:85vh;overflow-y:auto">
    <button onclick="closePlatformModal()" style="position:absolute;top:14px;right:14px;background:none;border:none;color:#888;font-size:1.3em;cursor:pointer;line-height:1">✕</button>
    <div id="platformModalBody"></div>
  </div>
</div>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ── Go-Live Checklist ─────────────────────────────────────────────────────────

export async function renderChecklist(env) {
  const state = await env.BOT_STATE.get('trading_state', 'json').catch(() => null) || {};
  const checks = [
    { name: 'MEXC API Key',            ok: !!env.MEXC_API_KEY,          critical: true,  note: 'مطلوب للتداول الحقيقي + MEXC Futures Perps' },
    { name: 'MEXC API Secret',          ok: !!env.MEXC_API_SECRET,       critical: true,  note: 'مطلوب للتداول الحقيقي + MEXC Futures Perps' },
    { name: 'Binance API Key',          ok: !!env.BINANCE_API_KEY,       critical: false, note: 'مطلوب لتنفيذ Binance Spot' },
    { name: 'Binance API Secret',       ok: !!env.BINANCE_API_SECRET,    critical: false, note: 'مطلوب لتنفيذ Binance Spot' },
    { name: 'KuCoin API Key',           ok: !!env.KUCOIN_API_KEY,        critical: false, note: 'مطلوب لتنفيذ KuCoin' },
    // { name: 'OKX API Key (data-only)',  ok: !!env.OKX_API_KEY,           critical: false, note: 'OKX = data-only (BaFin) — لا تنفيذ حي' },
    { name: 'Bitget API Key',           ok: !!env.BITGET_API_KEY,        critical: false, note: 'مطلوب لتنفيذ Bitget' },
    { name: 'Bitget Secret + Passphrase',ok: !!(env.BITGET_SECRET_KEY && env.BITGET_API_PASSPHRASE), critical: false, note: 'مطلوب لتنفيذ Bitget' },
    { name: 'Bitmart API Key',          ok: !!env.BITMART_API_KEY,       critical: false, note: 'مطلوب لتنفيذ Bitmart' },
    { name: 'HTX (Huobi) API Key',      ok: !!env.HTX_API_KEY,           critical: false, note: 'مطلوب لتنفيذ HTX' },
    { name: 'MetaMask / Web3 Wallet',    ok: true,                        critical: false, note: 'جاهز على مستوى الواجهة — التنفيذ اللامركزي ما زال يحتاج مسار on-chain مستقل' },
    { name: 'ADMIN_TOKEN',              ok: !!env.ADMIN_TOKEN,            critical: true,  note: 'لحماية نقاط التحكم' },
    { name: 'Telegram Bot Token',       ok: !!env.TELEGRAM_BOT_TOKEN,    critical: false, note: 'للإشعارات' },
    { name: 'Telegram Chat ID',         ok: !!env.TELEGRAM_CHAT_ID,      critical: false, note: 'معرف المستخدم' },
    { name: 'Alchemy API Key',          ok: !!env.ALCHEMY_API_KEY,       critical: false, note: 'اختياري: يحسّن دقة مسح DEX (يوجد fallback عام بدون مفتاح)' },
    { name: 'Perps — MEXC Futures',     ok: !!(env.MEXC_API_KEY && env.MEXC_API_SECRET), critical: true,  note: 'تنفيذ MEXC Futures للعقود الدائمة' },
    { name: 'Perps — Binance USDM Feed',ok: true,                        critical: false, note: 'بيانات أسعار Binance Futures (مجاني، لا مفتاح مطلوب)' },
    // { name: 'Perps — OKX Swap Feed',    ok: true,                        critical: false, note: 'بيانات أسعار OKX Perpetuals (مجاني، لا مفتاح مطلوب)' },
    { name: 'وضع Live مفعّل',           ok: state.paper_trading === false, critical: true, note: 'التداول الحقيقي' },
    { name: 'حد الخسارة اليومية',       ok: !!(state.max_daily_loss_usd), critical: true, note: `الحالي: $${state.max_daily_loss_usd ?? 25}` },
    { name: 'حد الحجم اليومي',          ok: !!(state.daily_limit_usd),    critical: true, note: `الحالي: $${state.daily_limit_usd ?? 500}` },
    { name: 'التداول مفعّل',            ok: state.trading_enabled !== false, critical: false, note: 'يجب التشغيل قبل المسح' },
    { name: 'لا إيقاف تلقائي نشط',     ok: !state.auto_stopped,         critical: false, note: state.auto_stop_reason || '' }
  ];
  const criticalOk = checks.filter(c => c.critical).every(c => c.ok);
  const optionalOk = checks.filter(c => !c.critical).every(c => c.ok);
  const color      = criticalOk ? (optionalOk ? '#2ecc71' : '#f0b90b') : '#e74c3c';
  const label      = criticalOk
    ? (optionalOk ? '✅ جاهز للتداول الحقيقي' : '⚠️ جاهز للتداول الحقيقي — بعض العناصر الاختيارية غير مكتملة')
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
