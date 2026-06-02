export function renderControlPanel() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Nexus Control Panel</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: linear-gradient(180deg, #0b0e14 0%, #131926 100%);
      color: #eee;
      font-family: "Segoe UI", Tahoma, sans-serif;
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 1500px; margin: 0 auto; }
    header {
      text-align: center;
      margin-bottom: 24px;
      border-bottom: 2px solid #f0b90b;
      padding-bottom: 14px;
    }
    h1 { color: #f0b90b; font-size: 2em; }
    header p { color: #aaa; font-size: 0.9em; margin-top: 4px; }
    .token-bar {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: flex-end;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .token-bar label { color: #aaa; font-size: 0.82em; white-space: nowrap; }
    .token-bar input {
      background: #1a1e26;
      color: #eee;
      border: 1px solid #3a3e48;
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 0.85em;
      width: 240px;
    }
    .token-bar input:focus { border-color: #f0b90b; outline: none; }
    .section-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: 18px;
      margin-bottom: 24px;
    }
    .card {
      background: rgba(26, 30, 38, 0.95);
      border-radius: 12px;
      padding: 18px;
      border-left: 4px solid #f0b90b;
      box-shadow: 0 2px 18px rgba(0, 0, 0, 0.35);
    }
    .card.card-wide { grid-column: 1 / -1; }
    .card h2 {
      color: #f0b90b;
      font-size: 1em;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .status-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .status-ok    { background: #27ae60; }
    .status-warn  { background: #f39c12; animation: pulse 1.2s infinite; }
    .status-error { background: #e74c3c; animation: pulse 0.6s infinite; }
    .status-idle  { background: #555; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
    .stat-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 7px 0;
      border-bottom: 1px solid #2a2e38;
      font-size: 0.88em;
      gap: 10px;
    }
    .stat-row:last-of-type { border-bottom: none; }
    .stat-label { color: #999; }
    .stat-value { color: #f0b90b; font-weight: bold; text-align: right; max-width: 60%; word-break: break-word; }
    .stat-value.ok    { color: #27ae60; }
    .stat-value.warn  { color: #f39c12; }
    .stat-value.error { color: #e74c3c; }
    .button-group { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    button {
      background: #f0b90b;
      color: #000;
      border: none;
      padding: 7px 14px;
      border-radius: 6px;
      font-weight: bold;
      cursor: pointer;
      font-size: 0.82em;
      transition: opacity 0.15s;
    }
    button:hover { opacity: 0.82; }
    button.danger { background: #e74c3c; color: #fff; }
    button.success { background: #27ae60; color: #fff; }
    button.secondary { background: #2d3748; color: #eee; }
    button:disabled { opacity: 0.4; cursor: not-allowed; }
    .endpoint-list { list-style: none; }
    .endpoint-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 0;
      border-bottom: 1px solid #2a2e38;
      font-size: 0.83em;
    }
    .endpoint-item:last-child { border-bottom: none; }
    .endpoint-name { flex: 1; color: #ccc; font-family: monospace; }
    .ep-dot { width: 8px; height: 8px; border-radius: 50%; background: #555; flex-shrink: 0; }
    .balance-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 10px;
      margin-top: 8px;
    }
    .balance-chip {
      background: #12161e;
      border-radius: 8px;
      padding: 10px;
      text-align: center;
      border: 1px solid #2a2e38;
    }
    .balance-chip.live { border-color: #245f3f; }
    .balance-chip.warning { border-color: #6b4a1a; }
    .balance-chip.error { border-color: #6b2626; }
    .balance-chip.dataonly { border-color: #3c3c3c; }
    .balance-chip .ex-name { font-size: 0.78em; text-transform: uppercase; color: #aaa; letter-spacing: 0.05em; }
    .balance-chip .ex-balance { font-size: 1.2em; font-weight: bold; color: #f0b90b; margin-top: 4px; }
    .balance-chip .ex-status { font-size: 0.72em; margin-top: 3px; }
    .balance-chip.unconfigured { opacity: 0.5; }
    .msg-area { margin-top: 16px; }
    .toast {
      padding: 10px 14px; border-radius: 6px; margin-bottom: 8px;
      font-size: 0.85em; animation: slideIn 0.2s ease;
    }
    @keyframes slideIn { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
    .toast.info    { background: #2d3748; color: #eee; }
    .toast.success { background: #1a3a28; color: #27ae60; border: 1px solid #27ae60; }
    .toast.warn    { background: #3a2a10; color: #f39c12; border: 1px solid #f39c12; }
    .toast.error   { background: #3a1a1a; color: #e74c3c; border: 1px solid #e74c3c; }
    table { width: 100%; border-collapse: collapse; font-size: 0.83em; }
    th { color: #f0b90b; padding: 6px 8px; border-bottom: 1px solid #2a2e38; text-align: left; font-size: 0.85em; }
    td { padding: 6px 8px; border-bottom: 1px solid #181c24; }
    tr:last-child td { border-bottom: none; }
    .pos { color: #27ae60; font-weight: bold; }
    .neg { color: #e74c3c; font-weight: bold; }
    .spin { animation: spin 1s linear infinite; display: inline-block; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
<div class="container">
  <header>
    <h1>&#9671; Nexus Control Panel</h1>
    <p>Live operator view &mdash; exchange balances, execution health, trading controls</p>
  </header>

  <div class="token-bar">
    <label for="tokenInput">Admin Token:</label>
    <input type="password" id="tokenInput" placeholder="Enter x-admin-token..." autocomplete="off">
    <button onclick="saveToken()" class="secondary">Save Token</button>
    <button onclick="refreshAll()" class="success">&#8635; Refresh All</button>
    <button onclick="location.href='/dashboard'" class="secondary">Dashboard</button>
  </div>

  <div class="section-grid">
    <div class="card">
      <h2>&#9654; Trading Controls <span class="status-dot status-idle" id="trading-dot"></span></h2>
      <div class="stat-row"><span class="stat-label">Trading Status</span><span class="stat-value" id="ctrl-enabled">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">Mode</span><span class="stat-value" id="ctrl-mode">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">Total Profit</span><span class="stat-value" id="ctrl-profit">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">Today P&amp;L</span><span class="stat-value" id="ctrl-today">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">Total Trades</span><span class="stat-value" id="ctrl-trades">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">Portfolio Equity</span><span class="stat-value" id="ctrl-capital">Loading...</span></div>
      <div class="button-group">
        <button onclick="startTrading()" class="success" id="btn-start">&#9654; Start</button>
        <button onclick="stopTrading()" class="danger" id="btn-stop">&#9646;&#9646; Stop</button>
        <button onclick="enablePaperMode()">Paper Mode</button>
        <button onclick="enableLiveMode()" class="danger">Live Mode</button>
        <button onclick="triggerScan()" class="secondary">&#8645; Scan Now</button>
      </div>
    </div>

    <div class="card">
      <h2>&#9888; System Readiness <span class="status-dot status-idle" id="readiness-dot"></span></h2>
      <div class="stat-row"><span class="stat-label">Live Ready</span><span class="stat-value" id="ready-live">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">Admin Token</span><span class="stat-value" id="ready-admin">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">Telegram</span><span class="stat-value" id="ready-telegram">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">Exchanges Configured</span><span class="stat-value" id="ready-exchanges">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">Auth Validated</span><span class="stat-value" id="ready-auth">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">BitMart CB</span><span class="stat-value" id="ready-cb">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">Note</span><span class="stat-value" id="ready-note" style="font-size:0.78em">---</span></div>
      <div class="button-group">
        <button onclick="checkReadiness()">&#8635; Check</button>
        <button onclick="sendTestAlert()" class="secondary">&#9993; Test Alert</button>
      </div>
    </div>

    <div class="card">
      <h2>&#10004; Execution Health <span class="status-dot status-idle" id="exec-dot"></span></h2>
      <div class="stat-row"><span class="stat-label">Execution Mode</span><span class="stat-value" id="exec-mode">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">Active Strategies</span><span class="stat-value" id="exec-strategies">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">Portfolio Balance</span><span class="stat-value" id="exec-balance">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">Open Positions</span><span class="stat-value" id="exec-positions">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">Max Positions</span><span class="stat-value" id="exec-max-pos">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">Cooldown</span><span class="stat-value" id="exec-cooldown">Loading...</span></div>
      <div id="exec-blocked" style="display:none;margin-top:8px;padding:8px;background:#3a1a1a;border-radius:6px;font-size:0.8em;color:#e74c3c"></div>
      <div class="button-group">
        <button onclick="checkExecutionHealth()">&#8635; Refresh</button>
      </div>
    </div>
  </div>

  <div class="section-grid">
    <div class="card card-wide">
      <h2>&#36; Exchange Balances (USDT) <span class="status-dot status-idle" id="balances-dot"></span></h2>
      <div class="stat-row"><span class="stat-label">Assets</span><span class="stat-value" id="balances-assets-label">USDT</span></div>
      <div class="balance-grid" id="balances-grid">
        <div class="balance-chip"><div class="ex-name">Loading</div><div class="ex-balance"><span class="spin">&#8635;</span></div></div>
      </div>
      <div class="button-group">
        <input id="balanceAssetsInput" type="text" placeholder="USDT,USDC,BTC,ETH" style="background:#1a1e26;color:#eee;border:1px solid #3a3e48;border-radius:6px;padding:7px 10px;font-size:.8em;min-width:220px">
        <button onclick="applyBalanceAssetsFilter()" class="secondary">Apply Assets</button>
        <button onclick="setBalanceAssetPreset('core')" class="secondary">Core</button>
        <button onclick="setBalanceAssetPreset('majors')" class="secondary">All Majors</button>
        <button onclick="loadBalances(false)">&#8635; Refresh Balances</button>
        <button onclick="loadBalances(true)" class="secondary">Force Fresh (bypass cache)</button>
      </div>
    </div>

    <div class="card">
      <h2>&#8646; Liquidity Rebalancer <span class="status-dot status-idle" id="rebalance-dot"></span></h2>
      <div class="stat-row"><span class="stat-label">Enabled</span><span class="stat-value" id="rb-enabled">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">Target / Exchange</span><span class="stat-value" id="rb-target">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">Estimated Shift</span><span class="stat-value" id="rb-shift">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">Transfer Suggestions</span><span class="stat-value" id="rb-transfers">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">Routing Weights</span><span class="stat-value" id="rb-weights" style="font-size:0.78em">---</span></div>
      <div id="rb-plan" style="margin-top:8px;padding:8px;background:#1a2634;border-radius:6px;font-size:0.78em;color:#9ec4e8">No plan yet</div>
      <div class="button-group">
        <button onclick="loadRebalanceStatus()">&#8635; Refresh Plan</button>
        <button onclick="toggleRebalance()" class="secondary">Enable/Disable</button>
      </div>
    </div>
  </div>

  <div class="section-grid">
    <div class="card">
      <h2>&#9889; BitMart Exchange <span class="status-dot status-idle" id="bitmart-dot"></span></h2>
      <div class="stat-row"><span class="stat-label">Circuit Breaker</span><span class="stat-value" id="bm-circuit">Unknown</span></div>
      <div class="stat-row"><span class="stat-label">CB Failures</span><span class="stat-value" id="bm-failures">Unknown</span></div>
      <div class="stat-row"><span class="stat-label">Rate Limit</span><span class="stat-value" id="bm-ratelimit">Unknown</span></div>
      <div class="stat-row"><span class="stat-label">External Proxy</span><span class="stat-value" id="bm-proxy">Unknown</span></div>
      <div class="button-group">
        <button onclick="checkBitmartStatus()">Check Status</button>
        <button onclick="resetBitmartCB()" class="danger">Reset CB</button>
      </div>
    </div>

    <div class="card">
      <h2>&#9782; Proxy Configuration <span class="status-dot status-idle" id="proxy-dot"></span></h2>
      <div class="stat-row"><span class="stat-label">Proxy Mode</span><span class="stat-value" id="proxy-mode">Unknown</span></div>
      <div class="stat-row"><span class="stat-label">Available Proxies</span><span class="stat-value" id="proxy-available">Unknown</span></div>
      <div class="stat-row"><span class="stat-label">External Provider</span><span class="stat-value" id="proxy-provider">Unknown</span></div>
      <div class="stat-row"><span class="stat-label">External Healthy</span><span class="stat-value" id="proxy-healthy">Unknown</span></div>
      <div class="button-group">
        <button onclick="checkProxyStats()">&#8635; Refresh</button>
      </div>
    </div>

    <div class="card">
      <h2>&#128737; Spot Lock Guard <span class="status-dot status-idle" id="safety-dot"></span></h2>
      <div class="stat-row"><span class="stat-label">Spot Lock</span><span class="stat-value" id="safe-lock">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">Execution Mode</span><span class="stat-value" id="safe-mode">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">Perps Flag</span><span class="stat-value" id="safe-perps">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">Funding Flag</span><span class="stat-value" id="safe-funding">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">Ready For Live</span><span class="stat-value" id="safe-ready">Loading...</span></div>
      <div class="stat-row"><span class="stat-label">Last Config Change</span><span class="stat-value" id="safe-config-ts" style="font-size:0.78em">---</span></div>
      <div class="stat-row"><span class="stat-label">Guard Interventions (Hour)</span><span class="stat-value" id="safe-guard-count">---</span></div>
      <div class="stat-row"><span class="stat-label">Last Intervention</span><span class="stat-value" id="safe-guard-last" style="font-size:0.78em">---</span></div>
      <div class="stat-row"><span class="stat-label">Last Flag Transition</span><span class="stat-value" id="safe-guard-transition" style="font-size:0.72em;max-width:68%">---</span></div>
      <div class="button-group">
        <button onclick="loadSafetyState()">&#8635; Refresh</button>
        <button onclick="enableSpotLock()" class="success">Enable Spot Lock</button>
        <button onclick="disableSpotLock()" class="danger">Disable Spot Lock</button>
        <button onclick="disablePerpsExplicit()" class="secondary">Disable Perps</button>
        <button onclick="enablePerpsExplicit()" class="secondary">Enable Perps</button>
      </div>
    </div>

    <div class="card">
      <h2>&#9881; API Endpoints <span class="status-dot status-idle" id="api-dot"></span></h2>
      <ul class="endpoint-list" id="endpoint-list">
        <li class="endpoint-item"><span class="endpoint-name">Click Refresh to check...</span></li>
      </ul>
      <div class="button-group">
        <button onclick="checkAllEndpoints()">&#8635; Check All</button>
      </div>
    </div>
  </div>

  <div class="section-grid">
    <div class="card">
      <h2>&#9654; Recent Trades <span class="status-dot status-idle" id="trades-dot"></span></h2>
      <div id="trades-wrap" style="overflow-x:auto">
        <div style="color:#555;font-size:0.85em">Click Load to fetch</div>
      </div>
      <div class="button-group">
        <button onclick="loadTrades()">&#8635; Load Trades</button>
      </div>
    </div>

    <div class="card">
      <h2>&#128200; Performance Report <span class="status-dot status-idle" id="report-dot"></span></h2>
      <div class="stat-row"><span class="stat-label">Total Trades (DB)</span><span class="stat-value" id="rpt-trades">---</span></div>
      <div class="stat-row"><span class="stat-label">Win Rate</span><span class="stat-value" id="rpt-winrate">---</span></div>
      <div class="stat-row"><span class="stat-label">Total P&amp;L</span><span class="stat-value" id="rpt-pnl">---</span></div>
      <div class="stat-row"><span class="stat-label">Best Trade</span><span class="stat-value" id="rpt-best">---</span></div>
      <div class="stat-row"><span class="stat-label">Worst Trade</span><span class="stat-value" id="rpt-worst">---</span></div>
      <div class="stat-row"><span class="stat-label">Avg Trade P&amp;L</span><span class="stat-value" id="rpt-avg">---</span></div>
      <div class="button-group">
        <button onclick="loadReport()">&#8635; Load Report</button>
      </div>
    </div>
  </div>

  <div id="messages" class="msg-area"></div>
</div>

<script>
  var ADMIN_TOKEN = localStorage.getItem('nexus_admin_token') || '';

  (function initToken() {
    if (ADMIN_TOKEN) document.getElementById('tokenInput').value = ADMIN_TOKEN;
  })();

  function saveToken() {
    var v = document.getElementById('tokenInput').value.trim();
    if (v) {
      ADMIN_TOKEN = v;
      localStorage.setItem('nexus_admin_token', v);
      showToast('Token saved', 'success');
      refreshAll();
    } else {
      showToast('Enter a token first', 'warn');
    }
  }

  function makeHeaders(extra) {
    var h = new Headers(extra || {});
    if (ADMIN_TOKEN) h.set('x-admin-token', ADMIN_TOKEN);
    return h;
  }

  async function api(path, opts) {
    opts = opts || {};
    try {
      var resp = await fetch(path, {
        credentials: 'same-origin',
        method: opts.method || 'GET',
        body: opts.body || undefined,
        headers: makeHeaders(opts.headers || {}),
      });
      var text = await resp.text();
      var data = null;
      try { data = JSON.parse(text); } catch (_) {}
      return { ok: resp.ok, status: resp.status, text: text, data: data };
    } catch (e) {
      return { ok: false, status: 0, text: e.message, data: null };
    }
  }

  function showToast(msg, type) {
    var el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    el.textContent = msg;
    document.getElementById('messages').prepend(el);
    setTimeout(function() { el.remove(); }, 5000);
  }

  function errMsg(r) {
    return (r.data && (r.data.error || r.data.hint)) || r.text || ('HTTP ' + r.status);
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escAttr(s) {
    return escHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function usd(n) { return '$' + Number(n || 0).toFixed(2); }
  function pct(n)  { return (n >= 0 ? '+' : '') + Number(n || 0).toFixed(4) + '%'; }
  function fmtTs(ts) {
    var n = Number(ts || 0);
    if (!n) return '---';
    var d = new Date(n);
    if (isNaN(d.getTime())) return '---';
    return d.toISOString().replace('T', ' ').replace('Z', ' UTC');
  }

  function setDot(id, cls) {
    var el = document.getElementById(id);
    if (el) el.className = 'status-dot ' + cls;
  }

  function setText(id, txt, cls) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = txt;
    if (cls) el.className = 'stat-value ' + cls;
  }

  function getSelectedBalanceAssets() {
    var raw = (localStorage.getItem('nexus_balance_assets') || 'USDT,USDC,BTC,ETH,BNB,SOL,XRP,ADA,DOGE,TRX,LTC,AVAX,DOT,LINK,MATIC').trim();
    var parsed = raw.split(',')
      .map(function(v) { return String(v || '').trim().toUpperCase(); })
      .filter(Boolean)
      .slice(0, 40);
    if (!parsed.length) parsed = ['USDT'];
    return parsed;
  }

  var BALANCE_ASSET_PRESETS = {
    core: 'USDT,USDC,BTC,ETH',
    majors: 'USDT,USDC,BTC,ETH,BNB,SOL,XRP,ADA,DOGE,TRX,LTC,AVAX,DOT,LINK,MATIC,BCH,ETC,ATOM,UNI,NEAR,FIL,APT,ARB,OP,SUI,PEPE,SHIB'
  };

  function syncBalanceAssetsUi() {
    var assets = getSelectedBalanceAssets();
    var input = document.getElementById('balanceAssetsInput');
    if (input) input.value = assets.join(',');
    var label = document.getElementById('balances-assets-label');
    if (label) label.textContent = assets.join(', ');
  }

  function applyBalanceAssetsFilter() {
    var input = document.getElementById('balanceAssetsInput');
    if (!input) return;
    var val = String(input.value || '').trim();
    localStorage.setItem('nexus_balance_assets', val || 'USDT');
    syncBalanceAssetsUi();
    loadBalances(true);
  }

  function setBalanceAssetPreset(kind) {
    var next = BALANCE_ASSET_PRESETS[kind];
    if (!next) return;
    localStorage.setItem('nexus_balance_assets', next);
    syncBalanceAssetsUi();
    loadBalances(true);
  }

  async function loadStatus() {
    var r = await api('/api/status');
    if (!r.ok) { setDot('trading-dot', 'status-error'); return; }
    var d = r.data || {};
    var on = !!d.trading_enabled;
    var paper = d.paper_trading !== false;
    setText('ctrl-enabled', on ? 'ENABLED' : 'DISABLED', on ? 'ok' : 'error');
    setText('ctrl-mode', paper ? 'Paper Trading' : 'LIVE Trading', paper ? 'warn' : 'error');
    setText('ctrl-profit', usd(d.totalProfit), (d.totalProfit || 0) >= 0 ? 'ok' : 'error');
    setText('ctrl-today',  usd(d.todayProfit),  (d.todayProfit  || 0) >= 0 ? 'ok' : 'warn');
    setText('ctrl-trades', String(d.totalTrades || 0));
    setText('ctrl-capital', usd(d.capital));
    setDot('trading-dot', on ? (paper ? 'status-warn' : 'status-ok') : 'status-error');
  }

  async function startTrading() {
    document.getElementById('btn-start').disabled = true;
    var r = await api('/start');
    document.getElementById('btn-start').disabled = false;
    showToast(r.ok ? (r.text || 'Started') : errMsg(r), r.ok ? 'success' : 'error');
    if (r.ok) loadStatus();
  }

  async function stopTrading() {
    document.getElementById('btn-stop').disabled = true;
    var r = await api('/stop');
    document.getElementById('btn-stop').disabled = false;
    showToast(r.ok ? (r.text || 'Stopped') : errMsg(r), r.ok ? 'success' : 'error');
    if (r.ok) loadStatus();
  }

  async function enablePaperMode() {
    var r = await api('/mode/paper', { method: 'POST' });
    showToast(r.ok ? (r.text || 'Paper mode enabled') : errMsg(r), r.ok ? 'success' : 'error');
    if (r.ok) loadStatus();
  }

  async function enableLiveMode() {
    if (!confirm('Switch to LIVE trading? Real money will be used.')) return;
    var r = await api('/mode/live', { method: 'POST' });
    showToast(r.ok ? (r.text || 'Live mode enabled') : errMsg(r), r.ok ? 'success' : 'error');
    if (r.ok) loadStatus();
  }

  async function triggerScan() {
    showToast('Triggering scan...', 'info');
    var r = await api('/scan');
    showToast(r.ok ? (r.text || 'Scan complete') : errMsg(r), r.ok ? 'success' : 'warn');
  }

  async function checkReadiness() {
    setDot('readiness-dot', 'status-warn');
    var r = await api('/api/readiness');
    if (!r.ok) { setDot('readiness-dot', 'status-error'); showToast('Readiness error: ' + errMsg(r), 'error'); return; }
    var d = r.data || {};
    var ch = d.checks || {};
    var ready = !!d.readyForLive;
    setDot('readiness-dot', ready ? 'status-ok' : 'status-error');
    setText('ready-live',      ready ? 'YES - LIVE READY' : 'NOT READY',  ready ? 'ok' : 'error');
    setText('ready-admin',     ch.adminTokenSet      ? 'Set'           : 'Missing',        ch.adminTokenSet      ? 'ok' : 'error');
    setText('ready-telegram',  ch.telegramConfigured ? 'Configured'    : 'Not configured', ch.telegramConfigured ? 'ok' : 'warn');
    setText('ready-exchanges', String(ch.configuredExchangeCount || 0) + ' configured');
    setText('ready-auth',
      String(ch.authValidatedExchangeCount || 0) + ' ok, ' + String(ch.exchangeAuthFailures || 0) + ' failed',
      (ch.exchangeAuthFailures || 0) > 0 ? 'error' : 'ok');
    var cb = ch.bitmartCircuitBreaker || {};
    setText('ready-cb', cb.state || 'Unknown', cb.state === 'OPEN' ? 'error' : 'ok');
    setText('ready-note', d.note || '---');
  }

  async function sendTestAlert() {
    var r = await api('/api/alerts/test', {
      method: 'POST',
      body: JSON.stringify({ message: 'Test alert from Nexus Control Panel' }),
      headers: { 'Content-Type': 'application/json' },
    });
    showToast(r.ok ? 'Alert sent!' : ('Alert failed: ' + errMsg(r)), r.ok ? 'success' : 'error');
  }

  async function checkExecutionHealth() {
    setDot('exec-dot', 'status-warn');
    var r = await api('/api/execution-health');
    if (!r.ok) { setDot('exec-dot', 'status-error'); showToast('Exec health error: ' + errMsg(r), 'error'); return; }
    var d = r.data || {};
    var paper = !!d.paperMode;
    var isBlocked = d.executionMode === 'blocked';
    var perpsDisabled = d.perpsEnabled === false;
    var strategies = Array.isArray(d.strategies) ? d.strategies : [];
    var activeStrategiesCount = perpsDisabled
      ? strategies.filter(function(s) { return String(s || '').toLowerCase() !== 'perps'; }).length
      : strategies.length;
    setText('exec-mode',      d.executionMode || (paper ? 'Paper' : 'Live'), d.executionMode === 'blocked' ? 'error' : (paper ? 'warn' : 'ok'));
    setText('exec-strategies', String(activeStrategiesCount) + (perpsDisabled ? ' (perps off)' : ''));
    setText('exec-balance',   usd(d.portfolioBalance));
    setText('exec-positions', String(d.openPositions || 0));
    setText('exec-max-pos',   String(d.maxPositions || d.maxOpenPositions || 0));
    setText('exec-cooldown',  String(d.strategyCooldownMs || 0) + ' ms');
    setDot('exec-dot', isBlocked ? 'status-error' : (paper ? 'status-warn' : 'status-ok'));
    var bl = document.getElementById('exec-blocked');
    if (Array.isArray(d.blockedReasons) && d.blockedReasons.length > 0) {
      bl.style.display = 'block';
      bl.style.background = isBlocked ? '#3a1a1a' : '#3a2a10';
      bl.style.color = isBlocked ? '#e74c3c' : '#f39c12';
      bl.textContent = (isBlocked ? 'Blocked: ' : 'Warning: ') + d.blockedReasons.join(' | ');
    } else if (perpsDisabled) {
      bl.style.display = 'block';
      bl.style.background = '#10263a';
      bl.style.color = '#6cb6ff';
      bl.textContent = 'Info: Perps strategy is disabled. Execution is running in spot-only mode.';
    } else {
      bl.style.display = 'none';
    }
  }

  async function loadSafetyState() {
    setDot('safety-dot', 'status-warn');
    var r = await api('/api/safety-state');
    if (!r.ok) {
      setDot('safety-dot', 'status-error');
      showToast('Safety state error: ' + errMsg(r), 'error');
      return;
    }
    var d = r.data || {};
    var flags = d.strategyFlags || {};
    var guard = d.coreStrategyGuard || {};
    var lockOn = d.spotOnlyLock === true;
    var perpsEnabled = flags.perps !== false;
    var fundingEnabled = flags.funding !== false;
    var prev = guard.previousFlags || null;
    var next = guard.nextFlags || null;

    function compactFlags(x) {
      if (!x || typeof x !== 'object') return '---';
      return 'cex=' + (x.cex === true ? '1' : '0') +
        ',dex=' + (x.dex === true ? '1' : '0') +
        ',tri=' + (x.triangular === true ? '1' : '0') +
        ',stat=' + (x.statistical === true ? '1' : '0') +
        ',perps=' + (x.perps === true ? '1' : '0') +
        ',fund=' + (x.funding === true ? '1' : '0');
    }

    setText('safe-lock', lockOn ? 'ENABLED' : 'DISABLED', lockOn ? 'ok' : 'warn');
    setText('safe-mode', String(d.executionMode || 'unknown'), d.executionMode === 'blocked' ? 'error' : 'ok');
    setText('safe-perps', perpsEnabled ? 'ON' : 'OFF', perpsEnabled ? 'warn' : 'ok');
    setText('safe-funding', fundingEnabled ? 'ON' : 'OFF', fundingEnabled ? 'warn' : 'ok');
    setText('safe-ready', d.readyForLive ? 'YES' : 'NO', d.readyForLive ? 'ok' : 'warn');
    setText('safe-config-ts', fmtTs(d.lastConfigChangeTs));
    setText('safe-guard-count', String(Number(guard.countThisHour || 0)), Number(guard.countThisHour || 0) > 0 ? 'warn' : 'ok');
    setText('safe-guard-last', fmtTs(guard.lastInterventionTs));
    setText('safe-guard-transition', compactFlags(prev) + ' -> ' + compactFlags(next));

    if (lockOn && (perpsEnabled || fundingEnabled)) {
      setDot('safety-dot', 'status-error');
    } else if (d.executionMode === 'blocked') {
      setDot('safety-dot', 'status-error');
    } else {
      setDot('safety-dot', lockOn ? 'status-ok' : 'status-warn');
    }
  }

  async function enableSpotLock() {
    var r = await api('/strategy/spot-lock/enable', { method: 'POST' });
    showToast(r.ok ? 'Spot-only lock enabled' : errMsg(r), r.ok ? 'success' : 'error');
    if (r.ok) {
      await Promise.all([loadSafetyState(), checkExecutionHealth(), loadStatus()]);
    }
  }

  async function disableSpotLock() {
    if (!confirm('Disable spot-only lock? This allows perps/funding to be enabled again.')) return;
    var r = await api('/strategy/spot-lock/disable', { method: 'POST' });
    showToast(r.ok ? 'Spot-only lock disabled' : errMsg(r), r.ok ? 'warn' : 'error');
    if (r.ok) {
      await Promise.all([loadSafetyState(), checkExecutionHealth(), loadStatus()]);
    }
  }

  async function disablePerpsExplicit() {
    var r = await api('/strategy/perps/disable', { method: 'POST' });
    showToast(r.ok ? 'Perps disabled' : errMsg(r), r.ok ? 'success' : 'error');
    if (r.ok) {
      await Promise.all([loadSafetyState(), checkExecutionHealth(), loadStatus()]);
    }
  }

  async function enablePerpsExplicit() {
    if (!confirm('Enable perps via explicit admin action? This also unlocks spot-only lock.')) return;
    var r = await api('/strategy/perps/enable', { method: 'POST' });
    showToast(r.ok ? 'Perps enabled' : errMsg(r), r.ok ? 'warn' : 'error');
    if (r.ok) {
      await Promise.all([loadSafetyState(), checkExecutionHealth(), loadStatus()]);
    }
  }

  async function loadBalances(fresh) {
    setDot('balances-dot', 'status-warn');
    var assets = getSelectedBalanceAssets();
    var params = new URLSearchParams();
    params.set('assets', assets.join(','));
    if (fresh) params.set('fresh', '1');
    var path = '/api/balances?' + params.toString();
    var r = await api(path);
    if (!r.ok) {
      setDot('balances-dot', 'status-error');
      document.getElementById('balances-grid').innerHTML = '<div style="color:#e74c3c;font-size:0.85em">' + errMsg(r) + '</div>';
      return;
    }
    var items = (r.data && r.data.data) || [];
    var grid = document.getElementById('balances-grid');
    if (!items.length) {
      grid.innerHTML = '<div style="color:#555;font-size:0.85em">No exchange data available</div>';
      setDot('balances-dot', 'status-warn');
      return;
    }
    var html = '';
    var hasLive = false;
    for (var i = 0; i < items.length; i++) {
      var ex = items[i];
      var balances = ex.balances || {};
      var assetsHtml = assets.map(function(asset) {
        var v = Number(balances[asset] || 0);
        return '<div style="font-size:.72em;color:#aaa">' + asset + ': <span style="color:#f0b90b">' + v.toFixed(4) + '</span></div>';
      }).join('');
      if (!ex.configured && !ex.dataOnly) {
        html += '<div class="balance-chip unconfigured"><div class="ex-name">' + ex.exchange.toUpperCase() + '</div>' +
          '<div class="ex-balance" style="color:#555">---</div>' +
          '<div class="ex-status" style="color:#555">Not configured</div></div>';
      } else if (ex.dataOnly) {
        html += '<div class="balance-chip unconfigured dataonly"><div class="ex-name">' + ex.exchange.toUpperCase() + '</div>' +
          '<div class="ex-balance" style="color:#555">Data only</div>' +
          '<div class="ex-status" style="color:#555">' + escHtml(ex.note || '') + '</div></div>';
      } else if (ex.warning) {
        html += '<div class="balance-chip warning" title="' + escAttr(ex.warning) + '"><div class="ex-name">' + ex.exchange.toUpperCase() + '</div>' +
          '<div class="ex-balance" style="color:#f39c12;font-size:0.72em">' + escHtml(ex.warning.slice(0, 60)) + '</div>' +
          '<div class="ex-status" style="color:#f39c12">Warning</div></div>';
      } else if (ex.error) {
        html += '<div class="balance-chip error" title="' + escAttr(ex.error) + '"><div class="ex-name">' + ex.exchange.toUpperCase() + '</div>' +
          '<div class="ex-balance" style="color:#e74c3c;font-size:0.72em">' + escHtml(ex.error.slice(0, 40)) + '</div>' +
          '<div class="ex-status" style="color:#e74c3c">Error</div></div>';
      } else {
        hasLive = true;
        html += '<div class="balance-chip live"><div class="ex-name">' + ex.exchange.toUpperCase() + '</div>' +
          '<div class="ex-balance">' + usd(ex.balance) + '</div>' +
          '<div style="margin-top:4px">' + assetsHtml + '</div>' +
          '<div class="ex-status" style="color:#27ae60">&#10003; Live</div></div>';
      }
    }
    grid.innerHTML = html;
    setDot('balances-dot', hasLive ? 'status-ok' : 'status-warn');
    if (r.data && r.data.cached) {
      showToast('Balances from cache (' + Math.round((r.data.age_ms || 0) / 1000) + 's old). Use Force Fresh to update.', 'info');
    }
  }

  async function checkBitmartStatus() {
    setDot('bitmart-dot', 'status-warn');
    var r = await api('/api/bitmart/stats');
    if (!r.ok) { setDot('bitmart-dot', 'status-error'); showToast('BitMart error: ' + errMsg(r), 'error'); return; }
    var d = (r.data && r.data.data) || r.data || {};
    var cbOpen = !!d.circuitBreakerOpen;
    setText('bm-circuit',   cbOpen ? 'OPEN' : 'CLOSED', cbOpen ? 'error' : 'ok');
    setText('bm-failures',  String(d.circuitBreakerFailures || 0), (d.circuitBreakerFailures || 0) > 3 ? 'warn' : '');
    setText('bm-ratelimit', String(d.rateLimitRequests || 0) + ' / ' + String(d.rateLimitMaxPerWindow || 0));
    setText('bm-proxy',     d.externalProxyEnabled ? 'Enabled' : 'Disabled');
    setDot('bitmart-dot', cbOpen ? 'status-error' : 'status-ok');
  }

  async function resetBitmartCB() {
    var r = await api('/api/bitmart/reset-circuit-breaker', { method: 'POST' });
    showToast(r.ok ? 'Circuit breaker reset' : ('Reset failed: ' + errMsg(r)), r.ok ? 'success' : 'error');
    if (r.ok) checkBitmartStatus();
  }

  async function checkProxyStats() {
    setDot('proxy-dot', 'status-warn');
    var r = await api('/api/proxy-stats');
    if (!r.ok) { setDot('proxy-dot', 'status-error'); showToast('Proxy error: ' + errMsg(r), 'error'); return; }
    var d = r.data || {};
    setText('proxy-mode',      d.proxyMode || 'auto');
    setText('proxy-available', String(d.availableProxies || 0));
    setText('proxy-provider',  d.externalProvider || 'none');
    setText('proxy-healthy',   d.externalHealthy ? 'Yes' : 'No', d.externalHealthy ? 'ok' : 'warn');
    setDot('proxy-dot', d.externalHealthy === false ? 'status-warn' : 'status-ok');
  }

  async function loadRebalanceStatus() {
    setDot('rebalance-dot', 'status-warn');
    var r = await api('/api/rebalance/status');
    if (!r.ok) {
      setDot('rebalance-dot', 'status-error');
      showToast('Rebalance status error: ' + errMsg(r), 'error');
      return;
    }

    var d = r.data || {};
    var policy = d.policy || {};
    var plan = d.plan || {};
    var summary = plan.summary || {};
    var transfers = plan.estimatedTransfers || [];
    var weights = d.weights || {};

    setText('rb-enabled', policy.enabled ? 'Enabled' : 'Disabled', policy.enabled ? 'ok' : 'warn');
    setText('rb-target', usd(plan.targetBalance || 0));
    setText('rb-shift', usd(summary.estimatedShiftUsd || 0));
    setText('rb-transfers', String(transfers.length || 0));
    setText('rb-weights', JSON.stringify(weights));

    var planEl = document.getElementById('rb-plan');
    if (!transfers.length) {
      planEl.textContent = 'No transfer suggestions in current buffer range.';
    } else {
      planEl.innerHTML = transfers.map(function(t) {
        return '• Move ' + usd(t.amountUsd) + ' from ' + String(t.from || '').toUpperCase() + ' to ' + String(t.to || '').toUpperCase();
      }).join('<br>');
    }

    setDot('rebalance-dot', policy.enabled ? (transfers.length ? 'status-ok' : 'status-warn') : 'status-idle');
  }

  async function toggleRebalance() {
    var current = await api('/api/rebalance/status');
    if (!current.ok) {
      showToast('Cannot read rebalance policy: ' + errMsg(current), 'error');
      return;
    }
    var enabled = !!(current.data && current.data.policy && current.data.policy.enabled);
    var next = !enabled;
    var r = await api('/api/rebalance/policy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    });
    showToast(r.ok ? ('Rebalancer ' + (next ? 'enabled' : 'disabled')) : errMsg(r), r.ok ? 'success' : 'error');
    if (r.ok) loadRebalanceStatus();
  }

  var ENDPOINTS_TO_CHECK = [
    '/api/status', '/api/readiness', '/api/proxy-stats',
    '/api/execution-health', '/api/report', '/api/balances',
    '/api/platforms', '/api/bitmart/stats', '/api/perps', '/api/safety-state', '/api/rebalance/status',
    '/health',
  ];

  async function checkAllEndpoints() {
    setDot('api-dot', 'status-warn');
    var list = document.getElementById('endpoint-list');
    list.innerHTML = '';
    var allOk = true;
    for (var i = 0; i < ENDPOINTS_TO_CHECK.length; i++) {
      var ep = ENDPOINTS_TO_CHECK[i];
      var li = document.createElement('li');
      li.className = 'endpoint-item';
      var nameEl = document.createElement('span');
      nameEl.className = 'endpoint-name';
      nameEl.textContent = ep;
      var dot = document.createElement('span');
      dot.className = 'ep-dot';
      li.appendChild(nameEl);
      li.appendChild(dot);
      list.appendChild(li);
      var res = await api(ep);
      dot.className = 'ep-dot ' + (res.ok ? 'status-ok' : 'status-error');
      if (!res.ok) allOk = false;
    }
    setDot('api-dot', allOk ? 'status-ok' : 'status-error');
  }

  async function loadTrades() {
    setDot('trades-dot', 'status-warn');
    var r = await api('/api/trades?limit=20');
    if (!r.ok) { setDot('trades-dot', 'status-error'); showToast('Trades error: ' + errMsg(r), 'error'); return; }
    var rows = (r.data && r.data.data) || [];
    var wrap = document.getElementById('trades-wrap');
    if (!rows.length) {
      wrap.innerHTML = '<div style="color:#555;font-size:0.85em">No trades yet</div>';
      setDot('trades-dot', 'status-idle');
      return;
    }
    var html = '<table><thead><tr><th>Symbol</th><th>Strategy</th><th>Direction</th><th>P&amp;L%</th><th>Size</th><th>Time</th></tr></thead><tbody>';
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i];
      var pv = Number(t.net_pct || t.netPct || 0);
      html += '<tr><td>' + (t.symbol || '---') + '</td><td>' + (t.strategy || '---') + '</td>' +
        '<td>' + (t.direction || '---') + '</td>' +
        '<td class="' + (pv >= 0 ? 'pos' : 'neg') + '">' + pct(pv) + '</td>' +
        '<td>' + usd(t.size_usd || t.sizeUsd || 0) + '</td>' +
        '<td>' + ((t.created_at || '').slice(0, 16).replace('T', ' ') || '---') + '</td></tr>';
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;
    setDot('trades-dot', 'status-ok');
  }

  async function loadReport() {
    setDot('report-dot', 'status-warn');
    var r = await api('/api/report');
    if (!r.ok) { setDot('report-dot', 'status-error'); showToast('Report error: ' + errMsg(r), 'error'); return; }
    var d = r.data || {};
    var m = d.metrics || d.data || {};
    setText('rpt-trades',  String(m.totalTrades || d.totalTrades || 0));
    setText('rpt-winrate', m.winRate != null ? (Number(m.winRate) * 100).toFixed(1) + '%' : '---');
    setText('rpt-pnl',     usd(m.totalPnl || d.totalProfit || 0), (m.totalPnl || 0) >= 0 ? 'ok' : 'error');
    setText('rpt-best',    m.bestTrade  != null ? pct(m.bestTrade)  : '---', 'ok');
    setText('rpt-worst',   m.worstTrade != null ? pct(m.worstTrade) : '---', 'error');
    setText('rpt-avg',     m.avgPnlPct  != null ? pct(m.avgPnlPct)  : '---');
    setDot('report-dot', 'status-ok');
  }

  async function refreshAll() {
    await Promise.all([
      loadStatus(),
      checkReadiness(),
      checkExecutionHealth(),
      loadSafetyState(),
      loadBalances(false),
      loadRebalanceStatus(),
      checkBitmartStatus(),
      checkProxyStats(),
      checkAllEndpoints(),
    ]);
  }

  window.addEventListener('load', function() {
    syncBalanceAssetsUi();
    refreshAll();
    loadTrades();
    loadReport();
  });

  setInterval(function() {
    loadStatus();
    checkExecutionHealth();
    loadSafetyState();
    checkProxyStats();
    loadRebalanceStatus();
  }, 30000);
</script>
</body>
</html>`;
}
