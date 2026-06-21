// nexus/src/orchestrator.js — Unified Decision Engine
//
// Runs ALL strategies (CEX, DEX, Perps, Funding, Triangular, Statistical,
// CEX-DEX Bridge, Scalping) in parallel across all supported symbols,
// selects the single best opportunity, applies unified risk checks,
// and executes one trade per cycle.

import { getAllSpotPrices, getMEXCPerpPrice, getBybitPerpData, getBinancePerpData, get0xPrice, resolveDynamicScanSymbols } from './prices.js';
import { scanCEX } from './strategies/cex.js';
import { scanDEX } from './strategies/dex.js';
import { scanPerps } from './strategies/perps.js';
import { scanFundingRate } from './strategies/funding.js';
import { scanTriangular, TRIANGLES, scanTriangularDynamic } from './strategies/triangular.js';
import { scanStatistical, CORRELATED_PAIRS } from './strategies/statistical.js';
import { scanScalpingForward } from './strategies/scalping-forward.js';
import { scanScalpingReverse } from './strategies/scalping-reverse.js';
import { scanScalpingParallel } from './strategies/scalping-parallel.js';
import { scanCexDexBridge, buildCexPriceMap } from './strategies/cex-dex-bridge.js';
import { scanFromHFT, isHFTEngineConfigured } from './hft-client.js';
import { logTrade, openPaperPosition, getOpenPaperPositions, closePaperPosition, logBotEvent } from './db.js';
import { calculateAdaptiveLeverage, calculatePositionSize, MAX_POSITION_EQUITY_FRACTION, checkDrawdownGuard, checkExposureLimit } from './risk.js';
import { logEvent, incrementMetric, observeLatency } from './infra/observability.js';
import { loadBotMemory, recordStrategyOutcome, recordVenueOutcome } from './bot-memory.js';
import { normalizeRebalancePolicy, buildVenueRoutingWeights } from './rebalancer.js';
import {
  placeMEXCFuturesOrder, hasSufficientUSDT,
  hasExchangeCredentials, getRequiredCredentialKeys, getExchangeBalance, placeExchangeMarketOrder,
  getEnabledExecutionExchanges, isExecutionExchangeEnabled
} from './exchange.js';
import { LightningExecutor } from './ultra-fast-engine.js';

const QUOTE_ASSETS = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'DAI', 'TUSD', 'BTC', 'ETH'];
const STABLE_QUOTES = new Set(['USDT', 'USDC', 'FDUSD', 'BUSD', 'DAI', 'TUSD']);
const STRATEGY_SPEED_WEIGHTS = {
  cex: 1.08,
  scalp_forward: 1.18,
  scalp_reverse: 1.15,
  scalp_parallel: 1.12,
  triangular: 0.95,
  statistical: 0.92,
  perps: 1,
  funding: 0.88,
  dex: 0.85,
  cex_dex_bridge: 0.9,
};

function splitSymbol(symbol) {
  const normalized = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const sortedQuotes = [...QUOTE_ASSETS].sort((a, b) => b.length - a.length);
  for (const quote of sortedQuotes) {
    if (!normalized.endsWith(quote)) continue;
    const base = normalized.slice(0, -quote.length);
    if (!base || base.length < 2) continue;
    return { symbol: normalized, base, quote };
  }
  return null;
}

async function getQuoteToUsdRate(env, quoteAsset, openCircuits = new Set()) {
  const quote = String(quoteAsset || '').toUpperCase();
  if (!quote || quote === 'USD') return 1;
  if (STABLE_QUOTES.has(quote)) return 1;

  const symbol = `${quote}USDT`;
  try {
    const prices = await getAllSpotPrices(env, symbol, openCircuits);
    const best = prices.length
      ? prices.reduce((a, b) => (Number(a.price || 0) > Number(b.price || 0) ? a : b), prices[0])
      : null;
    const px = Number(best?.price || 0);
    return Number.isFinite(px) && px > 0 ? px : 0;
  } catch (err) {
    console.warn(`[quote-rate] Failed to get ${quote} rate:`, err.message);
    return 0;
  }
}

const SUPPORTED_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT',
  'BNBUSDT', 'AVAXUSDT', 'MATICUSDT', 'LINKUSDT', 'UNIUSDT',
  'ADAUSDT', 'DOTUSDT', 'LTCUSDT', 'TRXUSDT', 'NEARUSDT',
  'ARBUSDT', 'OPUSDT', 'INJUSDT', 'ATOMUSDT', 'FTMUSDT'
];

async function resolveScanSymbolsForState(state) {
  if (Array.isArray(state?.supported_symbols) && state.supported_symbols.length > 0) {
    return state.supported_symbols;
  }
  try {
    return await resolveDynamicScanSymbols(state || {});
  } catch (err) {
    console.warn('[resolve-symbols] Dynamic scan symbols failed:', err.message);
    return SUPPORTED_SYMBOLS;
  }
}

/**
 * Returns true when the opportunity can be executed in live mode.
 */
const DEX_CHAINS = new Set(['0x', 'ethereum', 'bsc', 'arbitrum', 'polygon', 'optimism']);

export function isLiveExecutableOpportunity(opp) {
  if (!opp) return false;
  if (opp.strategy === 'dex') return false;
  // Statistical arb requires both legs on the same exchange
  if (opp.strategy === 'statistical' && opp.buyExchange !== opp.sellExchange) return false;
  return !DEX_CHAINS.has(opp.buyExchange)
    && !DEX_CHAINS.has(opp.sellExchange);
}

/** Returns true when DEX live execution is configured. */
export function hasDexExecutionConfigured(env) {
  return Boolean(env?.DEX_EXECUTOR_URL);
}

/**
 * Environment-aware live executability check.
 */
export function isLiveExecutableOpportunityWithEnv(opp, env) {
  if (!opp) return false;
  if (opp.strategy === 'dex') return hasDexExecutionConfigured(env);

  // Statistical arb is always executable in paper mode; in live, requires both legs on same exchange
  if (opp.strategy === 'statistical') {
    return opp.buyExchange === opp.sellExchange &&
      isExecutionExchangeEnabled(env, opp.buyExchange) &&
      hasExchangeCredentials(env, opp.buyExchange);
  }

  // Triangular arb executes on a single exchange
  if (opp.strategy === 'triangular') {
    return isExecutionExchangeEnabled(env, opp.buyExchange) &&
      hasExchangeCredentials(env, opp.buyExchange);
  }

  const buyExchange = String(opp.buyExchange || '').toLowerCase();
  const sellExchange = String(opp.sellExchange || '').toLowerCase();
  if (DEX_CHAINS.has(buyExchange) || DEX_CHAINS.has(sellExchange)) {
    return false;
  }

  if (opp.isPerp || opp.strategy === 'perps' || opp.strategy === 'funding') {
    const counterparty = buyExchange.endsWith('_perp') ? sellExchange : buyExchange;
    return isExecutionExchangeEnabled(env, counterparty) &&
      hasExchangeCredentials(env, 'mexc') && hasExchangeCredentials(env, counterparty);
  }

  // Check allowlist before credentials
  if (!isExecutionExchangeEnabled(env, buyExchange)) return false;
  if (!isExecutionExchangeEnabled(env, sellExchange)) return false;

  return hasExchangeCredentials(env, buyExchange) &&
    hasExchangeCredentials(env, sellExchange);
}

/**
 * Returns the maximum USD size that can be executed for the selected live opportunity.
 */
export async function getLiveExecutionCapUsd(env, opp) {
  if (!opp) return 0;
  if (opp.strategy === 'dex') return Number.POSITIVE_INFINITY;
  if (opp.strategy === 'triangular') {
    const ex = String(opp.buyExchange || '').toLowerCase();
    if (!isExecutionExchangeEnabled(env, ex) || !hasExchangeCredentials(env, ex)) return 0;
    return Number.POSITIVE_INFINITY;
  }

  const skipBalanceCheck = ['1', 'true', 'on', 'yes'].includes(
    String(env?.SKIP_BALANCE_CHECK || '').toLowerCase()
  );

  const safeBalance = async (exchange, asset) => {
    try {
      const v = await getExchangeBalance(env, exchange, asset);
      return Math.max(0, Number(v || 0));
    } catch (e) {
      console.warn(`[balance-cap] ${exchange} ${asset} check failed: ${e.message}`);
      if (skipBalanceCheck) {
        const defaultSize = Math.max(1, Number(env.SKIP_BALANCE_CHECK_SIZE || 5));
        console.warn(`[balance-cap] SKIP_BALANCE_CHECK=true → using default $${defaultSize}`);
        return defaultSize;
      }
      return 0;
    }
  };

  if (opp.isPerp || opp.strategy === 'funding') {
    const buyExchange = String(opp.buyExchange || '').toLowerCase();
    const sellExchange = String(opp.sellExchange || '').toLowerCase();
    const counterparty = buyExchange.endsWith('_perp') ? sellExchange : buyExchange;
    if (!isExecutionExchangeEnabled(env, counterparty)) return 0;
    return safeBalance('mexc', 'USDT');
  }

  const parsed = splitSymbol(opp.symbol);
  if (!parsed) return 0;

  const quoteToUsd = await getQuoteToUsdRate(env, parsed.quote);
  if (!Number.isFinite(quoteToUsd) || quoteToUsd <= 0) return 0;

  if (!isExecutionExchangeEnabled(env, opp.buyExchange) || !isExecutionExchangeEnabled(env, opp.sellExchange)) {
    return 0;
  }

  const buyBalance = await safeBalance(opp.buyExchange, parsed.quote);
  const sellBalance = await safeBalance(opp.sellExchange, parsed.base);
  const sellValueQuote = sellBalance * Math.max(0, Number(opp.buyPrice || 0));
  const buyValueUsd = buyBalance * quoteToUsd;
  const sellValueUsd = sellValueQuote * quoteToUsd;

  return Math.max(0, Math.min(buyValueUsd, sellValueUsd));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildDexExecutorPayload(opp, sizeUsd, slippageBps) {
  return {
    opportunity: {
      strategy: opp.strategy,
      symbol: opp.symbol,
      direction: opp.direction,
      buyExchange: opp.buyExchange,
      sellExchange: opp.sellExchange,
      buyPrice: opp.buyPrice,
      sellPrice: opp.sellPrice,
      grossPct: opp.grossPct,
      netPct: opp.netPct,
      safetyFactor: opp.safetyFactor
    },
    execution: {
      sizeUsd,
      slippageBps,
      source: 'ultimate-arbitrage-hft'
    }
  };
}

function shouldRetryDexRequest(attempt, maxRetries, error, statusCode, retryableStatuses) {
  if (attempt >= maxRetries) return false;

  if (statusCode && retryableStatuses.has(statusCode)) return true;

  const isAbort = error?.name === 'AbortError';
  const isNetwork = error instanceof TypeError;
  return isAbort || isNetwork;
}

async function parseDexResponse(resp) {
  try {
    return await resp.json();
  } catch (err) {
    console.warn('[dex-exec] Failed to parse response:', err.message);
    return null;
  }
}

/**
 * Executes a DEX arbitrage opportunity using an external executor service.
 */
export async function executeDexTrade(env, opp, sizeUsd) {
  const executorUrl = env.DEX_EXECUTOR_URL;
  if (!executorUrl) {
    throw new Error('DEX_EXECUTOR_URL is not configured for live DEX execution');
  }

  const timeoutMs = Math.max(1000, Number.parseInt(env.DEX_EXECUTION_TIMEOUT_MS || '20000', 10));
  const maxRetries = Math.max(0, Number.parseInt(env.DEX_EXECUTOR_MAX_RETRIES || '2', 10));
  const retryBaseMs = Math.max(100, Number.parseInt(env.DEX_EXECUTOR_RETRY_BASE_MS || '500', 10));
  const slippageBps = Math.max(1, Number.parseInt(env.DEX_MAX_SLIPPAGE_BPS || '80', 10));

  const payload = buildDexExecutorPayload(opp, sizeUsd, slippageBps);
  const headers = { 'Content-Type': 'application/json' };
  if (env.DEX_EXECUTOR_TOKEN) {
    headers.Authorization = `Bearer ${env.DEX_EXECUTOR_TOKEN}`;
  }

  const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('DEX executor timeout'), timeoutMs);

    try {
      const resp = await fetch(executorUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const data = await parseDexResponse(resp);

      if (!resp.ok) {
        const err = new Error(data?.error || data?.message || `DEX executor HTTP ${resp.status}`);
        if (shouldRetryDexRequest(attempt, maxRetries, err, resp.status, retryableStatuses)) {
          await sleep(retryBaseMs * (2 ** attempt));
          continue;
        }
        throw err;
      }

      if (!data?.success) {
        const err = new Error(data?.error || data?.message || 'DEX executor returned unsuccessful response');
        if (shouldRetryDexRequest(attempt, maxRetries, err, null, retryableStatuses)) {
          await sleep(retryBaseMs * (2 ** attempt));
          continue;
        }
        throw err;
      }

      return data;
    } catch (e) {
      if (shouldRetryDexRequest(attempt, maxRetries, e, null, retryableStatuses)) {
        await sleep(retryBaseMs * (2 ** attempt));
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('DEX executor failed after retries');
}

// ── Circuit Breaker (KV-backed, adaptive window) ────────────────────────────
// Resets after CB_RESET_WINDOW_MS of no failures.
// After MAX_CB_FAILURES consecutive failures within the window, the exchange
// is skipped. Additional protection: if failures exceed a very high threshold
// (e.g. 100), the circuit enters a long cool-down to prevent resource waste.
const CB_KEY = 'nexus_circuit_breaker';
const SCAN_REJECTIONS_KEY = 'nexus_scan_rejections_last';
const EXECUTION_LOCK_KEY = 'nexus_execution_lock';
const EXECUTION_LOCK_TTL_MS = 30 * 1000;
const MAX_CB_FAILURES = 3;
const CB_RESET_WINDOW_MS = 10 * 60 * 1000; // 10 min window to reset counter
const CB_COOLDOWN_MS = 5 * 60 * 1000;   // 5 min skip when open
const CB_MAX_FATAL_THRESHOLD = 100;             // if > 100 failures → fatal, skip 1h
const CB_FATAL_COOLDOWN_MS = 60 * 60 * 1000;  // 1 hour cooldown for fatal failures

async function tryAcquireExecutionLock(env, context = {}) {
  if (!env?.BOT_STATE) return { acquired: true, token: null, existing: null, lock: null };

  const now = Date.now();
  const token = crypto.randomUUID();
  const existing = await env.BOT_STATE.get(EXECUTION_LOCK_KEY, 'json').catch(() => null);
  const expiresAt = Number(existing?.expiresAt || 0);

  if (existing?.token && expiresAt > now) {
    return {
      acquired: false,
      token: null,
      existing: {
        acquiredAt: Number(existing?.acquiredAt || 0),
        expiresAt,
        source: String(existing?.source || 'unknown'),
        trigger: String(existing?.trigger || 'unknown'),
        scanId: existing?.scanId || null,
      },
      lock: null,
    };
  }

  const nextLock = {
    token,
    acquiredAt: now,
    expiresAt: now + EXECUTION_LOCK_TTL_MS,
    source: String(context?.source || 'unknown'),
    trigger: String(context?.trigger || 'unknown'),
    scanId: context?.scanId || crypto.randomUUID(),
  };
  await env.BOT_STATE.put(
    EXECUTION_LOCK_KEY,
    JSON.stringify(nextLock),
    { expirationTtl: Math.ceil(EXECUTION_LOCK_TTL_MS / 1000) + 5 }
  ).catch(() => { });

  const verify = await env.BOT_STATE.get(EXECUTION_LOCK_KEY, 'json').catch(() => null);
  if (!verify?.token) {
    // KV can be eventually consistent on immediate read-after-write.
    // If we cannot verify yet, continue optimistically with our lock token
    // to avoid false "execution_lock_active" negatives.
    return {
      acquired: true,
      token,
      existing: null,
      lock: {
        acquiredAt: nextLock.acquiredAt,
        expiresAt: nextLock.expiresAt,
        source: nextLock.source,
        trigger: nextLock.trigger,
        scanId: nextLock.scanId,
      },
    };
  }

  if (verify?.token !== token) {
    const latestExpiresAt = Number(verify?.expiresAt || 0);
    return {
      acquired: false,
      token: null,
      existing: {
        acquiredAt: Number(verify?.acquiredAt || 0),
        expiresAt: latestExpiresAt,
        source: String(verify?.source || 'unknown'),
        trigger: String(verify?.trigger || 'unknown'),
        scanId: verify?.scanId || null,
      },
      lock: null,
    };
  }

  return {
    acquired: true,
    token,
    existing: null,
    lock: {
      acquiredAt: nextLock.acquiredAt,
      expiresAt: nextLock.expiresAt,
      source: nextLock.source,
      trigger: nextLock.trigger,
      scanId: nextLock.scanId,
    },
  };
}

export async function getExecutionLockState(env) {
  if (!env?.BOT_STATE) {
    return {
      active: false,
      reason: 'missing_bot_state_binding',
      now: Date.now(),
    };
  }

  const now = Date.now();
  const lock = await env.BOT_STATE.get(EXECUTION_LOCK_KEY, 'json').catch(() => null);
  const expiresAt = Number(lock?.expiresAt || 0);
  const acquiredAt = Number(lock?.acquiredAt || 0);
  const active = Boolean(lock?.token && expiresAt > now);

  return {
    active,
    now,
    acquiredAt: acquiredAt || null,
    expiresAt: expiresAt || null,
    ageMs: active && acquiredAt ? Math.max(0, now - acquiredAt) : null,
    ttlRemainingMs: active ? Math.max(0, expiresAt - now) : 0,
    source: lock?.source || null,
    trigger: lock?.trigger || null,
    scanId: lock?.scanId || null,
  };
}

async function releaseExecutionLock(env, token) {
  if (!env?.BOT_STATE || !token) return;
  const current = await env.BOT_STATE.get(EXECUTION_LOCK_KEY, 'json').catch(() => null);
  if (current?.token === token) {
    await env.BOT_STATE.delete(EXECUTION_LOCK_KEY).catch(() => { });
  }
}

async function getCircuitBreaker(env) {
  try { return await env.BOT_STATE.get(CB_KEY, 'json') || {}; }
  catch (err) {
    console.warn('[CB] Failed to load circuit breaker:', err.message);
    return {};
  }
}

async function saveCircuitBreaker(env, cb) {
  try { await env.BOT_STATE.put(CB_KEY, JSON.stringify(cb), { expirationTtl: 7200 }); }
  catch (err) { console.warn('[CB] Failed to save circuit breaker:', err.message); }
}

async function saveState(env, state) {
  try {
    await env.BOT_STATE.put('trading_state', JSON.stringify(state));
  } catch (err) { console.warn('[state] Failed to save trading state:', err.message); }
}

function isCircuitOpen(cb, exchange) {
  const ex = cb[exchange];
  if (!ex) return false;
  const cooldownEnd = ex.cooldownUntil || 0;
  if (cooldownEnd > Date.now()) return true;
  if (ex.open && (Date.now() - ex.lastFailure) < CB_COOLDOWN_MS) return true;
  return false;
}

function recordCBFailure(cb, exchange) {
  const now = Date.now();
  const ex = cb[exchange] || { failures: 0, lastFailure: 0, open: false, cooldownUntil: 0 };

  // Reset failure counter if enough time has passed since last failure
  if (now - ex.lastFailure > CB_RESET_WINDOW_MS) {
    ex.failures = 0;
    ex.open = false;
    ex.cooldownUntil = 0;
  }

  ex.failures++;
  ex.lastFailure = now;

  // Fatal threshold: too many failures → long cooldown (likely bad credentials)
  if (ex.failures >= CB_MAX_FATAL_THRESHOLD) {
    ex.open = true;
    ex.cooldownUntil = now + CB_FATAL_COOLDOWN_MS;
    ex.failures = 0; // reset counter but keep long cooldown
    console.error(`[CB] ${exchange}: ${ex.failures}+ failures — FATAL cooldown 1h (likely bad credentials)`);
  } else if (ex.failures >= MAX_CB_FAILURES) {
    ex.open = true;
    ex.cooldownUntil = now + CB_COOLDOWN_MS;
    console.warn(`[CB] ${exchange} circuit OPEN for ${CB_COOLDOWN_MS / 60000}min after ${ex.failures} failures`);
  }

  cb[exchange] = ex;
}

function recordCBSuccess(cb, exchange) {
  if (cb[exchange]) {
    cb[exchange].failures = 0;
    cb[exchange].open = false;
    cb[exchange].cooldownUntil = 0;
  }
}

/**
 * Resets the circuit breaker for a specific exchange, or all if exchange is omitted.
 * Returns the updated CB state.
 */
export function resetCircuitBreaker(cb, exchange) {
  if (exchange) {
    delete cb[exchange];
    console.log(`[CB] Reset for ${exchange}`);
  } else {
    for (const key of Object.keys(cb)) delete cb[key];
    console.log('[CB] Reset ALL circuits');
  }
  return cb;
}

// ── Paper position settlement ─────────────────────────────────────────────────
async function settleOpenPaperPositions(env, currentPrices, state) {
  const positions = await getOpenPaperPositions(env);
  if (positions.length === 0) return;
  for (const pos of positions) {
    const current = currentPrices[pos.symbol];
    if (!current) continue;
    const feePct = 0.15 / 100;
    const isShortPerp = (pos.sell_exchange || '').includes('perp');
    const priceDelta = isShortPerp
      ? (pos.entry_price - current) / pos.entry_price
      : (current - pos.entry_price) / pos.entry_price;
    const netPct = (priceDelta - feePct) * 100;
    const pnlUsd = pos.size_usd * (netPct / 100);

    await closePaperPosition(env, pos.id, current, pnlUsd);

    state.daily_pnl = (state.daily_pnl || 0) + pnlUsd;
    state.total_pnl = (state.total_pnl || 0) + pnlUsd;
    state.daily_trades = (state.daily_trades || 0) + 1;
    state.total_trades = (state.total_trades || 0) + 1;

    const strategyLabel = `${pos.strategy}:${pos.direction}`;
    await logTrade(env, { strategy: strategyLabel, sizeUsd: pos.size_usd, netPct, mode: 'paper' });

    console.log(
      `[Paper] Settled ${pos.symbol} pos #${pos.id}` +
      ` entry=$${pos.entry_price.toFixed(4)} exit=$${current.toFixed(4)}` +
      ` pnl=$${pnlUsd.toFixed(4)} (${netPct.toFixed(4)}%)`
    );
  }
}

// ── Symbols needed for extended strategies ──────────────────────────────────
// Extract all unique symbols from TRIANGLES and CORRELATED_PAIRS
const _EXTRA_SCAN_SYMBOLS = (() => {
  const extra = new Set(['ATOMUSDT', 'FTMUSDT', 'INJUSDT']);
  // Add all triangular cross symbols
  for (const tri of TRIANGLES) {
    extra.add(tri.b); // cross-pair like ETHBTC, BNBBTC, etc.
  }
  return [...extra];
})();

/**
 * Main scan-and-execute cycle.
 * Now supports ALL strategies: CEX, DEX, Perps, Funding, Triangular, Statistical
 */
export async function runScan(env, state, sendAlert, scanContext = {}) {
  const scanStartedAt = Date.now();
  const normalizedScanContext = {
    source: String(scanContext?.source || 'unknown'),
    trigger: String(scanContext?.trigger || 'unknown'),
    scanId: scanContext?.scanId || crypto.randomUUID(),
  };
  const lock = await tryAcquireExecutionLock(env, normalizedScanContext);
  if (!lock.acquired) {
    const now = Date.now();
    const lockOwner = lock?.existing || null;
    const lockOnlyBuckets = {
      cex: {},
      perps: {},
      scalp_forward: {},
      scalp_reverse: {},
      scalp_parallel: {},
      triangular: {},
      statistical: {},
      live_execution: {},
      system: {},
    };
    incrementRejection(lockOnlyBuckets.system, 'execution_lock_active');
    const lockSnapshot = buildRejectionSnapshot(lockOnlyBuckets, {
      symbolCount: 0,
      strategyMode: String(env?.STRATEGY_MODE || 'multi_exchange').toLowerCase(),
      paperMode: state?.paper_trading !== false,
      maxSpreadPct: Number(state?.max_spread_pct || 0),
      opportunitiesFound: 0,
      executableFound: 0,
      lockAcquired: false,
      scanSource: normalizedScanContext.source,
      scanTrigger: normalizedScanContext.trigger,
      scanId: normalizedScanContext.scanId,
      lockOwnerSource: lockOwner?.source || null,
      lockOwnerTrigger: lockOwner?.trigger || null,
      lockOwnerScanId: lockOwner?.scanId || null,
      lockAgeMs: lockOwner?.acquiredAt ? Math.max(0, now - Number(lockOwner.acquiredAt || 0)) : null,
      lockTtlRemainingMs: lockOwner?.expiresAt ? Math.max(0, Number(lockOwner.expiresAt || 0) - now) : null,
    });
    try {
      await env?.BOT_STATE?.put(
        SCAN_REJECTIONS_KEY,
        JSON.stringify(lockSnapshot),
        { expirationTtl: 3600 }
      );
    } catch (err) {
      console.warn('[scan] Lock rejection snapshot save failed:', err.message);
    }
    console.warn('[scan] skipped: execution lock is active');
    incrementMetric('scan.skipped.lock_active');
    return null;
  }

  try {
    const maxSpreadPct = state.max_spread_pct ?? 5;
    const initialCapital = state.initial_capital ?? 1000;
    const equity = initialCapital + (state.total_pnl || 0);
    const paperMode = state.paper_trading !== false;
    const symbols = await resolveScanSymbolsForState(state);
    const strategyMode = String(env?.STRATEGY_MODE || 'multi_exchange').toLowerCase();
    const mexcOnlyMode = strategyMode === 'mexc_only';
    const aggressiveScanMode = ['1', 'true', 'on', 'yes'].includes(String(env?.AGGRESSIVE_SCAN_MODE || '').toLowerCase());
    const configuredCexMinSafety = Number.parseFloat(String(env?.CEX_MIN_SAFETY_FACTOR || ''));
    const configuredPerpsMinSafety = Number.parseFloat(String(env?.PERPS_MIN_SAFETY_FACTOR || ''));
    const configuredCexSlippageMultiplier = Number.parseFloat(String(env?.CEX_SLIPPAGE_MULTIPLIER || ''));

    const cexMinSafety = aggressiveScanMode ? 0.12 : 0.25;
    const cexSlippageMultiplier = aggressiveScanMode ? 0.75 : 1;
    const perpsMinSafety = aggressiveScanMode ? 0.12 : 0.25;

    const cexScanOptions = {
      minSafetyFactor: Number.isFinite(configuredCexMinSafety)
        ? configuredCexMinSafety
        : cexMinSafety,
      slippageMultiplier: Number.isFinite(configuredCexSlippageMultiplier)
        ? configuredCexSlippageMultiplier
        : cexSlippageMultiplier,
    };
    const perpsScanOptions = {
      minSafetyFactor: Number.isFinite(configuredPerpsMinSafety)
        ? configuredPerpsMinSafety
        : perpsMinSafety,
    };
    const botMemory = await loadBotMemory(env).catch(() => null);
    const strategyWeights = botMemory?.strategyWeights || {};
    const strategyOutcomes = botMemory?.strategyOutcomes || {};
    const venueOutcomes = botMemory?.venueOutcomes || {};
    const strategyFlags = {
      cex: state?.strategy_flags?.cex !== false,
      dex: state?.strategy_flags?.dex !== false,
      perps: state?.strategy_flags?.perps !== false,
      funding: state?.strategy_flags?.funding !== false,
      triangular: state?.strategy_flags?.triangular !== false,
      statistical: state?.strategy_flags?.statistical !== false,
      scalp_forward: state?.strategy_flags?.scalp_forward !== false,
      scalp_reverse: state?.strategy_flags?.scalp_reverse !== false,
      scalp_parallel: state?.strategy_flags?.scalp_parallel !== false,
      cex_dex_bridge: state?.strategy_flags?.cex_dex_bridge !== false,
    };
    const rebalancePolicy = normalizeRebalancePolicy(state?.rebalance_policy || {});
    const routingBalances = rebalancePolicy.enabled
      ? await getRoutingBalancesSnapshot(env)
      : [];
    const exchangeRoutingWeights = buildVenueRoutingWeights(routingBalances, venueOutcomes, rebalancePolicy).weights || {};
    const exposureBoost = clamp(
      Number(env?.EXPOSURE_BOOST_MULTIPLIER || 1),
      0.5,
      3
    );
    const venueReadyPriorityMultiplier = clamp(
      Number(env?.VENUE_READY_PRIORITY_MULTIPLIER || 1.2),
      1,
      1.6
    );
    const perpsExecutionEnabled = strategyFlags.perps && state?.spot_only_lock !== true;
    const liveMinBalanceUsd = Math.max(
      0,
      Number(
        state?.live_execution_min_balance_usd
        ?? env?.LIVE_EXECUTION_MIN_BALANCE_USD
        ?? 1
      ) || 0
    );
    const liveEligibleExchanges = new Set();
    const liveExchangeBalanceSnapshot = {};

    if (!paperMode) {
      const enabledExecutionExchanges = getEnabledExecutionExchanges(env);
      await Promise.all(enabledExecutionExchanges.map(async (exchange) => {
        const normalizedExchange = String(exchange || '').toLowerCase();
        if (!normalizedExchange) return;

        if (!hasExchangeCredentials(env, normalizedExchange)) {
          liveExchangeBalanceSnapshot[normalizedExchange] = {
            configured: false,
            balance: 0,
            eligible: false,
            reason: 'missing_credentials',
          };
          return;
        }

        try {
          const balance = Math.max(0, Number(await getExchangeBalance(env, normalizedExchange, 'USDT') || 0));
          const eligible = balance >= liveMinBalanceUsd;
          if (eligible) liveEligibleExchanges.add(normalizedExchange);
          liveExchangeBalanceSnapshot[normalizedExchange] = {
            configured: true,
            balance,
            eligible,
            reason: eligible ? 'ok' : 'insufficient_balance',
          };
        } catch (error) {
          const isPermissiveMode = liveMinBalanceUsd <= 0;
          liveExchangeBalanceSnapshot[normalizedExchange] = {
            configured: true,
            balance: 0,
            eligible: isPermissiveMode,
            reason: isPermissiveMode ? 'ok_permissive' : 'balance_check_failed',
            error: String(error?.message || error || 'unknown_error'),
          };
          if (isPermissiveMode) liveEligibleExchanges.add(normalizedExchange);
        }
      }));
    }

    const allOpportunities = [];
    const exchangePriceBooks = new Map();
    const rejectionBuckets = {
      cex: {},
      perps: {},
      scalp_forward: {},
      scalp_reverse: {},
      scalp_parallel: {},
      triangular: {},
      statistical: {},
      live_execution: {},
      system: {},
    };
    const lastScan = {
      timestamp: Date.now(),
      cex: null,
      dex: null,
      perps: null,
      funding: null,
      triangular: null,
      statistical: null,
      scalp_forward: null,
      scalp_reverse: null,
      scalp_parallel: null,
      cex_dex_bridge: null,
    };

    // Load circuit-breaker state from KV once per cycle
    const cb = await getCircuitBreaker(env);
    const openCircuits = new Set();
    for (const [exchange] of Object.entries(cb)) {
      if (isCircuitOpen(cb, exchange)) openCircuits.add(exchange);
    }
    if (!perpsExecutionEnabled && cb.mexc_perp) {
      delete cb.mexc_perp;
      await saveCircuitBreaker(env, cb);
    }
    if (!perpsExecutionEnabled) {
      openCircuits.delete('mexc_perp');
    }
    if (openCircuits.size > 0) {
      console.log(`[CB] Skipping open circuits: ${[...openCircuits].join(', ')}`);
    }

    const midPrices = {};

    // ── Scan from Go HFT engine first (low-latency, WebSocket-fed) ───────────
    let hftOpp;
    if (isHFTEngineConfigured(env) && strategyFlags.cex) {
      try {
        hftOpp = await scanFromHFT(env);
        if (hftOpp) {
          allOpportunities.push(hftOpp);
          if (paperMode || isLiveExecutableOpportunityWithEnv(hftOpp, env)) {
            lastScan.cex = hftOpp;
          }
          console.log(`[HFT] Go engine returned: ${hftOpp.symbol} ${hftOpp.netPct.toFixed(4)}%`);
        }
      } catch (e) {
        console.error('[HFT] scan error (falling back to JS):', e.message);
      }
    }

    // ── Concurrency limiter (max 5 symbols in parallel to avoid CF fetch deadlocks) ──
    async function* batchedSymbols(syms, concurrency) {
      for (let i = 0; i < syms.length; i += concurrency) {
        yield syms.slice(i, i + concurrency);
      }
    }

    async function scanSymbolsConcurrently(syms, handler, maxConcurrency = 4) {
      for await (const batch of batchedSymbols(syms, maxConcurrency)) {
        await Promise.all(batch.map(handler));
      }
    }

    // ── Scan all symbols with ALL JS strategies ──────────────────────────────
    const [, dexOpp] = await Promise.all([
      scanSymbolsConcurrently(
        symbols,
        async symbol => {
          try {
            const [spotSources, mexcPerp, bybitPerp, binancePerp, zeroXSource] = await Promise.all([
              getAllSpotPrices(env, symbol, openCircuits),
              (perpsExecutionEnabled && !openCircuits.has('mexc_perp')) ? getMEXCPerpPrice(symbol) : Promise.resolve(null),
              (perpsExecutionEnabled) ? getBybitPerpData(symbol).catch(() => null) : Promise.resolve(null),
              (perpsExecutionEnabled) ? getBinancePerpData(symbol).catch(() => null) : Promise.resolve(null),
              get0xPrice(env, symbol)
            ]);

            // Collect all perp sources into array for multi-perp scanning
            const allPerpSources = [mexcPerp, bybitPerp, binancePerp].filter(Boolean);

            // Update circuit breaker based on fetch results
            const hasMexcSrc = spotSources.some(s => s.exchange === 'mexc');
            if (hasMexcSrc) {
              recordCBSuccess(cb, 'mexc');
            } else if (!openCircuits.has('mexc')) {
              recordCBFailure(cb, 'mexc');
              // Propagate new open circuit to remaining batches immediately
              if (isCircuitOpen(cb, 'mexc')) openCircuits.add('mexc');
            }
            if (spotSources.length > 0) {
              for (const src of spotSources) {
                if (src.exchange !== 'mexc') recordCBSuccess(cb, src.exchange);
              }
            }
            if (perpsExecutionEnabled && mexcPerp) {
              recordCBSuccess(cb, 'mexc_perp');
            } else if (perpsExecutionEnabled && !openCircuits.has('mexc_perp')) {
              recordCBFailure(cb, 'mexc_perp');
              if (isCircuitOpen(cb, 'mexc_perp')) openCircuits.add('mexc_perp');
            }
            if (bybitPerp) recordCBSuccess(cb, 'bybit_perp');
            if (binancePerp) recordCBSuccess(cb, 'binance_perp');

            const mexcSrc = spotSources.find(s => s.exchange === 'mexc');
            if (mexcSrc) midPrices[symbol] = mexcSrc.price;

            const effectiveSpotSources = mexcOnlyMode
              ? spotSources.filter((src) => src.exchange === 'mexc')
              : spotSources;

            const cexSources = (!mexcOnlyMode && zeroXSource)
              ? [...effectiveSpotSources, zeroXSource]
              : effectiveSpotSources;

            for (const src of effectiveSpotSources) {
              const ex = String(src?.exchange || '').toLowerCase();
              if (!ex) continue;
              if (!exchangePriceBooks.has(ex)) exchangePriceBooks.set(ex, {});
              exchangePriceBooks.get(ex)[symbol] = Number(src.price || 0);
            }

            // ── Strategy 1: CEX Spatial ────────────────────────────────────────
            const cexOpp = (strategyFlags.cex && !mexcOnlyMode)
              ? scanCEX(symbol, cexSources, maxSpreadPct, {
                ...cexScanOptions,
                rejections: rejectionBuckets.cex,
              })
              : null;

            // ── Strategy 2: Perpetuals vs Spot ─────────────────────────────────
            const perpsOpp = strategyFlags.perps
              ? scanPerps(symbol, effectiveSpotSources, allPerpSources, maxSpreadPct, {
                ...perpsScanOptions,
                rejections: rejectionBuckets.perps,
              })
              : null;

            // ── Strategy 3: Funding Rate Harvest ──────────────────────────────
            // Use first perp source that has fundingRate data
            const fundedPerp = allPerpSources.find(p => p.fundingRate !== undefined);
            const fundingOpp = (strategyFlags.funding && fundedPerp)
              ? scanFundingRate(symbol, effectiveSpotSources, fundedPerp, maxSpreadPct)
              : null;

            const scalpingOptions = {
              minNetPct: Number(state?.scalp_min_net_pct || 0.1),
            };

            const scalpForwardOpp = strategyFlags.scalp_forward
              ? scanScalpingForward(symbol, effectiveSpotSources, {
                ...scalpingOptions,
                minSafety: 0.18,
                maxGrossPct: maxSpreadPct,
                rejections: rejectionBuckets.scalp_forward,
              })
              : null;

            const scalpReverseOpp = strategyFlags.scalp_reverse
              ? scanScalpingReverse(symbol, effectiveSpotSources, {
                ...scalpingOptions,
                minSafety: 0.18,
                rejections: rejectionBuckets.scalp_reverse,
              })
              : null;

            const scalpParallelOpp = strategyFlags.scalp_parallel
              ? scanScalpingParallel(symbol, effectiveSpotSources, {
                ...scalpingOptions,
                minSafety: 0.18,
                rejections: rejectionBuckets.scalp_parallel,
              })
              : null;

            if (cexOpp) {
              allOpportunities.push(cexOpp);
              if ((paperMode || isLiveExecutableOpportunityWithEnv(cexOpp, env)) &&
                (!lastScan.cex || cexOpp.netPct > lastScan.cex.netPct)) {
                lastScan.cex = cexOpp;
              }
            }
            if (perpsOpp) {
              allOpportunities.push(perpsOpp);
              if ((paperMode || isLiveExecutableOpportunityWithEnv(perpsOpp, env)) &&
                (!lastScan.perps || perpsOpp.netPct > lastScan.perps.netPct)) {
                lastScan.perps = perpsOpp;
              }
            }
            if (fundingOpp) {
              allOpportunities.push(fundingOpp);
              if ((paperMode || isLiveExecutableOpportunityWithEnv(fundingOpp, env)) &&
                (!lastScan.funding || fundingOpp.netPct > lastScan.funding.netPct)) {
                lastScan.funding = fundingOpp;
              }
            }
            if (scalpForwardOpp) {
              allOpportunities.push(scalpForwardOpp);
              if ((paperMode || isLiveExecutableOpportunityWithEnv(scalpForwardOpp, env)) &&
                (!lastScan.scalp_forward || scalpForwardOpp.netPct > lastScan.scalp_forward.netPct)) {
                lastScan.scalp_forward = scalpForwardOpp;
              }
            }
            if (scalpReverseOpp) {
              allOpportunities.push(scalpReverseOpp);
              if ((paperMode || isLiveExecutableOpportunityWithEnv(scalpReverseOpp, env)) &&
                (!lastScan.scalp_reverse || scalpReverseOpp.netPct > lastScan.scalp_reverse.netPct)) {
                lastScan.scalp_reverse = scalpReverseOpp;
              }
            }
            if (scalpParallelOpp) {
              allOpportunities.push(scalpParallelOpp);
              if ((paperMode || isLiveExecutableOpportunityWithEnv(scalpParallelOpp, env)) &&
                (!lastScan.scalp_parallel || scalpParallelOpp.netPct > lastScan.scalp_parallel.netPct)) {
                lastScan.scalp_parallel = scalpParallelOpp;
              }
            }
          } catch (e) {
            console.error(`[${symbol}] scan error:`, e.message);
          }
        },
        4
      ),
      strategyFlags.dex ? scanDEX(env) : Promise.resolve(null)
    ]);

    // ── Strategy 5: Statistical Arbitrage (KV-dependent, runs once per cycle) ─
    if (strategyFlags.statistical) {
      try {
        for (const pair of CORRELATED_PAIRS) {
          const sourcesA = await getAllSpotPrices(env, pair.symbolA, openCircuits).catch(() => []);
          const sourcesB = await getAllSpotPrices(env, pair.symbolB, openCircuits).catch(() => []);
          const priceA = sourcesA.length > 0 ? sourcesA.reduce((a, b) => (a.price < b.price ? a : b)).price : 0;
          const priceB = sourcesB.length > 0 ? sourcesB.reduce((a, b) => (a.price < b.price ? a : b)).price : 0;
          if (priceA > 0 && priceB > 0) {
            const statOpp = scanStatistical(env, pair, priceA, priceB, sourcesA, sourcesB);
            if (statOpp) {
              allOpportunities.push(statOpp);
              if ((paperMode || isLiveExecutableOpportunityWithEnv(statOpp, env)) &&
                (!lastScan.statistical || statOpp.netPct > lastScan.statistical.netPct)) {
                lastScan.statistical = statOpp;
              }
            } else {
              incrementRejection(rejectionBuckets.statistical, 'no_signal_for_pair');
            }
          } else {
            incrementRejection(rejectionBuckets.statistical, 'missing_pair_prices');
          }
        }
      } catch (e) {
        console.error('[Statistical] scan error:', e.message);
      }
    }

    // ── Strategy 4: Triangular Arbitrage (exchange-wide, runs once per cycle) ─
    if (strategyFlags.triangular) {
      let foundTriangular = false;
      for (const [exchange, prices] of exchangePriceBooks.entries()) {
        const fee = 0.001;

        // Try dynamic triangles first, fall back to hardcoded if price book is sparse
        const triOpp = scanTriangularDynamic(exchange, fee, prices)
          || scanTriangular(exchange, fee, prices);

        if (!triOpp) continue;
        foundTriangular = true;
        allOpportunities.push(triOpp);
        if ((paperMode || isLiveExecutableOpportunityWithEnv(triOpp, env)) &&
          (!lastScan.triangular || triOpp.netPct > lastScan.triangular.netPct)) {
          lastScan.triangular = triOpp;
        }
      }
      if (!foundTriangular) {
        incrementRejection(rejectionBuckets.triangular, 'no_valid_triangle_from_price_book');
      }
    }

    // ── Strategy 10: CEX↔DEX Bridge Arbitrage ──────────────────────────────
    if (strategyFlags.cex_dex_bridge) {
      try {
        // Build CEX price map from exchange price books
        const spotSourcesBySymbol = {};
        for (const [exchange, prices] of exchangePriceBooks.entries()) {
          for (const [symbol, price] of Object.entries(prices)) {
            if (!spotSourcesBySymbol[symbol]) spotSourcesBySymbol[symbol] = [];
            spotSourcesBySymbol[symbol].push({ exchange, price, fee: 0.001 });
          }
        }

        const cexPriceMap = buildCexPriceMap(spotSourcesBySymbol);
        const bridgeOpp = await scanCexDexBridge(cexPriceMap, env);

        if (bridgeOpp) {
          allOpportunities.push(bridgeOpp);
          if ((paperMode || isLiveExecutableOpportunityWithEnv(bridgeOpp, env)) &&
            (!lastScan.cex_dex_bridge || bridgeOpp.netPct > (lastScan.cex_dex_bridge?.netPct || 0))) {
            lastScan.cex_dex_bridge = bridgeOpp;
          }
        } else {
          incrementRejection(rejectionBuckets.system, 'no_cex_dex_bridge_opportunity');
        }
      } catch (e) {
        console.error('[CEX-DEX Bridge] scan error:', e.message);
      }
    }

    // Persist updated circuit-breaker state
    saveCircuitBreaker(env, cb);

    if (dexOpp && strategyFlags.dex) {
      allOpportunities.push(dexOpp);
      if (paperMode || isLiveExecutableOpportunityWithEnv(dexOpp, env)) {
        lastScan.dex = dexOpp;
      }
    }

    // Settle open paper positions
    await settleOpenPaperPositions(env, midPrices, state);

    // Persist scan summary to KV (5-min TTL)
    try {
      await env.BOT_STATE.put(
        'nexus_last_scan',
        JSON.stringify(lastScan),
        { expirationTtl: 300 }
      );
      await env.BOT_STATE.put(
        'nexus_capital_routing_last',
        JSON.stringify({
          ts: Date.now(),
          policy: rebalancePolicy,
          weights: exchangeRoutingWeights,
          balances: routingBalances,
        }),
        { expirationTtl: 3600 }
      );
    } catch (err) { console.warn('[scan] Failed to save scan summary:', err.message); }

    const executableOpportunities = paperMode
      ? allOpportunities
      : allOpportunities.filter((opp) => isLiveExecutableOpportunityWithEnv(opp, env));

    if (!paperMode && allOpportunities.length > 0) {
      for (const opp of allOpportunities) {
        if (isLiveExecutableOpportunityWithEnv(opp, env)) continue;
        incrementRejection(rejectionBuckets.live_execution, classifyLiveRejectReason(opp, env));
      }
    }

    if (allOpportunities.length === 0) {
      incrementRejection(rejectionBuckets.system, 'no_opportunities_after_scan');
    }
    if (allOpportunities.length > 0 && executableOpportunities.length === 0) {
      incrementRejection(rejectionBuckets.system, 'no_live_executable_opportunities');
    }

    const rejectionSnapshot = buildRejectionSnapshot(rejectionBuckets, {
      symbolCount: Number(symbols.length || 0),
      strategyMode,
      paperMode,
      maxSpreadPct,
      opportunitiesFound: allOpportunities.length,
      executableFound: executableOpportunities.length,
      liveMinBalanceUsd,
      liveEligibleExecutionExchanges: paperMode ? [] : [...liveEligibleExchanges],
      liveExecutionExchangeBalances: paperMode ? {} : liveExchangeBalanceSnapshot,
      lockAcquired: true,
      scanSource: normalizedScanContext.source,
      scanTrigger: normalizedScanContext.trigger,
      scanId: normalizedScanContext.scanId,
    });
    try {
      await env.BOT_STATE.put(
        SCAN_REJECTIONS_KEY,
        JSON.stringify(rejectionSnapshot),
        { expirationTtl: 3600 }
      );
    } catch (err) {
      console.warn('[scan] Rejection snapshot save failed:', err.message);
    }

    if (allOpportunities.length === 0) {
      console.log(`🔍 Nexus: no opportunities across ${symbols.length} symbols (all strategies)`);
      incrementMetric('scan.no_opportunities');
      return null;
    }

    if (executableOpportunities.length === 0) {
      console.log(`🔍 Nexus: no executable opportunities in ${paperMode ? 'paper' : 'live'} mode`);
      incrementMetric('scan.no_executable_opportunities', 1, { mode: paperMode ? 'paper' : 'live' });
      return null;
    }

    // ── Differential ranking and multi-strategy execution plan ───────────────
    const scoredOpportunities = await Promise.all(
      executableOpportunities.map(async (opp) => {
        const liveCapUsd = paperMode ? Number.POSITIVE_INFINITY : await getLiveExecutionCapUsd(env, opp);
        return {
          ...opp,
          liveCapUsd,
          score: scoreOpportunity(opp, {
            strategyWeights,
            strategyOutcomes,
            exchangeRoutingWeights,
            liveExchangeBalanceSnapshot,
            liveMinBalanceUsd,
            venueReadyPriorityMultiplier,
            liveCapUsd,
          }),
        };
      })
    );

    const rankedOpportunities = scoredOpportunities
      .filter((opp) => paperMode || Number(opp.liveCapUsd || 0) >= Math.max(1, liveMinBalanceUsd))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (Number(b.liveCapUsd || 0) !== Number(a.liveCapUsd || 0)) {
          return Number(b.liveCapUsd || 0) - Number(a.liveCapUsd || 0);
        }
        return Number(b.netPct || 0) - Number(a.netPct || 0);
      });

    if (!paperMode && scoredOpportunities.length > 0 && rankedOpportunities.length === 0) {
      incrementRejection(rejectionBuckets.live_execution, 'insufficient_live_execution_cap');
    }

    const isMultiStrategyLive = state.multi_strategy_live !== false;
    const maxTradesPerScan = isMultiStrategyLive
      ? clamp(Math.ceil(Number(state.max_live_trades_per_scan || 1) * exposureBoost), 1, 10)
      : 1;
    const selected = [];
    const usedSymbols = new Set();

    for (const opp of rankedOpportunities) {
      const key = String(opp.symbol || '').toUpperCase();
      if (usedSymbols.has(key) && opp.strategy !== 'scalp_parallel') continue;
      selected.push(opp);
      usedSymbols.add(key);
      if (selected.length >= maxTradesPerScan) break;
    }
    if (selected.length === 0 && rankedOpportunities.length > 0) {
      selected.push(rankedOpportunities[0]);
    }

    const top = selected[0];
    console.log(
      `🎯 Top now [${String(top.strategy || '').toUpperCase()}] ${top.symbol} ${top.direction}` +
      ` net ${Number(top.netPct || 0).toFixed(4)}% score ${Number(top.score || 0).toFixed(5)}`
    );

    const dailyLimitUsd = Number.isFinite(state.daily_limit_usd) && state.daily_limit_usd > 0
      ? state.daily_limit_usd
      : 0;

    const drawdownCheck = checkDrawdownGuard(state, equity);
    if (drawdownCheck.halt) {
      state.auto_stopped = true;
      state.auto_stop_reason = drawdownCheck.reason;
      await saveState(env, state);
      await logBotEvent(env, 'auto_stop', { reason: drawdownCheck.reason });
      await sendAlert(env, `🛑 *إيقاف تلقائي*\n${drawdownCheck.reason}`);
      console.log(`🛑 Nexus: drawdown guard blocked trade — ${drawdownCheck.reason}`);
      return null;
    }

    const mode = paperMode ? 'paper' : 'live';
    const executed = [];

    for (const opp of selected) {
      const liveEquity = initialCapital + (state.total_pnl || 0);
      const leverage = opp.isPerp || opp.strategy === 'funding'
        ? calculateAdaptiveLeverage(liveEquity, opp.netPct, initialCapital)
        : 1;
      const baseSize = calculatePositionSize(
        liveEquity,
        state.win_rate || 0.55,
        state.risk_reward_ratio || 2
      );
      const requestedSizeUsd = Math.min(baseSize * leverage * exposureBoost, liveEquity * MAX_POSITION_EQUITY_FRACTION);
      const capitalRoutingBoost = clamp(
        getOpportunityExchangeWeight(opp, exchangeRoutingWeights) * getStrategySpeedWeight(opp.strategy) * exposureBoost,
        0.7,
        2.4
      );
      const routedRequestedSizeUsd = requestedSizeUsd * capitalRoutingBoost;
      const liveBalanceCapUsd = paperMode ? Number.POSITIVE_INFINITY : Number(opp.liveCapUsd || 0);
      const sizeUsd = Math.min(routedRequestedSizeUsd, liveBalanceCapUsd);

      if (dailyLimitUsd > 0 && Number(state.daily_volume_usd || 0) + sizeUsd > dailyLimitUsd) {
        state.auto_stopped = true;
        state.auto_stop_reason = `تجاوز حد الحجم اليومي $${dailyLimitUsd}`;
        await saveState(env, state);
        await logBotEvent(env, 'auto_stop', { reason: state.auto_stop_reason });
        await sendAlert(env, `🛑 *إيقاف تلقائي*\n${state.auto_stop_reason}`);
        break;
      }

      if (!Number.isFinite(sizeUsd) || sizeUsd <= 0) {
        console.warn(
          `[fallback-paper] Live balance check blocked for ${opp.symbol} ` +
          `(${opp.strategy} ${opp.direction} net=${Number(opp.netPct || 0).toFixed(4)}%)`
        );
        await sendAlert(
          env,
          `📊 [OPP] [${String(opp.strategy || '').toUpperCase()}] ${opp.symbol}\n` +
          `${opp.direction}\n` +
          `صافي: ${Number(opp.netPct || 0).toFixed(4)}%  أمان: ${(Number(opp.safetyFactor || 0) * 100).toFixed(1)}%\n` +
          `⚠️ تعذّر التحقق من الرصيد — الفرصة مرصودة فقط`
        );
        continue;
      }

      const currentExposure = state.total_trades
        ? Math.min(sizeUsd * 3, liveEquity * MAX_POSITION_EQUITY_FRACTION * 3)
        : 0;
      const exposureCheck = checkExposureLimit(liveEquity, currentExposure, sizeUsd);
      if (!exposureCheck.allowed) {
        console.log(`🔍 Nexus: exposure limit blocked trade — ${exposureCheck.reason}`);
        continue;
      }

      const strategyLabel = `${opp.strategy}:${opp.direction}`;
      const levStr = leverage > 1 ? ` | ${leverage}x` : '';

      const venueList = getOpportunityVenues(opp);

      if (paperMode) {
        await openPaperPosition(env, opp, sizeUsd);
        state.daily_volume_usd = (state.daily_volume_usd || 0) + sizeUsd;
        state.last_trade_timestamp = Date.now();

        const estimatedPnl = sizeUsd * Number(opp.netPct || 0) / 100;
        await recordStrategyOutcome(env, String(opp.strategy || '').toLowerCase(), {
          success: true,
          pnlUsd: estimatedPnl,
          symbol: opp.symbol,
          exchange: opp.buyExchange,
        });
        await Promise.allSettled(
          venueList.map((venue) => recordVenueOutcome(env, venue, {
            success: true,
            pnlUsd: venueList.length > 0 ? estimatedPnl / venueList.length : estimatedPnl,
            latencyMs: 0,
            symbol: opp.symbol,
            strategy: opp.strategy,
          }))
        );

        await sendAlert(
          env,
          `📄 [PAPER] [${String(opp.strategy || '').toUpperCase()}] ${opp.symbol}\n` +
          `${opp.direction}\n` +
          `$${sizeUsd.toFixed(2)}${levStr}\n` +
          `net ${Number(opp.netPct || 0).toFixed(4)}%  safety ${(Number(opp.safetyFactor || 0) * 100).toFixed(1)}%`
        );
        incrementMetric('trade.executed', 1, { mode: 'paper', strategy: opp.strategy });
        executed.push({ opportunity: opp, sizeUsd, leverage, mode });
        continue;
      }

      try {
        const execStartedAt = Date.now();
        await executeTrade(env, opp, sizeUsd, leverage);
        const executionLatencyMs = Date.now() - execStartedAt;

        const tradePnl = sizeUsd * Number(opp.netPct || 0) / 100;
        state.daily_pnl = (state.daily_pnl || 0) + tradePnl;
        state.total_pnl = (state.total_pnl || 0) + tradePnl;
        state.daily_trades = (state.daily_trades || 0) + 1;
        state.daily_volume_usd = (state.daily_volume_usd || 0) + sizeUsd;
        state.total_trades = (state.total_trades || 0) + 1;
        state.last_trade_timestamp = Date.now();

        await recordStrategyOutcome(env, String(opp.strategy || '').toLowerCase(), {
          success: true,
          pnlUsd: tradePnl,
          symbol: opp.symbol,
          exchange: opp.buyExchange,
        });
        await Promise.allSettled(
          venueList.map((venue) => recordVenueOutcome(env, venue, {
            success: true,
            pnlUsd: venueList.length > 0 ? tradePnl / venueList.length : tradePnl,
            latencyMs: executionLatencyMs,
            symbol: opp.symbol,
            strategy: opp.strategy,
          }))
        );

        await logTrade(env, { strategy: strategyLabel, sizeUsd, netPct: opp.netPct, mode });

        await sendAlert(
          env,
          `✅ [LIVE] [${String(opp.strategy || '').toUpperCase()}] ${opp.symbol}\n` +
          `${opp.direction}\n` +
          `$${sizeUsd.toFixed(2)}${levStr}\n` +
          `net ${Number(opp.netPct || 0).toFixed(4)}%`
        );
        incrementMetric('trade.executed', 1, { mode: 'live', strategy: opp.strategy });
        executed.push({ opportunity: opp, sizeUsd, leverage, mode });
      } catch (execErr) {
        console.error('Trade execution error:', execErr.message);
        logEvent('error', 'trade.execution_failed', {
          strategy: opp.strategy,
          symbol: opp.symbol,
          reason: execErr.message,
        });
        incrementMetric('trade.execution_failed', 1, { strategy: opp.strategy });
        await recordStrategyOutcome(env, String(opp.strategy || '').toLowerCase(), {
          success: false,
          pnlUsd: 0,
          symbol: opp.symbol,
          exchange: opp.buyExchange,
        });
        await Promise.allSettled(
          venueList.map((venue) => recordVenueOutcome(env, venue, {
            success: false,
            pnlUsd: 0,
            latencyMs: 0,
            symbol: opp.symbol,
            strategy: opp.strategy,
          }))
        );
        await sendAlert(
          env,
          `❌ [${String(opp.strategy || '').toUpperCase()}] فشل التنفيذ ${opp.symbol}: ${execErr.message}`
        );
      }
    }

    if (!executed.length) return null;

    observeLatency('scan.duration_ms', scanStartedAt, {
      strategy: executed[0].opportunity.strategy,
      mode: paperMode ? 'paper' : 'live',
    });

    return {
      executed,
      rankedTop: rankedOpportunities.slice(0, 5).map((x) => ({
        strategy: x.strategy,
        symbol: x.symbol,
        netPct: x.netPct,
        score: x.score,
      })),
    };
  } finally {
    await releaseExecutionLock(env, lock.token);
  }
}

export async function executeCexArbWithHedge(
  env,
  {
    buyExch,
    sellExch,
    symbol,
    amount,
    requiredQuote,
  },
  placeOrder = placeExchangeMarketOrder,
) {
  console.log(`[CEX Arb] Starting: BUY on ${buyExch}, SELL on ${sellExch}, amount=${amount}`);

  const buyResult = await placeOrder(env, buyExch, symbol, 'BUY', amount, requiredQuote);
  console.log(`[CEX Arb] ✅ BUY complete on ${buyExch}:`, JSON.stringify(buyResult).slice(0, 200));

  let sellResult;
  try {
    sellResult = await placeOrder(env, sellExch, symbol, 'SELL', amount, requiredQuote);
    console.log(`[CEX Arb] ✅ SELL complete on ${sellExch}:`, JSON.stringify(sellResult).slice(0, 200));
  } catch (sellErr) {
    console.warn(`[CEX Arb] ❌ SELL failed on ${sellExch}; attempting hedge close on ${buyExch}: ${sellErr.message}`);
    try {
      await placeOrder(env, buyExch, symbol, 'SELL', amount, requiredQuote);
    } catch (hedgeErr) {
      throw new Error(
        `critical: sell leg failed on ${sellExch} and hedge failed on ${buyExch}; open exposure (${sellErr.message}; ${hedgeErr.message})`,
        { cause: hedgeErr },
      );
    }
    throw new Error(
      `sell leg failed on ${sellExch} but hedge closed residual exposure on ${buyExch}: ${sellErr.message}`,
      { cause: sellErr },
    );
  }

  return { buyResult, sellResult };
}

// ── Trade execution ──────────────────────────────────────────────────────────
async function executeTrade(env, opp, sizeUsd, leverage) {
  const lightning = new LightningExecutor(env);

  if (opp.strategy === 'dex') {
    await executeDexTrade(env, opp, sizeUsd);
    return;
  }

  if (opp.strategy === 'scalp_parallel' && Array.isArray(opp.parallelLegs) && opp.parallelLegs.length > 0) {
    const perLegSize = sizeUsd / opp.parallelLegs.length;
    // ── Lightning-fast parallel execution: all legs batched in 50ms window ──
    const batchResults = [];
    for (const leg of opp.parallelLegs) {
      const syntheticOpp = {
        ...opp,
        strategy: 'cex',
        buyExchange: leg.buyExchange,
        sellExchange: leg.sellExchange,
        buyPrice: leg.buyPrice,
        sellPrice: leg.sellPrice,
      };
      batchResults.push(lightning.batchExecute(
        { type: 'scalp_leg', opp: syntheticOpp, sizeUsd: perLegSize, leverage },
        ({ opp: legOpp, sizeUsd: sz, leverage: lev }) => executeTrade(env, legOpp, sz, lev)
      ));
    }
    const results = await Promise.all(batchResults);
    // Flush any remaining batches immediately
    await lightning.flushBatch();
    return results;
  }

  // Triangular arbitrage: execute all 3 legs on the same exchange
  if (opp.strategy === 'triangular') {
    const exchange = opp.buyExchange;
    if (!hasExchangeCredentials(env, exchange)) {
      throw new Error(`No execution credentials for triangular arb on ${exchange}`);
    }
    const plan = Array.isArray(opp.executionPlan) && opp.executionPlan.length >= 3
      ? opp.executionPlan
      : [];
    if (plan.length < 3) {
      throw new Error('Invalid triangular execution plan');
    }
    for (const leg of plan) {
      await placeExchangeMarketOrder(
        env,
        exchange,
        leg.symbol,
        String(leg.side || 'BUY').toUpperCase(),
        null,
        sizeUsd
      );
    }
    return;
  }

  // Statistical arbitrage: buy one symbol, sell the other on same exchange
  if (opp.strategy === 'statistical') {
    const exchange = opp.buyExchange;
    if (!hasExchangeCredentials(env, exchange)) {
      throw new Error(`No execution credentials for statistical arb on ${exchange}`);
    }
    if (!opp.buySymbol || !opp.sellSymbol) {
      // ── Lightning batch: buy + sell simultaneously ──
      await Promise.all([
        lightning.batchExecute(
          { exchange, symbol: opp.symbol, side: 'BUY', sizeUsd: sizeUsd / 2 },
          ({ exchange: ex, symbol: sym, side: s, sizeUsd: sz }) =>
            placeExchangeMarketOrder(env, ex, sym, s, null, sz)
        ),
        lightning.batchExecute(
          { exchange, symbol: opp.symbol, side: 'SELL', sizeUsd: sizeUsd / 2 },
          ({ exchange: ex, symbol: sym, side: s, sizeUsd: sz }) =>
            placeExchangeMarketOrder(env, ex, sym, s, null, sz)
        ),
      ]);
      await lightning.flushBatch();
      return;
    }
    await Promise.all([
      lightning.batchExecute(
        { exchange, symbol: opp.buySymbol, side: 'BUY', sizeUsd: sizeUsd / 2 },
        ({ exchange: ex, symbol: sym, side: s, sizeUsd: sz }) =>
          placeExchangeMarketOrder(env, ex, sym, s, null, sz)
      ),
      lightning.batchExecute(
        { exchange, symbol: opp.sellSymbol, side: 'SELL', sizeUsd: sizeUsd / 2 },
        ({ exchange: ex, symbol: sym, side: s, sizeUsd: sz }) =>
          placeExchangeMarketOrder(env, ex, sym, s, null, sz)
      ),
    ]);
    await lightning.flushBatch();
    return;
  }

  if (opp.buyExchange === '0x' || opp.sellExchange === '0x' ||
    ['ethereum', 'bsc', 'arbitrum', 'polygon', 'optimism'].includes(opp.buyExchange) ||
    ['ethereum', 'bsc', 'arbitrum', 'polygon', 'optimism'].includes(opp.sellExchange)) {
    // Internal DEX swap via 1inch (preferred) or simulate in paper mode
    const { paper_trading: paperTrading } = await import("../state.js").then(m => m.getState(env)).catch(() => ({ paper_trading: true }));
    if (paperTrading) {
      console.log(`[dex-exec] Paper DEX swap: ${opp.direction}, $${sizeUsd}`);
      return;
    }
    try {
      const { getDEXSwapQuote } = await import('./strategies/dex.js');
      const chain = opp.buyExchange === '0x' ? opp.sellExchange : opp.buyExchange;
      const quote = await getDEXSwapQuote({
        chain: chain === 'ethereum' ? 'ethereum' : chain,
        tokenIn: 'USDT',
        tokenOut: 'WETH',
        amount: sizeUsd * 1e6, // USDT has 6 decimals
        slippage: 2,
      });
      console.log(`[dex-exec] 1inch quote: ${quote.provider}, price=${quote.price}, gas=${quote.estimatedGas}`);
      if (quote.tx) {
        console.log(`[dex-exec] Swap tx ready: to=${quote.tx.to?.slice(0, 10)}...`);
        // In production, this would submit the tx via a wallet provider
      }
    } catch (e) {
      console.warn('[dex-exec] DEX swap quote failed:', e.message);
      throw new Error(`DEX execution not available: ${e.message}`, { cause: e });
    }
    return;
  }

  const parsed = splitSymbol(opp.symbol);
  if (!parsed) {
    throw new Error(`Unsupported symbol format: ${opp.symbol}`);
  }

  // ── Perpetuals / Funding ────────────────────────────────────────────────
  if (opp.isPerp || opp.strategy === 'funding' || opp.strategy === 'perps') {
    if (!String(opp.symbol || '').toUpperCase().endsWith('USDT')) {
      throw new Error(`Perps execution requires USDT-margined symbols. Received: ${opp.symbol}`);
    }
    if (!hasExchangeCredentials(env, 'mexc')) {
      throw new Error('MEXC_API_KEY / MEXC_API_SECRET required for perps/funding trading');
    }
    const skipCheck = ['1', 'true', 'on', 'yes'].includes(
      String(env?.SKIP_BALANCE_CHECK || '').toLowerCase()
    );
    const sufficient = skipCheck || await hasSufficientUSDT(env, sizeUsd);
    if (!sufficient) {
      throw new Error(`Insufficient USDT balance for $${sizeUsd.toFixed(2)} trade`);
    }
    const amount = (sizeUsd / opp.buyPrice).toFixed(6);
    const side = opp.sellExchange === 'mexc_perp' ? 'SHORT' : 'LONG';
    await placeMEXCFuturesOrder(env, opp.symbol, side, amount, leverage);
    return;
  }

  // ── CEX spatial arbitrage ───────────────────────────────────────────────
  const buyExch = opp.buyExchange;
  const sellExch = opp.sellExchange;

  if (!hasExchangeCredentials(env, buyExch)) {
    throw new Error(
      `No execution credentials for buy exchange: ${buyExch}. ` +
      `Required: ${getRequiredCredentialKeys(buyExch).join(', ')}`
    );
  }
  if (!hasExchangeCredentials(env, sellExch)) {
    throw new Error(
      `No execution credentials for sell exchange: ${sellExch}. ` +
      `Required: ${getRequiredCredentialKeys(sellExch).join(', ')}`
    );
  }

  const quoteToUsd = await getQuoteToUsdRate(env, parsed.quote);
  if (!Number.isFinite(quoteToUsd) || quoteToUsd <= 0) {
    throw new Error(`Cannot value quote asset ${parsed.quote} in USD`);
  }
  const requiredQuote = sizeUsd / quoteToUsd;
  const amount = (requiredQuote / opp.buyPrice).toFixed(6);

  const buyBalance = await getExchangeBalance(env, buyExch, parsed.quote);
  if (buyBalance < requiredQuote) {
    throw new Error(
      `Insufficient ${parsed.quote} on ${buyExch}: ` +
      `${buyBalance.toFixed(6)} available, ${requiredQuote.toFixed(6)} needed`
    );
  }

  let sellBalance = await getExchangeBalance(env, sellExch, parsed.base);
  const minSellQty = Number.parseFloat(amount);
  if (sellBalance < minSellQty) {
    console.warn(
      `⚠️ Insufficient ${parsed.base} on ${sellExch} (has ${sellBalance.toFixed(6)}, need ${minSellQty}). ` +
      `Will execute BUY first, then SELL immediately.`
    );
  }

  await executeCexArbWithHedge(env, {
    buyExch,
    sellExch,
    symbol: opp.symbol,
    amount,
    requiredQuote,
  });
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function incrementRejection(bucket, reason, count = 1) {
  if (!bucket || !reason || count <= 0) return;
  bucket[reason] = Number(bucket[reason] || 0) + Number(count || 0);
}

function checkDexStrategyRejection(opp, env) {
  if (opp.strategy === 'dex' && !hasDexExecutionConfigured(env)) {
    return 'dex_executor_not_configured';
  }
  return null;
}

function checkSpecialStrategyRejection(opp, env) {
  if (opp.strategy === 'statistical' && opp.buyExchange !== opp.sellExchange) {
    return 'statistical_cross_exchange_not_supported';
  }
  if (opp.strategy === 'triangular' && !hasExchangeCredentials(env, opp.buyExchange)) {
    return 'triangular_missing_exchange_credentials';
  }
  return null;
}

function checkPerpStrategyRejection(opp, env, buyExchange, sellExchange) {
  if (!opp.isPerp && opp.strategy !== 'perps' && opp.strategy !== 'funding') {
    return null;
  }

  const counterparty = buyExchange.endsWith('_perp') ? sellExchange : buyExchange;
  if (!hasExchangeCredentials(env, 'mexc')) return 'perps_missing_mexc_credentials';
  if (!hasExchangeCredentials(env, counterparty)) return 'perps_missing_counterparty_credentials';
  return 'perps_not_live_executable';
}

function classifyLiveRejectReason(opp, env) {
  if (!opp) return 'unknown';

  const dexRejection = checkDexStrategyRejection(opp, env);
  if (dexRejection) return dexRejection;

  const specialRejection = checkSpecialStrategyRejection(opp, env);
  if (specialRejection) return specialRejection;

  const buyExchange = String(opp.buyExchange || '').toLowerCase();
  const sellExchange = String(opp.sellExchange || '').toLowerCase();

  if (DEX_CHAINS.has(buyExchange) || DEX_CHAINS.has(sellExchange)) {
    return 'onchain_execution_not_supported';
  }

  const perpRejection = checkPerpStrategyRejection(opp, env, buyExchange, sellExchange);
  if (perpRejection) return perpRejection;

  if (!hasExchangeCredentials(env, buyExchange)) return 'missing_buy_exchange_credentials';
  if (!hasExchangeCredentials(env, sellExchange)) return 'missing_sell_exchange_credentials';
  return 'not_live_executable';
}

function buildRejectionSnapshot(rejectionBuckets, metadata = {}) {
  const entries = [];
  for (const [strategy, reasons] of Object.entries(rejectionBuckets || {})) {
    for (const [reason, count] of Object.entries(reasons || {})) {
      const n = Number(count || 0);
      if (n > 0) entries.push({ strategy, reason, count: n, key: `${strategy}.${reason}` });
    }
  }
  entries.sort((a, b) => b.count - a.count);

  const totalsByStrategy = Object.fromEntries(
    Object.entries(rejectionBuckets || {}).map(([strategy, reasons]) => {
      const total = Object.values(reasons || {}).reduce((sum, x) => sum + Number(x || 0), 0);
      return [strategy, total];
    })
  );

  return {
    timestamp: Date.now(),
    metadata,
    totalsByStrategy,
    topReasons: entries.slice(0, 15),
    reasons: rejectionBuckets,
  };
}

function getRecentWinRate(bucket) {
  const outcomes = Array.isArray(bucket?.outcomes) ? bucket.outcomes.slice(-40) : [];
  if (!outcomes.length) return 0.5;
  const wins = outcomes.reduce((sum, x) => sum + (x?.success ? 1 : 0), 0);
  return wins / outcomes.length;
}

function scoreOpportunity(opp, options = {}) {
  const {
    strategyWeights = {},
    strategyOutcomes = {},
    exchangeRoutingWeights = {},
    liveExchangeBalanceSnapshot = {},
    liveMinBalanceUsd = 0,
    venueReadyPriorityMultiplier = 1.2,
    liveCapUsd = Number.POSITIVE_INFINITY,
  } = options;

  const strategy = String(opp?.strategy || '').toLowerCase();
  const netPct = Number(opp?.netPct || 0);
  if (!Number.isFinite(netPct) || netPct <= 0) return -1;

  const weight = Number(strategyWeights?.[strategy] ?? 1);
  const safety = clamp(Number(opp?.safetyFactor ?? 0.5), 0.1, 1.5);
  const confidence = clamp(Number(opp?.confidence ?? 0.6), 0.2, 1);
  const winRate = getRecentWinRate(strategyOutcomes?.[strategy]);
  const winBoost = clamp(0.8 + (winRate * 0.5), 0.8, 1.3);
  const speedBoost = clamp(getStrategySpeedWeight(strategy), 0.75, 1.25);
  const exchangeBoost = getOpportunityExchangeWeight(opp, exchangeRoutingWeights);
  const balanceReadyBoost = getOpportunityBalanceReadinessBoost(
    opp,
    liveExchangeBalanceSnapshot,
    liveMinBalanceUsd,
    venueReadyPriorityMultiplier,
  );
  const liveCapBoost = getLiveExecutionCapBoost(liveCapUsd, liveMinBalanceUsd, venueReadyPriorityMultiplier);

  return netPct * safety * confidence * weight * winBoost * speedBoost * exchangeBoost * balanceReadyBoost * liveCapBoost;
}

function getLiveExecutionCapBoost(liveCapUsd, liveMinBalanceUsd, venueReadyPriorityMultiplier = 1.2) {
  const cap = Number(liveCapUsd || 0);
  if (!Number.isFinite(cap)) return 1;
  if (cap <= 0) return 0.6;

  const baseline = Math.max(1, Number(liveMinBalanceUsd || 0));
  const ratio = cap / baseline;
  return clamp(0.9 + (Math.min(ratio, 8) * 0.06), 0.9, Math.max(1.05, venueReadyPriorityMultiplier));
}

function getOpportunityBalanceReadinessBoost(
  opp,
  liveExchangeBalanceSnapshot = {},
  liveMinBalanceUsd = 0,
  venueReadyPriorityMultiplier = 1.2,
) {
  const venues = getOpportunityVenues(opp);
  if (!venues.length) return 1;

  let totalBoost = 0;
  for (const venue of venues) {
    const key = String(venue || '').toLowerCase();
    const snap = liveExchangeBalanceSnapshot?.[key] || null;
    if (!snap || snap.configured === false) {
      totalBoost += 0.85;
      continue;
    }

    const balance = Math.max(0, Number(snap.balance || 0));
    const eligible = snap.eligible === true || balance >= liveMinBalanceUsd;
    const ratio = liveMinBalanceUsd > 0 ? (balance / Math.max(1, liveMinBalanceUsd)) : 1;
    const balanceStrength = clamp(0.85 + (Math.min(ratio, 4) * 0.12), 0.85, venueReadyPriorityMultiplier);
    totalBoost += eligible ? balanceStrength : 0.9;
  }

  return clamp(totalBoost / venues.length, 0.8, venueReadyPriorityMultiplier);
}

async function getRoutingBalancesSnapshot(env) {
  const exchanges = getEnabledExecutionExchanges(env);
  const rows = await Promise.all(
    exchanges.map(async (exchange) => {
      if (!hasExchangeCredentials(env, exchange)) {
        return { exchange, configured: false, balance: 0 };
      }
      try {
        const balance = await getExchangeBalance(env, exchange, 'USDT');
        return { exchange, configured: true, balance: Number(balance || 0) };
      } catch (err) {
        console.warn(`[routing-balance] ${exchange} check failed:`, err.message);
        return { exchange, configured: true, balance: 0, error: true };
      }
    })
  );
  return rows;
}

function getStrategySpeedWeight(strategy) {
  const key = String(strategy || '').toLowerCase();
  return Number(STRATEGY_SPEED_WEIGHTS[key] ?? 1);
}

function getOpportunityExchangeWeight(opp, exchangeWeights = {}) {
  const venues = getOpportunityVenues(opp);
  if (!venues.length) return 1;

  const total = venues.reduce((sum, venue) => {
    return sum + Number(exchangeWeights[String(venue || '').toLowerCase()] ?? 1);
  }, 0);
  const avg = total / venues.length;
  return clamp(avg, 0.45, 1.75);
}

function getOpportunityVenues(opp) {
  const venues = new Set();
  const addVenue = (value) => {
    const v = String(value || '').toLowerCase().trim();
    const _DEX_CHAINS = ["0x", "ethereum", "bsc", "arbitrum", "polygon", "optimism"];
    if (v && !_DEX_CHAINS.includes(v)) venues.add(v);
  };

  if (Array.isArray(opp?.parallelLegs)) {
    for (const leg of opp.parallelLegs) {
      addVenue(leg?.buyExchange);
      addVenue(leg?.sellExchange);
    }
  }
  if (Array.isArray(opp?.legs)) {
    for (const leg of opp.legs) {
      addVenue(leg?.buyExchange);
      addVenue(leg?.sellExchange);
    }
  }

  addVenue(opp?.buyExchange);
  addVenue(opp?.sellExchange);

  return [...venues];
}
