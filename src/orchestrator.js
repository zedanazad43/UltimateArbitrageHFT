// nexus/src/orchestrator.js — Unified Decision Engine
//
// Runs ALL strategies (CEX, DEX, Perps, Funding, Triangular, Statistical)
// in parallel across all supported symbols, selects the single best
// opportunity, applies unified risk checks, and executes one trade per cycle.

import { getAllSpotPrices, getMEXCPerpPrice, get0xPrice, resolveDynamicScanSymbols } from './prices.js';
import { scanCEX }   from './strategies/cex.js';
import { scanDEX }   from './strategies/dex.js';
import { scanPerps } from './strategies/perps.js';
import { scanFundingRate } from './strategies/funding.js';
import { scanTriangular, TRIANGLES } from './strategies/triangular.js';
import { scanStatistical, CORRELATED_PAIRS } from './strategies/statistical.js';
import { scanFromHFT, isHFTEngineConfigured } from './hft-client.js';
import { logTrade, openPaperPosition, getOpenPaperPositions, closePaperPosition, logBotEvent } from './db.js';
import { calculateAdaptiveLeverage, calculatePositionSize, MAX_POSITION_EQUITY_FRACTION, checkDrawdownGuard, checkExposureLimit } from './risk.js';
import {
  placeMEXCFuturesOrder, hasSufficientUSDT,
  hasExchangeCredentials, getRequiredCredentialKeys, getExchangeBalance, placeExchangeMarketOrder
} from './exchange.js';

const QUOTE_ASSETS = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'DAI', 'TUSD', 'BTC', 'ETH'];
const STABLE_QUOTES = new Set(['USDT', 'USDC', 'FDUSD', 'BUSD', 'DAI', 'TUSD']);

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
  } catch (_) {
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
  } catch (_) {
    return SUPPORTED_SYMBOLS;
  }
}

/**
 * Returns true when the opportunity can be executed in live mode.
 */
export function isLiveExecutableOpportunity(opp) {
  if (!opp) return false;
  if (opp.strategy === 'dex') return false;
  // Statistical arb requires both legs on the same exchange
  if (opp.strategy === 'statistical' && opp.buyExchange !== opp.sellExchange) return false;
  return !['0x', 'ethereum', 'bsc'].includes(opp.buyExchange)
    && !['0x', 'ethereum', 'bsc'].includes(opp.sellExchange);
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
    return opp.buyExchange === opp.sellExchange && hasExchangeCredentials(env, opp.buyExchange);
  }

  // Triangular arb executes on a single exchange
  if (opp.strategy === 'triangular') {
    return hasExchangeCredentials(env, opp.buyExchange);
  }

  const buyExchange = String(opp.buyExchange || '').toLowerCase();
  const sellExchange = String(opp.sellExchange || '').toLowerCase();
  if (['0x', 'ethereum', 'bsc'].includes(buyExchange) || ['0x', 'ethereum', 'bsc'].includes(sellExchange)) {
    return false;
  }

  if (opp.isPerp || opp.strategy === 'perps' || opp.strategy === 'funding') {
    const counterparty = buyExchange.endsWith('_perp') ? sellExchange : buyExchange;
    return hasExchangeCredentials(env, 'mexc') && hasExchangeCredentials(env, counterparty);
  }

  return hasExchangeCredentials(env, buyExchange) && hasExchangeCredentials(env, sellExchange);
}

/**
 * Returns the maximum USD size that can be executed for the selected live opportunity.
 */
export async function getLiveExecutionCapUsd(env, opp) {
  if (!opp) return 0;
  if (opp.strategy === 'dex') return Number.POSITIVE_INFINITY;
  if (opp.strategy === 'triangular') return Number.POSITIVE_INFINITY; // single-exchange, no cross-exchange cap

  const safeBalance = async (exchange, asset) => {
    try {
      const v = await getExchangeBalance(env, exchange, asset);
      return Math.max(0, Number(v || 0));
    } catch (e) {
      console.warn(`[balance-cap] ${exchange} ${asset} check failed: ${e.message}`);
      return 0;
    }
  };

  if (opp.isPerp || opp.strategy === 'funding') {
    return safeBalance('mexc', 'USDT');
  }

  const parsed = splitSymbol(opp.symbol);
  if (!parsed) return 0;

  const quoteToUsd = await getQuoteToUsdRate(env, parsed.quote);
  if (!Number.isFinite(quoteToUsd) || quoteToUsd <= 0) return 0;

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

/**
 * Executes a DEX arbitrage opportunity using an external executor service.
 */
export async function executeDexTrade(env, opp, sizeUsd) {
  const executorUrl = env.DEX_EXECUTOR_URL;
  if (!executorUrl) {
    throw new Error('DEX_EXECUTOR_URL is not configured for live DEX execution');
  }

  const timeoutMs = Math.max(1000, parseInt(env.DEX_EXECUTION_TIMEOUT_MS || '20000', 10));
  const maxRetries = Math.max(0, parseInt(env.DEX_EXECUTOR_MAX_RETRIES || '2', 10));
  const retryBaseMs = Math.max(100, parseInt(env.DEX_EXECUTOR_RETRY_BASE_MS || '500', 10));
  const slippageBps = Math.max(1, parseInt(env.DEX_MAX_SLIPPAGE_BPS || '80', 10));
  const payload = {
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

      let data = null;
      try { data = await resp.json(); } catch (_) {}

      if (!resp.ok) {
        const err = new Error(data?.error || data?.message || `DEX executor HTTP ${resp.status}`);
        if (attempt < maxRetries && retryableStatuses.has(resp.status)) {
          await sleep(retryBaseMs * (2 ** attempt));
          continue;
        }
        throw err;
      }

      if (!data || data.success !== true) {
        const err = new Error(data?.error || data?.message || 'DEX executor returned unsuccessful response');
        if (attempt < maxRetries) {
          await sleep(retryBaseMs * (2 ** attempt));
          continue;
        }
        throw err;
      }

      return data;
    } catch (e) {
      const isAbort = e?.name === 'AbortError';
      const isNetwork = e instanceof TypeError;
      if (attempt < maxRetries && (isAbort || isNetwork)) {
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
const CB_KEY                 = 'nexus_circuit_breaker';
const MAX_CB_FAILURES        = 3;
const CB_RESET_WINDOW_MS     = 10 * 60 * 1000; // 10 min window to reset counter
const CB_COOLDOWN_MS         = 5 * 60 * 1000;   // 5 min skip when open
const CB_MAX_FATAL_THRESHOLD = 100;             // if > 100 failures → fatal, skip 1h
const CB_FATAL_COOLDOWN_MS   = 60 * 60 * 1000;  // 1 hour cooldown for fatal failures

async function getCircuitBreaker(env) {
  try { return await env.BOT_STATE.get(CB_KEY, 'json') || {}; }
  catch (_) { return {}; }
}

async function saveCircuitBreaker(env, cb) {
  try { await env.BOT_STATE.put(CB_KEY, JSON.stringify(cb), { expirationTtl: 7200 }); }
  catch (_) {}
}

async function saveState(env, state) {
  try {
    await env.BOT_STATE.put('trading_state', JSON.stringify(state));
  } catch (_) {}
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
  const ex  = cb[exchange] || { failures: 0, lastFailure: 0, open: false, cooldownUntil: 0 };

  // Reset failure counter if enough time has passed since last failure
  if (now - ex.lastFailure > CB_RESET_WINDOW_MS) {
    ex.failures = 0;
    ex.open     = false;
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
    console.warn(`[CB] ${exchange} circuit OPEN for ${CB_COOLDOWN_MS/60000}min after ${ex.failures} failures`);
  }

  cb[exchange] = ex;
}

function recordCBSuccess(cb, exchange) {
  if (cb[exchange]) {
    cb[exchange].failures = 0;
    cb[exchange].open     = false;
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

/**
 * Collects cross-pair prices needed for triangular arbitrage from a single exchange.
 * Uses the first exchange from spotSources as the primary price feed.
 */
function collectTriangularPrices(spotPriceMap, symbols) {
  const prices = {};
  for (const sym of symbols) {
    const src = spotPriceMap[sym];
    if (src) prices[sym] = src.price;
  }
  return prices;
}

/**
 * Builds a spotPriceMap from spotSources array: symbol -> { price, exchange, fee }
 */
function buildSpotPriceMap(symbol, spotSources) {
  const map = {};
  // Use the first available exchange as the primary source for triangular/statistical
  const bestSource = spotSources.reduce((a, b) => (a.fee < b.fee ? a : b), spotSources[0]);
  map[symbol] = { price: bestSource.price, exchange: bestSource.exchange, fee: bestSource.fee };
  return map;
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
export async function runScan(env, state, sendAlert) {
  const maxSpreadPct   = state.max_spread_pct   ?? 5.0;
  const initialCapital = state.initial_capital  ?? 1000;
  const equity         = initialCapital + (state.total_pnl || 0);
  const paperMode      = state.paper_trading !== false;
  const symbols        = await resolveScanSymbolsForState(state);
  const strategyMode   = String(env?.STRATEGY_MODE || 'multi_exchange').toLowerCase();
  const mexcOnlyMode   = strategyMode === 'mexc_only';
  const aggressiveScanMode = ['1', 'true', 'on', 'yes'].includes(String(env?.AGGRESSIVE_SCAN_MODE || '').toLowerCase());
  const configuredCexMinSafety = Number.parseFloat(String(env?.CEX_MIN_SAFETY_FACTOR || ''));
  const configuredPerpsMinSafety = Number.parseFloat(String(env?.PERPS_MIN_SAFETY_FACTOR || ''));
  const configuredCexSlippageMultiplier = Number.parseFloat(String(env?.CEX_SLIPPAGE_MULTIPLIER || ''));
  const cexScanOptions = {
    minSafetyFactor: Number.isFinite(configuredCexMinSafety)
      ? configuredCexMinSafety
      : (aggressiveScanMode ? 0.20 : 0.35),
    slippageMultiplier: Number.isFinite(configuredCexSlippageMultiplier)
      ? configuredCexSlippageMultiplier
      : (aggressiveScanMode ? 0.75 : 1),
  };
  const perpsScanOptions = {
    minSafetyFactor: Number.isFinite(configuredPerpsMinSafety)
      ? configuredPerpsMinSafety
      : (aggressiveScanMode ? 0.20 : 0.35),
  };
  const strategyFlags  = {
    cex:         state?.strategy_flags?.cex !== false,
    dex:         state?.strategy_flags?.dex !== false,
    perps:       state?.strategy_flags?.perps !== false,
    funding:     state?.strategy_flags?.funding !== false,
    triangular:  state?.strategy_flags?.triangular !== false,
    statistical: state?.strategy_flags?.statistical !== false,
  };

  const allOpportunities = [];
  const lastScan = { timestamp: Date.now(), cex: null, dex: null, perps: null, funding: null, triangular: null, statistical: null };

  // Load circuit-breaker state from KV once per cycle
  const cb = await getCircuitBreaker(env);
  const openCircuits = new Set();
  for (const [exchange] of Object.entries(cb)) {
    if (isCircuitOpen(cb, exchange)) openCircuits.add(exchange);
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

  async function scanSymbolsConcurrently(syms, handler, maxConcurrency = 5) {
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
          const [spotSources, perpSource, zeroXSource] = await Promise.all([
            getAllSpotPrices(env, symbol, openCircuits),
            (!openCircuits.has('mexc_perp')) ? getMEXCPerpPrice(symbol) : Promise.resolve(null),
            get0xPrice(env, symbol)
          ]);

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
          if (perpSource) {
            recordCBSuccess(cb, 'mexc_perp');
          } else if (!openCircuits.has('mexc_perp')) {
            recordCBFailure(cb, 'mexc_perp');
            if (isCircuitOpen(cb, 'mexc_perp')) openCircuits.add('mexc_perp');
          }

          const mexcSrc = spotSources.find(s => s.exchange === 'mexc');
          if (mexcSrc) midPrices[symbol] = mexcSrc.price;

          const effectiveSpotSources = mexcOnlyMode
            ? spotSources.filter((src) => src.exchange === 'mexc')
            : spotSources;

          const cexSources = (!mexcOnlyMode && zeroXSource)
            ? [...effectiveSpotSources, zeroXSource]
            : effectiveSpotSources;

          // ── Strategy 1: CEX Spatial ────────────────────────────────────────
          const cexOpp = (strategyFlags.cex && !mexcOnlyMode)
            ? scanCEX(symbol, cexSources, maxSpreadPct, cexScanOptions)
            : null;

          // ── Strategy 2: Perpetuals vs Spot ─────────────────────────────────
          const perpsOpp = strategyFlags.perps
            ? scanPerps(symbol, effectiveSpotSources, perpSource, maxSpreadPct, perpsScanOptions)
            : null;

          // ── Strategy 3: Funding Rate Harvest ──────────────────────────────
          // Requires perp data with fundingRate field
          const fundingOpp = (strategyFlags.funding && perpSource && perpSource.fundingRate !== undefined)
            ? scanFundingRate(symbol, effectiveSpotSources, perpSource, maxSpreadPct)
            : null;

          // ── Strategy 4: Triangular ─────────────────────────────────────────
          // Triangular arb uses the spotPriceMap from the primary exchange
          let triangularOpp = null;
          if (strategyFlags.triangular && effectiveSpotSources.length > 0) {
            const primaryExchange = effectiveSpotSources[0].exchange;
            const fee = effectiveSpotSources[0].fee;
            // We need cross-pair prices — use the primary exchange
            // For now, triangular is available only on MEXC (primary)
            const spotPriceMap = buildSpotPriceMap(symbol, effectiveSpotSources);
            const triPrices = collectTriangularPrices(spotPriceMap, [symbol]);
            if (triPrices[symbol]) {
              triangularOpp = scanTriangular(primaryExchange, fee, {
                [symbol]: triPrices[symbol],
                // Additional prices would be gathered in a more comprehensive scan
                // For now, we just flag it as available
              });
            }
          }

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
          if (triangularOpp) {
            allOpportunities.push(triangularOpp);
            if ((paperMode || isLiveExecutableOpportunityWithEnv(triangularOpp, env)) &&
                (!lastScan.triangular || triangularOpp.netPct > lastScan.triangular.netPct)) {
              lastScan.triangular = triangularOpp;
            }
          }
        } catch (e) {
          console.error(`[${symbol}] scan error:`, e.message);
        }
      },
      5
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
          const statOpp = await scanStatistical(env, pair, priceA, priceB, sourcesA, sourcesB);
          if (statOpp) {
            allOpportunities.push(statOpp);
            if ((paperMode || isLiveExecutableOpportunityWithEnv(statOpp, env)) &&
                (!lastScan.statistical || statOpp.netPct > lastScan.statistical.netPct)) {
              lastScan.statistical = statOpp;
            }
          }
        }
      }
    } catch (e) {
      console.error('[Statistical] scan error:', e.message);
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
  } catch (_) {}

  if (allOpportunities.length === 0) {
    console.log(`🔍 Nexus: no opportunities across ${symbols.length} symbols (all strategies)`);
    return null;
  }

  const executableOpportunities = paperMode
    ? allOpportunities
    : allOpportunities.filter((opp) => isLiveExecutableOpportunityWithEnv(opp, env));

  if (executableOpportunities.length === 0) {
    console.log(`🔍 Nexus: no executable opportunities in ${paperMode ? 'paper' : 'live'} mode`);
    return null;
  }

  // ── Pick highest net-profit opportunity ──────────────────────────────────
  const best = executableOpportunities.reduce((a, b) => (a.netPct > b.netPct ? a : b));
  console.log(
    `🎯 Best [${best.strategy.toUpperCase()}] ${best.symbol} ${best.direction}` +
    ` net ${best.netPct.toFixed(4)}%  safety ${(best.safetyFactor * 100).toFixed(1)}%`
  );

  // ── Sizing ───────────────────────────────────────────────────────────────
  const leverage = best.isPerp || best.strategy === 'funding'
    ? calculateAdaptiveLeverage(equity, best.netPct, initialCapital)
    : 1;
  const baseSize = calculatePositionSize(
    equity,
    state.win_rate          || 0.55,
    state.risk_reward_ratio || 2.0
  );
  const requestedSizeUsd = Math.min(baseSize * leverage, equity * MAX_POSITION_EQUITY_FRACTION);
  const liveBalanceCapUsd = paperMode ? Number.POSITIVE_INFINITY : await getLiveExecutionCapUsd(env, best);
  const sizeUsd = Math.min(requestedSizeUsd, liveBalanceCapUsd);
  const dailyLimitUsd = Number.isFinite(state.daily_limit_usd) && state.daily_limit_usd > 0
    ? state.daily_limit_usd
    : 0;
  const dailyVolumeUsd = Number(state.daily_volume_usd || 0);

  if (dailyLimitUsd > 0 && dailyVolumeUsd + sizeUsd > dailyLimitUsd) {
    state.auto_stopped = true;
    state.auto_stop_reason = `تجاوز حد الحجم اليومي $${dailyLimitUsd}`;
    await saveState(env, state);
    await logBotEvent(env, 'auto_stop', { reason: state.auto_stop_reason });
    await sendAlert(env, `🛑 *إيقاف تلقائي*\n${state.auto_stop_reason}`);
    return null;
  }

  if (!Number.isFinite(sizeUsd) || sizeUsd <= 0) {
    console.log(`🔍 Nexus: size capped to zero by balances for ${best.symbol}`);
    return null;
  }

  if (!paperMode && sizeUsd < requestedSizeUsd) {
    console.log(`💱 Live size capped from $${requestedSizeUsd.toFixed(2)} to $${sizeUsd.toFixed(2)} by available balances`);
  }
  const mode          = paperMode ? 'paper' : 'live';
  const strategyLabel = `${best.strategy}:${best.direction}`;
  const levStr        = leverage > 1 ? ` | ${leverage}x` : '';

  // ── Pre-execution risk checks ────────────────────────────────────────────
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

  const currentExposure = state.total_trades
    ? Math.min(sizeUsd * 3, equity * MAX_POSITION_EQUITY_FRACTION * 3)
    : 0;
  const exposureCheck = checkExposureLimit(equity, currentExposure, sizeUsd);
  if (!exposureCheck.allowed) {
    console.log(`🔍 Nexus: exposure limit blocked trade — ${exposureCheck.reason}`);
    return null;
  }

  // ── Execute or log paper trade ───────────────────────────────────────────
  if (paperMode) {
    await openPaperPosition(env, best, sizeUsd);
    state.daily_volume_usd = (state.daily_volume_usd || 0) + sizeUsd;
    state.last_trade_timestamp = Date.now();

    await sendAlert(
      env,
      `📄 [PAPER] [${best.strategy.toUpperCase()}] ${best.symbol}\n` +
      `${best.direction}\n` +
      `$${sizeUsd.toFixed(2)}${levStr}\n` +
      `net ${best.netPct.toFixed(4)}%  safety ${(best.safetyFactor * 100).toFixed(1)}%`
    );
  } else {
    try {
      await executeTrade(env, best, sizeUsd, leverage);

      const tradePnl = sizeUsd * best.netPct / 100;
      state.daily_pnl          = (state.daily_pnl   || 0) + tradePnl;
      state.total_pnl          = (state.total_pnl   || 0) + tradePnl;
      state.daily_trades       = (state.daily_trades || 0) + 1;
      state.daily_volume_usd   = (state.daily_volume_usd || 0) + sizeUsd;
      state.total_trades       = (state.total_trades || 0) + 1;
      state.last_trade_timestamp = Date.now();

      await logTrade(env, { strategy: strategyLabel, sizeUsd, netPct: best.netPct, mode });

      await sendAlert(
        env,
        `✅ [LIVE] [${best.strategy.toUpperCase()}] ${best.symbol}\n` +
        `${best.direction}\n` +
        `$${sizeUsd.toFixed(2)}${levStr}\n` +
        `net ${best.netPct.toFixed(4)}%`
      );
    } catch (execErr) {
      console.error('Trade execution error:', execErr.message);
      await sendAlert(
        env,
        `❌ [${best.strategy.toUpperCase()}] فشل التنفيذ ${best.symbol}: ${execErr.message}`
      );
      return null;
    }
  }

  return { opportunity: best, sizeUsd, leverage };
}

// ── Trade execution ──────────────────────────────────────────────────────────
async function executeTrade(env, opp, sizeUsd, leverage) {
  if (opp.strategy === 'dex') {
    await executeDexTrade(env, opp, sizeUsd);
    return;
  }

  // Triangular arbitrage: execute all 3 legs on the same exchange
  if (opp.strategy === 'triangular') {
    const exchange = opp.buyExchange;
    if (!hasExchangeCredentials(env, exchange)) {
      throw new Error(`No execution credentials for triangular arb on ${exchange}`);
    }
    // Execute all 3 legs sequentially to capture the spread
    const legs = opp.legs || [];
    if (legs.length < 3) throw new Error('Invalid triangular legs');
    // Estimate: execute first leg with sizeUsd/3 per leg
    const legSize = sizeUsd / 3;
    for (const leg of legs) {
      await placeExchangeMarketOrder(env, exchange, leg, 'BUY', null, legSize);
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
      // Fallback: use buyPrice/sellPrice from opportunity
      const parsed = splitSymbol(opp.symbol);
      if (!parsed) throw new Error(`Cannot parse symbol: ${opp.symbol}`);
      await Promise.all([
        placeExchangeMarketOrder(env, exchange, opp.symbol, 'BUY', null, sizeUsd / 2),
        placeExchangeMarketOrder(env, exchange, opp.symbol, 'SELL', null, sizeUsd / 2)
      ]);
      return;
    }
    await Promise.all([
      placeExchangeMarketOrder(env, exchange, opp.buySymbol, 'BUY', null, sizeUsd / 2),
      placeExchangeMarketOrder(env, exchange, opp.sellSymbol, 'SELL', null, sizeUsd / 2)
    ]);
    return;
  }

  if (opp.buyExchange === '0x' || opp.sellExchange === '0x') {
    throw new Error(
      'DEX (0x) execution not yet supported in live mode — set paper_trading=true to simulate'
    );
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
    const sufficient = await hasSufficientUSDT(env, sizeUsd);
    if (!sufficient) {
      throw new Error(`Insufficient USDT balance for $${sizeUsd.toFixed(2)} trade`);
    }
    const amount = (sizeUsd / opp.buyPrice).toFixed(6);
    const side = opp.sellExchange === 'mexc_perp' ? 'SHORT' : 'LONG';
    await placeMEXCFuturesOrder(env, opp.symbol, side, amount, leverage);
    return;
  }

  // ── CEX spatial arbitrage ───────────────────────────────────────────────
  const buyExch  = opp.buyExchange;
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

  const sellBalance = await getExchangeBalance(env, sellExch, parsed.base);
  const minSellQty  = parseFloat(amount);
  if (sellBalance < minSellQty) {
    throw new Error(
      `Insufficient ${parsed.base} on ${sellExch}: ` +
      `${sellBalance.toFixed(6)} available, ${amount} needed`
    );
  }

  await Promise.all([
    placeExchangeMarketOrder(env, buyExch,  opp.symbol, 'BUY',  amount, requiredQuote),
    placeExchangeMarketOrder(env, sellExch, opp.symbol, 'SELL', amount, requiredQuote)
  ]);
}