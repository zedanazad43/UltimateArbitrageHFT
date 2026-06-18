// ===== NEXUS ARBITRAGE HUB — Final Integrated Bot =====
// Entry point: ultimate-arbitrage-hft Cloudflare Worker
// Integrates: CEX + DEX + Perps strategies, admin dashboard, Telegram bot
// AI Agent: Autonomous self-learning trading agent v3.0 (Reinforcement Learning + Deep Orchestration)

import { Hono } from 'hono';
import { UnifiedAITradingSystem } from './src/ultimate-ai-engine.js';
import { RailwayMonitor, CloudflareOptimizer, AIModelRouter } from './src/infrastructure-optimizer.js';
import { cors } from 'hono/cors';
import PerformanceOptimizer from './src/performance-optimizer.js';
import ReliabilityManager from './src/reliability-manager.js';
import AnalyticsEngine from './src/analytics-engine.js';
import { renderDashboard, renderChecklist } from './src/dashboard.js';
import { runScan, getExecutionLockState, resetCircuitBreaker } from './src/orchestrator.js';
import { ensureSchema, logAdminEvent, logBotEvent, getRecentTrades, getStrategyPnL, getPerformanceMetrics, exportTrades } from './src/db.js';
import { hasExchangeCredentials, getExchangeBalance, placeExchangeMarketOrder, getMissingCredentialKeys, getConfiguredExchanges, ACTIVE_EXECUTION_EXCHANGES, DATA_ONLY_EXCHANGES, getMEXCFuturesBalance, getMEXCBalance, getEnabledExecutionExchanges, isExecutionExchangeEnabled, getBitgetAccountEquityUSDT } from './src/exchange.js';
import { scanDEX } from './src/strategies/dex.js';
import { isHFTEngineConfigured } from './src/hft-client.js';
import { runBacktest } from './src/backtest.js';
import { evaluateStrategyBreakdown } from './src/self-evaluation.js';
import { getEcosystemCatalog, recommendEcosystem, getApiKeySecurityChecklist } from './src/ecosystem.js';
import { executeAllExecutableIntegrations, executeExecutableIntegration, listExecutableIntegrationIds, probeExecutableIntegrations } from './src/executive-integrations.js';
import { getAutoExecutor } from './src/strategies/auto-executor.js';
import { renderControlPanel } from './src/control-panel.js';
import { loadBotMemory, saveBotMemory, recordEvaluation, summarizeMemory } from './src/bot-memory.js';
import { normalizeRebalancePolicy, computeRebalancePlan, buildRebalanceWeights, buildVenueRoutingWeights } from './src/rebalancer.js';
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
import { registerSystemRoutes } from './src/routes/system-routes.js';
import { registerAiRoutes } from './src/routes/ai-routes.js';

import { CircuitBreaker } from './src/circuit-breaker.js';
import { runLiveMonitor } from './src/monitor-live.js';
import { registerAIMasterRoutes } from './src/routes/aimaster-routes.js';
import { registerTemporalRoutes } from './src/routes/temporal-routes.js';


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
  trading_enabled: false,
  paper_trading: true,
  spot_only_lock: false,
  last_config_change_ts: 0,
  supported_symbols: [],
  scan_symbol_mode: 'cex_union',
  scan_quote_assets: ['USDT', 'USDC', 'FDUSD', 'BUSD', 'DAI', 'TUSD', 'BTC', 'ETH'],
  max_dynamic_symbols: 500,
  max_metamask_symbols: 10000,
  auto_profiler_enabled: true,
  manual_risk_lock: false,
  manual_risk_lock_override: false,
  auto_profile: 'balanced',
  auto_profile_last_change_ts: 0,
  no_opportunity_streak: 0,
  opportunity_hit_streak: 0,
  burst_overdrive_until_ts: 0,
  burst_revert_profile: 'balanced',
  minute_report_enabled: true,
  enforce_core_spot_strategies: true,
  minute_report_last_ts: 0,
  multi_strategy_live: true,
  max_live_trades_per_scan: 8,
  daily_volume_usd: 0,
  daily_limit_usd: 0,           // 0 = no daily limit (use max_daily_loss_usd for risk)
  rebalance_policy: {
    enabled: false,
    targetBufferPct: .1,
    minTransferUsd: 25,
    maxShiftPctPerCycle: .25,
  },
  strategy_flags: {
    cex: true,
    dex: true,
    perps: true,
    funding: true,
    triangular: true,
    statistical: true,
    scalp_forward: true,
    scalp_reverse: true,
    scalp_parallel: true,
  },
  daily_pnl: 0, daily_trades: 0,
  total_pnl: 0, total_trades: 0,
  initial_capital: 1000,
  max_daily_loss_usd: 25,
  min_seconds_between_trades: 3,
  max_per_trade_loss_pct: .02,
  max_spread_pct: 5,
  scalp_min_net_pct: .1,
  scalp_max_hold_seconds: 12,
  scalp_parallel_legs: 2,
  scalp_cooldown_ms: 1500,
  win_rate: .55,
  risk_reward_ratio: 2,
  position_size_usd: 5,       // default small position size (5 USDT)
  position_size_min_usd: 1,   // hard floor
  position_size_max_usd: 500, // hard ceiling
};

const AUTO_PROFILES = {
  conservative: {
    min_seconds_between_trades: 5,
    max_live_trades_per_scan: 4,
    max_dynamic_symbols: 500,
    max_spread_pct: 5,
  },
  balanced: {
    min_seconds_between_trades: 3,
    max_live_trades_per_scan: 6,
    max_dynamic_symbols: 1200,
    max_spread_pct: 7,
  },
  turbo: {
    min_seconds_between_trades: 1,
    max_live_trades_per_scan: 8,
    max_dynamic_symbols: 2000,
    max_spread_pct: 12,
  },
  overdrive: {
    min_seconds_between_trades: 1,
    max_live_trades_per_scan: 10,
    max_dynamic_symbols: 2000,
    max_spread_pct: 25,
  },
};

function parseEnvBool(value) {
  return ['1', 'true', 'on', 'yes'].includes(String(value || '').toLowerCase());
}

function applyForcedManualRiskLockFromEnv(state, env) {
  if (!parseEnvBool(env.MANUAL_RISK_LOCK_FORCE)) return state;
  if (state?.manual_risk_lock_override === true) return state;
  return {
    ...state,
    manual_risk_lock: true,
    auto_profiler_enabled: false,
    burst_overdrive_until_ts: 0,
    position_size_usd: 2,
    max_live_trades_per_scan: 2,
    max_daily_loss_usd: 20,
    max_per_trade_loss_pct: 0.015,
    min_seconds_between_trades: 8,
  };
}

function parseForcedSymbolsEnv(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .filter((s) => s.length >= 6 && s.length <= 20)
    .slice(0, 64);
}

function applyForcedAggressiveExecutionFromEnv(state, env) {
  if (!parseEnvBool(env.AGGRESSIVE_EXECUTION_FORCE)) return state;

  const forcedPosition = Number(env.AGGRESSIVE_FORCED_POSITION_SIZE_USD || 80);
  const forcedMaxLive = Number(env.AGGRESSIVE_FORCED_MAX_LIVE_TRADES_PER_SCAN || 10);
  const forcedScalpMinNet = Number(env.AGGRESSIVE_FORCED_SCALP_MIN_NET_PCT || 0.005);
  const forcedMinGap = Number(env.AGGRESSIVE_FORCED_MIN_SECONDS_BETWEEN_TRADES || 1);
  const forcedSymbols = parseForcedSymbolsEnv(env.AGGRESSIVE_FORCED_SUPPORTED_SYMBOLS);

  const next = {
    ...state,
    manual_risk_lock: false,
    manual_risk_lock_override: true,
    auto_profiler_enabled: false,
    auto_profile: 'overdrive',
    scalp_min_net_pct: Math.max(0.005, Math.min(2.5, forcedScalpMinNet)),
    min_seconds_between_trades: Math.max(1, Math.min(60, Math.floor(forcedMinGap))),
    max_live_trades_per_scan: Math.max(1, Math.min(10, Math.floor(forcedMaxLive))),
    position_size_usd: Math.max(1, Math.min(500, forcedPosition)),
    multi_strategy_live: true,
  };

  if (forcedSymbols.length > 0) {
    next.supported_symbols = forcedSymbols;
    next.scan_symbol_mode = 'cex_intersection';
    next.scan_quote_assets = ['USDT'];
  }

  return next;
}

function clampInt(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function applyProfileToState(state, profileName) {
  const profile = AUTO_PROFILES[profileName] || AUTO_PROFILES.balanced;
  state.auto_profile = profileName in AUTO_PROFILES ? profileName : 'balanced';
  state.min_seconds_between_trades = profile.min_seconds_between_trades;
  state.max_live_trades_per_scan = profile.max_live_trades_per_scan;
  state.max_dynamic_symbols = profile.max_dynamic_symbols;
  state.max_spread_pct = profile.max_spread_pct;
}

function hasLastScanOpportunity(lastScan) {
  if (!lastScan || typeof lastScan !== 'object') return false;
  return Boolean(lastScan.cex || lastScan.perps || lastScan.dex);
}

function buildMinuteScanMessage(state, lastScan) {
  const profile = String(state.auto_profile || 'balanced');
  const mode = state.paper_trading === false ? 'LIVE' : 'PAPER';
  const top = lastScan?.cex || lastScan?.perps || lastScan?.dex || null;

  if (!top) {
    return [
      '⏱️ *Minute Scan Report*',
      `Mode: ${mode}`,
      `Profile: ${profile}`,
      'Opportunity: none',
      `Streak(no-op): ${Number(state.no_opportunity_streak || 0)}`,
      `Symbols: ${Number(state.max_dynamic_symbols || 0)}`,
      `Spread cap: ${Number(state.max_spread_pct || 0)}%`,
    ].join('\n');
  }

  return [
    '⏱️ *Minute Scan Report*',
    `Mode: ${mode}`,
    `Profile: ${profile}`,
    `Strategy: ${String(top.strategy || '').toUpperCase()}`,
    `Symbol: ${top.symbol}`,
    `Direction: ${top.direction}`,
    `Net: ${Number(top.netPct || 0).toFixed(4)}%`,
    `Safety: ${(Number(top.safetyFactor || 0) * 100).toFixed(1)}%`,
  ].join('\n');
}

async function getState(env) {
  const state = await env.BOT_STATE.get('trading_state', 'json').catch((err) => {
    console.error('KV getState error:', err?.message);
    return null;
  }) || { ...DEFAULT_STATE };

  const persistedOverride = await env.BOT_STATE.get('manual_risk_lock_override', 'text').catch(() => null);
  const overrideEnabled = String(persistedOverride || '').trim() === '1' || String(persistedOverride || '').trim().toLowerCase() === 'true';

  const merged = {
    ...DEFAULT_STATE,
    ...state,
    manual_risk_lock_override: state?.manual_risk_lock_override === true || overrideEnabled,
    rebalance_policy: {
      ...DEFAULT_STATE.rebalance_policy,
      ...(state?.rebalance_policy),
    },
    strategy_flags: {
      ...DEFAULT_STATE.strategy_flags,
      ...(state?.strategy_flags),
    },
  };

  return applyForcedAggressiveExecutionFromEnv(
    applyForcedManualRiskLockFromEnv(merged, env),
    env
  );
}

async function saveState(env, state) {
  await env.BOT_STATE.put('trading_state', JSON.stringify(state));
}

async function saveStateWithConfigGuard(env, state, baselineConfigTs = 0) {
  const baselineTs = Number(baselineConfigTs || 0);
  const latest = await getState(env).catch(() => null);
  const latestTs = Number(latest?.last_config_change_ts || 0);

  if (!latest || latestTs <= baselineTs) {
    await saveState(env, state);
    return;
  }

  // Preserve newer operator config and only merge runtime counters from this cycle.
  const merged = {
    ...latest,
    daily_pnl: state.daily_pnl,
    daily_trades: state.daily_trades,
    total_pnl: state.total_pnl,
    total_trades: state.total_trades,
    daily_volume_usd: state.daily_volume_usd,
    last_daily_reset: state.last_daily_reset,
    last_trade_timestamp: state.last_trade_timestamp,
    no_opportunity_streak: state.no_opportunity_streak,
    opportunity_hit_streak: state.opportunity_hit_streak,
    minute_report_last_ts: state.minute_report_last_ts,
    auto_stopped: state.auto_stopped,
    auto_stop_reason: state.auto_stop_reason,
  };

  await saveState(env, merged);
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

function isKnownExternalBalanceWarning(message) {
  const msg = String(message || '').toLowerCase();
  return msg.includes('cloudflare') ||
    msg.includes('access denied') ||
    msg.includes('forbidden') ||
    msg.includes('currently unavailable in the u.s.') ||
    msg.includes('restricted country') ||
    msg.includes('current ip:') ||
    msg.includes('error code: 1016') ||
    msg.includes('non-json response (http 403)') ||
    msg.includes('non-json response (http 429)') ||
    msg.includes('non-json response (http 502)') ||
    msg.includes('non-json response (http 503)') ||
    msg.includes('non-json response (http 504)') ||
    msg.includes('error code: 429') ||
    msg.includes('error code: 502') ||
    msg.includes('error code: 503') ||
    msg.includes('error code: 504') ||
    msg.includes('bad gateway');
}

async function getExecutionBalancesSnapshot(env, assets = ['USDT']) {
  const requestedAssets = Array.isArray(assets) && assets.length ? assets : ['USDT'];
  const primaryAsset = requestedAssets[0];
  const executionExchanges = getEnabledExecutionExchanges(env);
  const results = await Promise.all(
    executionExchanges.map(async (ex) => {
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
        let accountEquityUSDT = null;
        if (ex === 'bitget') {
          try {
            accountEquityUSDT = await getBitgetAccountEquityUSDT(env);
          } catch (err) {
            // Bitget equity lookup is best-effort; fall back to null
            console.error('[balances] bitget equity lookup failed:', err?.message);
            accountEquityUSDT = null;
          }
        }
        return {
          exchange: ex,
          configured: true,
          asset: primaryAsset,
          balance: Number(balances[primaryAsset] || 0),
          balances,
          ...(accountEquityUSDT ? { usdt_equity: accountEquityUSDT } : {}),
        };
      } catch (e) {
        console.error(`[balances] ${ex} fetch failed:`, e.message);
        const message = e.message || 'unknown error';
        return {
          exchange: ex,
          configured: true,
          asset: primaryAsset,
          balance: 0,
          balances: {},
          ...(isKnownExternalBalanceWarning(message) ? { warning: message } : { error: message }),
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

async function probeExchangeBalance(env, exchange) {
  const configured = hasExchangeCredentials(env, exchange);
  if (!configured) {
    return { configured: false, missing: getMissingCredentialKeys(env, exchange), authValidated: false, authError: null };
  }

  try {
    await getExchangeBalance(env, exchange, 'USDT');
    return { configured: true, missing: [], authValidated: true, authError: null };
  } catch (error) {
    return { configured: true, missing: [], authValidated: false, authError: error.message };
  }
}

async function probeExecutionExchanges(env, exchanges = null) {
  const scopedExchanges = Array.isArray(exchanges) && exchanges.length
    ? exchanges
    : getEnabledExecutionExchanges(env);
  const exchangeStatus = {};
  let configuredCount = 0;
  let authValidatedCount = 0;
  let authFailureCount = 0;
  let readinessConfiguredCount = 0;
  let readinessAuthValidatedCount = 0;

  for (const exchange of scopedExchanges) {
    const { configured, missing, authValidated, authError } = await probeExchangeBalance(env, exchange);

    if (configured) {
      configuredCount++;
      if (authValidated) {
        authValidatedCount++;
        readinessConfiguredCount++;
        readinessAuthValidatedCount++;
      } else if (!isKnownExternalBalanceWarning(authError)) {
        authFailureCount++;
        readinessConfiguredCount++;
      }
    }

    exchangeStatus[exchange] = {
      configured,
      missing,
      authValidated,
      authError,
      readinessIgnored: configured && !authValidated && isKnownExternalBalanceWarning(authError),
    };
  }

  return {
    enabledExchanges: scopedExchanges,
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
  const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const re = new RegExp(String.raw`(?:^|;\s*)${safeName}=([^;]*)`);
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
    const ac = i < aLen ? a.codePointAt(i) : 0;
    const bc = i < bLen ? b.codePointAt(i) : 0;
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
  // Setup mode: if neither token is configured, allow access ONLY to /login
  // and /health so the admin can bootstrap. All other routes are denied.
  if (!token && !workflowToken) {
    const path = new URL(c.req.url).pathname;
    return path === '/login' || path === '/health';
  }

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
  const setupBanner = adminConfigured
    ? ''
    : `<div style="background:#e67e22;color:#fff;padding:10px 18px;border-radius:8px;margin-bottom:18px;font-weight:bold;line-height:1.7">
         ⚠️ ADMIN_TOKEN غير مُهيَّأ بعد.<br>
         شغّل: <code style="background:rgba(0,0,0,.25);padding:2px 6px;border-radius:4px">wrangler secret put ADMIN_TOKEN</code>
         ثم أعد النشر.
       </div>`;
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
    this.sessions = []; // WebSocket connections
  }

  async fetch(request) {
    const url = new URL(request.url);

    // WebSocket upgrade for real-time streaming
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.handleSession(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/price') {
      const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
      const price = this.prices[symbol] || 0;
      return Response.json({ price });
    }
    if (url.pathname === '/update' && request.method === 'POST') {
      const { symbol, price } = await request.json();
      if (symbol && price) this.prices[symbol] = price;
      // Broadcast to all connected WebSocket clients
      this.broadcast({ type: 'price', symbol, price, timestamp: Date.now() });
      return Response.json({ ok: true });
    }
    if (url.pathname === '/snapshot') {
      return Response.json({ prices: this.prices, sessions: this.sessions.length });
    }
    return new Response('MarketStreamer OK');
  }

  handleSession(ws) {
    this.sessions.push(ws);
    ws.accept();
    // Send current snapshot on connect
    ws.send(JSON.stringify({ type: 'snapshot', prices: this.prices, timestamp: Date.now() }));

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'subscribe' && msg.symbol) {
          ws.send(JSON.stringify({ type: 'subscribed', symbol: msg.symbol }));
        }
      } catch { /* ignore malformed */ }
    });

    ws.addEventListener('close', () => {
      this.sessions = this.sessions.filter(s => s !== ws);
    });
  }

  broadcast(data) {
    const msg = JSON.stringify(data);
    for (const ws of this.sessions) {
      try { ws.send(msg); } catch { /* disconnected */ }
    }
  }
}

// ─── Hono App ─────────────────────────────────────────────────────────────────
const app = new Hono();
app.use('*', cors({ origin: ['https://ultimatearbitragehft.zedanazad43.workers.dev', 'https://nexus-arbitrage.pages.dev'], allowMethods: ['GET', 'POST'], allowHeaders: ['Content-Type', 'x-admin-token', 'x-workflow-token', 'x-risk-unlock-token'], maxAge: 86400 }));

// ── Global error handler ──────────────────────────────────────────────────────
app.onError((err, c) => {
  console.error('[Worker] unhandled error:', err?.message, err?.stack);
  const safe = (err?.message || 'Unknown error')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return c.html(
    `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px">` +
    `<h1>500 — Internal Server Error</h1><pre>${safe}</pre>` +
    `</body></html>`,
    500
  );
});

// ── Auto-schema middleware — ensures D1 tables exist before any route runs ────
app.use('*', async (c, next) => {
  if (c.req.path === '/control-panel.html') {
    if (c.env.ADMIN_TOKEN && !isAuthorized(c.env, c)) return c.redirect('/login', 302);
    return c.redirect('/control-panel', 302);
  }
  try { await ensureSchema(c.env); } catch (err) { console.error('[schema] ensureSchema failed:', err?.message); }
  return next();
});

// ─── Initialize performance & reliability modules ────────────────────────────
const perfOptimizer = new PerformanceOptimizer({ ttl: 300000, maxSize: 1000 });
const reliabilityMgr = new ReliabilityManager({ maxRetries: 3 });
const analyticsEngine = new AnalyticsEngine();
registerSystemRoutes(app, {
  isAuthorized,
  authDenied,
  resetCircuitBreaker,
  perfOptimizer,
  reliabilityMgr,
  analyticsEngine,
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
        'Set-Cookie': `nexus_session=${encodeURIComponent(crypto.randomUUID())}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}; Path=/${isHttps ? '; Secure' : ''}`,
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

  // D1 health check (non-blocking, best-effort)
  let dbHealthy = false;
  try {
    if (c.env.DB) {
      const { results } = await c.env.DB.prepare('SELECT 1 AS ok').all();
      dbHealthy = results?.[0]?.ok === 1;
    }
  } catch (err) { console.error('[health] D1 check failed:', err?.message); }

  return c.json({
    status: 'ok',
    trading_enabled: state?.trading_enabled ?? false,
    paper_trading: state?.paper_trading ?? true,
    auto_stopped: state?.auto_stopped ?? false,
    equity_usd: equity === null ? null : Number.parseFloat(equity.toFixed(2)),
    daily_pnl_usd: state ? Number.parseFloat((state.daily_pnl || 0).toFixed(2)) : null,
    daily_trades: state?.daily_trades ?? 0,
    db_healthy: dbHealthy,
    timestamp: Date.now(),
  });
});

// ── WebSocket / HFT Engine Integration: Live Price Feed ───────────────────
// GET /prices — returns current prices from the WebSocket price book
// Used by the Go HFT engine and external consumers to get real-time prices
app.get('/prices', async (c) => {
  try {
    const { getPriceBook, initHFTFeed } = await import('./src/feeds/ws-price-book.js');
    const book = getPriceBook();

    // Try to refresh from HFT engine first
    await initHFTFeed(c.env).catch(() => { /* best-effort */ });

    // Build price map organized by symbol → {exchange: price}
    const prices = {};
    const symbols = c.req.query('symbols')?.split(',').map(s => s.trim()) || [];

    if (symbols.length > 0) {
      for (const symbol of symbols) {
        const all = book.getAll(symbol.toUpperCase());
        if (all.length > 0) {
          const exchangeMap = {};
          for (const { exchange, price } of all) {
            exchangeMap[exchange] = price;
          }
          prices[symbol.toUpperCase()] = exchangeMap;
        }
      }
    } else {
      // Return all symbols if none specified (limit to avoid huge responses)
      // This iterates the Map's keys — only available if we expose it
    }

    return c.json({
      success: true,
      timestamp: Date.now(),
      prices,
      feedStatus: 'active',
    });
  } catch {
    return c.json({ success: false, prices: {}, feedStatus: 'unavailable' }, 503);
  }
});

// ── WebSocket Live Price Stream ──────────────────────────────────────────────
// GET /api/prices/stream — upgrades to WebSocket for real-time price streaming.
// Requires MARKET_STREAMER Durable Object binding in wrangler.toml.
// Clients receive { type: 'snapshot', prices, timestamp } on connect,
// then { type: 'price', symbol, exchange, price } updates as they arrive.
app.get('/api/prices/stream', async (c) => {
  if (!c.env.MARKET_STREAMER) {
    return c.json({ error: 'WebSocket streaming not configured (MARKET_STREAMER binding missing)' }, 503);
  }

  // Check for WebSocket upgrade
  if (c.req.header('Upgrade') !== 'websocket') {
    // Return SSE fallback for browsers that don't use WebSocket
    const { getPriceBook } = await import('./src/feeds/ws-price-book.js');
    const book = getPriceBook();
    const symbols = c.req.query('symbols')?.split(',').map(s => s.trim().toUpperCase()) || ['BTCUSDT'];

    let closed = false;
    const stream = new ReadableStream({
      start(controller) {
        const interval = setInterval(() => {
          if (closed) { clearInterval(interval); return; }
          const prices = {};
          for (const symbol of symbols) {
            const all = book.getAll(symbol);
            if (all.length > 0) {
              const exchangeMap = {};
              for (const { exchange, price } of all) exchangeMap[exchange] = price;
              prices[symbol] = exchangeMap;
            }
          }
          controller.enqueue(`data: ${JSON.stringify({ prices, timestamp: Date.now() })}\n\n`);
        }, 1000);
      },
      cancel() { closed = true; },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  // Delegate WebSocket to Durable Object
  const id = c.env.MARKET_STREAMER.idFromName('live-prices');
  const stub = c.env.MARKET_STREAMER.get(id);
  return stub.fetch(c.req.raw);
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

app.get('/control-panel.html', async (c) => {
  if (c.env.ADMIN_TOKEN && !isAuthorized(c.env, c)) return c.redirect('/login', 302);
  return c.redirect('/control-panel', 302);
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

async function makeHmac(secret, msg) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const buf = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

app.get('/debug-futures', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c);
  const results = {};
  const apiKey = c.env.MEXC_API_KEY || '(missing)';
  const apiSecret = c.env.MEXC_API_SECRET || '(missing)';
  results.keyConfigured = apiKey !== '(missing)';
  results.secretConfigured = apiSecret !== '(missing)';

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
  const result = await runScan(c.env, state, sendTelegramAlert, {
    source: 'manual_api',
    trigger: '/scan',
  });
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

// ── Admin: Queue live-deal execution in the background ───────────────────────
// Triggers the same live scan/execution pipeline as /scan, but returns
// immediately so the dashboard can initiate a trade without waiting for a
// potentially long-running scan request to finish.
app.post('/api/live-deal/execute', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c);

  const state = await getState(c.env);
  const execution = runScan(c.env, state, sendTelegramAlert, {
    source: 'manual_api',
    trigger: '/api/live-deal/execute',
  }).catch((err) => {
    console.error('[live-deal-execute] error:', err?.message || err);
    return null;
  });

  if (c.executionCtx?.waitUntil) {
    c.executionCtx.waitUntil(execution);
  }

  const live = await c.env.BOT_STATE.get('nexus_last_scan', 'json').catch(() => null);
  return c.json({
    success: true,
    queued: true,
    message: 'Live deal execution queued',
    liveScanTimestamp: live?.timestamp || null,
    liveOpportunity: live?.cex || live?.triangular || live?.statistical || live?.dex || null,
  });
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
  // daily_limit_usd = 0 means no daily volume limit (risk is managed by max_daily_loss_usd)
  if (!Number.isFinite(state.daily_limit_usd)) {
    return c.text('❌ daily_limit_usd must be a number', 400);
  }
  state.paper_trading = false;
  await saveState(c.env, state);
  await logAdminEvent(c.env, 'mode:live', c.req.raw);
  await sendTelegramAlert(c.env, '🔴 *تم التبديل إلى وضع Live Trading — تنفيذ حقيقي*');
  return c.text('✅ وضع Live مفعّل');
});

// ── Admin: Save config ────────────────────────────────────────────────────────

const num = (v) => (typeof v === 'number' && v > 0 ? v : undefined);

function applyNumericRiskParams(state, body) {
  if (num(body.max_daily_loss_usd)) state.max_daily_loss_usd = body.max_daily_loss_usd;
  if (num(body.daily_limit_usd)) state.daily_limit_usd = body.daily_limit_usd;
  if (num(body.max_per_trade_loss_pct)) state.max_per_trade_loss_pct = body.max_per_trade_loss_pct;
  if (num(body.min_seconds_between_trades)) state.min_seconds_between_trades = body.min_seconds_between_trades;
  if (num(body.initial_capital)) state.initial_capital = body.initial_capital;
  if (num(body.max_spread_pct)) state.max_spread_pct = body.max_spread_pct;
  if (num(body.win_rate)) state.win_rate = body.win_rate;
  if (num(body.risk_reward_ratio)) state.risk_reward_ratio = body.risk_reward_ratio;
}

function applyNumericScalpParams(state, body) {
  if (num(body.scalp_min_net_pct)) state.scalp_min_net_pct = Math.max(0.005, Math.min(2.5, body.scalp_min_net_pct));
  if (num(body.scalp_max_hold_seconds)) state.scalp_max_hold_seconds = Math.max(2, Math.min(120, Math.floor(body.scalp_max_hold_seconds)));
  if (num(body.scalp_parallel_legs)) state.scalp_parallel_legs = Math.max(1, Math.min(3, Math.floor(body.scalp_parallel_legs)));
  if (num(body.scalp_cooldown_ms)) state.scalp_cooldown_ms = Math.max(200, Math.min(15000, Math.floor(body.scalp_cooldown_ms)));
}

function applySymbolConfig(state, body) {
  if (Number.isFinite(body.max_dynamic_symbols)) {
    state.max_dynamic_symbols = Math.max(15, Math.min(2000, Math.floor(body.max_dynamic_symbols)));
  }
  if (Number.isFinite(body.max_metamask_symbols)) {
    state.max_metamask_symbols = Math.max(100, Math.min(20000, Math.floor(body.max_metamask_symbols)));
  }
  if (typeof body.scan_symbol_mode === 'string') {
    const normalizedMode = body.scan_symbol_mode.toLowerCase();
    if (new Set(['cex_union', 'cex_intersection', 'wallet_readable']).has(normalizedMode)) state.scan_symbol_mode = normalizedMode;
  }
  if (Array.isArray(body.scan_quote_assets) || typeof body.scan_quote_assets === 'string') {
    const rawQuotes = Array.isArray(body.scan_quote_assets) ? body.scan_quote_assets : String(body.scan_quote_assets || '').split(',');
    const quotes = [...new Set(rawQuotes.map((v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).filter((q) => q.length >= 3 && q.length <= 10))];
    if (quotes.length > 0) state.scan_quote_assets = quotes;
  }
  if (typeof body.use_dynamic_symbols === 'boolean' && body.use_dynamic_symbols) {
    state.supported_symbols = [];
  }
  if (Array.isArray(body.supported_symbols)) {
    state.supported_symbols = [...new Set(body.supported_symbols
      .map((v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, ''))
      .filter((s) => isLikelyTradeableSymbol(s, state.scan_quote_assets || []))
    )].slice(0, 2000);
  }
}

function applyPositionSizeConfig(state, body) {
  if (num(body.position_size_min_usd)) state.position_size_min_usd = Math.max(1, Math.min(500, body.position_size_min_usd));
  if (num(body.position_size_max_usd)) state.position_size_max_usd = Math.max(1, Math.min(500, body.position_size_max_usd));
  if (state.position_size_min_usd > state.position_size_max_usd) {
    [state.position_size_min_usd, state.position_size_max_usd] = [state.position_size_max_usd, state.position_size_min_usd];
  }
  if (typeof body.position_size_usd === 'number' && body.position_size_usd > 0) {
    state.position_size_usd = Math.max(state.position_size_min_usd ?? 1, Math.min(state.position_size_max_usd ?? 500, body.position_size_usd));
  }
  if (Number.isFinite(body.max_live_trades_per_scan)) {
    state.max_live_trades_per_scan = Math.max(1, Math.min(10, Math.floor(body.max_live_trades_per_scan)));
  }
}

function applyNumericConfig(state, body) {
  applyNumericRiskParams(state, body);
  applyNumericScalpParams(state, body);
  applySymbolConfig(state, body);
  applyPositionSizeConfig(state, body);
}

function applyRiskLockFlags(state, body, forceUnlockManualRiskLock) {
  if (typeof body.manual_risk_lock !== 'boolean') return;
  if (state.manual_risk_lock && body.manual_risk_lock === false && !forceUnlockManualRiskLock) {
    state.manual_risk_lock = true;
  } else {
    state.manual_risk_lock = body.manual_risk_lock;
  }
  if (body.manual_risk_lock === false && forceUnlockManualRiskLock) {
    state.manual_risk_lock_override = true;
  } else if (body.manual_risk_lock === true) {
    state.manual_risk_lock_override = false;
  } else {
    state.manual_risk_lock_override = state.manual_risk_lock_override === true;
  }
}

function applyStrategyFlags(state, body) {
  const requested = body.strategy_flags && typeof body.strategy_flags === 'object' ? body.strategy_flags : null;
  if (!requested) return;
  const current = state.strategy_flags || {};
  const nextFlags = {
    cex: current.cex !== false, dex: current.dex !== false,
    perps: current.perps !== false, funding: current.funding !== false,
    triangular: current.triangular !== false, statistical: current.statistical !== false,
    scalp_forward: current.scalp_forward !== false, scalp_reverse: current.scalp_reverse !== false,
    scalp_parallel: current.scalp_parallel !== false,
  };
  for (const key of Object.keys(nextFlags)) {
    if (typeof requested[key] === 'boolean') nextFlags[key] = requested[key];
  }
  state.strategy_flags = nextFlags;
}

function applyProfileBurstConfig(state, body) {
  if (typeof body.auto_profile === 'string') {
    const requestedProfile = String(body.auto_profile || '').toLowerCase();
    if (!state.manual_risk_lock && AUTO_PROFILES[requestedProfile]) {
      applyProfileToState(state, requestedProfile);
      state.auto_profile_last_change_ts = Date.now();
    }
  }
  if (Number.isFinite(body.burst_overdrive_minutes)) {
    const mins = clampInt(body.burst_overdrive_minutes, 0, 120);
    if (state.manual_risk_lock) {
      state.burst_overdrive_until_ts = 0;
    } else if (mins > 0) {
      state.burst_overdrive_until_ts = Date.now() + mins * 60_000;
    } else {
      state.burst_overdrive_until_ts = 0;
    }
    if (!state.manual_risk_lock && mins > 0) {
      applyProfileToState(state, 'overdrive');
      state.auto_profile_last_change_ts = Date.now();
    }
  }
  if (typeof body.burst_revert_profile === 'string') {
    const requestedRevert = String(body.burst_revert_profile || '').toLowerCase();
    if (['conservative', 'balanced', 'turbo'].includes(requestedRevert)) state.burst_revert_profile = requestedRevert;
  }
}

function applyBooleanConfig(state, body, forceSpotOnlyLock, forceUnlockManualRiskLock) {
  if (typeof body.multi_strategy_live === 'boolean') state.multi_strategy_live = body.multi_strategy_live;
  if (typeof body.auto_profiler_enabled === 'boolean') state.auto_profiler_enabled = body.auto_profiler_enabled;
  if (typeof body.minute_report_enabled === 'boolean') state.minute_report_enabled = body.minute_report_enabled;
  if (typeof body.enforce_core_spot_strategies === 'boolean') state.enforce_core_spot_strategies = body.enforce_core_spot_strategies;

  applyRiskLockFlags(state, body, forceUnlockManualRiskLock);

  if (typeof body.spot_only_lock === 'boolean') {
    state.spot_only_lock = forceSpotOnlyLock ? true : body.spot_only_lock;
  }

  applyStrategyFlags(state, body);
  applyProfileBurstConfig(state, body);
}

function applyRiskLockFinalize(state, forceSpotOnlyLock, lockedRiskValues) {
  if (state.spot_only_lock === true || forceSpotOnlyLock) {
    state.spot_only_lock = true;
    state.strategy_flags = { ...state.strategy_flags, perps: false, funding: false };
  }
  if (state.manual_risk_lock) {
    state.auto_profiler_enabled = false;
    state.burst_overdrive_until_ts = 0;
  }
  if (lockedRiskValues) {
    state.manual_risk_lock = true;
    Object.assign(state, {
      position_size_usd: lockedRiskValues.position_size_usd,
      max_live_trades_per_scan: lockedRiskValues.max_live_trades_per_scan,
      max_daily_loss_usd: lockedRiskValues.max_daily_loss_usd,
      max_per_trade_loss_pct: lockedRiskValues.max_per_trade_loss_pct,
      min_seconds_between_trades: lockedRiskValues.min_seconds_between_trades,
      auto_profiler_enabled: false,
      auto_profile: lockedRiskValues.auto_profile,
      burst_overdrive_until_ts: 0,
    });
  }
}

async function validateConfigAuth(c, state, body, forceManualRiskLock, forceSpotOnlyLock) {
  const forceUnlockRequested = body.force_unlock_manual_risk_lock === true;
  const unlockHeader = String(c.req.header('x-risk-unlock-token') || '').trim();
  const unlockTokenConfigured = String(c.env.RISK_UNLOCK_TOKEN || '').trim();
  let forceUnlockManualRiskLock = false;

  if (forceUnlockRequested) {
    if (!unlockTokenConfigured) {
      return { error: c.json({ success: false, error: 'RISK_UNLOCK_TOKEN is not configured; force unlock is disabled' }, 403), forceUnlockManualRiskLock: false, blockedBySpotLock: false };
    }
    if (!constantTimeEquals(unlockHeader, unlockTokenConfigured)) {
      return { error: c.json({ success: false, error: 'Invalid x-risk-unlock-token' }, 403), forceUnlockManualRiskLock: false, blockedBySpotLock: false };
    }
    forceUnlockManualRiskLock = true;
    await c.env.BOT_STATE.put('manual_risk_lock_override', '1').catch(() => { });
  }

  const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const touching = typeof body.manual_risk_lock === 'boolean' || typeof body.auto_profiler_enabled === 'boolean' ||
    typeof body.auto_profile === 'string' || isFiniteNum(body.position_size_usd) ||
    isFiniteNum(body.max_live_trades_per_scan) || isFiniteNum(body.max_daily_loss_usd) ||
    isFiniteNum(body.max_per_trade_loss_pct) || isFiniteNum(body.min_seconds_between_trades) ||
    isFiniteNum(body.burst_overdrive_minutes) || typeof body.burst_revert_profile === 'string';

  if (forceManualRiskLock && touching) {
    await logAdminEvent(c.env, 'config_forced_lock_rejected', c.req.raw);
    return { error: c.json({ success: false, error: 'MANUAL_RISK_LOCK_FORCE is enabled; protected risk settings are immutable', forcedByEnvironment: true }, 423), forceUnlockManualRiskLock: false, blockedBySpotLock: false };
  }
  if (state.manual_risk_lock === true && touching && !forceUnlockManualRiskLock) {
    await logAdminEvent(c.env, 'config_locked_rejected', c.req.raw);
    return { error: c.json({ success: false, error: 'manual_risk_lock is active; protected risk settings are locked', requiresForceUnlock: true }, 423), forceUnlockManualRiskLock: false, blockedBySpotLock: false };
  }

  const requestedFlags = body.strategy_flags && typeof body.strategy_flags === 'object' ? body.strategy_flags : null;
  const blockedBySpotLock = Boolean((state.spot_only_lock === true || forceSpotOnlyLock) && requestedFlags &&
    (requestedFlags.perps === true || requestedFlags.funding === true));

  return { error: null, forceUnlockManualRiskLock, blockedBySpotLock };
}

app.post('/config', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c);
  let body;
  try { body = await c.req.json(); } catch { return c.text('Invalid JSON', 400); }
  const state = await getState(c.env);
  const forceManualRiskLock = parseEnvBool(c.env.MANUAL_RISK_LOCK_FORCE);
  const forceSpotOnlyLock = ['1', 'true', 'on', 'yes'].includes(String(c.env.SPOT_ONLY_LOCK_FORCE || '').toLowerCase());

  const auth = await validateConfigAuth(c, state, body, forceManualRiskLock, forceSpotOnlyLock);
  if (auth.error) return auth.error;

  const forceUnlockManualRiskLock = auth.forceUnlockManualRiskLock;
  const blockedBySpotLock = auth.blockedBySpotLock;

  const lockProtected = state.manual_risk_lock === true && !forceUnlockManualRiskLock;
  const lockedRiskValues = lockProtected ? {
    position_size_usd: state.position_size_usd, max_live_trades_per_scan: state.max_live_trades_per_scan,
    max_daily_loss_usd: state.max_daily_loss_usd, max_per_trade_loss_pct: state.max_per_trade_loss_pct,
    min_seconds_between_trades: state.min_seconds_between_trades,
    auto_profiler_enabled: state.auto_profiler_enabled, auto_profile: state.auto_profile,
    burst_overdrive_until_ts: state.burst_overdrive_until_ts,
  } : null;

  applyNumericConfig(state, body);
  applyBooleanConfig(state, body, forceSpotOnlyLock, forceUnlockManualRiskLock);
  applyRiskLockFinalize(state, forceSpotOnlyLock, lockedRiskValues);

  if (typeof body.manual_risk_lock === 'boolean') {
    if (forceUnlockManualRiskLock && body.manual_risk_lock === false) {
      await c.env.BOT_STATE.put('manual_risk_lock_override', '1').catch(() => { });
    } else if (body.manual_risk_lock === true) {
      await c.env.BOT_STATE.put('manual_risk_lock_override', '0').catch(() => { });
    }
  }

  state.last_config_change_ts = Date.now();

  if (blockedBySpotLock) {
    await sendTelegramAlert(c.env,
      '🛡️ *Spot-only lock blocked a config transition*\nAttempted to enable perps/funding via /config while lock is active.'
    );
  }

  await saveState(c.env, state);
  await logAdminEvent(c.env, 'config', c.req.raw);
  return c.text('✅ تم حفظ الإعدادات');
});

// ── Admin: Spot-only lock controls ──────────────────────────────────────────
// Explicit endpoint to toggle lock state. When enabled, perps/funding are forced off.
app.post('/strategy/spot-lock/:mode', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c);

  const mode = String(c.req.param('mode') || '').toLowerCase();
  if (!['enable', 'disable'].includes(mode)) {
    return c.text('❌ mode must be enable|disable', 400);
  }
  const forceSpotOnlyLock = ['1', 'true', 'on', 'yes'].includes(String(c.env.SPOT_ONLY_LOCK_FORCE || '').toLowerCase());
  if (forceSpotOnlyLock && mode === 'disable') {
    return c.json({
      success: false,
      error: 'spot_only_lock is forced by environment and cannot be disabled',
      spotOnlyLockForced: true,
    }, 403);
  }

  const state = await getState(c.env);
  state.spot_only_lock = mode === 'enable';
  if (state.spot_only_lock) {
    state.strategy_flags = {
      ...state.strategy_flags,
      perps: false,
      funding: false,
    };

    // Clear stale perp breaker noise while operating in enforced spot-only mode.
    const cbState = await c.env.BOT_STATE.get('nexus_circuit_breaker', 'json').catch(() => null);
    if (cbState && typeof cbState === 'object') {
      delete cbState.mexc_perp;
      await c.env.BOT_STATE.put('nexus_circuit_breaker', JSON.stringify(cbState)).catch(() => { });
    }
  }

  state.last_config_change_ts = Date.now();

  await saveState(c.env, state);
  await logAdminEvent(c.env, 'spot_lock', c.req.raw);
  return c.json({
    success: true,
    spotOnlyLock: state.spot_only_lock,
    strategyFlags: state.strategy_flags,
    note: state.spot_only_lock
      ? 'Spot-only lock enabled: perps/funding forced off'
      : 'Spot-only lock disabled',
  });
});

// ── Admin: Explicit perps enable/disable endpoint ───────────────────────────
// Perps can only be enabled from this dedicated route (not generic /config when lock is on).
app.post('/strategy/perps/:mode', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c);

  const mode = String(c.req.param('mode') || '').toLowerCase();
  if (!['enable', 'disable'].includes(mode)) {
    return c.text('❌ mode must be enable|disable', 400);
  }
  const forceSpotOnlyLock = ['1', 'true', 'on', 'yes'].includes(String(c.env.SPOT_ONLY_LOCK_FORCE || '').toLowerCase());
  if (forceSpotOnlyLock && mode === 'enable') {
    return c.json({
      success: false,
      error: 'perps enable is blocked while spot-only lock is forced by environment',
      spotOnlyLockForced: true,
    }, 403);
  }

  const state = await getState(c.env);
  const current = state.strategy_flags || {};

  if (mode === 'enable') {
    // Explicit enable unlocks spot-only mode by operator intent.
    state.spot_only_lock = false;
    state.strategy_flags = {
      ...current,
      perps: true,
      funding: true,
    };
  } else {
    state.strategy_flags = {
      ...current,
      perps: false,
      funding: false,
    };
  }

  state.last_config_change_ts = Date.now();

  await saveState(c.env, state);
  await logAdminEvent(c.env, 'perps_toggle', c.req.raw);
  return c.json({
    success: true,
    spotOnlyLock: state.spot_only_lock,
    strategyFlags: state.strategy_flags,
  });
});

// ── API: Bot status ───────────────────────────────────────────────────────────
app.get('/api/status', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  const forceSpotOnlyLock = ['1', 'true', 'on', 'yes'].includes(String(c.env.SPOT_ONLY_LOCK_FORCE || '').toLowerCase());
  const [state, lastScan, circuitBreaker] = await Promise.all([
    getState(c.env),
    c.env.BOT_STATE.get('nexus_last_scan', 'json').catch(() => null),
    c.env.BOT_STATE.get('nexus_circuit_breaker', 'json').catch(() => null)
  ]);
  const [summary, metrics] = await Promise.all([
    Promise.resolve(getStateSummary(state)),
    getPerformanceMetrics(c.env).catch(() => null),
  ]);
  if (metrics && Number.isFinite(Number(metrics.total_trades))) {
    summary.totalTrades = Number(metrics.total_trades);
  }
  const cbOut = { ...circuitBreaker };
  const perpsDisabled = state?.strategy_flags?.perps === false || state?.spot_only_lock === true || forceSpotOnlyLock;
  if (perpsDisabled) {
    delete cbOut.mexc_perp;
  }
  return c.json({
    ...state,
    ...summary,
    strategyMode: String(c.env.STRATEGY_MODE || 'multi_exchange').toLowerCase(),
    enabledExecutionExchanges: getEnabledExecutionExchanges(c.env),
    lastScan,
    circuitBreaker: cbOut,
    secretBindings: {
      adminTokenConfigured: !!c.env.ADMIN_TOKEN,
      telegramConfigured: !!c.env.TELEGRAM_BOT_TOKEN && !!c.env.TELEGRAM_CHAT_ID,
      vscodeApiTokenConfigured: !!c.env.VSCODE_API_TOKEN,
    },
  });
});

// ── API: Scan rejection telemetry snapshot ──────────────────────────────────
app.get('/api/scan-rejections', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  const snapshot = await c.env.BOT_STATE.get('nexus_scan_rejections_last', 'json').catch(() => null);
  let data = snapshot;

  if (snapshot && typeof snapshot === 'object') {
    const state = await getState(c.env);
    const enabledExecutionExchanges = getEnabledExecutionExchanges(c.env);
    const liveMinBalanceUsd = Math.max(
      0,
      Number(
        state?.live_execution_min_balance_usd
        ?? c.env?.LIVE_EXECUTION_MIN_BALANCE_USD
        ?? 1
      ) || 0
    );

    const liveExecutionExchangeBalances = {};
    const liveEligibleExecutionExchanges = [];

    await Promise.all(enabledExecutionExchanges.map(async (exchange) => {
      const ex = String(exchange || '').toLowerCase();
      if (!ex) return;

      if (!hasExchangeCredentials(c.env, ex)) {
        liveExecutionExchangeBalances[ex] = {
          configured: false,
          balance: 0,
          eligible: false,
          reason: 'missing_credentials',
        };
        return;
      }

      try {
        const balance = Math.max(0, Number(await getExchangeBalance(c.env, ex, 'USDT') || 0));
        const eligible = balance >= liveMinBalanceUsd;
        if (eligible) liveEligibleExecutionExchanges.push(ex);
        liveExecutionExchangeBalances[ex] = {
          configured: true,
          balance,
          eligible,
          reason: eligible ? 'ok' : 'insufficient_balance',
        };
      } catch (error) {
        const isPermissiveMode = liveMinBalanceUsd <= 0;
        liveExecutionExchangeBalances[ex] = {
          configured: true,
          balance: 0,
          eligible: isPermissiveMode,
          reason: isPermissiveMode ? 'ok_permissive' : 'balance_check_failed',
          error: String(error?.message || error || 'unknown_error'),
        };
        if (isPermissiveMode) liveEligibleExecutionExchanges.push(ex);
      }
    }));

    const metadata = {
      ...snapshot.metadata,
      snapshotSchemaVersion: Number(snapshot?.metadata?.snapshotSchemaVersion || 2),
      liveMinBalanceUsd: Number(snapshot?.metadata?.liveMinBalanceUsd ?? liveMinBalanceUsd),
      liveEligibleExecutionExchanges: Array.isArray(snapshot?.metadata?.liveEligibleExecutionExchanges)
        ? snapshot.metadata.liveEligibleExecutionExchanges
        : liveEligibleExecutionExchanges,
      liveExecutionExchangeBalances:
        snapshot?.metadata?.liveExecutionExchangeBalances && typeof snapshot.metadata.liveExecutionExchangeBalances === 'object'
          ? snapshot.metadata.liveExecutionExchangeBalances
          : liveExecutionExchangeBalances,
    };

    data = {
      ...snapshot,
      metadata,
    };
  }

  return c.json({
    success: true,
    data,
    timestamp: new Date().toISOString(),
  });
});

// ── API: Execution lock diagnostics ─────────────────────────────────────────
app.get('/api/execution-lock', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  const lockState = await getExecutionLockState(c.env);
  return c.json({
    success: true,
    data: lockState,
    timestamp: new Date().toISOString(),
  });
});

// ── API: Safety state snapshot ───────────────────────────────────────────────
// Single payload for operational guardrails and runtime safety checks.

async function probeMexcReadiness(env, mexcConfigured, perpsEnabled) {
  let spotReady = false;
  let spotError = null;
  let spotBalance = null;
  if (mexcConfigured) {
    try {
      const bal = await getMEXCBalance(env, 'USDT');
      spotBalance = bal;
      spotReady = Number(bal?.free || 0) > 0;
    } catch (e) {
      spotError = e.message;
    }
  }

  let futuresReady = false;
  let futuresError = null;
  let futuresBalance = null;
  if (mexcConfigured && perpsEnabled) {
    try {
      futuresBalance = await getMEXCFuturesBalance(env, 'USDT');
      futuresReady = true;
    } catch (e) {
      futuresError = e.message;
    }
  }

  let executionMode;
  if (!perpsEnabled) {
    executionMode = spotReady ? 'spot-only' : 'blocked';
  } else if (futuresReady) {
    executionMode = 'futures+spot';
  } else {
    executionMode = spotReady ? 'spot-fallback' : 'blocked';
  }

  return { spotReady, spotError, spotBalance, futuresReady, futuresError, futuresBalance, executionMode };
}

app.get('/api/safety-state', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  const forceSpotOnlyLock = ['1', 'true', 'on', 'yes'].includes(String(c.env.SPOT_ONLY_LOCK_FORCE || '').toLowerCase());

  const [state, lastScan, executionProbe] = await Promise.all([
    getState(c.env),
    c.env.BOT_STATE.get('nexus_last_scan', 'json').catch(() => null),
    probeExecutionExchanges(c.env),
  ]);
  const [guardStats, guardLast] = await Promise.all([
    c.env.BOT_STATE.get(CORE_STRATEGY_GUARD_STATS_KEY, 'json').catch(() => null),
    c.env.BOT_STATE.get(CORE_STRATEGY_GUARD_LAST_KEY, 'json').catch(() => null),
  ]);

  const adminTokenSet = !!(c.env.ADMIN_TOKEN);
  const tradingEnabled = !!state.trading_enabled;
  const paperMode = state.paper_trading !== false;
  const perpsEnabled = state?.strategy_flags?.perps !== false;
  const mexcConfigured = hasExchangeCredentials(c.env, 'mexc');
  const { spotReady, spotError, futuresReady, futuresError, executionMode } =
    await probeMexcReadiness(c.env, mexcConfigured, perpsEnabled);

  const readyForLive = (
    adminTokenSet &&
    tradingEnabled &&
    !paperMode &&
    executionProbe.allConfiguredExchangesHealthy
  );

  return c.json({
    success: true,
    spotOnlyLock: state.spot_only_lock === true,
    spotOnlyLockForced: forceSpotOnlyLock,
    strategyFlags: state.strategy_flags || {},
    executionMode,
    readyForLive,
    tradingEnabled,
    paperMode,
    perpsEnabled,
    mexcConfigured,
    spotReady,
    futuresReady,
    spotError,
    futuresError,
    lastConfigChangeTs: Number(state.last_config_change_ts || 0),
    coreStrategyGuard: {
      countThisHour: Number(guardStats?.count || 0),
      hourStartTs: Number(guardStats?.hourStart || 0),
      lastInterventionTs: Number(guardLast?.at || 0),
      previousFlags: guardLast?.previous_flags || null,
      nextFlags: guardLast?.strategy_flags || null,
    },
    lastScanTimestamp: lastScan?.timestamp || null,
    timestamp: new Date().toISOString(),
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
  } catch (err) { console.error('[proxy-stats] external proxy unavailable:', err?.message); }
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
  } catch (err) { console.error('[readiness] BitMart bridge unavailable:', err?.message); }

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
  } catch (err) { console.error('[readiness] external proxy unavailable:', err?.message); }

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
    note: (() => {
      if (readyForLive) return 'All systems go — live trading is active';
      if (executionProbe.configuredCount === 0) return 'No executable exchange credentials are configured';
      if (executionProbe.authFailureCount > 0) return 'One or more configured exchanges failed authenticated balance checks';
      return 'One or more pre-requisites are not met; review checks above';
    })(),
    timestamp: new Date().toISOString(),
  });
});

// ── API: Recent trades ────────────────────────────────────────────────────────
app.get('/api/trades', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  const limit = Number.parseInt(c.req.query('limit') || '50', 10);
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
  const from = c.req.query('from');
  const to = c.req.query('to');
  const fromMs = from ? new Date(from).getTime() : 0;
  const toMs = to ? new Date(to).getTime() : Date.now();
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return c.json({ error: 'Invalid date parameters' }, 400);
  const [state, metrics] = await Promise.all([
    getState(c.env),
    getPerformanceMetrics(c.env, fromMs, toMs),
  ]);
  const summary = getStateSummary(state);
  if (metrics && Number.isFinite(Number(metrics.total_trades))) {
    summary.totalTrades = Number(metrics.total_trades);
  }
  return c.json({
    success: true,
    ...summary,
    metrics,
    data: metrics,
    from: fromMs,
    to: toMs,
  });
});

// ── API: Detailed Analytics Dashboard ─────────────────────────────────────────
// GET /api/analytics/detailed — comprehensive trade analytics with strategy breakdown,
// win rates, PnL charts, drawdown metrics, and performance recommendations.
app.get('/api/analytics/detailed', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  const days = Math.max(1, Math.min(90, Number(c.req.query('days') || 7)));
  const capital = Number(c.req.query('capital') || 1000);
  const toMs = Date.now();
  const fromMs = toMs - days * 24 * 60 * 60 * 1000;

  const [state, metrics, trades] = await Promise.all([
    getState(c.env),
    getPerformanceMetrics(c.env, fromMs, toMs),
    exportTrades(c.env, fromMs, toMs),
  ]);

  // Strategy breakdown
  const strategyPnl = await getStrategyPnL(c.env);
  const strategyMap = {};
  for (const [key, val] of Object.entries(strategyPnl)) {
    strategyMap[key] = {
      trades: val.trades || 0,
      pnl: Number((val.pnl || 0).toFixed(2)),
      winRate: val.winRate || 0,
    };
  }

  // Win rate calculation
  const winCount = trades.filter(t => (t.net_profit_percent || 0) > 0).length;
  const lossCount = trades.filter(t => (t.net_profit_percent || 0) < 0).length;
  const totalTrades = trades.length;
  const winRate = totalTrades > 0 ? ((winCount / totalTrades) * 100).toFixed(1) : 0;

  // Drawdown analysis
  let peak = capital;
  let maxDrawdown = 0;
  let currentEquity = capital;
  for (const t of trades) {
    currentEquity += (t.net_profit_percent || 0) > 0 ? (t.size_usd || 0) * (t.net_profit_percent || 0) / 100 : -(t.size_usd || Math.abs(t.net_profit_percent || 0) / 100);
    if (currentEquity > peak) peak = currentEquity;
    const dd = ((peak - currentEquity) / peak) * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Daily PnL trend
  const dailyPnlMap = {};
  for (const t of trades) {
    const day = (t.created_at || '').substring(0, 10);
    dailyPnlMap[day] = (dailyPnlMap[day] || 0) + (t.net_profit_percent || 0);
  }
  const dailyTrend = Object.entries(dailyPnlMap).map(([date, pnl]) => ({ date, pnl: Number(pnl.toFixed(4)) })).sort((a, b) => a.date.localeCompare(b.date));

  // Recommendation engine
  const recommendations = [];
  if (winRate < 45) recommendations.push('⚠️ Win rate below 45% — consider tightening min profit threshold');
  if (maxDrawdown > 15) recommendations.push('🚨 Max drawdown > 15% — reduce position size or enforce stricter stop-loss');
  if (totalTrades < 5 && days >= 3) recommendations.push('📉 Low trade count — widen spread tolerance or increase scan frequency');
  if (totalTrades > 50 && winRate > 55) recommendations.push('✅ Strong performance — consider scaling position size gradually');
  if (Object.values(strategyMap).some(s => s.trades > 0 && s.winRate < 30)) {
    const underperformers = Object.entries(strategyMap).filter(([, s]) => s.trades > 0 && s.winRate < 30).map(([k]) => k).join(', ');
    recommendations.push(`🔧 Underperforming strategies: ${underperformers} — consider disabling or adjusting parameters`);
  }

  return c.json({
    success: true,
    period_days: days,
    summary: {
      totalTrades,
      winCount,
      lossCount,
      winRate: Number(winRate),
      totalPnl: Number((metrics?.total_pnl || state?.total_pnl || 0).toFixed(2)),
      maxDrawdownPct: Number(maxDrawdown.toFixed(2)),
      initialCapital: capital,
      currentEquity: Number(currentEquity.toFixed(2)),
      returnPct: Number((((currentEquity - capital) / capital) * 100).toFixed(2)),
      dailyAvgTrades: Number((totalTrades / days).toFixed(1)),
    },
    strategies: strategyMap,
    dailyTrend,
    recommendations,
    generatedAt: new Date().toISOString(),
  });
});

// ── API: Recent admin/bot logs ───────────────────────────────────────────────
app.get('/api/logs', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  if (!c.env.DB) return c.json({ success: true, data: { admin: [], bot: [] } });

  const limit = Math.min(Number.parseInt(c.req.query('limit') || '50', 10), 200);
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

  const limit = Math.min(Number.parseInt(c.req.query('limit') || '50', 10), 200);
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
    if (cached?._ts && (Date.now() - cached._ts) < CACHE_TTL) {
      return c.json({ success: true, data: cached.data, cached: true, age_ms: Date.now() - cached._ts });
    }
  }

  const data = await getExecutionBalancesSnapshot(c.env, assets);

  // Persist to KV cache in background (don't await — keep response fast)
  if (c.env.BOT_STATE) {
    const payload = JSON.stringify({ data, _ts: Date.now() });
    c.executionCtx.waitUntil(
      c.env.BOT_STATE.put(CACHE_KEY, payload, { expirationTtl: 120 }).catch(() => { })
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

// ── API: Capital routing snapshot (auth-protected) ─────────────────────────
// Returns both the latest scan-time routing snapshot and a live recomputed
// view using current balances/policy.
app.get('/api/capital-routing', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

  const [state, memory] = await Promise.all([
    getState(c.env),
    loadBotMemory(c.env).catch(() => null),
  ]);
  const policy = normalizeRebalancePolicy(state.rebalance_policy || {});
  const balances = await getExecutionBalancesSnapshot(c.env);
  const balanceWeights = buildRebalanceWeights(balances, policy);
  const venueWeights = buildVenueRoutingWeights(balances, memory?.venueOutcomes || {}, policy);
  const last = await c.env.BOT_STATE.get('nexus_capital_routing_last', 'json').catch(() => null);

  return c.json({
    success: true,
    policy,
    lastSnapshot: last,
    live: {
      balances,
      targetBalance: balanceWeights.targetBalance,
      totalBalance: balanceWeights.totalBalance,
      balanceWeights: balanceWeights.weights,
      venueWeights: venueWeights.weights,
      weights: venueWeights.weights,
      venuePolicy: venueWeights.policy,
      venueOutcomeKeys: Object.keys(memory?.venueOutcomes || {}),
    },
    generatedAt: new Date().toISOString(),
  });
});

// ── API: Venue performance snapshot (auth-protected) ───────────────────────
// Merges live balances, venue-aware routing weights, and bot-memory venue
// stats into one sortable payload for operator diagnostics.
app.get('/api/venue-performance', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  const includeDataOnly = c.req.query('includeDataOnly') === '1';

  const [state, memory] = await Promise.all([
    getState(c.env),
    loadBotMemory(c.env).catch(() => null),
  ]);

  const policy = normalizeRebalancePolicy(state.rebalance_policy || {});
  const balances = await getExecutionBalancesSnapshot(c.env);
  const balanceWeights = buildRebalanceWeights(balances, policy);
  const venueWeights = buildVenueRoutingWeights(balances, memory?.venueOutcomes || {}, policy);
  const memorySummary = summarizeMemory(memory || null);
  const venueStats = Array.isArray(memorySummary?.venueStats) ? memorySummary.venueStats : [];
  const venueStatsMap = Object.fromEntries(
    venueStats.map((item) => [String(item.venue || '').toLowerCase(), item])
  );

  const rows = balances.map((entry) => {
    const exchange = String(entry.exchange || '').toLowerCase();
    const stats = venueStatsMap[exchange] || null;
    const wins = Number(stats?.wins || 0);
    const losses = Number(stats?.losses || 0);
    const sampleCount = wins + losses;

    return {
      exchange,
      configured: !!entry.configured,
      dataOnly: !!entry.dataOnly,
      balanceUsd: Number(entry.balance || 0),
      balanceWeights: Number(balanceWeights.weights?.[exchange] ?? 1),
      venueWeight: Number(venueWeights.weights?.[exchange] ?? 1),
      sampleCount,
      wins,
      losses,
      winRate: stats?.winRate ?? null,
      avgLatencyMs: stats?.avgLatencyMs ?? null,
      totalPnlUsd: stats?.totalPnlUsd ?? 0,
      missingKeys: entry.missing_keys || [],
      warning: entry.warning || null,
      error: entry.error || null,
    };
  }).filter((row) => includeDataOnly ? true : !row.dataOnly).sort((a, b) => {
    if (Number(b.configured) !== Number(a.configured)) return Number(b.configured) - Number(a.configured);
    if (Number(a.dataOnly) !== Number(b.dataOnly)) return Number(a.dataOnly) - Number(b.dataOnly);
    if (b.venueWeight !== a.venueWeight) return b.venueWeight - a.venueWeight;
    if ((b.sampleCount || 0) !== (a.sampleCount || 0)) return (b.sampleCount || 0) - (a.sampleCount || 0);
    if ((b.winRate ?? -1) !== (a.winRate ?? -1)) return (b.winRate ?? -1) - (a.winRate ?? -1);
    return (b.balanceUsd || 0) - (a.balanceUsd || 0);
  });

  return c.json({
    success: true,
    policy,
    venuePolicy: venueWeights.policy,
    totalBalanceUsd: venueWeights.totalBalance,
    targetBalanceUsd: venueWeights.targetBalance,
    rows,
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
    ...state.rebalance_policy,
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
  const [state, lastScan, cb] = await Promise.all([
    getState(c.env),
    c.env.BOT_STATE.get('nexus_last_scan', 'json').catch(() => null),
    c.env.BOT_STATE.get('nexus_circuit_breaker', 'json').catch(() => null)
  ]);
  const cbState = cb || {};
  const perpsEnabled = state?.strategy_flags?.perps !== false;

  const perpExchanges = ['mexc_perp', 'binance_perp', 'bybit_perp'];
  const exchangeStatus = perpExchanges.map(ex => {
    const info = cbState[ex];
    const now = Date.now();
    const open = info?.open && (now - (info?.lastFailure || 0)) < 300000;
    // mexc_perp is the only executable perp feed; others are data-only feeds
    const isExecutable = ex === 'mexc_perp';
    const paused = !perpsEnabled;
    let status;
    if (paused) {
      status = 'disabled';
    } else if (open) {
      status = 'open';
    } else {
      status = 'ok';
    }
    return {
      exchange: ex,
      status,
      failures: paused ? 0 : (info?.failures || 0),
      paused,
      dataOnly: !isExecutable,
      executionVia: isExecutable ? 'mexc_futures' : 'spot_hedge'
    };
  });

  const mexcReady = hasExchangeCredentials(c.env, 'mexc');

  let executionNote;
  if (perpsEnabled && mexcReady) {
    executionNote = 'MEXC Futures active — perps orders placed via contract.mexc.com';
  } else if (perpsEnabled) {
    executionNote = 'MEXC credentials missing — perps will run as spot hedge on best available exchange';
  } else {
    executionNote = 'Perps strategy disabled — execution is spot-only';
  }

  return c.json({
    success: true,
    perpsEnabled,
    mexcFuturesConfigured: mexcReady,
    lastPerpsOpp: lastScan?.perps || null,
    lastFundingOpp: lastScan?.funding || null,
    exchangeStatus,
    executionNote,
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
  const perpsEnabled = state?.strategy_flags?.perps !== false;
  const mexcConfigured = hasExchangeCredentials(c.env, 'mexc');
  const { spotReady, spotError, spotBalance, futuresReady, futuresError, futuresBalance, executionMode } =
    await probeMexcReadiness(c.env, mexcConfigured, perpsEnabled);

  const paperMode = state?.paper_trading !== false;
  const blockedReasons = [];
  if (!mexcConfigured) blockedReasons.push('MEXC credentials missing');
  if (spotError) blockedReasons.push(`Spot: ${spotError}`);
  if (futuresError && perpsEnabled) blockedReasons.push(`Futures: ${futuresError}`);

  return c.json({
    success: true,
    tradingEnabled: !!state?.trading_enabled,
    paperMode,
    paperTrading: paperMode,
    mexcConfigured,
    perpsEnabled,
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
  const isActive = ACTIVE_EXECUTION_EXCHANGES.includes(exchange);
  const isDataOnly = DATA_ONLY_EXCHANGES.has(exchange);
  if (!isActive && !isDataOnly) {
    return c.json({ error: `Unknown exchange: ${exchange}` }, 404);
  }
  if (isActive && !isExecutionExchangeEnabled(c.env, exchange)) {
    return c.json({
      exchange,
      configured: false,
      balance: null,
      skipped: true,
      note: 'Execution disabled by EXECUTION_EXCHANGES_ALLOWLIST'
    });
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
    if (exchange === 'bitget') {
      let usdt_equity = null;
      try {
        usdt_equity = await getBitgetAccountEquityUSDT(c.env);
      } catch (err) { console.error('[exchange] bitget equity lookup failed:', err?.message); }
      return c.json({ exchange, configured: true, balance, ...(usdt_equity ? { usdt_equity } : {}) });
    }
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
  if (!isExecutionExchangeEnabled(c.env, exchange)) {
    return c.json({ error: `${exchange} execution is disabled by EXECUTION_EXCHANGES_ALLOWLIST` }, 400);
  }
  if (!hasExchangeCredentials(c.env, exchange)) {
    return c.json({ error: `${exchange} API credentials not configured` }, 503);
  }

  let body;
  try { body = await c.req.json(); } catch (err) { console.error('[exchange-order] JSON parse failed:', err?.message); return c.json({ error: 'Invalid JSON body' }, 400); }

  const { symbol, side, quantity, sizeUsd } = body || {};
  if (symbol == null || side == null || quantity == null || sizeUsd == null) {
    return c.json({ error: 'Required fields: symbol, side, quantity, sizeUsd' }, 400);
  }
  if (!['BUY', 'SELL'].includes(side?.toUpperCase())) {
    return c.json({ error: 'side must be BUY or SELL' }, 400);
  }
  const parsedSizeUsd = Number.parseFloat(sizeUsd);
  if (Number.isNaN(parsedSizeUsd) || parsedSizeUsd <= 0) {
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
      optional: true,
      configured: !!c.env.ALPHA_VANTAGE_API_KEY,
      requiresApiKey: true,
      note: 'Optional free key for extra pricing fallback',
      missing: c.env.ALPHA_VANTAGE_API_KEY ? [] : ['ALPHA_VANTAGE_API_KEY'],
    },
    {
      id: 'twelve_data',
      name: 'Twelve Data',
      type: 'free-data-provider',
      optional: true,
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
  try { body = await c.req.json(); } catch (err) { console.error('[broker-order] JSON parse failed:', err?.message); return c.json({ error: 'Invalid JSON body' }, 400); }

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
    } catch (err) { console.error('[dex] scanDEX failed:', err?.message); }
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
  const enabledExecutionExchanges = new Set(getEnabledExecutionExchanges(c.env));
  const scopedPlatformMeta = PLATFORM_META.filter((platform) => enabledExecutionExchanges.has(platform.name));

  // Fetch live USDT balances in parallel for configured CEX platforms
  const platformResults = await Promise.all(
    scopedPlatformMeta.map(async ({ name, type, executionMode, strategies, note, priority }) => {
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

  // Public data-only platforms + MetaMask — appended in one pass
  const allPlatforms = platformResults.concat([
    { name: 'bybit', type: 'cex', executionMode: 'data-only', configured: false, missingKeys: [], balance: null, error: null, strategies: ['cex-price-feed', 'perps-price-feed'], note: 'بيانات أسعار عامة فقط (قيود تنظيمية BaFin الألمانية — لا تنفيذ)', dataOnly: true },
    { name: 'gateio', type: 'cex', executionMode: 'data-only', configured: false, missingKeys: [], balance: null, error: null, strategies: ['cex-price-feed'], note: 'بيانات أسعار عامة فقط (قيود تنظيمية BaFin الألمانية — لا تنفيذ)', dataOnly: true },
    { name: 'kraken', type: 'cex', executionMode: 'data-only', configured: false, missingKeys: [], balance: null, error: null, strategies: ['cex-price-feed'], note: 'بيانات أسعار عامة فقط — لا يلزم مفتاح API', dataOnly: true },
    { name: 'coinbase', type: 'cex', executionMode: 'data-only', configured: false, missingKeys: [], balance: null, error: null, strategies: ['cex-price-feed'], note: 'بيانات أسعار عامة فقط — لا يلزم مفتاح API', dataOnly: true },
    { name: 'metamask', type: 'web3', executionMode: 'browser-signing', configured: true, missingKeys: [], balance: null, error: null, strategies: ['dex-gmx', 'dex-dydx'], note: 'Web3 browser wallet; on-chain execution requires browser + MetaMask extension. Server executes via HFT engine private key.' },
  ]);
  const configuredCount = allPlatforms.filter(p => p.configured).length;

  return c.json({
    success: true,
    summary: { total: allPlatforms.length, configured: configuredCount, unconfigured: allPlatforms.length - configuredCount },
    platforms: allPlatforms
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
  const maxMetaMask = Math.max(100, Math.min(20000, Number.parseInt(c.req.query('maxMetaMask') || '5000', 10)));
  const maxScan = Math.max(15, Math.min(500, Number.parseInt(c.req.query('maxScan') || '150', 10)));

  const state = await getState(c.env);
  const scanQuoteAssets = quoteAssets || state.scan_quote_assets || ['USDT'];
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
  state.daily_pnl = 0;
  state.daily_trades = 0;
  state.daily_volume_usd = 0;
  state.last_daily_reset = Date.now();
  if (state.auto_stopped) {
    state.auto_stopped = false;
    state.auto_stop_reason = null;
  }
  await saveState(c.env, state);
  await logAdminEvent(c.env, 'reset-daily', c.req.raw);
  await sendTelegramAlert(c.env, '🔄 *تم إعادة تعيين إحصائيات اليوم يدوياً*');
  return c.text('✅ تم إعادة تعيين إحصائيات اليوم');
});

// ── API: CSV export — also archives to R2 ────────────────────────────────────
app.get('/api/export', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  const from = c.req.query('from');
  const to = c.req.query('to');
  const fromMs = from ? new Date(from).getTime() : 0;
  const toMs = to ? new Date(to).getTime() : Date.now();
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return c.text('Invalid date parameters', 400);
  const trades = await exportTrades(c.env, fromMs, toMs);
  const headers = ['id', 'strategy', 'size_usd', 'net_profit_percent', 'mode', 'created_at'];
  const rows = trades.map(t =>
    headers.map(h => {
      const v = t[h] ?? '';
      // Quote fields that contain commas or quotes
      const s = String(v);
      return s.includes(',') || s.includes('"') ? `"${s.replaceAll('"', '""')}"` : s;
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

registerAIMasterRoutes(app);

registerAiRoutes(app, {
  isAuthorized,
  authDenied,
});

// ── AI Trading Agent Routes (v3.0 Unified System) ───────────────────────────
app.get('/api/ai/status', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  const state = await getState(c.env);
  const system = new UnifiedAITradingSystem(c.env, state);
  const report = await system.generateReport();
  return c.json(report);
});

app.get('/api/ai/health', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  const state = await getState(c.env);
  const system = new UnifiedAITradingSystem(c.env, state);
  const health = await system.agent.checkHealth();
  return c.json(health);
});

app.post('/api/ai/recover', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  const state = await getState(c.env);
  const system = new UnifiedAITradingSystem(c.env, state);
  const result = await system.agent.autoRecover();
  return c.json(result);
});

app.get('/api/ai/dex-status', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  const state = await getState(c.env);
  const system = new UnifiedAITradingSystem(c.env, state);
  const dexSnapshot = await system.agent.dex.getDexSnapshot();
  return c.json(dexSnapshot);
});

app.get('/api/ai/rl-stats', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  const state = await getState(c.env);
  const system = new UnifiedAITradingSystem(c.env, state);
  return c.json(system.rl.getStats());
});

app.get('/api/ai/optimizer', async (c) => {
  if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
  const state = await getState(c.env);
  const system = new UnifiedAITradingSystem(c.env, state);
  return c.json(system.optimizer.getStatus());
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

    // ── Infrastructure Optimizer Routes ──────────────────────────────────────────
    app.get('/api/infra/status', async (c) => {
      if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
      const railway = new RailwayMonitor(c.env);
      const cloudflare = new CloudflareOptimizer(c.env);
      const aiRouter = new AIModelRouter(c.env);

      const [railwayHealth, proxyStatus, edgeStatus, aiModels] = await Promise.all([
        railway.checkHealth(),
        railway.getProxyStatus(),
        cloudflare.getEdgeStatus(),
        aiRouter.getAvailableModels(),
      ]);

      return c.json({
        railway: { url: railway.hftUrl, ...railwayHealth, proxy: proxyStatus },
        cloudflare: edgeStatus,
        aiModels,
        timestamp: new Date().toISOString(),
      });
    });
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
    id: v?.id ?? null,
    tag: v?.tag ?? null,
    timestamp: v?.timestamp ?? null,
    worker: 'ultimatearbitragehft',
  });
});

// ── Telegram webhook ──────────────────────────────────────────────────────────

async function handleTelegramHelp(send) {
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
}

async function handleTelegramStatus(env, state, send) {
  const equity = (state.initial_capital || 1000) + (state.total_pnl || 0);
  const lastScan = await env.BOT_STATE.get('nexus_last_scan', 'json').catch(() => null);
  const configuredExchanges = getConfiguredExchanges(env);
  const credStatus = configuredExchanges.length > 0
    ? `✅ ${configuredExchanges.length} منصة مُهيأة: ${configuredExchanges.join(', ')}`
    : `⚠️ لا توجد مفاتيح API — أضف الأسرار عبر: wrangler secret put MEXC_API_KEY`;
  const autoStopLine = state.auto_stopped ? `🛑 إيقاف تلقائي: ${state.auto_stop_reason}\n` : '';
  const modeLabel = state.paper_trading === false ? '🔴 Live' : '📄 Paper';
  await send(
    `⚙️ *حالة Nexus Hub*\n\n` +
    `الوضع: ${modeLabel}\n` +
    `التداول: ${state.trading_enabled ? '✅ مفعّل' : '❌ متوقف'}\n` +
    `${autoStopLine}` +
    `🔑 المنصات: ${credStatus}\n` +
    `💰 رأس المال: $${equity.toFixed(2)}\n` +
    `📈 إجمالي الأرباح: $${(state.total_pnl || 0).toFixed(2)}\n` +
    `📊 ربح اليوم: $${(state.daily_pnl || 0).toFixed(2)}\n` +
    `🎯 صفقات اليوم: ${state.daily_trades || 0}\n` +
    `📊 إجمالي الصفقات: ${state.total_trades || 0}\n` +
    (lastScan ? `🕐 آخر مسح: ${new Date(lastScan.timestamp).toLocaleString('ar')}` : '🕐 لم يتم المسح بعد')
  );
}

async function handleTelegramScan(env, state, send) {
  await send('🔍 جاري المسح عبر CEX + DEX + Perps...');
  const result = await runScan(env, state, sendTelegramAlert, {
    source: 'telegram',
    trigger: '/telegram/webhook:/scan',
  });
  await saveState(env, state);
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
}

async function handleTelegramPnl(env, state, send) {
  const pnl = await getStrategyPnL(env);
  await send(
    `📊 *الأرباح حسب الاستراتيجية:*\n\n` +
    `📈 CEX: $${pnl.cex.pnl.toFixed(2)} (${pnl.cex.trades} صفقة)\n` +
    `🌐 DEX: $${pnl.dex.pnl.toFixed(2)} (${pnl.dex.trades} صفقة)\n` +
    `⚡ Perps: $${pnl.perps.pnl.toFixed(2)} (${pnl.perps.trades} صفقة)\n` +
    `──────────────────\n` +
    `💰 الإجمالي: $${(state.total_pnl || 0).toFixed(2)}`
  );
}

const TELEGRAM_COMMANDS = {
  '/start': handleTelegramHelp,
  '/help': handleTelegramHelp,
  '/status': handleTelegramStatus,
  '/scan': handleTelegramScan,
  '/pnl': handleTelegramPnl,
  '/start_trading': async (env, state, send) => {
    state.trading_enabled = true;
    state.auto_stopped = false;
    state.auto_stop_reason = null;
    await saveState(env, state);
    await send('▶️ *تم تشغيل التداول التلقائي* ✅');
  },
  '/stop_trading': async (env, state, send) => {
    state.trading_enabled = false;
    await saveState(env, state);
    await send('⏸️ *تم إيقاف التداول التلقائي*');
  },
  '/mode': async (_env, state, send) => {
    const paperLabel = state.paper_trading === false ? '🔴 Live Trading (حقيقي)' : '📄 Paper Trading (تجريبي)';
    await send(
      `🎛️ *وضع التداول الحالي:*\n` +
      `${paperLabel}\n\n` +
      `لتغيير الوضع استخدم لوحة التحكم على الإنترنت`
    );
  },
};

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
  const handler = TELEGRAM_COMMANDS[cmd];
  const state = await getState(c.env);

  if (handler) {
    try {
      await handler(c.env, state, send);
    } catch (err) {
      await send(`⚠️ خطأ: ${err.message}`).catch(() => { });
    }
  }

  return c.json({ ok: true });
});

registerTemporalRoutes(app, {
  checkRateLimit,
  isAuthorized,
  authDenied,
  logAdminEvent,
  startWorkflow,
  stopWorkflow,
  terminateWorkflow,
  describeWorkflow,
  queryWorkflowStatus,
  setTradingModeSignal,
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
    const results = runBacktest(c.env, config);
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
    const backtest = runBacktest(c.env, {
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
      venueOutcomes: {},
      strategyWeights: {
        cex: 1,
        dex: 1,
        perps: 1,
        triangular: 1,
        statistical: 1,
        funding: 1,
        scalp_forward: 1,
        scalp_reverse: 1,
        scalp_parallel: 1,
      },
      autoTuning: { appliedAt: null, adjustments: [] },
      recommendations: [],
    });
    await logAdminEvent(c.env, 'memory:reset', c.req.raw);
    return c.json({ success: true, message: 'Bot memory cleared' });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── Scheduled cron cycle helpers ────────────────────────────────────────────

async function enforceSpotLock(env, state, forceSpotOnlyLock, now, cycleStartConfigTs) {
  if (forceSpotOnlyLock && state.spot_only_lock !== true) {
    state.spot_only_lock = true;
  }
  if (state.spot_only_lock !== true && !forceSpotOnlyLock) return false;

  const hasPerps = state?.strategy_flags?.perps !== false;
  const hasFunding = state?.strategy_flags?.funding !== false;
  const hasDexDisabled = state?.strategy_flags?.dex === false;
  const shouldForceDexEnabled = forceSpotOnlyLock && isHFTEngineConfigured(env) && Boolean(env.ALCHEMY_API_KEY);
  if (!hasPerps && !hasFunding && !(shouldForceDexEnabled && hasDexDisabled)) return false;

  state.spot_only_lock = true;
  state.strategy_flags = {
    ...state.strategy_flags,
    dex: shouldForceDexEnabled ? true : (state?.strategy_flags?.dex !== false),
    perps: false,
    funding: false,
  };
  state.last_config_change_ts = now;
  await saveStateWithConfigGuard(env, state, cycleStartConfigTs);
  await logBotEvent(env, 'spot_lock_enforced', { at: now, strategy_flags: state.strategy_flags });
  return true;
}

async function enforceCoreStrategies(env, state, forceSpotOnlyLock, now, cycleStartConfigTs) {
  const shouldEnforce =
    state.enforce_core_spot_strategies !== false &&
    state.paper_trading === false &&
    state.multi_strategy_live !== false;
  if (!shouldEnforce) return;

  const currentFlags = state.strategy_flags || {};
  const nextFlags = {
    ...currentFlags,
    cex: true, dex: true, triangular: true, statistical: true,
    scalp_forward: true, scalp_reverse: true, scalp_parallel: true,
  };
  if (state.spot_only_lock === true || forceSpotOnlyLock) {
    nextFlags.perps = false;
    nextFlags.funding = false;
  }

  const driftDetected =
    currentFlags.cex !== true || currentFlags.dex !== true ||
    currentFlags.triangular !== true || currentFlags.statistical !== true ||
    currentFlags.scalp_forward !== true || currentFlags.scalp_reverse !== true || currentFlags.scalp_parallel !== true ||
    ((state.spot_only_lock === true || forceSpotOnlyLock) &&
      (currentFlags.perps !== false || currentFlags.funding !== false));
  if (!driftDetected) return;

  const previousFlags = {
    cex: currentFlags.cex !== false, dex: currentFlags.dex !== false,
    perps: currentFlags.perps !== false, funding: currentFlags.funding !== false,
    triangular: currentFlags.triangular !== false, statistical: currentFlags.statistical !== false,
    scalp_forward: currentFlags.scalp_forward !== false, scalp_reverse: currentFlags.scalp_reverse !== false,
    scalp_parallel: currentFlags.scalp_parallel !== false,
  };
  state.strategy_flags = nextFlags;
  state.last_config_change_ts = now;

  const hourStart = Math.floor(now / 3_600_000) * 3_600_000;
  const guardStats = await env.BOT_STATE.get(CORE_STRATEGY_GUARD_STATS_KEY, 'json').catch(() => null) || {};
  if (Number(guardStats.hourStart || 0) !== hourStart) { guardStats.hourStart = hourStart; guardStats.count = 0; }
  guardStats.count = Number(guardStats.count || 0) + 1;

  await saveStateWithConfigGuard(env, state, cycleStartConfigTs);
  await env.BOT_STATE.put(CORE_STRATEGY_GUARD_STATS_KEY, JSON.stringify(guardStats), { expirationTtl: 2 * 24 * 60 * 60 }).catch(() => { });
  await env.BOT_STATE.put(CORE_STRATEGY_GUARD_LAST_KEY, JSON.stringify({
    at: now, countThisHour: guardStats.count, previous_flags: previousFlags, strategy_flags: state.strategy_flags,
  }), { expirationTtl: 2 * 24 * 60 * 60 }).catch(() => { });
  await logBotEvent(env, 'core_strategy_guard_enforced', {
    at: now, countThisHour: guardStats.count, previous_flags: previousFlags, strategy_flags: state.strategy_flags,
  });
  await sendTelegramAlert(env,
    '🛡️ *Core Strategy Guard Intervention*\n' +
    `Count (this hour): ${guardStats.count}\n` +
    `Execution mode: ${state.paper_trading === false ? 'LIVE' : 'PAPER'}\n` +
    `Before: tri=${previousFlags.triangular}, stat=${previousFlags.statistical}\n` +
    `After: tri=${state.strategy_flags?.triangular === true}, stat=${state.strategy_flags?.statistical === true}`
  );
}

function handleProfileAndBurst(state, now) {
  const manualRiskLock = state.manual_risk_lock === true;
  if (manualRiskLock) {
    state.auto_profiler_enabled = false;
    state.burst_overdrive_until_ts = 0;
  }

  const inBurst = !manualRiskLock && Number(state.burst_overdrive_until_ts || 0) > now;
  if (!manualRiskLock && inBurst) {
    applyProfileToState(state, 'overdrive');
  } else if (!manualRiskLock && Number(state.burst_overdrive_until_ts || 0) > 0) {
    state.burst_overdrive_until_ts = 0;
    const revertProfile = ['conservative', 'balanced', 'turbo'].includes(String(state.burst_revert_profile || '').toLowerCase())
      ? String(state.burst_revert_profile || '').toLowerCase() : 'balanced';
    applyProfileToState(state, revertProfile);
    state.auto_profile_last_change_ts = now;
  }
  return { manualRiskLock, inBurst };
}

async function handleDailyReset(env, state, now) {
  if (now - (state.last_daily_reset || 0) <= 86_400_000) return;
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

async function applyAutoProfiler(env, state, manualRiskLock, inBurst, now) {
  if (manualRiskLock || !state.auto_profiler_enabled || inBurst) return;
  const noOpp = Number(state.no_opportunity_streak || 0);
  const hitStreak = Number(state.opportunity_hit_streak || 0);
  const currentProfile = String(state.auto_profile || 'balanced');
  let nextProfile = currentProfile;

  if (noOpp >= 6) nextProfile = 'turbo';
  if (noOpp >= 16) nextProfile = 'overdrive';
  if (hitStreak >= 1) nextProfile = 'balanced';

  if (nextProfile !== currentProfile && AUTO_PROFILES[nextProfile]) {
    applyProfileToState(state, nextProfile);
    state.auto_profile_last_change_ts = now;
    await sendTelegramAlert(env,
      `⚙️ *Auto-Profiler* switched profile\n${currentProfile} → ${nextProfile}\n` +
      `no-op streak: ${noOpp}, hit streak: ${hitStreak}`
    );
  }
}

// ─── Scheduled cron cycle ─────────────────────────────────────────────────────
async function runScheduledCycle(env) {
  const state = await getState(env);
  const cycleStartConfigTs = Number(state?.last_config_change_ts || 0);
  const forceSpotOnlyLock = ['1', 'true', 'on', 'yes'].includes(String(env.SPOT_ONLY_LOCK_FORCE || '').toLowerCase());
  const now = Date.now();

  await enforceSpotLock(env, state, forceSpotOnlyLock, now, cycleStartConfigTs);
  await enforceCoreStrategies(env, state, forceSpotOnlyLock, now, cycleStartConfigTs);

  const { manualRiskLock, inBurst } = handleProfileAndBurst(state, now);

  if (!state.trading_enabled) {
    console.log('🔕 Nexus: التداول معطّل');
    return null;
  }

  await handleDailyReset(env, state, now);

  // Circuit breaker check
  const cb = new CircuitBreaker(env.BOT_STATE);
  const breakerAllowed = await cb.isTradingAllowed();
  if (!breakerAllowed) {
    const status = await cb.getStatus();
    console.log('🚫 Circuit breaker OPEN — trading suspended:', status.trip_reason);
    await sendTelegramAlert(env, `🚫 *Circuit Breaker OPEN*\nReason: ${status.trip_reason}\nTrading suspended. Use /api/admin/reset-breaker to reset.`);
    return null;
  }

  // Auto-stop guard
  if (state.auto_stopped) {
    console.log('🛑 Nexus: إيقاف تلقائي نشط —', state.auto_stop_reason);
    return null;
  }

  // ── Daily Loss Limit (MAX_DAILY_LOSS_USD env var overrides default 25) ────
  const maxDailyLoss = Number(env.MAX_DAILY_LOSS_USD) || state.max_daily_loss_usd || 25;
  if (state.daily_pnl <= -maxDailyLoss) {
    state.auto_stopped = true;
    state.auto_stop_reason = `تجاوز حد الخسارة اليومية $${maxDailyLoss} | PnL: $${(state.daily_pnl || 0).toFixed(2)}`;
    await saveStateWithConfigGuard(env, state, cycleStartConfigTs);
    await logBotEvent(env, 'auto_stop', { reason: state.auto_stop_reason, daily_pnl: state.daily_pnl, max_daily_loss_usd: maxDailyLoss });
    await sendTelegramAlert(env,
      `🛑 *إيقاف تلقائي — حد الخسارة اليومية*\n\n` +
      `💰 الحد: $${maxDailyLoss}\n` +
      `📉 خسارة اليوم: $${Math.abs(state.daily_pnl || 0).toFixed(2)}\n` +
      `📊 صفقات اليوم: ${state.daily_trades || 0}\n` +
      `⚙️ المصدر: ${env.MAX_DAILY_LOSS_USD ? 'Cloudflare env var' : 'default config'}\n\n` +
      `🔒 تم إيقاف التداول تلقائياً. راجع الإعدادات ثم شغّل يدوياً.`
    );
    return null;
  }

  // Throttle: enforce a minimum gap between consecutive trades
  const minMs = (state.min_seconds_between_trades || 3) * 1000;
  if (state.last_trade_timestamp && now - state.last_trade_timestamp < minMs) {
    return null;
  }

  const equity = (state.initial_capital || 1000) + (state.total_pnl || 0);
  await sendDrawdownWarning(env, state, equity);

  // ── Unified AI Trading System v3.0 ──────────────────────────────────────
  const aiSystem = new UnifiedAITradingSystem(env, state);
  const marketData = { volatility: 0.5, avgSpread: 0.5, balance: equity };
  const performanceData = { winRate: 0.55, sharpeRatio: 0, recentTrades: [] };
  
  const aiDecision = await aiSystem.execute(scanResults, marketData, performanceData);
  if (!aiDecision.orchestration?.success && aiDecision.rl?.action === 'conservative') {
    console.log(`🤖 AI v3.0: Conservative mode — ${aiDecision.orchestration?.message || 'holding'}`);
    return null;
  }

  const result = await runScan(env, state, sendTelegramAlert, { source: 'scheduled', trigger: 'cron.scheduled' });

  const lastScan = await env.BOT_STATE.get('nexus_last_scan', 'json').catch(() => null);
  const hadOpportunity = hasLastScanOpportunity(lastScan);
  state.no_opportunity_streak = hadOpportunity ? 0 : Number(state.no_opportunity_streak || 0) + 1;
  state.opportunity_hit_streak = hadOpportunity ? Number(state.opportunity_hit_streak || 0) + 1 : 0;

  await applyAutoProfiler(env, state, manualRiskLock, inBurst, now);

  if (state.minute_report_enabled) {
    const lastReportAt = Number(state.minute_report_last_ts || 0);
    if (now - lastReportAt >= 55_000) {
      await sendTelegramAlert(env, buildMinuteScanMessage(state, lastScan));
      state.minute_report_last_ts = now;
    }
  }

  await saveStateWithConfigGuard(env, state, cycleStartConfigTs);
  return result;
}

// ─── Drawdown warning alerts ──────────────────────────────────────────────────
// Sends a Telegram alert when equity drops to a warning or critical threshold.
// Each threshold fires at most once per hour (tracked in KV) to avoid spam.
const DRAWDOWN_WARN_KEY = 'drawdown_warn_sent';
const DRAWDOWN_WARN_INTERVAL = 60 * 60 * 1000; // 1 hour
const CORE_STRATEGY_GUARD_STATS_KEY = 'core_strategy_guard_stats';
const CORE_STRATEGY_GUARD_LAST_KEY = 'core_strategy_guard_last';

async function sendDrawdownWarning(env, state, equity) {
  try {
    const initialCapital = state.initial_capital || 1000;
    const drawdownPct = ((initialCapital - equity) / initialCapital) * 100;

    if (drawdownPct < 5) return; // below warning threshold — nothing to do

    // Read the last-sent timestamps from KV
    const sentRecord = await env.BOT_STATE.get(DRAWDOWN_WARN_KEY, 'json').catch(() => null) || {};
    const now = Date.now();

    let level, emoji, arabic;
    if (drawdownPct >= 15) {
      level = 'critical';
      emoji = '🚨';
      arabic = 'حرج';
    } else if (drawdownPct >= 10) {
      level = 'high';
      emoji = '⚠️';
      arabic = 'عالٍ';
    } else {
      level = 'warning';
      emoji = '📉';
      arabic = 'تحذير';
    }
    const lastSent = sentRecord[level] || 0;
    if (now - lastSent < DRAWDOWN_WARN_INTERVAL) return;

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

// ── Monitor and Circuit Breaker API ────────────────────────────────────────
app.get('/api/monitor/status', async (c) => {
  const breaker = new CircuitBreaker(c.env.BOT_STATE);
  const status = await breaker.getStatus();
  return c.json({ success: true, ...status });
});

app.post('/api/admin/reset-breaker', async (c) => {
  if (!isAuthorized(c)) return authDenied(c, 'reset breaker');
  const breaker = new CircuitBreaker(c.env.BOT_STATE);
  await breaker.reset();
  await logAdminEvent(c.env, 'reset_circuit_breaker', c.req.header('CF-Connecting-IP') || 'unknown');
  return c.json({ success: true, message: 'Circuit breaker reset to HALF_OPEN' });
});

app.post('/api/monitor/run', async (c) => {
  const report = await runLiveMonitor(c.env);
  return c.json(report);
});

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
