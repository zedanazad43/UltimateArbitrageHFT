// nexus/src/orchestrator.js — Unified Decision Engine
//
// Runs all three strategies (CEX, DEX, Perps) in parallel across all supported
// symbols, selects the single best opportunity, applies unified risk checks,
// and executes one trade per scan cycle.

import {
  getAllSpotPrices,
  getMEXCPerpPrice,
  getBybitPerpData,
  getBinancePerpData,
  get0xPrice,
  getBinanceCrossPrice,
  getMEXCCrossPrice,
  getKuCoinCrossPrice,
} from './prices.js';
import { scanCEX }         from './strategies/cex.js';
import { scanDEX }         from './strategies/dex.js';
import { scanPerps }       from './strategies/perps.js';
import { scanFundingRate } from './strategies/funding.js';
import { scanTriangular, TRIANGLES } from './strategies/triangular.js';
import { scanStatistical, CORRELATED_PAIRS } from './strategies/statistical.js';
import { logTrade, openPaperPosition, getOpenPaperPositions, closePaperPosition } from './db.js';
import {
  calculateAdaptiveLeverage, calculatePositionSize,
  volatilityAdjustedSize, checkDrawdownGuard, checkExposureLimit,
  checkMinTimeBetweenTrades, MAX_POSITION_EQUITY_FRACTION
} from './risk.js';
import {
  placeMEXCFuturesOrder, hasSufficientUSDT,
  getMEXCFuturesBalance,
  hasExchangeCredentials, getRequiredCredentialKeys, getExchangeBalance,
  placeExchangeMarketOrder, getConfiguredExchanges, selectBestExchange, extractFillMetrics,
  ACTIVE_EXECUTION_EXCHANGES
} from './exchange.js';
import { isHFTEngineConfigured, scanFromHFT, executeViaHFT } from './hft-client.js';
import { filterOpportunityWithAI } from './ai-client.js';
import { buildRebalanceWeights } from './rebalancer.js';

const SUPPORTED_SYMBOLS = [
  // Top-cap majors
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  // Mid-cap with good liquidity
  'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'UNIUSDT', 'ADAUSDT',
  'DOTUSDT', 'LTCUSDT', 'TRXUSDT', 'NEARUSDT', 'MATICUSDT',
  // Trending layer-2 / ecosystem tokens
  'ARBUSDT', 'OPUSDT', 'APTUSDT', 'SUIUSDT', 'TONUSDT',
  // High-volume meme coins (larger inter-exchange spreads)
  'SHIBUSDT', 'PEPEUSDT', 'WIFUSDT', 'FLOKIUSDT',
  // DeFi / infrastructure
  'INJUSDT', 'TIAUSDT', 'ATOMUSDT', 'FILUSDT', 'HBARUSDT'
];

const DEFAULT_STRATEGY_FLAGS = Object.freeze({
  cex: true,
  dex: true,
  perps: true,
  funding: true,
  triangular: true,
  statistical: true,
});

function getStrategyFlags(state) {
  const raw = state?.strategy_flags || {};
  return {
    cex: raw.cex !== false,
    dex: raw.dex !== false,
    perps: raw.perps !== false,
    funding: raw.funding !== false,
    triangular: raw.triangular !== false,
    statistical: raw.statistical !== false,
  };
}

async function getRebalanceWeightsFromCache(env, state) {
  const policy = state?.rebalance_policy;
  if (!policy?.enabled) return null;
  if (!env?.BOT_STATE) return null;

  try {
    const cached = await env.BOT_STATE.get('balances_cache_v1', 'json');
    const balances = cached?.data;
    if (!Array.isArray(balances) || balances.length === 0) return null;
    const { weights } = buildRebalanceWeights(balances, policy);
    return weights;
  } catch (_) {
    return null;
  }
}

// ── Circuit Breaker (KV-backed, 5-minute window) ──────────────────────────────
//
// Tracks per-exchange failure counts across scan cycles.  After
// MAX_CB_FAILURES consecutive failures, the exchange is "open" (skipped) for
// CB_RESET_MS.  State is persisted in KV with a 10-minute TTL.

const CB_KEY         = 'nexus_circuit_breaker';
const MAX_CB_FAILURES = 3;
const CB_RESET_MS    = 5 * 60 * 1000; // 5 min
const FUTURES_STATUS_KEY = 'nexus_mexc_futures_status';
const FUTURES_STATUS_TTL_MS = 60 * 1000;
const PERP_EXCHANGES = new Set(['mexc_perp', 'binance_perp', 'bybit_perp']);

async function getMEXCFuturesReadyCached(env) {
  try {
    const cached = await env.BOT_STATE.get(FUTURES_STATUS_KEY, 'json');
    if (cached && typeof cached.checkedAt === 'number' && (Date.now() - cached.checkedAt) < FUTURES_STATUS_TTL_MS) {
      return !!cached.ready;
    }
  } catch (_) {}

  let ready = false;
  let error = null;
  try {
    await getMEXCFuturesBalance(env, 'USDT');
    ready = true;
  } catch (e) {
    error = e.message;
  }

  try {
    await env.BOT_STATE.put(
      FUTURES_STATUS_KEY,
      JSON.stringify({ ready, error, checkedAt: Date.now() }),
      { expirationTtl: Math.ceil(FUTURES_STATUS_TTL_MS / 1000) }
    );
  } catch (_) {}

  return ready;
}

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

async function settleOpenPaperPositions(env, currentPrices) {
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
    const pnlUsd = pos.size_usd * (priceDelta - feePct);
    await closePaperPosition(env, pos.id, current, pnlUsd);
    console.log(
      `[Paper] Closed ${pos.symbol} pos #${pos.id}` +
      ` entry=$${pos.entry_price.toFixed(4)} exit=$${current.toFixed(4)}` +
      ` pnl=$${pnlUsd.toFixed(4)}`
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
  const strategyFlags  = getStrategyFlags(state);
  const multiStrategyLive = state.multi_strategy_live !== false;
  const maxLiveTradesPerScan = Math.max(
    1,
    Math.min(5, Math.floor(state.max_live_trades_per_scan ?? 3))
  );

  // Keep flags explicit in state so /api/status and dashboard always receive booleans.
  state.strategy_flags = { ...DEFAULT_STRATEGY_FLAGS, ...strategyFlags };

  // ── Enhanced risk pre-flight checks ─────────────────────────────────────────
  const drawdown = checkDrawdownGuard(state, equity);
  if (drawdown.halt) {
    console.warn(`[Risk] Scan halted: ${drawdown.reason}`);
    if (!state.auto_stopped) {
      state.auto_stopped    = true;
      state.auto_stop_reason = drawdown.reason;
    }
    return null;
  }

  const timingCheck = checkMinTimeBetweenTrades(state);
  if (!timingCheck.allowed) {
    console.log(`[Risk] Min time between trades: wait ${timingCheck.waitSec}s`);
    return null;
  }

  const allOpportunities = [];
  const lastScan = { timestamp: Date.now(), cex: null, dex: null, perps: null, funding: null, triangular: null, statistical: null };
  const spotPriceByExchange = {};
  const spotSourcesBySymbol = {};

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

  // ── Scan all symbols (CEX + Perps + Funding) and DEX + Triangular + Statistical in parallel ─────────────
  // Collect cross-pair prices needed for triangular arbitrage once (shared across exchanges)
  const crossSymbols = [...new Set(TRIANGLES.map(t => t.b))]; // e.g. ['ETHBTC', 'BNBBTC', 'SOLBTC', 'BNBETH']

  const scanSymbolsInBatches = async () => {
    const batchSize = 6;
    for (let i = 0; i < SUPPORTED_SYMBOLS.length; i += batchSize) {
      const batch = SUPPORTED_SYMBOLS.slice(i, i + batchSize);
      await Promise.all(batch.map(async symbol => {
        try {
          // Fetch perp prices with per-source error tracking so the circuit breaker
          // only trips on genuine connectivity failures, not on "symbol not listed".
          const [spotSources, zeroXSource, mexcPerpResult, bybitPerpResult, binancePerpResult] = await Promise.all([
            getAllSpotPrices(env, symbol, openCircuits),
            get0xPrice(env, symbol),
            (!openCircuits.has('mexc_perp'))
              ? getMEXCPerpPrice(symbol).then(d => ({ data: d, error: null })).catch(e => ({ data: null, error: e }))
              : Promise.resolve({ data: null, error: null }),
            (!openCircuits.has('bybit_perp'))
              ? getBybitPerpData(symbol).then(d => ({ data: d, error: null })).catch(e => ({ data: null, error: e }))
              : Promise.resolve({ data: null, error: null }),
            (!openCircuits.has('binance_perp'))
              ? getBinancePerpData(symbol).then(d => ({ data: d, error: null })).catch(e => ({ data: null, error: e }))
              : Promise.resolve({ data: null, error: null }),
          ]);

          const mexcPerp    = mexcPerpResult.data;
          const bybitPerp   = bybitPerpResult.data;
          const binancePerp = binancePerpResult.data;
          spotSourcesBySymbol[symbol] = spotSources;

          // Cache spot prices from this cycle to avoid expensive refetches later.
          for (const src of spotSources) {
            if (!spotPriceByExchange[src.exchange]) spotPriceByExchange[src.exchange] = {};
            spotPriceByExchange[src.exchange][symbol] = src.price;
          }

          // Update circuit breaker based on fetch results.
          // Only record failure on genuine errors (exceptions), NOT on null returns
          // (null means the symbol simply has no perp contract on that exchange).
          if (spotSources.length > 0) {
            for (const src of spotSources) recordCBSuccess(cb, src.exchange);
          } else {
            recordCBFailure(cb, 'mexc');
          }

          if (mexcPerpResult.error)   recordCBFailure(cb, 'mexc_perp');
          else if (mexcPerp)          recordCBSuccess(cb, 'mexc_perp');
          // null without error = symbol not listed — do not trip the circuit

          if (bybitPerpResult.error)  recordCBFailure(cb, 'bybit_perp');
          else if (bybitPerp)         recordCBSuccess(cb, 'bybit_perp');

          if (binancePerpResult.error) recordCBFailure(cb, 'binance_perp');
          else if (binancePerp)        recordCBSuccess(cb, 'binance_perp');

          // Record mid price for paper settlement (use MEXC spot as reference)
          const mexcSrc = spotSources.find(s => s.exchange === 'mexc');
          if (mexcSrc) midPrices[symbol] = mexcSrc.price;

          // Perp source priority: MEXC (executable) → Binance → Bybit (data-only)
          const perpSource = mexcPerp || binancePerp || bybitPerp;

          // Best perp source with funding rate for harvest strategy
          // Prefer sources that carry a fundingRate field
          const fundingPerp = bybitPerp || binancePerp || mexcPerp;

          // CEX: all spot sources + 0x DEX price
          const cexSources = zeroXSource
            ? [...spotSources, zeroXSource]
            : spotSources;

          const cexOpp   = scanCEX(symbol, cexSources, maxSpreadPct);
          const perpsOpp = scanPerps(symbol, spotSources, perpSource, maxSpreadPct);

          // Funding rate harvest — use whichever perp source has a funding rate
          const fundingOpp = fundingPerp?.fundingRate !== undefined
            ? scanFundingRate(symbol, spotSources, fundingPerp, maxSpreadPct)
            : null;

          if (cexOpp && strategyFlags.cex) {
            allOpportunities.push(cexOpp);
            if (!lastScan.cex || cexOpp.netPct > lastScan.cex.netPct)
              lastScan.cex = cexOpp;
          }
          if (perpsOpp && strategyFlags.perps) {
            allOpportunities.push(perpsOpp);
            if (!lastScan.perps || perpsOpp.netPct > lastScan.perps.netPct)
              lastScan.perps = perpsOpp;
          }
          if (fundingOpp && strategyFlags.funding) {
            allOpportunities.push(fundingOpp);
            if (!lastScan.funding || fundingOpp.netPct > lastScan.funding.netPct)
              lastScan.funding = fundingOpp;
          }
        } catch (e) {
          console.error(`[${symbol}] scan error:`, e.message);
        }
      }));
    }
  };

  const [, dexOpp] = await Promise.all([
    scanSymbolsInBatches(),
    scanDEX(env)
  ]);

  // ── Triangular arbitrage (per-exchange, using cross-pair prices) ─────────────
  // Build per-exchange price maps from the mid-price cache and run triangular scan.
  // Exchange fee map derived from official fee schedules (taker, standard tier).
  // Uses exchanges currently enabled for routing.
  const TRIANGULAR_EXCHANGES = {
    binance: 0.001,   // 0.10% taker
    mexc:    0.0005,  // 0.05% taker
    kucoin:  0.001,   // 0.10% taker
  };
  const crossFetcherByExchange = {
    binance: getBinanceCrossPrice,
    mexc: getMEXCCrossPrice,
    kucoin: getKuCoinCrossPrice,
  };
  const crossPricesByExchange = {};
  await Promise.all(
    Object.keys(TRIANGULAR_EXCHANGES).map(async (exchangeName) => {
      const fetchCross = crossFetcherByExchange[exchangeName];
      if (!fetchCross) {
        crossPricesByExchange[exchangeName] = {};
        return;
      }

      const entries = await Promise.allSettled(
        crossSymbols.map(async (sym) => [sym, await fetchCross(sym)])
      );
      const symbolMap = {};
      for (const e of entries) {
        if (e.status === 'fulfilled' && e.value[1]) {
          symbolMap[e.value[0]] = e.value[1];
        }
      }
      crossPricesByExchange[exchangeName] = symbolMap;
    })
  );

  for (const [exchangeName, fee] of Object.entries(TRIANGULAR_EXCHANGES)) {
    if (openCircuits.has(exchangeName)) continue;
    try {
      const priceMap = {};
      // Reuse spot prices already fetched in this cycle.
      const exchangeSpotMap = spotPriceByExchange[exchangeName] || {};
      for (const sym of SUPPORTED_SYMBOLS) {
        const px = exchangeSpotMap[sym];
        if (px) priceMap[sym] = px;
      }
      // Add cross-pair prices from the same exchange only.
      Object.assign(priceMap, crossPricesByExchange[exchangeName] || {});

      const triOpp = scanTriangular(exchangeName, fee, priceMap);
      if (triOpp && strategyFlags.triangular) {
        allOpportunities.push(triOpp);
        if (!lastScan.triangular || triOpp.netPct > lastScan.triangular.netPct)
          lastScan.triangular = triOpp;
      }
    } catch (e) {
      console.error(`[Triangular:${exchangeName}] scan error:`, e.message);
    }
  }

  // ── Statistical / pairs arbitrage (cross-exchange z-score) ───────────────────
  for (const pairDef of CORRELATED_PAIRS) {
    try {
      const [sourcesA, sourcesB] = await Promise.all([
        spotSourcesBySymbol[pairDef.symbolA]
          ? Promise.resolve(spotSourcesBySymbol[pairDef.symbolA])
          : getAllSpotPrices(env, pairDef.symbolA, openCircuits),
        spotSourcesBySymbol[pairDef.symbolB]
          ? Promise.resolve(spotSourcesBySymbol[pairDef.symbolB])
          : getAllSpotPrices(env, pairDef.symbolB, openCircuits)
      ]);
      const priceA = midPrices[pairDef.symbolA] ?? sourcesA[0]?.price;
      const priceB = midPrices[pairDef.symbolB] ?? sourcesB[0]?.price;
      if (!priceA || !priceB) continue;

      const statOpp = await scanStatistical(env, pairDef, priceA, priceB, sourcesA, sourcesB);
      if (statOpp && strategyFlags.statistical) {
        allOpportunities.push(statOpp);
        if (!lastScan.statistical || statOpp.netPct > lastScan.statistical.netPct)
          lastScan.statistical = statOpp;
      }
    } catch (e) {
      console.error(`[Statistical:${pairDef.id}] scan error:`, e.message);
    }
  }

  // Persist updated circuit-breaker state (fire-and-forget)
  saveCircuitBreaker(env, cb);

  if (dexOpp && strategyFlags.dex) {
    allOpportunities.push(dexOpp);
    lastScan.dex = dexOpp;
  }

  // ── Go HFT engine scan (WebSocket-fed, sub-ms latency) ───────────────────────
  // If HFT_ENGINE_URL is configured, fetch the best opportunity from the Go
  // engine's live price book and add it to the candidate pool.  The engine
  // processes Binance/MEXC/Bybit WebSocket feeds in real time, so its prices
  // may be fresher than the REST-poll results above.
  if (isHFTEngineConfigured(env)) {
    try {
      const hftOpp = await scanFromHFT(env);
      if (hftOpp) {
        allOpportunities.push(hftOpp);
        console.log(
          `[HFT] engine opportunity: [${hftOpp.strategy.toUpperCase()}] ${hftOpp.symbol} ` +
          `${hftOpp.direction} net ${hftOpp.netPct.toFixed(4)}%`
        );
      }
    } catch (e) {
      console.error('[HFT] scanFromHFT error:', e.message);
    }
  }

  // Settle open paper positions now that we have fresh prices
  await settleOpenPaperPositions(env, midPrices);

  // Persist scan summary to KV (5-min TTL for status endpoints)
  try {
    await env.BOT_STATE.put(
      'nexus_last_scan',
      JSON.stringify(lastScan),
      { expirationTtl: 300 }
    );
  } catch (_) {}

  if (allOpportunities.length === 0) {
    console.log(`🔍 Nexus: no opportunities across ${SUPPORTED_SYMBOLS.length} symbols`);
    return null;
  }

  let futuresReady = true;
  if (!paperMode && hasExchangeCredentials(env, 'mexc')) {
    futuresReady = await getMEXCFuturesReadyCached(env);
  }

  // CEX spatial arb requires two separate funded exchanges (buy on one, sell on
  // the other with pre-positioned base asset).  With only one exchange configured
  // both legs would be rerouted to the same venue, defeating the spread capture.
  // Compute this once so the filter below can use it cheaply.
  const configuredExchangeCount = paperMode ? 2 : getConfiguredExchanges(env).length;

  // ── In live mode, keep only strategies with direct execution support in this Worker.
  const execPool = (!paperMode && !isHFTEngineConfigured(env))
    ? allOpportunities
        .filter(
          opp => opp.strategy     !== 'dex'         &&
                 opp.strategy     !== 'funding'     &&
                 opp.buyExchange  !== '0x'          &&
                 opp.sellExchange !== '0x'          &&
                 (opp.strategy !== 'perps' || futuresReady || PERP_EXCHANGES.has(opp.buyExchange) || PERP_EXCHANGES.has(opp.sellExchange)) &&
                 (opp.strategy !== 'cex'   || configuredExchangeCount >= 2)
        )
        .map(opp => ({ ...opp, _futuresReady: futuresReady }))
    : allOpportunities;

  let prioritizedExecPool = execPool;
  let rebalanceWeights = null;
  if (!paperMode && execPool.length > 0) {
    rebalanceWeights = await getRebalanceWeightsFromCache(env, state);
    if (rebalanceWeights && Object.keys(rebalanceWeights).length > 0) {
      prioritizedExecPool = execPool
        .map((opp) => {
          const buyWeight = rebalanceWeights[opp.buyExchange] ?? 1;
          const sellWeight = rebalanceWeights[opp.sellExchange] ?? 1;
          // Positive bias when buying from deficit exchanges and selling from surplus.
          const rebalanceBias = ((buyWeight - 1) + (1 - sellWeight)) * 0.15;
          return {
            ...opp,
            _rebalanceBias: rebalanceBias,
            _rebalanceAdjustedNet: (opp.netPct || 0) + rebalanceBias,
          };
        })
        .sort((a, b) => (b._rebalanceAdjustedNet || b.netPct || 0) - (a._rebalanceAdjustedNet || a.netPct || 0));
    }
  }

  if (!paperMode) {
    const byStrategy = allOpportunities.reduce((acc, opp) => {
      acc[opp.strategy] = (acc[opp.strategy] || 0) + 1;
      return acc;
    }, {});
    console.log(
      `[Scan] candidates=${allOpportunities.length} executable=${execPool.length} ` +
      `byStrategy=${JSON.stringify(byStrategy)} strategyFlags=${JSON.stringify(strategyFlags)}`
    );
    if (rebalanceWeights) {
      console.log(`[Scan] rebalance enabled: weights=${JSON.stringify(rebalanceWeights)}`);
    }
    if (!futuresReady) {
      console.warn('[Scan] MEXC futures auth unavailable: restricting perps execution to SHORT fallback routes');
    }
  }

  if (execPool.length === 0) {
    console.log('[Live] No CEX/perps opportunities this cycle — all candidates require the HFT engine');
    return null;
  }

  // ── Pick best opportunity — AI-assisted when AIWORKER is available ────────────
  // filterOpportunityWithAI ranks candidates by safety factor, net profit,
  // strategy reliability, and asset liquidity.  Falls back to highest netPct
  // when AI is unavailable or returns an unrecognised response.
  let best = await filterOpportunityWithAI(env, prioritizedExecPool);
  if (!best) {
    // Defensive guard: filterOpportunityWithAI only returns null for an empty list,
    // which is already handled above; this branch prevents any future regression.
    console.log(`🔍 Nexus: AI filter returned no candidate`);
    return null;
  }
  console.log(
    `🎯 Best [${best.strategy.toUpperCase()}] ${best.symbol} ${best.direction}` +
    ` net ${best.netPct.toFixed(4)}%  safety ${(best.safetyFactor * 100).toFixed(1)}%`
  );

  // ── Sizing ───────────────────────────────────────────────────────────────────
  // Leverage only applied for perps; spot arbitrage uses effective leverage 1
  const baseSize = calculatePositionSize(
    equity,
    state.win_rate          || 0.55,
    state.risk_reward_ratio || 2.0
  );

  // Minimum order size — below this exchanges reject the order.
  // MEXC spot minimum is $1, but effective routing requires ≥$10 for majors.
  const MIN_TRADE_USD = 10;

  /** Returns { leverage, sizeUsd } for the given opportunity */
  function sizeFor(opp) {
    const lev = opp.isPerp
      ? calculateAdaptiveLeverage(equity, opp.netPct, initialCapital)
      : 1;
    const sz = Math.max(
      MIN_TRADE_USD,
      Math.min(
        volatilityAdjustedSize(baseSize, opp.grossPct || 0) * lev,
        equity * MAX_POSITION_EQUITY_FRACTION
      )
    );
    return { leverage: lev, sizeUsd: sz };
  }

  let { leverage, sizeUsd: rawSizeUsd } = sizeFor(best);

  // Open exposure check: count open paper positions total size
  const openPositions    = await getOpenPaperPositions(env);
  const currentExposure  = openPositions.reduce((s, p) => s + (p.size_usd || 0), 0);
  const exposureCheck    = checkExposureLimit(equity, currentExposure, rawSizeUsd);
  if (!exposureCheck.allowed) {
    console.warn(`[Risk] Exposure limit: ${exposureCheck.reason}`);
    return null;
  }

  const mode = paperMode ? 'paper' : 'live';
  const executedTrades = [];
  let runningExposure = currentExposure;

  // ── Execute or log paper trade ───────────────────────────────────────────────
  if (paperMode) {
    const sizeUsd = rawSizeUsd;
    const levStr = leverage > 1 ? ` | ${leverage}x` : '';
    await openPaperPosition(env, best, sizeUsd);
    await sendAlert(
      env,
      `📄 [PAPER] [${best.strategy.toUpperCase()}] ${best.symbol}\n` +
      `${best.direction}\n` +
      `$${sizeUsd.toFixed(2)}${levStr}\n` +
      `net ${best.netPct.toFixed(4)}%  safety ${(best.safetyFactor * 100).toFixed(1)}%`
    );
    best._executionSummary = { realized: true, realizedPnlUsd: sizeUsd * best.netPct / 100, realizedNetPct: best.netPct };
    executedTrades.push({ opportunity: best, sizeUsd, leverage, summary: best._executionSummary });
  } else {
    const allowMulti = multiStrategyLive;
    const maxLiveTrades = allowMulti ? maxLiveTradesPerScan : 1;

    const fallbackQueue = [
      best,
      ...prioritizedExecPool
        .filter(o => o !== best)
        .sort((a, b) => (b._rebalanceAdjustedNet || b.netPct) - (a._rebalanceAdjustedNet || a.netPct)),
    ];

    const usedStrategies = new Set();
    for (const candidate of fallbackQueue) {
      if (executedTrades.length >= maxLiveTrades) break;

      // In multi-strategy mode, diversify first: at most one trade per strategy per scan cycle.
      if (allowMulti && usedStrategies.has(candidate.strategy)) continue;

      const { leverage: cLev, sizeUsd: cSize } = sizeFor(candidate);
      const cExposure = checkExposureLimit(equity, runningExposure, cSize);
      if (!cExposure.allowed) {
        console.warn(`[Risk] Skip ${candidate.strategy} ${candidate.symbol}: ${cExposure.reason}`);
        continue;
      }

      try {
        const summary = await executeTrade(env, candidate, cSize, cLev);
        const hasRealizedPnl = summary?.realized === true &&
          Number.isFinite(summary?.realizedPnlUsd) &&
          Number.isFinite(summary?.realizedNetPct);
        if (!hasRealizedPnl) {
          console.warn(
            `[Exec] ${candidate.strategy} ${candidate.symbol} filled without complete fill metrics; ` +
            `excluding this trade from realized P&L aggregates until reconciliation is available`
          );
        }

        candidate._executionSummary = summary || null;
        executedTrades.push({ opportunity: candidate, sizeUsd: cSize, leverage: cLev, summary: summary || null });
        usedStrategies.add(candidate.strategy);
        runningExposure += cSize;
      } catch (err) {
        console.error(
          `[Exec] ${candidate.strategy} ${candidate.symbol} failed: ${err.message}` +
          (candidate !== fallbackQueue[fallbackQueue.length - 1] ? ' — trying next candidate' : '')
        );
      }
    }

    if (executedTrades.length === 0) {
      await sendAlert(
        env,
        `❌ [${best.strategy.toUpperCase()}] فشل التنفيذ ${best.symbol}: جميع الفرص المتاحة فشلت`
      );
      return null;
    }

    const lines = executedTrades.map(t => {
      const opp = t.opportunity;
      const levStr = t.leverage > 1 ? ` | ${t.leverage}x` : '';
      return `• [${opp.strategy.toUpperCase()}] ${opp.symbol} ${opp.direction} | $${t.sizeUsd.toFixed(2)}${levStr} | net ${opp.netPct.toFixed(4)}%`;
    }).join('\n');
    await sendAlert(env, `✅ [LIVE] Executed ${executedTrades.length} trade(s) this scan:\n${lines}`);
  }

  // ── Update state counters (caller saves state to KV) ────────────────────────
  for (const t of executedTrades) {
    const opp = t.opportunity;
    const execSummary = t.summary || opp._executionSummary || null;
    const hasRealizedLivePnl = !paperMode &&
      execSummary?.realized === true &&
      Number.isFinite(execSummary?.realizedPnlUsd) &&
      Number.isFinite(execSummary?.realizedNetPct);
    const loggedNetPct = paperMode
      ? opp.netPct
      : hasRealizedLivePnl
        ? execSummary.realizedNetPct
        : 0;
    const tradePnl = paperMode
      ? (t.sizeUsd * opp.netPct / 100)
      : hasRealizedLivePnl
        ? execSummary.realizedPnlUsd
        : 0;

    state.daily_pnl            = (state.daily_pnl    || 0) + tradePnl;
    state.total_pnl            = (state.total_pnl    || 0) + tradePnl;
    state.daily_trades         = (state.daily_trades || 0) + 1;
    state.total_trades         = (state.total_trades || 0) + 1;
    state.last_trade_timestamp = Date.now();
    state.last_trade_pnl_usd   = tradePnl;
    state.last_trade_net_pct   = loggedNetPct;
    state.last_trade_realized  = hasRealizedLivePnl || paperMode;

    const strategyLabel = `${opp.strategy}:${opp.direction}`;
    if (env.TRADE_QUEUE) {
      await env.TRADE_QUEUE.send({ type: 'trade_log', data: { strategy: strategyLabel, sizeUsd: t.sizeUsd, netPct: loggedNetPct, mode } });
    } else {
      await logTrade(env, { strategy: strategyLabel, sizeUsd: t.sizeUsd, netPct: loggedNetPct, mode });
    }

    delete opp._executionSummary;
    delete opp._futuresReady;
  }

  const first = executedTrades[0];
  return {
    opportunity: first.opportunity,
    sizeUsd: first.sizeUsd,
    leverage: first.leverage,
    trades: executedTrades.map(t => ({
      strategy: t.opportunity.strategy,
      symbol: t.opportunity.symbol,
      direction: t.opportunity.direction,
      netPct: t.opportunity.netPct,
      sizeUsd: t.sizeUsd,
      leverage: t.leverage,
    }))
  };
}

// ── Trade execution ──────────────────────────────────────────────────────────
//
// Execution routing rules:
//   DEX / 0x opportunities → paper-only (no on-chain bridge layer yet)
//   Funding rate harvest   → paper-only (delta-neutral management not yet automated)
//   Perps (MEXC/Bybit)    → MEXC Futures (primary), Bybit Linear (fallback)
//   CEX spatial            → execute both legs on their respective exchanges
//                            (requires API credentials for buyExchange AND sellExchange)

async function executeTrade(env, opp, sizeUsd, leverage) {
  // Opportunities sourced directly from the Go HFT engine are executed there,
  // since the engine already holds the wallet key and exchange credentials.
  if (opp.source === 'hft_engine') {
    await executeViaHFT(env, opp, sizeUsd);
    return { realized: false, realizedPnlUsd: null, realizedNetPct: null };
  }

  // DEX cross-chain trades (ETH↔BSC bridge) require on-chain signing.
  // Route to the Go HFT engine when available; otherwise reject.
  if (opp.strategy === 'dex') {
    if (isHFTEngineConfigured(env)) {
      await executeViaHFT(env, opp, sizeUsd);
      return { realized: false, realizedPnlUsd: null, realizedNetPct: null };
    }
    throw new Error(
      'DEX cross-chain execution requires the Go HFT engine. ' +
      'Deploy the engine and set HFT_ENGINE_URL + HFT_ENGINE_SECRET, ' +
      'or set paper_trading=true to simulate.'
    );
  }

  // 0x DEX quotes represent on-chain swaps that need wallet signing.
  // Route to the Go HFT engine when available; otherwise reject.
  if (opp.buyExchange === '0x' || opp.sellExchange === '0x') {
    if (isHFTEngineConfigured(env)) {
      await executeViaHFT(env, opp, sizeUsd);
      return { realized: false, realizedPnlUsd: null, realizedNetPct: null };
    }
    throw new Error(
      'DEX (0x) execution requires the Go HFT engine. ' +
      'Deploy the engine and set HFT_ENGINE_URL + HFT_ENGINE_SECRET, ' +
      'or set paper_trading=true to simulate.'
    );
  }

  // Funding rate harvest requires ongoing delta-neutral management.
  // Route to the Go HFT engine when available; otherwise reject.
  if (opp.strategy === 'funding') {
    if (isHFTEngineConfigured(env)) {
      await executeViaHFT(env, opp, sizeUsd);
      return { realized: false, realizedPnlUsd: null, realizedNetPct: null };
    }
    throw new Error(
      'Funding rate harvest execution requires the Go HFT engine. ' +
      'Deploy the engine and set HFT_ENGINE_URL + HFT_ENGINE_SECRET, ' +
      'or set paper_trading=true to simulate.'
    );
  }

  const amount = (sizeUsd / opp.buyPrice).toFixed(6);

  // ── Perpetuals ────────────────────────────────────────────────────────────
  if (opp.isPerp) {
    // Determine if this is a SHORT (sell on perp exchange) or LONG (buy on perp)
    const isSellPerp = PERP_EXCHANGES.has(opp.sellExchange);
    const side = isSellPerp ? 'SHORT' : 'LONG';
    const futuresReadyHint = opp._futuresReady !== false;

    // Primary: MEXC Futures (executable perp)
    const hasMEXC = hasExchangeCredentials(env, 'mexc');
    if (!futuresReadyHint) {
      // Futures auth is confirmed down — refuse outright.  Proceeding to the
      // spot-only fallback would buy spot with NO corresponding futures position,
      // making it a naked directional buy that burns capital with no arb offset.
      throw new Error(
        `[Perp] Skipped ${opp.symbol} — futures auth is down (futuresReady=false). ` +
        `Spot-only hedge without an open futures position would be a naked trade.`
      );
    }
    if (hasMEXC) {
      const sufficient = await hasSufficientUSDT(env, sizeUsd);
      console.log(`[Perp] ${opp.symbol} side=${side} sizeUsd=${sizeUsd.toFixed(2)} amount=${amount} leverage=${leverage} sufficient=${sufficient}`);
      if (sufficient) {
        try {
          await placeMEXCFuturesOrder(env, opp.symbol, side, amount, leverage);
          console.log(`[Perp] ✅ MEXC Futures order placed: ${opp.symbol} ${side} vol=${amount} lev=${leverage}`);
          return { realized: false, realizedPnlUsd: null, realizedNetPct: null };
        } catch (futErr) {
          // Futures order failed — do NOT fall through to spot hedge.  Without
          // a confirmed open futures position the spot buy would be a naked trade.
          throw new Error(
            `[Perp] MEXC Futures order FAILED for ${opp.symbol} ${side}: ${futErr.message}. ` +
            `Aborting to prevent naked spot exposure.`,
            { cause: futErr }
          );
        }
      } else {
        throw new Error(
          `[Perp] Skipped — insufficient USDT ($${sizeUsd.toFixed(2)}) for perps position`
        );
      }
    }
    // No MEXC credentials at all — cannot open futures position.
    throw new Error(
      `[Perp] Live perps execution requires MEXC Futures credentials (MEXC_API_KEY + MEXC_API_SECRET). ` +
      `Configure credentials or set paper_trading=true to simulate.`
    );
  }

  // ── CEX spatial arbitrage ─────────────────────────────────────────────────
  let buyExch  = opp.buyExchange;
  let sellExch = opp.sellExchange;
  // ── Triangular arbitrage (3-leg sequential, single exchange) ─────────────
  if (opp.strategy === 'triangular') {
    const triExchange = opp.buyExchange;
    if (!hasExchangeCredentials(env, triExchange)) {
      throw new Error(`[Tri] No execution credentials for ${triExchange}`);
    }
    const [legA, legB, legC] = opp.legs;
    // direction e.g. "USDT→DOT→ETH→USDT" or "USDT→ETH→DOT→USDT"
    const legCBase = legC.replace(/USDT$/, '');
    const firstIntermediate = opp.direction.split('→')[1];
    const isDir2 = firstIntermediate === legCBase;

    const triSize = sizeUsd;
    let usdtOut;

    if (isDir2) {
      // Dir2: USDT → legC → legB cross → legA → USDT
      // Step 1: BUY legC (e.g. DOTUSDT) — spend USDT, receive legC base (DOT)
      const r1 = await placeExchangeMarketOrder(env, triExchange, legC, 'BUY', null, triSize);
      const f1 = extractFillMetrics(r1);
      const q1 = f1?.executedQty ?? (triSize / opp.sellPrice);   // DOT received

      // Step 2: SELL legB (e.g. DOTETH) — sell DOT, receive legA base (ETH)
      const r2 = await placeExchangeMarketOrder(env, triExchange, legB, 'SELL', String(q1), null);
      const f2 = extractFillMetrics(r2);
      const q2 = f2?.quoteQty                                     // ETH received
        ?? ((f2?.executedQty ?? q1) * (opp.crossPrice ?? 0));

      // Step 3: SELL legA (e.g. ETHUSDT) — sell ETH, receive USDT
      const r3 = await placeExchangeMarketOrder(env, triExchange, legA, 'SELL', String(q2), null);
      const f3 = extractFillMetrics(r3);
      usdtOut = f3?.quoteQty ?? ((f3?.executedQty ?? q2) * opp.buyPrice);
    } else {
      // Dir1: USDT → legA → legB cross → legC → USDT
      // Step 1: BUY legA (e.g. ETHUSDT) — spend USDT, receive legA base (ETH)
      const r1 = await placeExchangeMarketOrder(env, triExchange, legA, 'BUY', null, triSize);
      const f1 = extractFillMetrics(r1);
      const q1 = f1?.executedQty ?? (triSize / opp.buyPrice);    // ETH received

      // Step 2: BUY legB (e.g. DOTETH) — spend ETH (q1 as quoteOrderQty), receive legC base (DOT)
      const r2 = await placeExchangeMarketOrder(env, triExchange, legB, 'BUY', null, q1);
      const f2 = extractFillMetrics(r2);
      const q2 = f2?.executedQty ?? (q1 / (opp.crossPrice ?? 1));  // DOT received

      // Step 3: SELL legC (e.g. DOTUSDT) — sell DOT, receive USDT
      const r3 = await placeExchangeMarketOrder(env, triExchange, legC, 'SELL', String(q2), null);
      const f3 = extractFillMetrics(r3);
      usdtOut = f3?.quoteQty ?? ((f3?.executedQty ?? q2) * opp.sellPrice);
    }

    const pnl = (usdtOut ?? 0) - triSize;
    console.log(`[Tri] ✅ ${opp.direction} on ${triExchange}: in=$${triSize.toFixed(2)}, out=$${(usdtOut ?? 0).toFixed(2)}, pnl=$${pnl.toFixed(4)}`);
    return { realized: true, realizedPnlUsd: pnl, realizedNetPct: (pnl / triSize) * 100 };
  }


  // If either leg is on a data-only exchange, reroute to best available exchange.
  if (!ACTIVE_EXECUTION_EXCHANGES.includes(buyExch)) {
    const alt = await selectBestExchange(env, sizeUsd);
    if (!alt) throw new Error(`Buy exchange ${buyExch} not available and no alternative configured`);
    console.warn(`[Exec] Rerouted BUY from ${buyExch} → ${alt}`);
    buyExch = alt;
  }
  if (!ACTIVE_EXECUTION_EXCHANGES.includes(sellExch)) {
    const configured = getConfiguredExchanges(env).filter(ex => ex !== buyExch);
    if (configured.length === 0) throw new Error(`Sell exchange ${sellExch} not available`);
    sellExch = configured[0];
    console.warn(`[Exec] Rerouted SELL from ${opp.sellExchange} → ${sellExch}`);
  }

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

  const buyBalance = await getExchangeBalance(env, buyExch, 'USDT');
  if (buyBalance < sizeUsd) {
    // Try rerouting BUY to an exchange with sufficient balance
    const alt = await selectBestExchange(env, sizeUsd);
    if (!alt || alt === sellExch) {
      throw new Error(
        `Insufficient USDT on ${buyExch}: ` +
        `$${buyBalance.toFixed(2)} available, $${sizeUsd.toFixed(2)} needed. ` +
        `Top up balance or enable more exchanges.`
      );
    }
    console.warn(`[Exec] USDT insufficient on ${buyExch}, rerouted BUY to ${alt}`);
    buyExch = alt;
  }

  // Base asset on sell exchange (must be pre-positioned for hedged execution).
  const sellBalance = await getExchangeBalance(env, sellExch, baseAsset);
  const minSellQty  = parseFloat(amount);
  if (sellBalance < minSellQty) {
    throw new Error(
      `Insufficient ${baseAsset} on ${sellExch}: ` +
      `${sellBalance.toFixed(6)} available, ${amount} needed. ` +
      `Transfer ${baseAsset} to ${sellExch} before executing this trade.`
    );
  }

  // Execute both legs simultaneously to minimise execution slippage.
  const [buyOrder, sellOrder] = await Promise.all([
    placeExchangeMarketOrder(env, buyExch,  opp.symbol, 'BUY',  amount, sizeUsd),
    placeExchangeMarketOrder(env, sellExch, opp.symbol, 'SELL', amount, sizeUsd)
  ]);

  const buyFill = extractFillMetrics(buyOrder);
  const sellFill = extractFillMetrics(sellOrder);
  if (!buyFill || !sellFill) {
    return { realized: false, realizedPnlUsd: null, realizedNetPct: null };
  }

  const executedQty = Math.min(buyFill.executedQty, sellFill.executedQty);
  if (!Number.isFinite(executedQty) || executedQty <= 0) {
    return { realized: false, realizedPnlUsd: null, realizedNetPct: null };
  }

  const realizedBuyQuote = executedQty * buyFill.avgPrice;
  const realizedSellQuote = executedQty * sellFill.avgPrice;
  if (realizedBuyQuote <= 0) {
    return { realized: false, realizedPnlUsd: null, realizedNetPct: null };
  }

  const realizedPnlUsd = realizedSellQuote - realizedBuyQuote;
  const realizedNetPct = (realizedPnlUsd / realizedBuyQuote) * 100;
  return { realized: true, realizedPnlUsd, realizedNetPct };
}

