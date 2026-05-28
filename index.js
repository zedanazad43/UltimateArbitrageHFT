// ===== NEXUS ARBITRAGE HUB — Final Integrated Bot =====
// Entry point: ultimate-arbitrage-hft Cloudflare Worker
// Integrates: CEX + DEX + Perps strategies, admin dashboard, Telegram bot

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import PerformanceOptimizer from './src/performance-optimizer.js';
import ReliabilityManager from './src/reliability-manager.js';
import AnalyticsEngine from './src/analytics-engine.js';
import { renderDashboard, renderChecklist } from './src/dashboard.js';
import { runScan } from './src/orchestrator.js';
import { ensureSchema, logAdminEvent, logBotEvent, getRecentTrades, getStrategyPnL, getPerformanceMetrics, exportTrades } from './src/db.js';
import { hasExchangeCredentials, getExchangeBalance, placeExchangeMarketOrder, getMissingCredentialKeys, getConfiguredExchanges, ACTIVE_EXECUTION_EXCHANGES, DATA_ONLY_EXCHANGES, getMEXCFuturesBalance, getMEXCBalance } from './src/exchange.js';
import { scanDEX } from './src/strategies/dex.js';
import { isHFTEngineConfigured } from './src/hft-client.js';
import { runBacktest } from './src/backtest.js';
import { evaluateStrategyBreakdown } from './src/self-evaluation.js';
import { getEcosystemCatalog, recommendEcosystem, getApiKeySecurityChecklist } from './src/ecosystem.js';
import { executeAllExecutableIntegrations, executeExecutableIntegration, listExecutableIntegrationIds, probeExecutableIntegrations } from './src/executive-integrations.js';
import { getAutoExecutor } from './src/strategies/auto-executor.js';
import { renderControlPanel } from './src/control-panel.js';
import { loadBotMemory, saveBotMemory, recordEvaluation, summarizeMemory } from './src/bot-memory.js';
import { normalizeRebalancePolicy, computeRebalancePlan, buildRebalanceWeights } from './src/rebalancer.js';
import { discoverSymbolCatalog, resolveDynamicScanSymbols, getAllSpotPrices, isLikelyTradeableSymbol } from './src/prices.js';
import { SUPPORTED_BROKERS, hasBrokerCredentials, getMissingBrokerCredentialKeys, getBrokerAccountSummary, placeBrokerMarketOrder } from './src/brokerage.js';
import {
  startWorkflow,
  stopWorkflow,
  terminateWorkflow,
  describeWorkflow,
  queryWorkflowStatus,
  setTradingModeSignal,
} from './src/temporal/cf-client.js';


// ─── Telegram notification helper ────────────────────────────────────────────
async function sendTelegramAlert(env, message) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { ok: false, error: 'Telegram is not configured' };
  }
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' })
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => 'Telegram API request failed');
      return { ok: false, error: detail, status: resp.status };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// ─── State helpers ────────────────────────────────────────────────────────────
const DEFAULT_STATE = {
  trading_enabled: true,
  paper_trading: false,
  supported_symbols: [],
  scan_symbol_mode: 'cex_union',
  scan_quote_assets: ['USDT', 'USDC', 'FDUSD', 'BUSD', 'DAI', 'TUSD', 'BTC', 'ETH'],
  max_dynamic_symbols: 500,
  max_metamask_symbols: 10000,
  multi_strategy_live: true,
  max_live_trades_per_scan: 5,
  daily_volume_usd: 0,
  daily_limit_usd: 500,
  rebalance_policy: {
    enabled: false,
    targetBufferPct: 0.10,
    minTransferUsd: 25,
    maxShiftPctPerCycle: 0.25,
  },
  strategy_flags: {
    cex: true,
    dex: true,
    perps: true,
    funding: true,
    triangular: true,
    statistical: true,
  },
  daily_pnl: 0, daily_trades: 0,
  total_pnl: 0, total_trades: 0,
  initial_capital: 1000,
  max_daily_loss_usd: 25,
  min_seconds_between_trades: 3,
  max_per_trade_loss_pct: 0.02,
  max_spread_pct: 5.0,
  win_rate: 0.55,
  risk_reward_ratio: 2.0,
  position_size_usd: 5,       // default small position size (5 USDT)
  position_size_min_usd: 1,   // hard floor
  position_size_max_usd: 500, // hard ceiling
};

async function getState(env) {
  const state = await env.BOT_STATE.get('trading_state', 'json').catch((err) => {
    console.error('KV getState error:', err?.message);
    return null;
  }) || { ...DEFAULT_STATE };

  return {
    ...DEFAULT_STATE,
    ...state,
    rebalance_policy: {
      ...DEFAULT_STATE.rebalance_policy,
      ...(state?.rebalance_policy || {}),
    },
    strategy_flags: {
      ...DEFAULT_STATE.strategy_flags,
      ...(state?.strategy_flags || {}),
    },
  };
}

async function saveState(env, state) {
  await env.BOT_STATE.put('trading_state', JSON.stringify(state));
}

function normalizeRequestedAssets(rawAssets) {
  const defaults = ['USDT'];
  if (!rawAssets || typeof rawAssets !== 'string') return defaults;

  const parsed = rawAssets
    .split(',')
    .map((a) => String(a || '').trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 40);

  return parsed.length ? parsed : defaults;
}

async function getExecutionBalancesSnapshot(env, assets = ['USDT']) {
  const requestedAssets = Array.isArray(assets) && assets.length ? assets : ['USDT'];
  const primaryAsset = requestedAssets[0];
  const results = await Promise.all(
    ACTIVE_EXECUTION_EXCHANGES.map(async (ex) => {
      const configured = hasExchangeCredentials(env, ex);
      if (!configured) {
        const missing = getMissingCredentialKeys(env, ex);
        return {
          exchange: ex,
          configured: false,
          asset: primaryAsset,
          balance: null,
          balances: {},
          missing_keys: missing,
        };
      }
      try {
        const balances = {};
        await Promise.all(requestedAssets.map(async (asset) => {
          const value = await getExchangeBalance(env, ex, asset);
          balances[asset] = Number(value || 0);
        }));
        return {
          exchange: ex,
          configured: true,
          asset: primaryAsset,
          balance: Number(balances[primaryAsset] || 0),
          balances,
        };
      } catch (e) {
        console.error(`[balances] ${ex} fetch failed:`, e.message);
        return {
          exchange: ex,
          configured: true,
          asset: primaryAsset,
          balance: 0,
          balances: {},
          error: e.message,
        };
      }
    })
  );

  const dataOnly = [
    { exchange: 'bybit', configured: false, asset: primaryAsset, balance: null, balances: {}, dataOnly: true, note: 'German law — data feed only' },
    { exchange: 'gateio', configured: false, asset: primaryAsset, balance: null, balances: {}, dataOnly: true, note: 'German law — data feed only' }
  ];

  return [...results, ...dataOnly];
}

function getStateSummary(state) {
  const totalProfit = Number(state?.total_pnl || 0);
  const todayProfit = Number(state?.daily_pnl || 0);
  const totalTrades = Number(state?.total_trades || 0);
  const initialCapital = Number(state?.initial_capital || 0);

  return {
    capital: initialCapital + totalProfit,
    totalProfit,
    todayProfit,
    totalTrades,
    paperMode: state?.paper_trading !== false,
    tradingEnabled: !!state?.trading_enabled,
  };
}

async function probeExecutionExchanges(env, exchanges = ACTIVE_EXECUTION_EXCHANGES) {
  const exchangeStatus = {};
  let configuredCount = 0;
  let authValidatedCount = 0;
  let authFailureCount = 0;
  let readinessConfiguredCount = 0;
  let readinessAuthValidatedCount = 0;

  const isBitgetCloudflareBlock = (exchange, message) => {
    if (exchange !== 'bitget') return false;
    const msg = String(message || '').toLowerCase();
    return (
      msg.includes('cloudflare') ||
      msg.includes('<!doctype') ||
      msg.includes('not valid json') ||
      msg.includes('unexpected token') ||
      msg.includes('"block"') ||
      msg.includes('access denied')
    );
  };

  for (const exchange of exchanges) {
    const configured = hasExchangeCredentials(env, exchange);
    const missing = configured ? [] : getMissingCredentialKeys(env, exchange);
    let authValidated = false;
    let authError = null;

    if (configured) {
      configuredCount++;
      try {
        await getExchangeBalance(env, exchange, 'USDT');
        authValidated = true;
        authValidatedCount++;
        readinessConfiguredCount++;
        readinessAuthValidatedCount++;
      } catch (error) {
        authError = error.message;
        if (!isBitgetCloudflareBlock(exchange, authError)) {
          authFailureCount++;
          readinessConfiguredCount++;
        }
      }
    }

    exchangeStatus[exchange] = {
      configured,
      missing,
      authValidated,
      authError,
      readinessIgnored: configured && !authValidated && isBitgetCloudflareBlock(exchange, authError),
    };
  }

  return {
    exchangeStatus,
    configuredCount,
    authValidatedCount,
    authFailureCount,
    liveTradingCapable: readinessAuthValidatedCount > 0,
    allConfiguredExchangesHealthy:
      readinessConfiguredCount > 0 &&
      authFailureCount === 0 &&
      readinessAuthValidatedCount === readinessConfiguredCount,
  };
}

// ─── Cookie helper ────────────────────────────────────────────────────────────
// Parses a single named cookie from the Cookie request header.
// The name is escaped so it's safe to embed in a RegExp literal.
function getCookieValue(c, name) {
  const cookieHeader = c.req.header('Cookie') || '';
  const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|;\\s*)${safeName}=([^;]*)`);
  const m = cookieHeader.match(re);
  return m ? decodeURIComponent(m[1]) : null;
}

function constantTimeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aLen = a.length;
  const bLen = b.length;
  const len = Math.max(aLen, bLen);
  let diff = aLen ^ bLen;
  for (let i = 0; i < len; i++) {
    const ac = i < aLen ? a.charCodeAt(i) : 0;
    const bc = i < bLen ? b.charCodeAt(i) : 0;
    diff |= ac ^ bc;
  }
  return diff === 0;
}

// ─── Admin auth ───────────────────────────────────────────────────────────────
// ADMIN_TOKEN must be set as a Cloudflare Worker secret (`wrangler secret put ADMIN_TOKEN`).
// If it is absent the endpoint is denied — this prevents accidental exposure of admin
// controls on a freshly-deployed worker that has not yet had secrets configured.
//
// Two auth paths are supported:
//   1. x-admin-token request header  — for programmatic / script access.
//   2. nexus_session HttpOnly cookie  — for browser sessions after /login.
function isAuthorized(env, c) {
  const token = env.ADMIN_TOKEN;
  const workflowToken = env.WORKFLOW_ADMIN_TOKEN;
  // Open setup mode: if ADMIN_TOKEN is not configured yet, allow access so
  // the dashboard can be fully wired during initial bootstrap.
  if (!token && !workflowToken) return true;

  const headerToken = c.req.header('x-admin-token') || c.req.header('x-workflow-token') || '';
  if ((token && constantTimeEquals(headerToken, token)) || (workflowToken && constantTimeEquals(headerToken, workflowToken))) {
    return true;
  }

  const cookie = getCookieValue(c, 'nexus_session');
  return !!token && constantTimeEquals(cookie || '', token);
}

// Returns a descriptive 401 response that distinguishes "secret not configured" from
// "wrong token supplied", making it easier to diagnose setup problems.
// Use `asJson` for API routes that speak JSON; leave false for plain-text admin routes.
function authDenied(env, c, asJson = false) {
  const adminConfigured = !!env.ADMIN_TOKEN;
  const hint = adminConfigured
    ? 'Invalid admin token'
    : 'ADMIN_TOKEN secret not configured — run: wrangler secret put ADMIN_TOKEN';
  const status = adminConfigured ? 401 : 503;
  if (asJson) {
    return c.json({
      error: adminConfigured ? 'Unauthorized' : 'Admin auth not configured',
      hint
    }, status);
  }
  return c.text(`${adminConfigured ? 'Unauthorized' : 'Service unavailable'}: ${hint}`, status);
}

// ─── Login page renderer ──────────────────────────────────────────────────────
function renderLoginPage(showError = false, adminConfigured = true) {
  const setupBanner = !adminConfigured
    ? `<div style="background:#e67e22;color:#fff;padding:10px 18px;border-radius:8px;margin-bottom:18px;font-weight:bold;line-height:1.7">
         ⚠️ ADMIN_TOKEN غير مُهيَّأ بعد.<br>
         شغّل: <code style="background:rgba(0,0,0,.25);padding:2px 6px;border-radius:4px">wrangler secret put ADMIN_TOKEN</code>
         ثم أعد النشر.
       </div>`
    : '';
  const errorBanner = showError && adminConfigured
    ? `<div style="background:#e74c3c;color:#fff;padding:10px 18px;border-radius:8px;margin-bottom:18px;font-weight:bold">❌ رمز الإدارة غير صحيح — حاول مجدداً</div>`
    : '';
  const formHtml = adminConfigured
    ? `<form method="POST" action="/login">
         <label for="token">رمز الإدارة (ADMIN_TOKEN)</label>
         <input id="token" name="token" type="password" placeholder="••••••••••••" autocomplete="current-password" autofocus required>
         <button type="submit">🔑 دخول</button>
       </form>`
    : `<div style="background:#12161e;border:1px solid #2a2e38;border-radius:10px;padding:16px;text-align:right;line-height:1.8;color:#aaa">
         تم تعطيل تسجيل الدخول لأن سر الإدارة غير مُهيَّأ بعد.
       </div>`;
  return new Response(
    `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Nexus Arbitrage Hub — تسجيل الدخول</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0b0e14;color:#eee;font-family:'Segoe UI',Tahoma,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:#1a1e26;border-radius:16px;padding:40px;width:100%;max-width:400px;box-shadow:0 4px 40px rgba(0,0,0,.5);text-align:center}
    h1{color:#f0b90b;font-size:1.6em;margin-bottom:8px}
    .subtitle{color:#888;font-size:.9em;margin-bottom:28px}
    label{display:block;text-align:right;color:#aaa;font-size:.85em;margin-bottom:6px}
    input[type=password]{width:100%;background:#2a2e38;color:#eee;border:1px solid #444;border-radius:8px;padding:10px 14px;font-size:1em;margin-bottom:18px;outline:none}
    input[type=password]:focus{border-color:#f0b90b}
    button{width:100%;background:#f0b90b;color:#000;font-weight:bold;font-size:1em;padding:12px;border:none;border-radius:8px;cursor:pointer;transition:opacity .2s}
    button:hover{opacity:.85}
    .footer{color:#555;font-size:.75em;margin-top:24px}
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size:2.2em;margin-bottom:12px">🔷</div>
    <h1>Nexus Arbitrage Hub</h1>
    <p class="subtitle">${adminConfigured ? 'أدخل رمز الإدارة للمتابعة' : 'أكمِل الإعداد أولاً ثم سجّل الدخول'}</p>
    ${setupBanner}
    ${errorBanner}
    ${formHtml}
    <p class="footer">مبني على Cloudflare Workers</p>
  </div>
</body>
</html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

// ─── Rate limiter helper ──────────────────────────────────────────────────────
// Uses the RATE_LIMITER binding (Cloudflare Rate Limiting API).
// Returns a 429 response if the caller has exceeded the configured threshold;
// returns null when the request may proceed.
// Gracefully skips rate limiting when the binding is absent (local dev).
async function checkRateLimit(env, c) {
  if (!env.RATE_LIMITER) return null;
  try {
    const key = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
    const { success } = await env.RATE_LIMITER.limit({ key });
    if (!success) return c.text('Too Many Requests', 429);
  } catch (e) {
    console.error('[RateLimit] error:', e.message);
  }
  return null;
}

// ─── Durable Object: MarketStreamer ───────────────────────────────────────────
export class MarketStreamer {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.prices = {};
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/price') {
      const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
      const price = this.prices[symbol] || 0;
      return Response.json({ price });
    }
    if (url.pathname === '/update' && request.method === 'POST') {
      const { symbol, price } = await request.json();
      if (symbol && price) this.prices[symbol] = price;
      return Response.json({ ok: true });
    }
    return new Response('MarketStreamer OK');
  }
}

// ─── Hono App ─────────────────────────────────────────────────────────────────
const app = new Hono();
app.use('*', cors());

// ── Global error handler ──────────────────────────────────────────────────────
app.onError((err, c) => {
  console.error('[Worker] unhandled error:', err?.message, err?.stack);
  const safe = (err?.message || 'Unknown error')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return c.html(
    `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px">` +
    `<h1>500 — Internal Server Error</h1><pre>${safe}</pre>` +
    `</body></html>`,
    500
  );
});

// ── Auto-schema middleware — ensures D1 tables exist before any route runs ────
app.use('*', async (c, next) => {
  try { await ensureSchema(c.env); } catch (_) { /* already logged in ensureSchema */ }
  return next();
});

// ─── Initialize performance & reliability modules ────────────────────────────
const perfOptimizer = new PerformanceOptimizer({ ttl: 300000, maxSize: 1000 });
const reliabilityMgr = new ReliabilityManager({ maxRetries: 3 });
const analyticsEngine = new AnalyticsEngine();

// ─── API: Analytics Dashboard ──────────────────────────────────────────────
app.get('/api/analytics', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

  try {
    const initialCapital = parseInt(c.req.query('capital') || '10000', 10);
    const report = analyticsEngine.getPerformanceReport(initialCapital);
    const equityData = analyticsEngine.getEquityCurveData().slice(-100); // Last 100 points

    return c.json({
      ok: true,
      timestamp: new Date().toISOString(),
      report,
      equityCurve: equityData
    });
  } catch (err) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// ─── API: Performance Metrics ──────────────────────────────────────────────
app.get('/api/performance', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

  const metrics = perfOptimizer.getMetrics();
  return c.json({
    ok: true,
    timestamp: new Date().toISOString(),
    performance: metrics
  });
});

// ─── API: Health Check Status ──────────────────────────────────────────────
app.get('/api/health', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

  const healthStatus = reliabilityMgr.getHealthStatus();
  const errorReport = reliabilityMgr.getErrorReport(10);

  const overallHealth = Object.values(healthStatus).every((h) => h.status === 'healthy')
    ? 'HEALTHY'
    : 'DEGRADED';

  return c.json({
    ok: true,
    timestamp: new Date().toISOString(),
    overallHealth,
    checks: healthStatus,
    recentErrors: errorReport
  });
});

// ─── API: Reset Performance Metrics ──────────────────────────────────────────
app.post('/api/metrics/reset', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

  perfOptimizer.resetMetrics();
  reliabilityMgr.resetErrorHistory();
  analyticsEngine.reset();

  return c.json({
    ok: true,
    message: 'All metrics have been reset',
    timestamp: new Date().toISOString()
  });
});

// ── Login / Logout routes ─────────────────────────────────────────────────────
// GET /login  — render the login form (public)
app.get('/login', (c) => {
  // Already logged in → go to dashboard
  if (isAuthorized(c.env, c)) return c.redirect('/', 302);
  return renderLoginPage(false, !!c.env.ADMIN_TOKEN);
});

// POST /login — validate token, set HttpOnly session cookie, redirect to /
app.post('/login', async (c) => {
  if (!c.env.ADMIN_TOKEN) return renderLoginPage(false, false);
  const body = await c.req.parseBody().catch(() => ({}));
  const input = (typeof body.token === 'string' ? body.token : '').trim();
  if (input && c.env.ADMIN_TOKEN && constantTimeEquals(input, c.env.ADMIN_TOKEN)) {
    const maxAge = 86400; // 24 hours
    const isHttps = c.req.url.startsWith('https://');
    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/',
        'Set-Cookie': `nexus_session=${encodeURIComponent(c.env.ADMIN_TOKEN)}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Path=/${isHttps ? '; Secure' : ''}`,
      },
    });
  }
  return renderLoginPage(true, true);
});

// GET /logout — clear session cookie, redirect to /login
app.get('/logout', (_c) => {
  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/login',
      'Set-Cookie': 'nexus_session=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/',
    },
  });
});

// ── Health check (public, no auth) ────────────────────────────────────────────
// Returns a lightweight system snapshot for uptime monitors and load balancers.
// Does not expose sensitive state — safe to probe from external services.
app.get('/health', async (c) => {
  const state = await getState(c.env).catch(() => null);
  const equity = state
    ? (state.initial_capital || 1000) + (state.total_pnl || 0)
    : null;
  return c.json({
    status:          'ok',
    trading_enabled: state?.trading_enabled ?? false,
    paper_trading:   state?.paper_trading   ?? true,
    auto_stopped:    state?.auto_stopped    ?? false,
    equity_usd:      equity !== null ? parseFloat(equity.toFixed(2)) : null,
    daily_pnl_usd:   state ? parseFloat((state.daily_pnl || 0).toFixed(2)) : null,
    daily_trades:    state?.daily_trades    ?? 0,
    timestamp:       Date.now(),
  });
});

// ── Dashboard routes ──────────────────────────────────────────────────────────
// Browser access requires a valid session; redirect to /login when absent.
// API callers that send an x-admin-token header bypass the cookie check.
app.get('/', async (c) => {
  if (c.env.ADMIN_TOKEN && !isAuthorized(c.env, c)) return c.redirect('/login', 302);
  return renderDashboard(c.env);
});
app.get('/dashboard', async (c) => {
  if (c.env.ADMIN_TOKEN && !isAuthorized(c.env, c)) return c.redirect('/login', 302);
  return renderDashboard(c.env);
});
app.get('/checklist', async (c) => {
  if (c.env.ADMIN_TOKEN && !isAuthorized(c.env, c)) return c.redirect('/login', 302);
  return renderChecklist(c.env);
});

app.get('/control-panel', async (c) => {
  if (c.env.ADMIN_TOKEN && !isAuthorized(c.env, c)) return c.redirect('/login', 302);
  return c.html(renderControlPanel());
});

// ── Admin: Start ──────────────────────────────────────────────────────────────
app.get('/start', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c);
  const state = await getState(c.env);
  state.trading_enabled = true;
  state.auto_stopped = false;
  state.auto_stop_reason = null;
  await saveState(c.env, state);
  await logAdminEvent(c.env, 'start', c.req.raw);
  await sendTelegramAlert(c.env, '▶️ *تم تشغيل نظام Nexus Arbitrage Hub*');
  return c.text('✅ تم تشغيل التداول');
});

// ── Admin: Stop ───────────────────────────────────────────────────────────────
app.get('/stop', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c);
  const state = await getState(c.env);
  state.trading_enabled = false;
  await saveState(c.env, state);
  await logAdminEvent(c.env, 'stop', c.req.raw);
  await sendTelegramAlert(c.env, '⏸️ *تم إيقاف نظام Nexus Arbitrage Hub*');
  return c.text('✅ تم إيقاف التداول');
});

// ── Admin: Debug MEXC Futures ─────────────────────────────────────────────────
app.get('/debug-futures', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c);
  const results = {};
  const apiKey    = c.env.MEXC_API_KEY    || '(missing)';
  const apiSecret = c.env.MEXC_API_SECRET || '(missing)';
  results.keyPrefix    = apiKey.slice(0, 8) + '...';
  results.secretLength = apiSecret.length;

  async function makeHmac(secret, msg) {
    const enc = new TextEncoder();
    const k = await crypto.subtle.importKey('raw', enc.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
    const buf = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }

  // Test 1: contract.mexc.com with primary key.
  try {
    results.futuresBalance = await getMEXCFuturesBalance(c.env);
  } catch (e) {
    results.futuresBalanceError = e.message;
  }

  // Test 2: optional secondary credentials from env (if provided)
  const apiKey2 = c.env.MEXC_API_KEY_2; // gitleaks:allow
  const apiSec2 = c.env.MEXC_API_SECRET_2; // gitleaks:allow
  if (apiKey2 && apiSec2) {
    try {
      const ts2 = Date.now();
      const sig2 = await makeHmac(apiSec2, `${ts2}${apiKey2}5000`);
      const r2 = await fetch('https://contract.mexc.com/api/v1/private/account/assets', {
        headers: { 'ApiKey': apiKey2, 'Request-Time': ts2.toString(), 'Signature': sig2, 'recv-window': '5000' }
      });
      const d2 = await r2.json();
      results.key2contract = d2.success ? 'OK:' + JSON.stringify((d2.data || []).slice(0, 2)) : `code=${d2.code} ${d2.message}`;
    } catch (e) {
      results.key2contractError = e.message;
    }
  } else {
    results.key2contract = 'skipped (set MEXC_API_KEY_2 and MEXC_API_SECRET_2 to test secondary key)';
  }

  // Test 2b: primary key WITHOUT recv-window in signature
  try {
    const ts2b = Date.now();
    const sig2b = await makeHmac(apiSecret, `${ts2b}${apiKey}`);
    const r2b = await fetch('https://contract.mexc.com/api/v1/private/account/assets', {
      headers: { 'ApiKey': apiKey, 'Request-Time': ts2b.toString(), 'Signature': sig2b }
    });
    const d2b = await r2b.json();
    results.noRecvWindow = d2b.success ? 'OK' : `code=${d2b.code} ${d2b.message}`;
  } catch (e) {
    results.noRecvWindowError = e.message;
  }

  // Test 3: spot balance
  try {
    results.spotBalance = await getMEXCBalance(c.env, 'USDT');
  } catch (e) {
    results.spotBalanceError = e.message;
  }

  return c.json(results);
});

// ── Admin: Immediate scan ─────────────────────────────────────────────────────
app.get('/scan', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c);
  const state = await getState(c.env);
  const result = await runScan(c.env, state, sendTelegramAlert);
  await saveState(c.env, state);
  if (result) {
    const opp = result.opportunity;
    if (Array.isArray(result.trades) && result.trades.length > 1) {
      const lines = result.trades
        .map(t => `• ${t.symbol} [${String(t.strategy || '').toUpperCase()}] ${t.direction} | ${Number(t.netPct || 0).toFixed(4)}% | $${Number(t.sizeUsd || 0).toFixed(2)}`)
        .join('\n');
      return c.text(
        `✅ مسح اكتمل — تم تنفيذ ${result.trades.length} صفقات في نفس الدورة:\n` +
        `${lines}`
      );
    }
    return c.text(
      `✅ مسح اكتمل — أفضل فرصة:\n` +
      `${opp.symbol} [${opp.strategy.toUpperCase()}] ${opp.direction}\n` +
      `صافي: ${opp.netPct.toFixed(4)}%  |  حجم: $${result.sizeUsd.toFixed(2)}`
    );
  }
  return c.text('✅ مسح اكتمل — لا توجد فرص مربحة حالياً');
});

// ── Admin: Set mode Paper ─────────────────────────────────────────────────────
app.post('/mode/paper', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c);
  const state = await getState(c.env);
  state.paper_trading = true;
  await saveState(c.env, state);
  await logAdminEvent(c.env, 'mode:paper', c.req.raw);
  await sendTelegramAlert(c.env, '📄 *تم التبديل إلى وضع Paper Trading*');
  return c.text('✅ وضع Paper مفعّل');
});

// ── Admin: Set mode Live ──────────────────────────────────────────────────────
app.post('/mode/live', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c);
  const state = await getState(c.env);
  if (!Number.isFinite(state.daily_limit_usd) || state.daily_limit_usd <= 0) {
    return c.text('❌ يجب ضبط daily_limit_usd قبل تفعيل Live', 400);
  }
  state.paper_trading = false;
  await saveState(c.env, state);
  await logAdminEvent(c.env, 'mode:live', c.req.raw);
  await sendTelegramAlert(c.env, '🔴 *تم التبديل إلى وضع Live Trading — تنفيذ حقيقي*');
  return c.text('✅ وضع Live مفعّل');
});

// ── Admin: Save config ────────────────────────────────────────────────────────
app.post('/config', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c);
  let body;
  try { body = await c.req.json(); } catch (_) { return c.text('Invalid JSON', 400); }
  const state = await getState(c.env);
  const num = (v) => (typeof v === 'number' && v > 0 ? v : undefined);
  if (num(body.max_daily_loss_usd))           state.max_daily_loss_usd           = body.max_daily_loss_usd;
  if (num(body.daily_limit_usd))              state.daily_limit_usd              = body.daily_limit_usd;
  if (num(body.max_per_trade_loss_pct))       state.max_per_trade_loss_pct       = body.max_per_trade_loss_pct;
  if (num(body.min_seconds_between_trades))   state.min_seconds_between_trades   = body.min_seconds_between_trades;
  if (num(body.initial_capital))              state.initial_capital              = body.initial_capital;
  if (num(body.max_spread_pct))               state.max_spread_pct               = body.max_spread_pct;
  if (num(body.win_rate))                     state.win_rate                     = body.win_rate;
  if (num(body.risk_reward_ratio))            state.risk_reward_ratio            = body.risk_reward_ratio;
  if (Number.isFinite(body.max_dynamic_symbols)) {
    state.max_dynamic_symbols = Math.max(15, Math.min(2000, Math.floor(body.max_dynamic_symbols)));
  }
  if (Number.isFinite(body.max_metamask_symbols)) {
    state.max_metamask_symbols = Math.max(100, Math.min(20000, Math.floor(body.max_metamask_symbols)));
  }
  if (typeof body.scan_symbol_mode === 'string') {
    const normalizedMode = body.scan_symbol_mode.toLowerCase();
    const allowedModes = new Set(['cex_union', 'cex_intersection', 'wallet_readable']);
    if (allowedModes.has(normalizedMode)) state.scan_symbol_mode = normalizedMode;
  }
  if (Array.isArray(body.scan_quote_assets) || typeof body.scan_quote_assets === 'string') {
    const rawQuotes = Array.isArray(body.scan_quote_assets)
      ? body.scan_quote_assets
      : String(body.scan_quote_assets || '').split(',');
    const quotes = [...new Set(rawQuotes
      .map((v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, ''))
      .filter((q) => q.length >= 3 && q.length <= 10)
    )];
    if (quotes.length > 0) state.scan_quote_assets = quotes;
  }
  if (typeof body.use_dynamic_symbols === 'boolean') {
    if (body.use_dynamic_symbols) {
      state.supported_symbols = [];
    }
  }
  if (Array.isArray(body.supported_symbols)) {
    const normalizedSymbols = [...new Set(body.supported_symbols
      .map((v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, ''))
      .filter((s) => isLikelyTradeableSymbol(s, state.scan_quote_assets || []))
    )].slice(0, 2000);
    state.supported_symbols = normalizedSymbols;
  }
  if (num(body.position_size_min_usd))        state.position_size_min_usd        = Math.max(1, Math.min(500, body.position_size_min_usd));
  if (num(body.position_size_max_usd))        state.position_size_max_usd        = Math.max(1, Math.min(500, body.position_size_max_usd));
  if (state.position_size_min_usd > state.position_size_max_usd) {
    const tmp = state.position_size_min_usd;
    state.position_size_min_usd = state.position_size_max_usd;
    state.position_size_max_usd = tmp;
  }
  // Position size — clamped to safe bounds (1–500 USDT)
  if (typeof body.position_size_usd === 'number' && body.position_size_usd > 0) {
    state.position_size_usd = Math.max(
      state.position_size_min_usd ?? 1,
      Math.min(state.position_size_max_usd ?? 500, body.position_size_usd)
    );
  }
  if (typeof body.multi_strategy_live === 'boolean') {
    state.multi_strategy_live = body.multi_strategy_live;
  }
  if (Number.isFinite(body.max_live_trades_per_scan)) {
    const clamped = Math.max(1, Math.min(5, Math.floor(body.max_live_trades_per_scan)));
    state.max_live_trades_per_scan = clamped;
  }
  if (body.strategy_flags && typeof body.strategy_flags === 'object') {
    const current = state.strategy_flags || {};
    const nextFlags = {
      cex: current.cex !== false,
      dex: current.dex !== false,
      perps: current.perps !== false,
      funding: current.funding !== false,
      triangular: current.triangular !== false,
      statistical: current.statistical !== false,
    };
    for (const key of Object.keys(nextFlags)) {
      if (typeof body.strategy_flags[key] === 'boolean') {
        nextFlags[key] = body.strategy_flags[key];
      }
    }
    state.strategy_flags = nextFlags;
  }
  await saveState(c.env, state);
  await logAdminEvent(c.env, 'config', c.req.raw);
  return c.text('✅ تم حفظ الإعدادات');
});

// ── API: Bot status ───────────────────────────────────────────────────────────
app.get('/api/status', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  const [state, lastScan, circuitBreaker] = await Promise.all([
    getState(c.env),
    c.env.BOT_STATE.get('nexus_last_scan', 'json').catch(() => null),
    c.env.BOT_STATE.get('nexus_circuit_breaker', 'json').catch(() => null)
  ]);
  const summary = getStateSummary(state);
  return c.json({
    ...state,
    ...summary,
    lastScan,
    circuitBreaker: circuitBreaker || {},
    secretBindings: {
      adminTokenConfigured: !!c.env.ADMIN_TOKEN,
      telegramConfigured: !!c.env.TELEGRAM_BOT_TOKEN && !!c.env.TELEGRAM_CHAT_ID,
      vscodeApiTokenConfigured: !!c.env.VSCODE_API_TOKEN,
    },
  });
});

// ── API: Proxy routing stats ────────────────────────────────────────────────
// GET /api/proxy-stats — returns current proxy pool mode, available proxies,
// auto-executor strategy health, and rate-limiter backoff state.
app.get('/api/proxy-stats', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  const executor = getAutoExecutor(c.env);
  const stats = executor.getStats();
  let externalProvider = 'none';
  let externalHealthy = false;
  try {
    const { getExternalProxyManager } = await import('./src/infra/external-proxy.js');
    const externalStats = getExternalProxyManager(c.env).getStats();
    externalProvider = externalStats.provider ?? 'none';
    externalHealthy = !!externalStats.healthy;
  } catch (_) {}
  return c.json({
    success: true,
    proxyRouting: stats.proxyRouting,
    rateLimiterBackoffExchanges: stats.rateLimiterBackoffExchanges,
    strategyHealth: stats.strategyHealth,
    executorPaperMode: stats.paperMode,
    openPositions: stats.openPositions,
    paperMode: stats.paperMode,
    maxOpenPositions: stats.maxPositions,
    strategyCooldownMs: stats.strategyCooldownMs,
    proxyMode: stats.proxyRouting?.mode || 'auto',
    availableProxies: stats.proxyRouting?.availableProxies ?? 0,
    externalProvider,
    externalHealthy,
  });
});

app.post('/api/alerts/test', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

  const body = await c.req.json().catch(() => ({}));
  const requestedMessage = typeof body.message === 'string' ? body.message.trim() : '';
  const message = requestedMessage || [
    '🧪 *UltimateArbitrageHFT test alert*',
    `Time: ${new Date().toISOString()}`,
    'Path: /api/alerts/test',
  ].join('\n');

  const result = await sendTelegramAlert(c.env, message);
  if (!result.ok) {
    return c.json({ ok: false, error: result.error }, result.status ? 502 : 503);
  }

  return c.json({ ok: true, preview: message });
});

// ── API: BitMart Enhanced Management ────────────────────────────────────────
app.get('/api/bitmart/stats', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  const { getBitmartEnhanced } = await import('./src/infra/bitmart-enhanced.js');
  const bitmart = getBitmartEnhanced(c.env);
  return c.json({
    success: true,
    data: bitmart.getStats(),
  });
});

app.post('/api/bitmart/reset-circuit-breaker', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  const { resetBitmartCircuitBreaker } = await import('./src/infra/bitmart-enhanced.js');
  resetBitmartCircuitBreaker();
  return c.json({
    success: true,
    message: 'BitMart circuit breaker reset',
  });
});

// ── API: Readiness — cross-system go-live checklist ───────────────────────────────────────
// Returns a single structured object showing every pre-requisite for live
// trading.  Auth-protected.  Checks: exchange credentials, BitMart circuit
// breaker, external proxy, trading state, Telegram, and admin token.
app.get('/api/readiness', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

  const state = await getState(c.env);
  const executionProbe = await probeExecutionExchanges(c.env);

  // ---- Exchange credentials -----------------------------------------------
  const exchangeStatus = {
    ...executionProbe.exchangeStatus,
  };
  for (const ex of ['bybit', 'gateio', 'kraken', 'coinbase']) {
    const configured = hasExchangeCredentials(c.env, ex);
    exchangeStatus[ex] = {
      configured,
      missing: configured ? [] : getMissingCredentialKeys(c.env, ex),
      authValidated: false,
      authError: null,
      dataOnly: true,
    };
  }

  // ---- BitMart circuit breaker --------------------------------------------
  let bitmartCircuitBreaker = { state: 'UNKNOWN', failures: 0 };
  try {
    const { getBitmartEnhanced } = await import('./src/infra/bitmart-enhanced.js');
    const bm = getBitmartEnhanced(c.env);
    const bmStats = bm.getStats();
    bitmartCircuitBreaker = {
      state: bmStats.circuitBreakerOpen ? 'OPEN' : 'CLOSED',
      failures: bmStats.circuitBreakerFailures ?? 0,
      rateLimitUsed: bmStats.rateLimitRequests ?? 0,
    };
  } catch (_) {}

  // ---- External proxy -----------------------------------------------------
  let proxyStatus = { provider: 'none', enabled: false, healthy: false };
  try {
    const { getExternalProxyManager } = await import('./src/infra/external-proxy.js');
    const pm = getExternalProxyManager(c.env);
    const ps = pm.getStats();
    proxyStatus = {
      provider: ps.provider ?? 'none',
      enabled: ps.enabled ?? false,
      healthy: ps.healthy ?? false,
    };
  } catch (_) {}

  // ---- System flags -------------------------------------------------------
  const adminTokenSet = !!(c.env.ADMIN_TOKEN);
  const telegramConfigured = !!(c.env.TELEGRAM_BOT_TOKEN && c.env.TELEGRAM_CHAT_ID);
  const tradingEnabled = !!state.trading_enabled;
  const paperMode = state.paper_trading !== false;
  const executionExchangesReady = executionProbe.allConfiguredExchangesHealthy;

  // ---- Live-trading gate: all checks must pass ----------------------------
  const readyForLive = (
    adminTokenSet &&
    tradingEnabled &&
    !paperMode &&
    executionExchangesReady &&
    bitmartCircuitBreaker.state !== 'OPEN'
  );

  return c.json({
    success: true,
    readyForLive,
    checks: {
      adminTokenSet,
      telegramConfigured,
      tradingEnabled,
      paperMode,
      configuredExchangeCount: executionProbe.configuredCount,
      authValidatedExchangeCount: executionProbe.authValidatedCount,
      exchangeAuthFailures: executionProbe.authFailureCount,
      liveTradingCapable: executionProbe.liveTradingCapable,
      executionExchangesReady,
      bitmartCircuitBreaker,
      externalProxy: proxyStatus,
    },
    exchanges: exchangeStatus,
    note: readyForLive
      ? 'All systems go — live trading is active'
      : executionProbe.configuredCount === 0
        ? 'No executable exchange credentials are configured'
        : executionProbe.authFailureCount > 0
          ? 'One or more configured exchanges failed authenticated balance checks'
          : 'One or more pre-requisites are not met; review checks above',
    timestamp: new Date().toISOString(),
  });
});

// ── API: Recent trades ────────────────────────────────────────────────────────
app.get('/api/trades', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const trades = await getRecentTrades(c.env, Math.min(limit, 100));
  return c.json({ success: true, data: trades });
});

// ── API: Strategy P&L ─────────────────────────────────────────────────────────
app.get('/api/pnl', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  const pnl = await getStrategyPnL(c.env);
  return c.json({ success: true, data: pnl });
});

// ── API: Performance report ───────────────────────────────────────────────────
app.get('/api/report', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  const from   = c.req.query('from');
  const to     = c.req.query('to');
  const fromMs = from ? new Date(from).getTime() : 0;
  const toMs   = to   ? new Date(to).getTime()   : Date.now();
  if (isNaN(fromMs) || isNaN(toMs)) return c.json({ error: 'Invalid date parameters' }, 400);
  const [state, metrics] = await Promise.all([
    getState(c.env),
    getPerformanceMetrics(c.env, fromMs, toMs),
  ]);
  const summary = getStateSummary(state);
  return c.json({
    success: true,
    ...summary,
    metrics,
    data: metrics,
    from: fromMs,
    to: toMs,
  });
});

// ── API: Recent admin/bot logs ───────────────────────────────────────────────
app.get('/api/logs', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  if (!c.env.DB) return c.json({ success: true, data: { admin: [], bot: [] } });

  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
  try {
    const [adminRows, botRows] = await Promise.all([
      c.env.DB.prepare(
        `SELECT action, source_ip, created_at FROM admin_events ORDER BY created_at DESC LIMIT ?`
      ).bind(limit).all(),
      c.env.DB.prepare(
        `SELECT event_type, details, created_at FROM bot_events ORDER BY created_at DESC LIMIT ?`
      ).bind(limit).all()
    ]);
    return c.json({
      success: true,
      data: {
        admin: adminRows?.results || [],
        bot: botRows?.results || []
      }
    });
  } catch (e) {
    console.error('[api/logs] fetch failed:', e.message);
    return c.json({ error: 'Failed to load logs', detail: e.message }, 500);
  }
});

// ── API: R2 log archives list ────────────────────────────────────────────────
app.get('/api/logs/archives', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  if (!c.env.TRADE_LOGS) return c.json({ success: true, objects: [], truncated: false, note: 'TRADE_LOGS binding not configured' });

  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
  const prefix = c.req.query('prefix') || 'exports/';
  const cursor = c.req.query('cursor') || undefined;

  try {
    const result = await c.env.TRADE_LOGS.list({ prefix, limit, cursor });
    const objects = (result.objects || []).map((obj) => ({
      key: obj.key,
      size: obj.size,
      uploaded: obj.uploaded,
      customMetadata: obj.customMetadata || {},
    }));
    return c.json({
      success: true,
      objects,
      truncated: !!result.truncated,
      cursor: result.cursor || null,
    });
  } catch (e) {
    console.error('[api/logs/archives] list failed:', e.message);
    return c.json({ error: 'Failed to list log archives', detail: e.message }, 500);
  }
});

// ── API: Exchange balances (auth-protected) ───────────────────────────────────
app.get('/api/balances', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

  const assets = normalizeRequestedAssets(c.req.query('assets') || 'USDT');
  const cacheSuffix = assets.join('_');
  const CACHE_KEY = `balances_cache_v2_${cacheSuffix}`;
  const CACHE_TTL = 60_000; // 60 s
  const forceFresh = c.req.query('fresh') === '1';

  if (!forceFresh && c.env.BOT_STATE) {
    const cached = await c.env.BOT_STATE.get(CACHE_KEY, 'json').catch(() => null);
    if (cached && cached._ts && (Date.now() - cached._ts) < CACHE_TTL) {
      return c.json({ success: true, data: cached.data, cached: true, age_ms: Date.now() - cached._ts });
    }
  }

  const data = await getExecutionBalancesSnapshot(c.env, assets);

  // Persist to KV cache in background (don't await — keep response fast)
  if (c.env.BOT_STATE) {
    const payload = JSON.stringify({ data, _ts: Date.now() });
    c.executionCtx.waitUntil(
      c.env.BOT_STATE.put(CACHE_KEY, payload, { expirationTtl: 120 }).catch(() => {})
    );
  }

  return c.json({ success: true, assets, data, cached: false });
});

// ── API: Rebalance status/plan (auth-protected) ─────────────────────────────
// Computes an environment-agnostic rebalance plan based on currently fetched
// exchange balances and returns routing weights used by live execution scoring.
app.get('/api/rebalance/status', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

  const state = await getState(c.env);
  const policy = normalizeRebalancePolicy(state.rebalance_policy || {});
  const balances = await getExecutionBalancesSnapshot(c.env);
  const plan = computeRebalancePlan(balances, policy);
  const weights = buildRebalanceWeights(balances, policy);

  return c.json({
    success: true,
    policy,
    plan,
    weights: weights.weights,
    generatedAt: new Date().toISOString(),
  });
});

// ── API: Rebalance policy update (auth-protected) ───────────────────────────
app.post('/api/rebalance/policy', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

  const body = await c.req.json().catch(() => ({}));
  const state = await getState(c.env);

  const nextPolicy = normalizeRebalancePolicy({
    ...(state.rebalance_policy || {}),
    ...body,
  });

  state.rebalance_policy = nextPolicy;
  await saveState(c.env, state);
  await logAdminEvent(c.env, 'rebalance:policy', c.req.raw);

  return c.json({
    success: true,
    policy: nextPolicy,
    message: 'Rebalance policy updated',
  });
});

// ── API: Perps status ─────────────────────────────────────────────────────────
// Returns the current perpetuals scan state, active perp exchanges (price feeds),
// and MEXC Futures execution readiness.  Auth-protected.
app.get('/api/perps', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  const [lastScan, cb] = await Promise.all([
    c.env.BOT_STATE.get('nexus_last_scan', 'json').catch(() => null),
    c.env.BOT_STATE.get('nexus_circuit_breaker', 'json').catch(() => null)
  ]);
  const cbState = cb || {};

  const perpExchanges = ['mexc_perp', 'binance_perp', 'bybit_perp'];
  const exchangeStatus = perpExchanges.map(ex => {
    const info = cbState[ex];
    const now = Date.now();
    const open = info?.open && (now - (info?.lastFailure || 0)) < 300000;
    // mexc_perp is the only executable perp feed; others are data-only feeds
    const isExecutable = ex === 'mexc_perp';
    return {
      exchange: ex,
      status: open ? 'open' : 'ok',
      failures: info?.failures || 0,
      dataOnly: !isExecutable,
      executionVia: isExecutable ? 'mexc_futures' : 'spot_hedge'
    };
  });

  const mexcReady = hasExchangeCredentials(c.env, 'mexc');

  return c.json({
    success: true,
    perpsEnabled: true,
    mexcFuturesConfigured: mexcReady,
    lastPerpsOpp: lastScan?.perps || null,
    lastFundingOpp: lastScan?.funding || null,
    exchangeStatus,
    executionNote: mexcReady
      ? 'MEXC Futures active — perps orders placed via contract.mexc.com'
      : 'MEXC credentials missing — perps will run as spot hedge on best available exchange'
  });
});

// ── API: Execution health (auth-protected) ───────────────────────────────────
// Returns a concise readiness snapshot for live execution routing:
// - spotReady: whether MEXC spot is available and funded
// - futuresReady: whether MEXC futures auth/balance call succeeds
// - executionMode: futures+spot or spot-fallback
app.get('/api/execution-health', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

  const [state, lastScan] = await Promise.all([
    getState(c.env),
    c.env.BOT_STATE.get('nexus_last_scan', 'json').catch(() => null)
  ]);
  const executorStats = getAutoExecutor(c.env).getStats();

  const mexcConfigured = hasExchangeCredentials(c.env, 'mexc');

  let spotReady = false;
  let spotBalance = null;
  let spotError = null;
  if (mexcConfigured) {
    try {
      const bal = await getMEXCBalance(c.env, 'USDT');
      spotBalance = bal;
      spotReady = bal.free > 0;
    } catch (e) {
      spotError = e.message;
    }
  }

  let futuresReady = false;
  let futuresBalance = null;
  let futuresError = null;
  if (mexcConfigured) {
    try {
      futuresBalance = await getMEXCFuturesBalance(c.env, 'USDT');
      futuresReady = true;
    } catch (e) {
      futuresError = e.message;
    }
  }

  const executionMode = futuresReady ? 'futures+spot' : (spotReady ? 'spot-fallback' : 'blocked');
  const paperMode = state?.paper_trading !== false;
  const blockedReasons = [];
  if (!mexcConfigured) blockedReasons.push('MEXC credentials missing');
  if (spotError) blockedReasons.push(`Spot: ${spotError}`);
  if (futuresError) blockedReasons.push(`Futures: ${futuresError}`);

  return c.json({
    success: true,
    tradingEnabled: !!state?.trading_enabled,
    paperMode,
    paperTrading: paperMode,
    mexcConfigured,
    spotReady,
    futuresReady,
    executionMode,
    spotBalance,
    futuresBalance,
    spotError,
    futuresError,
    blockedReasons,
    strategies: executorStats.strategies,
    portfolioBalance: Number(executorStats.portfolioBalance || 0),
    openPositions: executorStats.openPositions,
    lastPerpsOpp: lastScan?.perps || null,
    lastScanTimestamp: lastScan?.timestamp || null,
  });
});

// ── API: Per-exchange status & balance ────────────────────────────────────────
// GET /api/exchange/:exchange — returns connection status and USDT balance for
// a single exchange.  Auth-protected.
app.get('/api/exchange/:exchange', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  const exchange = c.req.param('exchange').toLowerCase();
  const isActive  = ACTIVE_EXECUTION_EXCHANGES.includes(exchange);
  const isDataOnly = DATA_ONLY_EXCHANGES.has(exchange);
  if (!isActive && !isDataOnly) {
    return c.json({ error: `Unknown exchange: ${exchange}` }, 404);
  }
  if (isDataOnly) {
    return c.json({
      exchange,
      configured: false,
      balance: null,
      dataOnly: true,
      note: 'German regulatory restriction — price feed only, no live execution'
    });
  }
  const configured = hasExchangeCredentials(c.env, exchange);
  if (!configured) {
    return c.json({ exchange, configured: false, balance: null });
  }
  try {
    const balance = await getExchangeBalance(c.env, exchange, 'USDT');
    return c.json({ exchange, configured: true, balance });
  } catch (e) {
    return c.json({ exchange, configured: true, balance: null, error: e.message }, 502);
  }
});

// GET /api/market/price/:symbol — fetches all currently available spot quotes
// for a symbol, including optional free providers (Alpha Vantage / Twelve Data).
app.get('/api/market/price/:symbol', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

  const rawSymbol = String(c.req.param('symbol') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!isLikelyTradeableSymbol(rawSymbol)) {
    return c.json({ error: 'invalid market symbol. examples: BTCUSDT, ETHUSDC, ETHBTC' }, 400);
  }

  const quotes = await getAllSpotPrices(c.env, rawSymbol);
  const best = quotes.length
    ? quotes.reduce((prev, next) => (Number(next.price || 0) > Number(prev.price || 0) ? next : prev), quotes[0])
    : null;

  return c.json({
    success: true,
    symbol: rawSymbol,
    quoteCount: quotes.length,
    bestQuote: best,
    quotes,
  });
});

// ── API: Manual order placement on a specific exchange ────────────────────────
// POST /api/exchange/:exchange/order — places a market order on the named
// exchange.  Auth-protected.  Respects paper_trading mode.
// Body: { symbol, side, quantity, sizeUsd }
app.post('/api/exchange/:exchange/order', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

  const exchange = c.req.param('exchange').toLowerCase();
  if (!ACTIVE_EXECUTION_EXCHANGES.includes(exchange)) {
    return c.json({ error: `Exchange not available for execution: ${exchange}` }, 400);
  }
  if (!hasExchangeCredentials(c.env, exchange)) {
    return c.json({ error: `${exchange} API credentials not configured` }, 503);
  }

  let body;
  try { body = await c.req.json(); } catch (_) { return c.json({ error: 'Invalid JSON body' }, 400); }

  const { symbol, side, quantity, sizeUsd } = body || {};
  if (symbol == null || side == null || quantity == null || sizeUsd == null) {
    return c.json({ error: 'Required fields: symbol, side, quantity, sizeUsd' }, 400);
  }
  if (!['BUY', 'SELL'].includes(side?.toUpperCase())) {
    return c.json({ error: 'side must be BUY or SELL' }, 400);
  }
  const parsedSizeUsd = parseFloat(sizeUsd);
  if (isNaN(parsedSizeUsd) || parsedSizeUsd <= 0) {
    return c.json({ error: 'sizeUsd must be a positive number' }, 400);
  }

  const state = await getState(c.env);
  if (state.paper_trading) {
    return c.json({
      success: true,
      paper: true,
      exchange,
      symbol,
      side: side.toUpperCase(),
      quantity,
      sizeUsd,
      note: 'Paper trading mode — no real order placed'
    });
  }

  try {
    const result = await placeExchangeMarketOrder(c.env, exchange, symbol, side.toUpperCase(), quantity, parsedSizeUsd);
    await logAdminEvent(c.env, 'manual-order', c.req.raw);
    return c.json({ success: true, paper: false, exchange, symbol, side: side.toUpperCase(), result });
  } catch (e) {
    return c.json({ success: false, error: e.message }, 502);
  }
});

// GET /api/broker/:broker — returns broker account readiness and account summary.
app.get('/api/broker/:broker', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

  const broker = String(c.req.param('broker') || '').toLowerCase();
  if (!SUPPORTED_BROKERS.includes(broker)) {
    return c.json({ error: `Unsupported broker: ${broker}` }, 404);
  }

  const configured = hasBrokerCredentials(c.env, broker);
  if (!configured) {
    return c.json({
      success: true,
      broker,
      configured: false,
      missing: getMissingBrokerCredentialKeys(c.env, broker),
    });
  }

  try {
    const account = await getBrokerAccountSummary(c.env, broker);
    return c.json({ success: true, broker, configured: true, account });
  } catch (e) {
    return c.json({ success: false, broker, configured: true, error: e.message }, 502);
  }
});

// GET /api/brokers — returns readiness summary for all broker adapters.
app.get('/api/brokers', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

  const results = await Promise.all(
    SUPPORTED_BROKERS.map(async (broker) => {
      const configured = hasBrokerCredentials(c.env, broker);
      if (!configured) {
        return {
          broker,
          configured: false,
          missing: getMissingBrokerCredentialKeys(c.env, broker),
          account: null,
        };
      }

      try {
        const account = await getBrokerAccountSummary(c.env, broker);
        return { broker, configured: true, missing: [], account };
      } catch (e) {
        return { broker, configured: true, missing: [], account: null, error: e.message };
      }
    })
  );

  return c.json({ success: true, brokers: results });
});

// GET /api/free-sources — returns status of free/open-source market integrations.
app.get('/api/free-sources', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

  const sources = [
    {
      id: 'tradingview_widget',
      name: 'TradingView Advanced Widget',
      type: 'open-source-ui',
      configured: true,
      requiresApiKey: false,
      note: 'Free embedded widget for visual market analysis',
    },
    {
      id: 'lightweight_charts',
      name: 'TradingView Lightweight Charts',
      type: 'open-source-ui',
      configured: true,
      requiresApiKey: false,
      note: 'MIT-licensed charting library rendered from bot price API',
    },
    {
      id: 'alphavantage',
      name: 'Alpha Vantage',
      type: 'free-data-provider',
      configured: !!c.env.ALPHA_VANTAGE_API_KEY,
      requiresApiKey: true,
      note: 'Optional free key for extra pricing fallback',
      missing: c.env.ALPHA_VANTAGE_API_KEY ? [] : ['ALPHA_VANTAGE_API_KEY'],
    },
    {
      id: 'twelve_data',
      name: 'Twelve Data',
      type: 'free-data-provider',
      configured: !!c.env.TWELVE_DATA_API_KEY,
      requiresApiKey: true,
      note: 'Optional free key for extra pricing fallback',
      missing: c.env.TWELVE_DATA_API_KEY ? [] : ['TWELVE_DATA_API_KEY'],
    },
    {
      id: 'paper_broker',
      name: 'Internal Paper Broker Adapter',
      type: 'open-source-execution',
      configured: true,
      requiresApiKey: false,
      note: 'Zero-cost simulated execution for backtesting and paper mode',
    },
  ];

  return c.json({ success: true, sources });
});

// POST /api/broker/:broker/order — places a broker market order through unified adapter.
// Body: { symbol, side, quantity, sizeUsd }
app.post('/api/broker/:broker/order', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

  const broker = String(c.req.param('broker') || '').toLowerCase();
  if (!SUPPORTED_BROKERS.includes(broker)) {
    return c.json({ error: `Unsupported broker: ${broker}` }, 404);
  }
  if (!hasBrokerCredentials(c.env, broker)) {
    return c.json({
      error: `${broker} credentials are not configured`,
      missing: getMissingBrokerCredentialKeys(c.env, broker),
    }, 503);
  }

  let body;
  try { body = await c.req.json(); } catch (_) { return c.json({ error: 'Invalid JSON body' }, 400); }

  const { symbol, side, quantity, sizeUsd } = body || {};
  if (!symbol || !side) {
    return c.json({ error: 'Required fields: symbol, side (quantity/sizeUsd optional by broker rule)' }, 400);
  }

  const state = await getState(c.env);
  if (state.paper_trading) {
    return c.json({
      success: true,
      paper: true,
      broker,
      symbol,
      side: String(side || '').toUpperCase(),
      quantity,
      sizeUsd,
      note: 'Paper trading mode — broker order skipped',
    });
  }

  try {
    const result = await placeBrokerMarketOrder(c.env, broker, { symbol, side, quantity, sizeUsd });
    await logAdminEvent(c.env, `broker-order:${broker}`, c.req.raw);
    return c.json({ success: true, paper: false, broker, result });
  } catch (e) {
    return c.json({ success: false, broker, error: e.message }, 502);
  }
});

// ── API: DEX / MetaMask status ────────────────────────────────────────────────
// GET /api/dex — returns on-chain/DEX trading configuration status:
//   - whether Alchemy API key is configured (needed for ETH price feeds)
//   - whether the Go HFT engine is configured (needed for DEX execution)
//   - last DEX scan result from KV state
// DEX execution requires the Go HFT engine + a funded wallet.
// MetaMask integration is handled client-side; this endpoint exposes the
// server-side readiness.  Auth-protected.
app.get('/api/dex', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

  const alchemyConfigured = !!(c.env.ALCHEMY_API_KEY || c.env.ALCHEMY_ETHEREUM_ENDPOINT);
  const hftConfigured = isHFTEngineConfigured(c.env);
  const lastScan = await c.env.BOT_STATE.get('nexus_last_scan', 'json').catch(() => null);

  let currentOpportunity = null;
  if (alchemyConfigured) {
    try {
      currentOpportunity = await scanDEX(c.env);
    } catch (_) {}
  }

  return c.json({
    success: true,
    alchemyConfigured,
    hftEngineConfigured: hftConfigured,
    executionReady: alchemyConfigured && hftConfigured,
    lastDexOpp: lastScan?.dex ?? null,
    currentOpportunity,
    executionNote: hftConfigured
      ? 'Go HFT engine active — DEX orders executed via engine wallet'
      : 'Go HFT engine not configured — set HFT_ENGINE_URL + HFT_ENGINE_SECRET to enable DEX execution',
    metamaskNote: 'MetaMask wallet connect is handled client-side; server executes via HFT engine private key'
  });
});

// ── API: Platform readiness — per-platform detailed status ───────────────────
// GET /api/platforms — returns configuration status, missing keys, and
// execution capabilities for each supported trading platform.
// Auth-protected.
app.get('/api/platforms', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

  const isCredentialError = (msg = '') => {
    const m = String(msg || '').toLowerCase();
    return (
      m.includes('api key info invalid') ||
      m.includes('api-key format invalid') ||
      m.includes('kc-api-key not exists') ||
      m.includes('invalid api key') ||
      m.includes('signature') ||
      m.includes('permission')
    );
  };

  const isNetworkBlockError = (msg = '') => {
    const m = String(msg || '').toLowerCase();
    return (
      m.includes('cloudflare') ||
      m.includes('"block"') ||
      m.includes('<!doctype') ||
      m.includes('access denied')
    );
  };

  const PLATFORM_META = [
    {
      name: 'mexc',
      type: 'cex',
      executionMode: 'spot+futures',
      strategies: ['cex', 'perps', 'funding', 'triangular'],
      note: 'Primary execution exchange — spot and MEXC futures',
      priority: 1,
    },
    {
      name: 'binance',
      type: 'cex',
      executionMode: 'spot',
      strategies: ['cex', 'triangular'],
      note: 'Spot execution + USDM perps price feed',
      priority: 2,
    },
    {
      name: 'bitget',
      type: 'cex',
      executionMode: 'spot',
      strategies: ['cex'],
      note: 'Spot execution',
      priority: 3,
    },
  ];

  // Fetch live USDT balances in parallel for configured CEX platforms
  const platformResults = await Promise.all(
    PLATFORM_META.map(async ({ name, type, executionMode, strategies, note, priority }) => {
      const configured = hasExchangeCredentials(c.env, name);
      const missingKeys = configured ? [] : getMissingCredentialKeys(c.env, name);
      let balance = null;
      let error = null;
      let authValidated = false;
      let statusNote = null;
      if (configured) {
        try {
          balance = await getExchangeBalance(c.env, name, 'USDT');
          authValidated = true;
        } catch (e) {
          balance = 0;
          error = e?.message || 'Balance fetch failed';
          if (isCredentialError(error)) {
            statusNote = 'API credentials are present but invalid.';
          } else if (isNetworkBlockError(error)) {
            statusNote = 'Network/WAF block detected from current egress.';
          }
        }
      }
      return { name, type, executionMode, configured, authValidated, missingKeys, balance, error, statusNote, strategies, note, priority };
    })
  );

  // Public data-only platforms — no credentials required
  const DATA_ONLY_PLATFORMS = [
    {
      name: 'bybit',
      type: 'cex',
      executionMode: 'data-only',
      configured: false,
      missingKeys: [],
      balance: null,
      error: null,
      strategies: ['cex-price-feed', 'perps-price-feed'],
      note: 'بيانات أسعار عامة فقط (قيود تنظيمية BaFin الألمانية — لا تنفيذ)',
      dataOnly: true,
    },
    {
      name: 'gateio',
      type: 'cex',
      executionMode: 'data-only',
      configured: false,
      missingKeys: [],
      balance: null,
      error: null,
      strategies: ['cex-price-feed'],
      note: 'بيانات أسعار عامة فقط (قيود تنظيمية BaFin الألمانية — لا تنفيذ)',
      dataOnly: true,
    },
    {
      name: 'kraken',
      type: 'cex',
      executionMode: 'data-only',
      configured: false,
      missingKeys: [],
      balance: null,
      error: null,
      strategies: ['cex-price-feed'],
      note: 'بيانات أسعار عامة فقط — لا يلزم مفتاح API',
      dataOnly: true,
    },
    {
      name: 'coinbase',
      type: 'cex',
      executionMode: 'data-only',
      configured: false,
      missingKeys: [],
      balance: null,
      error: null,
      strategies: ['cex-price-feed'],
      note: 'بيانات أسعار عامة فقط — لا يلزم مفتاح API',
      dataOnly: true,
    },
  ];
  platformResults.push(...DATA_ONLY_PLATFORMS);

  // MetaMask is browser-only — always considered "configured" on the server side
  platformResults.push({
    name: 'metamask',
    type: 'web3',
    executionMode: 'browser-signing',
    configured: true,
    missingKeys: [],
    balance: null,
    error: null,
    strategies: ['dex-gmx', 'dex-dydx'],
    note: 'Web3 browser wallet; on-chain execution requires browser + MetaMask extension. Server executes via HFT engine private key.'
  });

  const configuredCount = platformResults.filter(p => p.configured).length;

  return c.json({
    success: true,
    summary: { total: platformResults.length, configured: configuredCount, unconfigured: platformResults.length - configuredCount },
    platforms: platformResults
  });
});

// ── API: Symbol catalog discovery (MEXC/Binance/Bitget/MetaMask) ────────────
// GET /api/symbols/catalog
// Optional query params:
//   includeMetaMask=true|false (default true)
//   maxMetaMask=5000
//   maxScan=150
app.get('/api/symbols/catalog', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

  const includeMetaMask = (c.req.query('includeMetaMask') || 'true').toLowerCase() !== 'false';
  const quoteAssets = (c.req.query('quotes') || '').trim();
  const maxMetaMask = Math.max(100, Math.min(20000, parseInt(c.req.query('maxMetaMask') || '5000', 10)));
  const maxScan = Math.max(15, Math.min(500, parseInt(c.req.query('maxScan') || '150', 10)));

  const state = await getState(c.env);
  const scanQuoteAssets = quoteAssets || state.scan_quote_assets;
  const catalog = await discoverSymbolCatalog({
    metaMaskLimit: includeMetaMask ? maxMetaMask : 0,
    quoteAssets: scanQuoteAssets,
  });
  const scanSymbols = await resolveDynamicScanSymbols({
    max_dynamic_symbols: maxScan,
    max_metamask_symbols: maxMetaMask,
    scan_quote_assets: scanQuoteAssets,
  });

  const filteredSources = includeMetaMask
    ? catalog.sources
    : { ...catalog.sources, metamask: [] };

  return c.json({
    success: true,
    summary: {
      mexc: filteredSources.mexc.length,
      binance: filteredSources.binance.length,
      bitget: filteredSources.bitget.length,
      metamask: filteredSources.metamask.length,
      cexUnion: catalog.aggregate.cexUnion.length,
      cexIntersection: catalog.aggregate.cexIntersection.length,
      walletReadableCex: includeMetaMask ? catalog.aggregate.walletReadableCex.length : 0,
      scanSymbols: scanSymbols.length,
    },
    sources: filteredSources,
    aggregate: {
      cexUnion: catalog.aggregate.cexUnion,
      cexIntersection: catalog.aggregate.cexIntersection,
      walletReadableCex: includeMetaMask ? catalog.aggregate.walletReadableCex : [],
      scanSymbols,
    },
  });
});

// ── Admin: Reset daily stats ──────────────────────────────────────────────────
app.post('/reset-daily', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c);
  const state = await getState(c.env);
  state.daily_pnl    = 0;
  state.daily_trades = 0;
  state.daily_volume_usd = 0;
  state.last_daily_reset = Date.now();
  if (state.auto_stopped) {
    state.auto_stopped      = false;
    state.auto_stop_reason  = null;
  }
  await saveState(c.env, state);
  await logAdminEvent(c.env, 'reset-daily', c.req.raw);
  await sendTelegramAlert(c.env, '🔄 *تم إعادة تعيين إحصائيات اليوم يدوياً*');
  return c.text('✅ تم إعادة تعيين إحصائيات اليوم');
});

// ── API: CSV export — also archives to R2 ────────────────────────────────────
app.get('/api/export', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  const from   = c.req.query('from');
  const to     = c.req.query('to');
  const fromMs = from ? new Date(from).getTime() : 0;
  const toMs   = to   ? new Date(to).getTime()   : Date.now();
  if (isNaN(fromMs) || isNaN(toMs)) return c.text('Invalid date parameters', 400);
  const trades = await exportTrades(c.env, fromMs, toMs);
  const headers = ['id', 'strategy', 'size_usd', 'net_profit_percent', 'mode', 'created_at'];
  const rows = trades.map(t =>
    headers.map(h => {
      const v = t[h] ?? '';
      // Quote fields that contain commas or quotes
      const s = String(v);
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')
  );
  const csv = [headers.join(','), ...rows].join('\r\n');
  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Archive to R2 (non-blocking — failure does not affect the download)
  if (c.env.TRADE_LOGS) {
    try {
      const key = `exports/${dateStr}-${Date.now()}.csv`;
      await c.env.TRADE_LOGS.put(key, csv, {
        httpMetadata: { contentType: 'text/csv; charset=utf-8' },
        customMetadata: { from: String(fromMs), to: String(toMs), rows: String(trades.length) },
      });
    } catch (e) {
      console.error('[R2] export archive error:', e.message);
    }
  }

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="trades-${dateStr}.csv"`
    }
  });
});

const DEFAULT_LLM_MODEL = '@cf/meta/llama-3.1-8b-instruct';

function getConfiguredLlmModel(env) {
  const model = typeof env.LLM_MODEL === 'string' ? env.LLM_MODEL.trim() : '';
  return model || DEFAULT_LLM_MODEL;
}

function trimTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function resolveAiGatewayChatUrl(env) {
  const explicit = typeof env.AI_GATEWAY_URL === 'string' ? env.AI_GATEWAY_URL.trim() : '';
  if (explicit) {
    const normalized = trimTrailingSlash(explicit);
    if (normalized.endsWith('/chat/completions')) return normalized;
    if (normalized.endsWith('/v1')) return `${normalized}/chat/completions`;
    return `${normalized}/v1/chat/completions`;
  }

  const gatewayId = typeof env.AI_GATEWAY_ID === 'string' ? env.AI_GATEWAY_ID.trim() : '';
  const accountId = typeof env.CLOUDFLARE_ACCOUNT_ID === 'string' ? env.CLOUDFLARE_ACCOUNT_ID.trim() : '';
  if (gatewayId && accountId) {
    return `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/workers-ai/v1/chat/completions`;
  }

  return '';
}

async function runConfiguredLlm(env, aiParams) {
  const model = getConfiguredLlmModel(env);
  const gatewayUrl = resolveAiGatewayChatUrl(env);

  if (gatewayUrl) {
    const payload = {
      model,
      messages: aiParams.messages,
      max_tokens: aiParams.max_tokens,
    };
    if (typeof aiParams.temperature === 'number') payload.temperature = aiParams.temperature;
    if (typeof aiParams.top_p === 'number') payload.top_p = aiParams.top_p;

    const headers = { 'Content-Type': 'application/json' };
    if (typeof env.AI_GATEWAY_TOKEN === 'string' && env.AI_GATEWAY_TOKEN.trim()) {
      headers.Authorization = `Bearer ${env.AI_GATEWAY_TOKEN.trim()}`;
    }

    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let data = null;
    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch (_) {}

    if (!response.ok) {
      const detail = data?.error?.message || data?.error || responseText || `Gateway HTTP ${response.status}`;
      throw new Error(`AI gateway request failed: ${detail}`);
    }

    const text = data?.choices?.[0]?.message?.content
      ?? data?.output_text
      ?? data?.response
      ?? (typeof data === 'string' ? data : JSON.stringify(data));

    const usage = {
      input_tokens: data?.usage?.prompt_tokens ?? 0,
      output_tokens: data?.usage?.completion_tokens ?? 0,
      total_tokens: data?.usage?.total_tokens ?? 0,
    };

    return { model, text, usage, provider: 'ai-gateway' };
  }

  if (!env.AIWORKER) {
    throw new Error('Workers AI binding not configured and AI gateway is not set');
  }

  const result = await env.AIWORKER.run(model, aiParams);
  const text = result?.response ?? result?.text ?? (typeof result === 'string' ? result : JSON.stringify(result));
  const usage = {
    input_tokens: result?.usage?.prompt_tokens ?? 0,
    output_tokens: result?.usage?.completion_tokens ?? 0,
    total_tokens: result?.usage?.total_tokens ?? 0,
  };
  return { model, text, usage, provider: 'workers-ai' };
}

app.get('/api/ai/health', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

  const model = getConfiguredLlmModel(c.env);
  const gatewayUrl = resolveAiGatewayChatUrl(c.env);

  try {
    const result = await runConfiguredLlm(c.env, {
      messages: [{ role: 'user', content: 'healthcheck' }],
      max_tokens: 8,
      temperature: 0,
    });
    return c.json({
      ok: true,
      provider: result.provider,
      model: result.model,
      gatewayConfigured: !!gatewayUrl,
      gatewayUrl: gatewayUrl || null,
      preview: String(result.text || '').slice(0, 80),
      usage: result.usage,
    });
  } catch (e) {
    return c.json({
      ok: false,
      provider: gatewayUrl ? 'ai-gateway' : 'workers-ai',
      model,
      gatewayConfigured: !!gatewayUrl,
      gatewayUrl: gatewayUrl || null,
      error: e.message,
    }, 500);
  }
});

// ── API: Generic AI inference (OpenAI Responses API schema) ──────────────────
// Accepts a JSON body that conforms to the Responses API request schema and
// returns a response that conforms to the Responses API response schema.
//
// Request schema (required: input):
//   input            – string | array  – user message(s)
//   instructions     – string          – optional system prompt
//   temperature      – number 0–2
//   max_output_tokens– number > 0
//   top_p            – number 0–1
//   stream           – boolean         – streaming not yet supported; ignored
//   tools            – array           – tool definitions (passed to model if supported)
//   tool_choice      – any             – passed through
//   text             – object          – text format hints
//   reasoning        – { effort }      – "none"|"low"|"medium"|"high"
//
// Response schema:
//   id, object:"response", created_at, model, output, output_text, status, usage
app.post('/api/ai', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

  let body;
  try { body = await c.req.json(); } catch (_) { return c.json({ error: 'Invalid JSON' }, 400); }

  // Validate required field
  if (body.input == null) {
    return c.json({ error: 'Missing required field: input' }, 400);
  }

  // Build messages array for Workers AI
  const messages = [];

  // System message from instructions
  if (typeof body.instructions === 'string' && body.instructions.trim()) {
    messages.push({ role: 'system', content: body.instructions.trim() });
  }

  // User content from input
  if (typeof body.input === 'string') {
    messages.push({ role: 'user', content: body.input });
  } else if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (item && typeof item === 'object' && typeof item.role === 'string' && item.role && item.content !== undefined) {
        messages.push({ role: item.role, content: item.content });
      } else if (typeof item === 'string') {
        messages.push({ role: 'user', content: item });
      }
    }
  }

  if (messages.length === 0) {
    return c.json({ error: 'input produced no messages' }, 400);
  }

  // Map reasoning effort to max_tokens multiplier (higher effort → longer response)
  const VALID_EFFORTS = new Set(['none', 'low', 'medium', 'high']);
  const effortMultiplier = { none: 0.25, low: 0.5, medium: 1, high: 2 };
  const effort = body.reasoning?.effort ?? 'medium';
  if (!VALID_EFFORTS.has(effort)) {
    return c.json({ error: `Invalid reasoning.effort value: "${effort}". Must be one of: none, low, medium, high` }, 400);
  }
  const baseMaxTokens = typeof body.max_output_tokens === 'number' && body.max_output_tokens > 0
    ? body.max_output_tokens
    : 512;
  const max_tokens = Math.round(baseMaxTokens * effortMultiplier[effort]);

  const aiParams = { messages, max_tokens };
  if (typeof body.temperature === 'number') aiParams.temperature = body.temperature;
  if (typeof body.top_p       === 'number') aiParams.top_p       = body.top_p;

  const createdAt = Math.floor(Date.now() / 1000);
  const responseId = `resp_${crypto.randomUUID().replace(/-/g, '')}`;

  try {
    const ai = await runConfiguredLlm(c.env, aiParams);

    const outputItem = {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: ai.text }],
    };

    return c.json({
      id:          responseId,
      object:      'response',
      created_at:  createdAt,
      model:       ai.model,
      provider:    ai.provider,
      output:      [outputItem],
      output_text: ai.text,
      status:      'completed',
      usage:       ai.usage,
    });
  } catch (e) {
    console.error('[AI /api/ai] run error:', e.message);
    return c.json({
      id:         responseId,
      object:     'response',
      created_at: createdAt,
      model:      getConfiguredLlmModel(c.env),
      output:     [],
      status:     'failed',
      usage:      { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      error:      e.message,
    }, 500);
  }
});

// ── API: AI Analysis — opportunity-focused endpoint for dashboard ─────────────
// Accepts { opportunity: { symbol, strategy, direction, buyPrice, sellPrice, netPct } }
// Translates to AIWORKER format and returns { analysis, provider }.
app.post('/api/ai-analysis', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

  let body;
  try { body = await c.req.json(); } catch (_) { return c.json({ error: 'Invalid JSON' }, 400); }

  const opp = body.opportunity;
  if (!opp || typeof opp !== 'object') {
    return c.json({ error: 'Missing required field: opportunity' }, 400);
  }

  // Minimum net-spread % considered viable for a real trade after fees
  const MIN_VIABLE_SPREAD_PCT = 0.3;

  const prompt = [
    `You are an expert crypto arbitrage analyst. Analyze the following trading opportunity and provide a concise recommendation (2–4 sentences) covering: whether to execute, key risks, and any concerns about liquidity or timing.`,
    ``,
    `Opportunity:`,
    `- Symbol: ${opp.symbol || '—'}`,
    `- Strategy: ${opp.strategy || '—'}`,
    `- Direction: ${opp.direction || '—'}`,
    `- Buy Price: $${opp.buyPrice || 0}`,
    `- Sell Price: $${opp.sellPrice || 0}`,
    `- Net Profit %: ${opp.netPct || 0}%`,
  ].join('\n');

  // Fallback if no Workers AI binding or gateway config
  if (!c.env.AIWORKER && !resolveAiGatewayChatUrl(c.env)) {
    const fallback = opp.netPct > MIN_VIABLE_SPREAD_PCT
      ? `✅ Potential opportunity: net spread of ${opp.netPct}% is above threshold. Verify liquidity and fee structure before executing. Monitor for slippage — position size should remain small (≤$5 for initial trades).`
      : `⚠️ Low spread: net spread of ${opp.netPct}% may not cover execution costs after slippage. Consider waiting for a higher-quality opportunity.`;
    return c.json({ analysis: fallback, provider: 'fallback' });
  }

  try {
    const ai = await runConfiguredLlm(c.env, {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 256,
    });
    return c.json({ analysis: ai.text, provider: ai.provider, model: ai.model });
  } catch (e) {
    console.error('[AI /api/ai-analysis] error:', e.message);
    return c.json({ error: e.message }, 500);
  }
});

// ── API: Ecosystem integrations ────────────────────────────────────────────────
app.get('/api/ecosystem', (c) => {
  return c.json({
    updated_at: '2026-05-09',
    catalog: getEcosystemCatalog()
  });
});

app.get('/api/ecosystem/recommendation', (c) => {
  const goal = c.req.query('goal') || 'quick_start';
  return c.json(recommendEcosystem(goal));
});

app.get('/api/security/api-keys', (c) => {
  return c.json({
    checklist: getApiKeySecurityChecklist()
  });
});

// ── API: Executable integrations (Hummingbot/Freqtrade/CrewAI/AutoGPT) ────────
app.get('/api/integrations/executive/status', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  try {
    const statuses = await probeExecutableIntegrations(c.env);
    return c.json({ integrations: statuses });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.post('/api/integrations/executive/execute', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  try {
    const { integration, payload } = await c.req.json().catch(() => ({}));
    const ids = listExecutableIntegrationIds();
    if (!ids.includes(integration)) {
      return c.json({ error: `integration must be one of: ${ids.join(', ')}` }, 400);
    }
    const result = await executeExecutableIntegration(c.env, integration, payload || {});
    await logAdminEvent(c.env, `executive:${integration}:execute`, c.req.raw);
    return c.json({ success: true, ...result });
  } catch (e) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

app.post('/api/integrations/executive/execute-all', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  try {
    const body = await c.req.json().catch(() => ({}));
    const results = await executeAllExecutableIntegrations(
      c.env,
      body.payloadByIntegration || {},
      body.defaultPayload || {}
    );
    await logAdminEvent(c.env, 'executive:all:execute', c.req.raw);
    const successCount = results.filter((item) => item.success).length;
    return c.json({
      success: successCount === results.length,
      success_count: successCount,
      total: results.length,
      results,
    });
  } catch (e) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// ── API: Version metadata ─────────────────────────────────────────────────────
// Exposes the current Worker deployment version, tag, and timestamp.
app.get('/api/version', (c) => {
  const v = c.env.METADATA;
  return c.json({
    id:        v?.id        ?? null,
    tag:       v?.tag       ?? null,
    timestamp: v?.timestamp ?? null,
    worker:    'ultimatearbitragehft',
  });
});

// ── Telegram webhook ──────────────────────────────────────────────────────────
app.post('/telegram/webhook', async (c) => {
  // Validate the optional webhook secret set via `wrangler secret put TELEGRAM_WEBHOOK_SECRET`
  // and passed to Telegram during setWebhook as the `secret_token` parameter.
  const expectedSecret = c.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret) {
    const provided = c.req.header('X-Telegram-Bot-Api-Secret-Token');
    if (provided !== expectedSecret) return c.json({ ok: false }, 401);
  }

  const body = await c.req.json().catch((err) => {
    console.error('Telegram webhook JSON parse error:', err?.message);
    return {};
  });
  const msg = body.message || body.edited_message;
  if (!msg) return c.json({ ok: true });

  const chatId = msg.chat.id;
  const text = msg.text || '';
  const token = c.env.TELEGRAM_BOT_TOKEN;
  if (!token) return c.json({ ok: true });
  const allowedChat = String(c.env.TELEGRAM_CHAT_ID || '').trim();
  if (!allowedChat || String(chatId) !== allowedChat) {
    return c.json({ ok: false, error: 'Unauthorized chat' }, 403);
  }

  const send = async (txt) => {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: txt, parse_mode: 'Markdown' })
    });
    await resp.body?.cancel();
  };

  const cmd = text.trim().split(/\s+/)[0].toLowerCase();
  const state = await getState(c.env);

  try {
    if (cmd === '/start' || cmd === '/help') {
      await send(
        `🔷 *Nexus Arbitrage Hub*\n\n` +
        `📊 الاستراتيجيات: CEX + DEX + Perps + Funding Rate\n` +
        `🏦 المنصات: MEXC, Binance, KuCoin, Bitget, Bitmart, Bybit, Gate.io\n` +
        `📈 الأزواج: 29 زوج من أكبر العملات\n\n` +
        `⚡ *الأوامر:*\n` +
        `/status — حالة البوت والإحصائيات\n` +
        `/scan — مسح فوري للفرص\n` +
        `/start\\_trading — تشغيل التداول التلقائي\n` +
        `/stop\\_trading — إيقاف التداول التلقائي\n` +
        `/pnl — الأرباح حسب الاستراتيجية\n` +
        `/mode — الوضع الحالي (Paper/Live)\n` +
        `/help — قائمة الأوامر`
      );
    } else if (cmd === '/status') {
      const equity = (state.initial_capital || 1000) + (state.total_pnl || 0);
      const lastScan = await c.env.BOT_STATE.get('nexus_last_scan', 'json').catch(() => null);
      const configuredExchanges = getConfiguredExchanges(c.env);
      const credStatus = configuredExchanges.length > 0
        ? `✅ ${configuredExchanges.length} منصة مُهيأة: ${configuredExchanges.join(', ')}`
        : `⚠️ لا توجد مفاتيح API — أضف الأسرار عبر: wrangler secret put MEXC_API_KEY`;
      await send(
        `⚙️ *حالة Nexus Hub*\n\n` +
        `الوضع: ${state.paper_trading !== false ? '📄 Paper' : '🔴 Live'}\n` +
        `التداول: ${state.trading_enabled ? '✅ مفعّل' : '❌ متوقف'}\n` +
        `${state.auto_stopped ? `🛑 إيقاف تلقائي: ${state.auto_stop_reason}\n` : ''}` +
        `🔑 المنصات: ${credStatus}\n` +
        `💰 رأس المال: $${equity.toFixed(2)}\n` +
        `📈 إجمالي الأرباح: $${(state.total_pnl || 0).toFixed(2)}\n` +
        `📊 ربح اليوم: $${(state.daily_pnl || 0).toFixed(2)}\n` +
        `🎯 صفقات اليوم: ${state.daily_trades || 0}\n` +
        `📊 إجمالي الصفقات: ${state.total_trades || 0}\n` +
        (lastScan ? `🕐 آخر مسح: ${new Date(lastScan.timestamp).toLocaleString('ar')}` : '🕐 لم يتم المسح بعد')
      );
    } else if (cmd === '/scan') {
      await send('🔍 جاري المسح عبر CEX + DEX + Perps...');
      const result = await runScan(c.env, state, sendTelegramAlert);
      await saveState(c.env, state);
      if (result) {
        const opp = result.opportunity;
        await send(
          `🎯 *أفضل فرصة وُجدت:*\n\n` +
          `الزوج: *${opp.symbol}*\n` +
          `الاستراتيجية: ${opp.strategy.toUpperCase()}\n` +
          `الاتجاه: ${opp.direction}\n` +
          `شراء: $${Number(opp.buyPrice).toFixed(4)}\n` +
          `بيع: $${Number(opp.sellPrice).toFixed(4)}\n` +
          `صافي الربح: *${opp.netPct.toFixed(4)}%*\n` +
          `معامل الأمان: ${(opp.safetyFactor * 100).toFixed(1)}%\n` +
          `الحجم: $${result.sizeUsd.toFixed(2)}`
        );
      } else {
        await send('ℹ️ لا توجد فرص مربحة عند الحد الحالي');
      }
    } else if (cmd === '/start_trading') {
      state.trading_enabled = true;
      state.auto_stopped = false;
      state.auto_stop_reason = null;
      await saveState(c.env, state);
      await send('▶️ *تم تشغيل التداول التلقائي* ✅');
    } else if (cmd === '/stop_trading') {
      state.trading_enabled = false;
      await saveState(c.env, state);
      await send('⏸️ *تم إيقاف التداول التلقائي*');
    } else if (cmd === '/pnl') {
      const pnl = await getStrategyPnL(c.env);
      await send(
        `📊 *الأرباح حسب الاستراتيجية:*\n\n` +
        `📈 CEX: $${pnl.cex.pnl.toFixed(2)} (${pnl.cex.trades} صفقة)\n` +
        `🌐 DEX: $${pnl.dex.pnl.toFixed(2)} (${pnl.dex.trades} صفقة)\n` +
        `⚡ Perps: $${pnl.perps.pnl.toFixed(2)} (${pnl.perps.trades} صفقة)\n` +
        `──────────────────\n` +
        `💰 الإجمالي: $${(state.total_pnl || 0).toFixed(2)}`
      );
    } else if (cmd === '/mode') {
      await send(
        `🎛️ *وضع التداول الحالي:*\n` +
        `${state.paper_trading !== false ? '📄 Paper Trading (تجريبي)' : '🔴 Live Trading (حقيقي)'}\n\n` +
        `لتغيير الوضع استخدم لوحة التحكم على الإنترنت`
      );
    }
  } catch (err) {
    await send(`⚠️ خطأ: ${err.message}`).catch(() => {});
  }
  return c.json({ ok: true });
});

// ── API: Temporal workflow — start ────────────────────────────────────────────
// Starts (or restarts) the ArbitrageTradingWorkflow on Temporal Cloud.
// The workflow calls /scan on this Worker at each cycle interval.
// Body (all optional): { cycleIntervalSeconds, maxCyclesBeforeReset }
app.post('/api/temporal/start', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  if (!c.env.TEMPORAL_API_KEY) {
    return c.json({ error: 'TEMPORAL_API_KEY is not configured' }, 503);
  }
  try {
    const body = await c.req.json().catch(() => ({}));
    const workerUrl = c.env.TEMPORAL_WORKER_URL;
    if (!workerUrl) {
      return c.json({ error: 'TEMPORAL_WORKER_URL is not configured — set it via wrangler secret or [vars] in wrangler.toml' }, 503);
    }
    const result = await startWorkflow(c.env, {
      workerUrl,
      adminToken:           c.env.ADMIN_TOKEN || '',
      cycleIntervalSeconds: body.cycleIntervalSeconds,
      maxCyclesBeforeReset: body.maxCyclesBeforeReset,
    });
    await logAdminEvent(c.env, 'temporal:start', c.req.raw);
    return c.json({ success: true, workflowId: 'arbitrage-trading-session', result });
  } catch (e) {
    console.error('[Temporal] start error:', e.message);
    return c.json({ error: e.message }, 500);
  }
});

// ── API: Temporal workflow — stop ─────────────────────────────────────────────
// Signals the workflow to stop gracefully, or terminates it immediately.
// Body (optional): { force: true } for immediate termination.
app.post('/api/temporal/stop', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  if (!c.env.TEMPORAL_API_KEY) {
    return c.json({ error: 'TEMPORAL_API_KEY is not configured' }, 503);
  }
  try {
    const { force } = await c.req.json().catch(() => ({}));
    const result = force
      ? await terminateWorkflow(c.env)
      : await stopWorkflow(c.env);
    await logAdminEvent(c.env, force ? 'temporal:terminate' : 'temporal:stop', c.req.raw);
    return c.json({ success: true, result });
  } catch (e) {
    console.error('[Temporal] stop error:', e.message);
    return c.json({ error: e.message }, 500);
  }
});

// ── API: Temporal workflow — status ──────────────────────────────────────────
// Returns the Temporal workflow description and live status query snapshot.
app.get('/api/temporal/status', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  if (!c.env.TEMPORAL_API_KEY) {
    return c.json({ error: 'TEMPORAL_API_KEY is not configured' }, 503);
  }
  try {
    const [descResult, queryResult] = await Promise.allSettled([
      describeWorkflow(c.env),
      queryWorkflowStatus(c.env),
    ]);
    return c.json({
      success:     true,
      description: descResult.status  === 'fulfilled' ? descResult.value  : { error: descResult.reason?.message },
      status:      queryResult.status === 'fulfilled' ? queryResult.value : null,
    });
  } catch (e) {
    console.error('[Temporal] status error:', e.message);
    return c.json({ error: e.message }, 500);
  }
});

// ── API: Temporal workflow — set mode ────────────────────────────────────────
// Signals the running workflow to switch trading modes.
// Body: { paper: true|false }
app.post('/api/temporal/mode', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  if (!c.env.TEMPORAL_API_KEY) {
    return c.json({ error: 'TEMPORAL_API_KEY is not configured' }, 503);
  }
  try {
    const { paper } = await c.req.json().catch(() => ({}));
    if (typeof paper !== 'boolean') return c.json({ error: 'body must include { "paper": true|false }' }, 400);
    await setTradingModeSignal(c.env, paper);
    await logAdminEvent(c.env, paper ? 'temporal:mode:paper' : 'temporal:mode:live', c.req.raw);
    return c.json({ success: true, mode: paper ? 'paper' : 'live' });
  } catch (e) {
    console.error('[Temporal] mode error:', e.message);
    return c.json({ error: e.message }, 500);
  }
});

// ── Manual cron trigger ───────────────────────────────────────────────────────
app.get('/cron', async (c) => {
  const result = await runScheduledCycle(c.env);
  return c.json({ success: true, result: result ? 'trade executed' : 'no trade' });
});

// ── API: Backtesting ──────────────────────────────────────────────────────────
// POST /api/backtest — runs a full backtest over stored trade history.
// Body (all optional):
//   from_ms:          start timestamp (default: 30d ago)
//   to_ms:            end timestamp (default: now)
//   initial_capital:  starting equity (default: 1000)
//   min_net_pct:      minimum net profit to include a trade (default: 0)
//   position_frac:    position size as fraction of equity (default: 0.10)
//   strategies:       array of strategy prefixes to filter ['cex','dex','perps',…]
//   run_monte_carlo:  boolean (default: true)
//   run_param_sweep:  boolean (default: false)
app.post('/api/backtest', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return c.json({ error: 'Unauthorized' }, 401);
  try {
    const config = await c.req.json().catch(() => ({}));
    await logAdminEvent(c.env, 'backtest', c.req.raw);
    const results = await runBacktest(c.env, config);
    return c.json(results);
  } catch (e) {
    console.error('[backtest] error:', e.message);
    return c.json({ error: e.message }, 500);
  }
});

// GET /api/backtest/runs — returns recent stored backtest run summaries
app.get('/api/backtest/runs', async (c) => {
  if (!isAuthorized(c.env, c)) return c.json({ error: 'Unauthorized' }, 401);
  try {
    const { getRecentBacktestRuns } = await import('./src/db.js');
    const runs = await getRecentBacktestRuns(c.env, 10);
    return c.json({ runs });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.post('/api/strategies/self-evaluate', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return c.json({ error: 'Unauthorized' }, 401);
  try {
    const body = await c.req.json().catch(() => ({}));
    const days = Math.max(1, Math.min(90, Number(body.days || 7)));
    const toMs = Date.now();
    const fromMs = toMs - days * 24 * 60 * 60 * 1000;
    const backtest = await runBacktest(c.env, {
      from_ms: fromMs,
      to_ms: toMs,
      run_monte_carlo: false,
      run_param_sweep: true,
    });
    const evaluation = evaluateStrategyBreakdown(backtest.strategy_breakdown || {});

    // Persist evaluation results to bot memory (non-blocking)
    recordEvaluation(c.env, evaluation, {
      period_days: days,
      trade_count: backtest.trade_count,
      return_pct: backtest.return_pct,
    }).catch(err => console.warn('[self-evaluate] memory persist error:', err.message));

    return c.json({
      period_days: days,
      trade_count: backtest.trade_count,
      return_pct: backtest.return_pct,
      recommendations: evaluation.recommendations,
      rankings: evaluation.rankings,
      generated_at: evaluation.generatedAt,
    });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// ── API: Bot Memory — long-term learning and strategy memory ───────────────────
// GET  /api/memory — returns memory summary for dashboard display
// POST /api/memory/reset — clears the memory (irreversible, requires auth)
app.get('/api/memory', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  try {
    const memory = await loadBotMemory(c.env);
    const summary = summarizeMemory(memory);
    return c.json({ success: true, summary, updatedAt: memory.updatedAt });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

app.post('/api/memory/reset', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  try {
    await saveBotMemory(c.env, {
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      evaluations: [],
      strategyOutcomes: {},
      strategyWeights: { cex: 1.0, dex: 1.0, perps: 1.0, triangular: 1.0, statistical: 1.0, funding: 1.0 },
      autoTuning: { appliedAt: null, adjustments: [] },
      recommendations: [],
    });
    await logAdminEvent(c.env, 'memory:reset', c.req.raw);
    return c.json({ success: true, message: 'Bot memory cleared' });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── Scheduled cron cycle ─────────────────────────────────────────────────────
async function runScheduledCycle(env) {
  const state = await getState(env);

  if (!state.trading_enabled) {
    console.log('🔕 Nexus: التداول معطّل');
    return null;
  }

  // Daily reset (every 24 h)
  const now = Date.now();
  if (now - (state.last_daily_reset || 0) > 86_400_000) {
    // Send daily summary before resetting counters
    await sendDailyReport(env, state);

    state.daily_pnl = 0;
    state.daily_trades = 0;
    state.daily_volume_usd = 0;
    state.last_daily_reset = now;
    if (state.auto_stopped) {
      state.auto_stopped = false;
      state.auto_stop_reason = null;
      await logBotEvent(env, 'daily_reset', { reset_time: now });
    }
  }

  // Auto-stop guard
  if (state.auto_stopped) {
    console.log('🛑 Nexus: إيقاف تلقائي نشط —', state.auto_stop_reason);
    return null;
  }

  const maxDailyLoss = state.max_daily_loss_usd ?? 25;
  if (state.daily_pnl <= -maxDailyLoss) {
    state.auto_stopped = true;
    state.auto_stop_reason = `تجاوز حد الخسارة اليومية $${maxDailyLoss}`;
    await saveState(env, state);
    await logBotEvent(env, 'auto_stop', { reason: state.auto_stop_reason });
    await sendTelegramAlert(env, `🛑 *إيقاف تلقائي*\n${state.auto_stop_reason}`);
    return null;
  }

  // Throttle: enforce a minimum gap between consecutive trades to prevent
  // over-trading and allow market prices to settle between executions.
  const minMs = (state.min_seconds_between_trades || 30) * 1000;
  if (state.last_trade_timestamp && now - state.last_trade_timestamp < minMs) {
    return null;
  }

  // Drawdown warning alerts (before the scan, so the alert goes out promptly)
  const equity = (state.initial_capital || 1000) + (state.total_pnl || 0);
  await sendDrawdownWarning(env, state, equity);

  const result = await runScan(env, state, sendTelegramAlert);
  await saveState(env, state);
  return result;
}

// ─── Drawdown warning alerts ──────────────────────────────────────────────────
// Sends a Telegram alert when equity drops to a warning or critical threshold.
// Each threshold fires at most once per hour (tracked in KV) to avoid spam.
const DRAWDOWN_WARN_KEY      = 'drawdown_warn_sent';
const DRAWDOWN_WARN_INTERVAL = 60 * 60 * 1000; // 1 hour

async function sendDrawdownWarning(env, state, equity) {
  try {
    const initialCapital = state.initial_capital || 1000;
    const drawdownPct = ((initialCapital - equity) / initialCapital) * 100;

    if (drawdownPct < 5) return; // below warning threshold — nothing to do

    // Read the last-sent timestamps from KV
    const sentRecord = await env.BOT_STATE.get(DRAWDOWN_WARN_KEY, 'json').catch(() => null) || {};
    const now        = Date.now();

    const level    = drawdownPct >= 15 ? 'critical' : drawdownPct >= 10 ? 'high' : 'warning';
    const lastSent = sentRecord[level] || 0;

    if (now - lastSent < DRAWDOWN_WARN_INTERVAL) return; // already alerted recently

    const emoji  = level === 'critical' ? '🚨' : level === 'high' ? '⚠️' : '📉';
    const arabic = level === 'critical' ? 'حرج' : level === 'high' ? 'عالٍ' : 'تحذير';
    await sendTelegramAlert(
      env,
      `${emoji} *تحذير تراجع رأس المال — مستوى ${arabic}*\n\n` +
      `💰 رأس المال الأولي: $${initialCapital.toFixed(2)}\n` +
      `📉 رأس المال الحالي: $${equity.toFixed(2)}\n` +
      `📊 نسبة التراجع: *${drawdownPct.toFixed(1)}%*\n` +
      `📅 ربح/خسارة اليوم: $${(state.daily_pnl || 0).toFixed(2)}\n\n` +
      `${level === 'critical' ? '🛑 يُنصح بإيقاف التداول الآن وإعادة التقييم.' : '⚡ راجع الإعدادات وحدود الخسارة.'}`
    );

    sentRecord[level] = now;
    // TTL is 2× the alert interval so the record outlives at least two windows
    const ttlSeconds = Math.ceil(DRAWDOWN_WARN_INTERVAL / 1000) * 2;
    await env.BOT_STATE.put(DRAWDOWN_WARN_KEY, JSON.stringify(sentRecord), { expirationTtl: ttlSeconds });
  } catch (e) {
    console.error('[drawdown_warning] error:', e.message);
  }
}

// ─── Daily summary Telegram report ───────────────────────────────────────────
async function sendDailyReport(env, state) {
  try {
    const metrics = await getPerformanceMetrics(
      env,
      (state.last_daily_reset || 0),
      Date.now()
    );
    const equity = (state.initial_capital || 1000) + (state.total_pnl || 0);
    const msg =
      `📊 *التقرير اليومي — Nexus Hub*\n\n` +
      `💰 رأس المال الحالي: $${equity.toFixed(2)}\n` +
      `📈 ربح اليوم: $${(state.daily_pnl || 0).toFixed(2)}\n` +
      `🎯 صفقات اليوم: ${state.daily_trades || 0}\n` +
      `──────────────────\n` +
      `✅ صفقات رابحة: ${metrics.win_trades}\n` +
      `❌ صفقات خاسرة: ${metrics.loss_trades}\n` +
      `📊 نسبة الربح: ${(metrics.win_rate * 100).toFixed(1)}%\n` +
      `🏆 أفضل صفقة: $${metrics.best_trade_usd.toFixed(2)}\n` +
      `📉 أسوأ صفقة: $${metrics.worst_trade_usd.toFixed(2)}\n` +
      `📉 أقصى تراجع: $${metrics.max_drawdown_usd.toFixed(2)}\n` +
      `📈 إجمالي الأرباح الكلية: $${(state.total_pnl || 0).toFixed(2)}`;
    await sendTelegramAlert(env, msg);
  } catch (e) {
    console.error('[daily_report] error:', e.message);
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────
export default {
  fetch: app.fetch.bind(app),

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledCycle(env));
  },

  // ── Queue consumer ─────────────────────────────────────────────────────────
  // Processes messages enqueued via env.TRADE_QUEUE.send().
  // Each message is expected to carry { type, data } where type is one of:
  //   "trade_log"   — write a deferred trade record to D1 + R2 daily summary
  //   "alert"       — send a Telegram notification
  async queue(batch, env) {
    for (const msg of batch.messages) {
      try {
        const { type, data } = msg.body;

        if (type === 'trade_log' && env.DB) {
          const { strategy, sizeUsd, netPct, mode } = data;
          await env.DB.prepare(
            `INSERT INTO trades (strategy, size_usd, net_profit_percent, mode, created_at) VALUES (?, ?, ?, ?, ?)`
          ).bind(strategy, sizeUsd, netPct, mode, Date.now()).run();
        }

        if (type === 'alert') {
          await sendTelegramAlert(env, data.message);
        }

        msg.ack();
      } catch (e) {
        console.error('[Queue] message processing error:', e.message);
        msg.retry();
      }
    }
  },
};
