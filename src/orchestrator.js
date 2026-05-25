// nexus/src/orchestrator.js — Unified Decision Engine
//
// Runs all three strategies (CEX, DEX, Perps) in parallel across all supported
// symbols, selects the single best opportunity, applies unified risk checks,
// and executes one trade per scan cycle.

import { getAllSpotPrices, getMEXCPerpPrice, get0xPrice, resolveDynamicScanSymbols } from './prices.js';
import { scanCEX }   from './strategies/cex.js';
import { scanDEX }   from './strategies/dex.js';
import { scanPerps } from './strategies/perps.js';
import { logTrade, openPaperPosition, getOpenPaperPositions, closePaperPosition } from './db.js';
import { calculateAdaptiveLeverage, calculatePositionSize, MAX_POSITION_EQUITY_FRACTION } from './risk.js';
import {
  placeMEXCFuturesOrder, hasSufficientUSDT,
  hasExchangeCredentials, getRequiredCredentialKeys, getExchangeBalance, placeExchangeMarketOrder
} from './exchange.js';

const SUPPORTED_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT',
  'BNBUSDT', 'AVAXUSDT', 'MATICUSDT', 'LINKUSDT', 'UNIUSDT',
  'ADAUSDT', 'DOTUSDT', 'LTCUSDT', 'TRXUSDT', 'NEARUSDT'
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
 * DEX opportunities remain scan-only until a safe on-chain execution layer exists.
 */
export function isLiveExecutableOpportunity(opp) {
  return isLiveExecutableOpportunityWithEnv(opp, {});
}

/** Returns true when DEX live execution is configured. */
export function hasDexExecutionConfigured(env) {
  return Boolean(env?.DEX_EXECUTOR_URL);
}

/**
 * Environment-aware live executability check.
 * DEX opportunities are executable only when a DEX executor endpoint is configured.
 */
export function isLiveExecutableOpportunityWithEnv(opp, env) {
  if (!opp) return false;
  if (opp.strategy === 'dex') return hasDexExecutionConfigured(env);
  return !['0x', 'ethereum', 'bsc'].includes(opp.buyExchange)
    && !['0x', 'ethereum', 'bsc'].includes(opp.sellExchange);
}

/**
 * Returns the maximum USD size that can be executed for the selected live opportunity.
 * DEX opportunities are delegated to the external executor, so they are not capped here.
 */
export async function getLiveExecutionCapUsd(env, opp) {
  if (!opp) return 0;
  if (opp.strategy === 'dex') return Number.POSITIVE_INFINITY;

  const safeBalance = async (exchange, asset) => {
    try {
      const v = await getExchangeBalance(env, exchange, asset);
      return Math.max(0, Number(v || 0));
    } catch (_) {
      return 0;
    }
  };

  if (opp.isPerp) {
    return safeBalance('mexc', 'USDT');
  }

  const buyBalance = await safeBalance(opp.buyExchange, 'USDT');
  const baseAsset = opp.symbol.replace(/USDT$/, '');
  const sellBalance = await safeBalance(opp.sellExchange, baseAsset);
  const sellValueUsd = sellBalance * Math.max(0, Number(opp.buyPrice || 0));

  return Math.max(0, Math.min(buyBalance, sellValueUsd));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes a DEX arbitrage opportunity using an external executor service.
 * The service owns private-key operations and bridge/swap settlement.
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

// ── Circuit Breaker (KV-backed, 5-minute window) ──────────────────────────────
//
// Tracks per-exchange failure counts across scan cycles.  After
// MAX_CB_FAILURES consecutive failures, the exchange is "open" (skipped) for
// CB_RESET_MS.  State is persisted in KV with a 10-minute TTL.

const CB_KEY         = 'nexus_circuit_breaker';
const MAX_CB_FAILURES = 3;
const CB_RESET_MS    = 5 * 60 * 1000; // 5 min

async function getCircuitBreaker(env) {
  try { return await env.BOT_STATE.get(CB_KEY, 'json') || {}; }
  catch (_) { return {}; }
}

async function saveCircuitBreaker(env, cb) {
  try { await env.BOT_STATE.put(CB_KEY, JSON.stringify(cb), { expirationTtl: 600 }); }
  catch (_) {}
}

function isCircuitOpen(cb, exchange) {
  const ex = cb[exchange];
  if (!ex || !ex.open) return false;
  return (Date.now() - ex.lastFailure) < CB_RESET_MS;
}

function recordCBFailure(cb, exchange) {
  const now = Date.now();
  const ex  = cb[exchange] || { failures: 0, lastFailure: 0, open: false };
  if (now - ex.lastFailure > CB_RESET_MS) {
    ex.failures = 0;
    ex.open     = false;
  }
  ex.failures++;
  ex.lastFailure = now;
  ex.open = ex.failures >= MAX_CB_FAILURES;
  cb[exchange] = ex;
  if (ex.open) {
    console.warn(`[CB] ${exchange} circuit OPEN after ${ex.failures} failures`);
  }
}

function recordCBSuccess(cb, exchange) {
  if (cb[exchange]) {
    cb[exchange].failures = 0;
    cb[exchange].open     = false;
  }
}

// ── Paper position settlement ─────────────────────────────────────────────────
//
// At the start of each scan cycle, open paper positions whose symbol was just
// re-priced are closed at the current mid-price.  This gives a more realistic
// P&L figure than an instant-fill assumption.

async function settleOpenPaperPositions(env, currentPrices, state) {
  const positions = await getOpenPaperPositions(env);
  if (positions.length === 0) return;
  for (const pos of positions) {
    const current = currentPrices[pos.symbol];
    if (!current) continue;
    // Round-trip fee estimate: 0.15% covers typical taker fees on both legs
    const feePct = 0.15 / 100;
    // Direction: if the perp is on the sell side (basis trade SHORT), profit when
    // price falls; otherwise it's a LONG leg and profit when price rises.
    const isShortPerp = (pos.sell_exchange || '').includes('perp');
    const priceDelta = isShortPerp
      ? (pos.entry_price - current) / pos.entry_price  // SHORT: entry higher → profit
      : (current - pos.entry_price) / pos.entry_price; // LONG : exit higher  → profit
    const netPct = (priceDelta - feePct) * 100;
    const pnlUsd = pos.size_usd * (netPct / 100);

    await closePaperPosition(env, pos.id, current, pnlUsd);

    // Update state counters with realized P&L
    state.daily_pnl = (state.daily_pnl || 0) + pnlUsd;
    state.total_pnl = (state.total_pnl || 0) + pnlUsd;
    state.daily_trades = (state.daily_trades || 0) + 1;
    state.total_trades = (state.total_trades || 0) + 1;

    // Log the settled trade to the canonical trades table for dashboard/analytics
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
 * Main scan-and-execute cycle.
 *
 * @param {object}   env        — Cloudflare Worker env bindings
 * @param {object}   state      — current trading_state from KV (mutated in place)
 * @param {function} sendAlert  — async (env, msg) => void
 * @returns {object|null}  trade result or null when no trade was made
 */
export async function runScan(env, state, sendAlert) {
  const maxSpreadPct   = state.max_spread_pct   ?? 5.0;
  const initialCapital = state.initial_capital  ?? 1000;
  const equity         = initialCapital + (state.total_pnl || 0);
  const paperMode      = state.paper_trading !== false;
  const symbols        = await resolveScanSymbolsForState(state);

  const allOpportunities = [];
  const lastScan = { timestamp: Date.now(), cex: null, dex: null, perps: null };

  // Load circuit-breaker state from KV once per cycle and build the open-circuit set
  const cb = await getCircuitBreaker(env);
  const openCircuits = new Set();
  for (const [exchange] of Object.entries(cb)) {
    if (isCircuitOpen(cb, exchange)) openCircuits.add(exchange);
  }
  if (openCircuits.size > 0) {
    console.log(`[CB] Skipping open circuits: ${[...openCircuits].join(', ')}`);
  }

  // Track per-symbol mid prices so we can settle paper positions
  const midPrices = {};

  // ── Scan all symbols (CEX + Perps) and DEX in parallel ──────────────────────
  const [, dexOpp] = await Promise.all([
    Promise.all(
      symbols.map(async symbol => {
        try {
          const [spotSources, perpSource, zeroXSource] = await Promise.all([
            getAllSpotPrices(env, symbol, openCircuits),
            (!openCircuits.has('mexc_perp')) ? getMEXCPerpPrice(symbol) : Promise.resolve(null),
            get0xPrice(env, symbol)
          ]);

          // Update circuit breaker based on fetch results
          if (spotSources.length > 0) {
            for (const src of spotSources) recordCBSuccess(cb, src.exchange);
          } else {
            // All spot sources failed — record failure for mexc (primary)
            recordCBFailure(cb, 'mexc');
          }
          if (perpSource) {
            recordCBSuccess(cb, 'mexc_perp');
          } else {
            recordCBFailure(cb, 'mexc_perp');
          }

          // Record mid price for paper settlement (use MEXC spot as reference)
          const mexcSrc = spotSources.find(s => s.exchange === 'mexc');
          if (mexcSrc) midPrices[symbol] = mexcSrc.price;

          // CEX: all spot sources + 0x DEX price
          const cexSources = zeroXSource
            ? [...spotSources, zeroXSource]
            : spotSources;

          const cexOpp   = scanCEX(symbol, cexSources, maxSpreadPct);
          const perpsOpp = scanPerps(symbol, spotSources, perpSource, maxSpreadPct);

          if (cexOpp) {
            allOpportunities.push(cexOpp);
            if (!lastScan.cex || cexOpp.netPct > lastScan.cex.netPct)
              lastScan.cex = cexOpp;
          }
          if (perpsOpp) {
            allOpportunities.push(perpsOpp);
            if (!lastScan.perps || perpsOpp.netPct > lastScan.perps.netPct)
              lastScan.perps = perpsOpp;
          }
        } catch (e) {
          console.error(`[${symbol}] scan error:`, e.message);
        }
      })
    ),
    scanDEX(env)
  ]);

  // Persist updated circuit-breaker state (fire-and-forget)
  saveCircuitBreaker(env, cb);

  if (dexOpp) {
    allOpportunities.push(dexOpp);
    lastScan.dex = dexOpp;
  }

  // Settle open paper positions now that we have fresh prices
  await settleOpenPaperPositions(env, midPrices, state);

  // Persist scan summary to KV (5-min TTL for status endpoints)
  try {
    await env.BOT_STATE.put(
      'nexus_last_scan',
      JSON.stringify(lastScan),
      { expirationTtl: 300 }
    );
  } catch (_) {}

  if (allOpportunities.length === 0) {
    console.log(`🔍 Nexus: no opportunities across ${symbols.length} symbols`);
    return null;
  }

  const executableOpportunities = paperMode
    ? allOpportunities
    : allOpportunities.filter((opp) => isLiveExecutableOpportunityWithEnv(opp, env));

  if (executableOpportunities.length === 0) {
    console.log(`🔍 Nexus: no executable opportunities in ${paperMode ? 'paper' : 'live'} mode`);
    return null;
  }

  // ── Pick highest net-profit opportunity ──────────────────────────────────────
  const best = executableOpportunities.reduce((a, b) => (a.netPct > b.netPct ? a : b));
  console.log(
    `🎯 Best [${best.strategy.toUpperCase()}] ${best.symbol} ${best.direction}` +
    ` net ${best.netPct.toFixed(4)}%  safety ${(best.safetyFactor * 100).toFixed(1)}%`
  );

  // ── Sizing ───────────────────────────────────────────────────────────────────
  // Leverage only applied for perps; spot arbitrage uses effective leverage 1
  const leverage = best.isPerp
    ? calculateAdaptiveLeverage(equity, best.netPct, initialCapital)
    : 1;
  const baseSize = calculatePositionSize(
    equity,
    state.win_rate          || 0.55,
    state.risk_reward_ratio || 2.0
  );
  // Hard cap: MAX_POSITION_EQUITY_FRACTION of equity, consistent with risk.js
  const requestedSizeUsd = Math.min(baseSize * leverage, equity * MAX_POSITION_EQUITY_FRACTION);
  const liveBalanceCapUsd = paperMode ? Number.POSITIVE_INFINITY : await getLiveExecutionCapUsd(env, best);
  const sizeUsd = Math.min(requestedSizeUsd, liveBalanceCapUsd);

  if (!Number.isFinite(sizeUsd) || sizeUsd <= 0) {
    console.log(`🔍 Nexus: live size capped to zero by available balances for ${best.symbol}`);
    return null;
  }

  if (!paperMode && sizeUsd < requestedSizeUsd) {
    console.log(`💱 Live size capped from $${requestedSizeUsd.toFixed(2)} to $${sizeUsd.toFixed(2)} by available balances`);
  }
  const mode          = paperMode ? 'paper' : 'live';
  const strategyLabel = `${best.strategy}:${best.direction}`;
  const levStr        = leverage > 1 ? ` | ${leverage}x` : '';

  // ── Execute or log paper trade ───────────────────────────────────────────────
  if (paperMode) {
    // Open a virtual position that will be settled at current price on the next cycle.
    // We do NOT update state.total_pnl or logTrade here; settlement happens later.
    await openPaperPosition(env, best, sizeUsd);
    state.last_trade_timestamp = Date.now(); // Still update throttle

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

      // ── Update state counters for LIVE trades (caller saves state to KV) ─────
      const tradePnl = sizeUsd * best.netPct / 100;
      state.daily_pnl          = (state.daily_pnl   || 0) + tradePnl;
      state.total_pnl          = (state.total_pnl   || 0) + tradePnl;
      state.daily_trades       = (state.daily_trades || 0) + 1;
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
//
// Execution routing rules:
//   DEX / 0x opportunities → paper-only (no on-chain bridge layer yet)
//   Perps                  → MEXC Futures (only supported futures venue)
//   CEX spatial            → execute both legs on their respective exchanges
//                            (requires API credentials for buyExchange AND sellExchange)

async function executeTrade(env, opp, sizeUsd, leverage) {
  // DEX trades are delegated to an external executor (bridge/swap signer service).
  if (opp.strategy === 'dex') {
    await executeDexTrade(env, opp, sizeUsd);
    return;
  }

  // 0x quotes represent on-chain DEX prices — not executable via CEX APIs.
  if (opp.buyExchange === '0x' || opp.sellExchange === '0x') {
    throw new Error(
      'DEX (0x) execution not yet supported in live mode — set paper_trading=true to simulate'
    );
  }

  const amount = (sizeUsd / opp.buyPrice).toFixed(6);

  // ── Perpetuals ────────────────────────────────────────────────────────────
  if (opp.isPerp) {
    if (!hasExchangeCredentials(env, 'mexc')) {
      throw new Error('MEXC_API_KEY / MEXC_API_SECRET required for perps trading');
    }
    const sufficient = await hasSufficientUSDT(env, sizeUsd);
    if (!sufficient) {
      throw new Error(`Insufficient USDT balance for $${sizeUsd.toFixed(2)} trade`);
    }
    const side = opp.sellExchange === 'mexc_perp' ? 'SHORT' : 'LONG';
    await placeMEXCFuturesOrder(env, opp.symbol, side, amount, leverage);
    return;
  }

  // ── CEX spatial arbitrage ─────────────────────────────────────────────────
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

  // Pre-flight balance checks
  const baseAsset = opp.symbol.replace(/USDT$/, '');

  // USDT on buy exchange
  const buyBalance = await getExchangeBalance(env, buyExch, 'USDT');
  if (buyBalance < sizeUsd) {
    throw new Error(
      `Insufficient USDT on ${buyExch}: ` +
      `$${buyBalance.toFixed(2)} available, $${sizeUsd.toFixed(2)} needed`
    );
  }

  // Base asset on sell exchange (must be pre-positioned for hedged execution)
  const sellBalance = await getExchangeBalance(env, sellExch, baseAsset);
  const minSellQty  = parseFloat(amount);
  if (sellBalance < minSellQty) {
    throw new Error(
      `Insufficient ${baseAsset} on ${sellExch}: ` +
      `${sellBalance.toFixed(6)} available, ${amount} needed`
    );
  }

  // Execute both legs simultaneously to minimise execution slippage.
  await Promise.all([
    placeExchangeMarketOrder(env, buyExch,  opp.symbol, 'BUY',  amount, sizeUsd),
    placeExchangeMarketOrder(env, sellExch, opp.symbol, 'SELL', amount, sizeUsd)
  ]);
}
