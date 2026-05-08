// nexus/src/orchestrator.js — Unified Decision Engine
//
// Runs all three strategies (CEX, DEX, Perps) in parallel across all supported
// symbols, selects the single best opportunity, applies unified risk checks,
// and executes one trade per scan cycle.

import { getAllSpotPrices, getMEXCPerpPrice, getBybitPerpData, getBinancePerpData, getOKXPerpData, get0xPrice, getCrossPairPrices } from './prices.js';
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
  hasExchangeCredentials, getRequiredCredentialKeys, getExchangeBalance,
  placeExchangeMarketOrder, getConfiguredExchanges, selectBestExchange,
  ACTIVE_EXECUTION_EXCHANGES, DATA_ONLY_EXCHANGES
} from './exchange.js';
import { isHFTEngineConfigured, scanFromHFT, executeViaHFT } from './hft-client.js';
import { filterOpportunityWithAI } from './ai-client.js';

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

  const [, dexOpp, crossPrices] = await Promise.all([
    Promise.all(
      SUPPORTED_SYMBOLS.map(async symbol => {
        try {
          // Fetch perp prices with per-source error tracking so the circuit breaker
          // only trips on genuine connectivity failures, not on "symbol not listed".
          const [spotSources, zeroXSource, mexcPerpResult, bybitPerpResult, binancePerpResult, okxPerpResult] = await Promise.all([
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
            (!openCircuits.has('okx_perp'))
              ? getOKXPerpData(symbol).then(d => ({ data: d, error: null })).catch(e => ({ data: null, error: e }))
              : Promise.resolve({ data: null, error: null }),
          ]);

          const mexcPerp    = mexcPerpResult.data;
          const bybitPerp   = bybitPerpResult.data;
          const binancePerp = binancePerpResult.data;
          const okxPerp     = okxPerpResult.data;

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

          if (okxPerpResult.error)    recordCBFailure(cb, 'okx_perp');
          else if (okxPerp)           recordCBSuccess(cb, 'okx_perp');

          // Record mid price for paper settlement (use MEXC spot as reference)
          const mexcSrc = spotSources.find(s => s.exchange === 'mexc');
          if (mexcSrc) midPrices[symbol] = mexcSrc.price;

          // Perp source priority: MEXC (executable) → Binance → OKX → Bybit (data-only)
          const perpSource = mexcPerp || binancePerp || okxPerp || bybitPerp;

          // Best perp source with funding rate for harvest strategy
          // Prefer sources that carry a fundingRate field
          const fundingPerp = bybitPerp || binancePerp || okxPerp || mexcPerp;

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
          if (fundingOpp) {
            allOpportunities.push(fundingOpp);
            if (!lastScan.funding || fundingOpp.netPct > lastScan.funding.netPct)
              lastScan.funding = fundingOpp;
          }
        } catch (e) {
          console.error(`[${symbol}] scan error:`, e.message);
        }
      })
    ),
    scanDEX(env),
    getCrossPairPrices(crossSymbols)
  ]);

  // ── Triangular arbitrage (per-exchange, using cross-pair prices) ─────────────
  // Build per-exchange price maps from the mid-price cache and run triangular scan
  for (const exchangeName of ['binance', 'mexc']) {
    try {
      const priceMap = {};
      // Add USDT-quoted prices from midPrices (indexed by symbol)
      for (const sym of SUPPORTED_SYMBOLS) {
        const src = (await getAllSpotPrices(env, sym, openCircuits))
          .find(s => s.exchange === exchangeName);
        if (src) priceMap[sym] = src.price;
      }
      // Add cross-pair prices
      Object.assign(priceMap, crossPrices);

      const fee = exchangeName === 'binance' ? 0.001 : 0.0005;
      const triOpp = scanTriangular(exchangeName, fee, priceMap);
      if (triOpp) {
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
        getAllSpotPrices(env, pairDef.symbolA, openCircuits),
        getAllSpotPrices(env, pairDef.symbolB, openCircuits)
      ]);
      const priceA = midPrices[pairDef.symbolA] ?? sourcesA[0]?.price;
      const priceB = midPrices[pairDef.symbolB] ?? sourcesB[0]?.price;
      if (!priceA || !priceB) continue;

      const statOpp = await scanStatistical(env, pairDef, priceA, priceB, sourcesA, sourcesB);
      if (statOpp) {
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

  if (dexOpp) {
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

  // ── In live mode, exclude strategies that require the Go HFT engine when it is not
  //    running.  Without this filter the AI could pick a DEX/funding opportunity that
  //    executeTrade() would immediately reject, wasting the whole scan cycle.
  const execPool = (!paperMode && !isHFTEngineConfigured(env))
    ? allOpportunities.filter(
        opp => opp.strategy     !== 'dex'     &&
               opp.strategy     !== 'funding' &&
               opp.buyExchange  !== '0x'      &&
               opp.sellExchange !== '0x'
      )
    : allOpportunities;

  if (execPool.length === 0) {
    console.log('[Live] No CEX/perps opportunities this cycle — all candidates require the HFT engine');
    return null;
  }

  // ── Pick best opportunity — AI-assisted when AIWORKER is available ────────────
  // filterOpportunityWithAI ranks candidates by safety factor, net profit,
  // strategy reliability, and asset liquidity.  Falls back to highest netPct
  // when AI is unavailable or returns an unrecognised response.
  let best = await filterOpportunityWithAI(env, execPool);
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

  /** Returns { leverage, sizeUsd } for the given opportunity */
  function sizeFor(opp) {
    const lev = opp.isPerp
      ? calculateAdaptiveLeverage(equity, opp.netPct, initialCapital)
      : 1;
    const sz = Math.min(
      volatilityAdjustedSize(baseSize, opp.grossPct || 0) * lev,
      equity * MAX_POSITION_EQUITY_FRACTION
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

  let sizeUsd       = rawSizeUsd;
  const mode          = paperMode ? 'paper' : 'live';
  let strategyLabel = `${best.strategy}:${best.direction}`;
  let levStr        = leverage > 1 ? ` | ${leverage}x` : '';

  // ── Execute or log paper trade ───────────────────────────────────────────────
  if (paperMode) {
    // Open a virtual position that will be settled at current price on the next cycle
    await openPaperPosition(env, best, sizeUsd);
    await sendAlert(
      env,
      `📄 [PAPER] [${best.strategy.toUpperCase()}] ${best.symbol}\n` +
      `${best.direction}\n` +
      `$${sizeUsd.toFixed(2)}${levStr}\n` +
      `net ${best.netPct.toFixed(4)}%  safety ${(best.safetyFactor * 100).toFixed(1)}%`
    );
  } else {
    // Build a fallback queue: try the AI-selected best first, then up to 2 alternatives
    // sorted by netPct.  This ensures a temporary failure on one exchange (API error,
    // insufficient balance) does not waste the entire scan cycle.
    const fallbackQueue = [
      best,
      ...execPool
        .filter(o => o !== best)
        .sort((a, b) => b.netPct - a.netPct)
        .slice(0, 2),
    ];

    // `executedOpp` is the candidate that was actually placed on the exchange.
    // It may differ from `best` (the AI's top pick) when `best` fails transiently.
    let executedOpp = null;
    let executedLev = leverage;
    let executedSize = sizeUsd;
    for (const candidate of fallbackQueue) {
      const { leverage: cLev, sizeUsd: cSize } = sizeFor(candidate);
      try {
        await executeTrade(env, candidate, cSize, cLev);
        executedOpp  = candidate;
        executedLev  = cLev;
        executedSize = cSize;
        break;
      } catch (err) {
        console.error(
          `[Exec] ${candidate.strategy} ${candidate.symbol} failed: ${err.message}` +
          (candidate !== fallbackQueue[fallbackQueue.length - 1] ? ' — trying next candidate' : '')
        );
      }
    }

    if (!executedOpp) {
      await sendAlert(
        env,
        `❌ [${best.strategy.toUpperCase()}] فشل التنفيذ ${best.symbol}: جميع الفرص المتاحة فشلت`
      );
      return null;
    }

    strategyLabel = `${executedOpp.strategy}:${executedOpp.direction}`;
    leverage      = executedLev;
    sizeUsd       = executedSize;
    levStr        = leverage > 1 ? ` | ${leverage}x` : '';

    await sendAlert(
      env,
      `✅ [LIVE] [${executedOpp.strategy.toUpperCase()}] ${executedOpp.symbol}\n` +
      `${executedOpp.direction}\n` +
      `$${sizeUsd.toFixed(2)}${levStr}\n` +
      `net ${executedOpp.netPct.toFixed(4)}%`
    );

    // Promote executedOpp so the state-update block below uses the correct trade data
    best = executedOpp;
  }

  // ── Update state counters (caller saves state to KV) ────────────────────────
  const tradePnl = sizeUsd * best.netPct / 100;
  state.daily_pnl            = (state.daily_pnl   || 0) + tradePnl;
  state.total_pnl            = (state.total_pnl   || 0) + tradePnl;
  state.daily_trades         = (state.daily_trades || 0) + 1;
  state.total_trades         = (state.total_trades || 0) + 1;
  state.last_trade_timestamp = Date.now();
  state.last_trade_pnl_usd   = tradePnl;

  // Use queue producer when available, fall back to logTrade()
  if (env.TRADE_QUEUE) {
    await env.TRADE_QUEUE.send({ type: 'trade_log', data: { strategy: strategyLabel, sizeUsd, netPct: best.netPct, mode } });
  } else {
    await logTrade(env, { strategy: strategyLabel, sizeUsd, netPct: best.netPct, mode });
  }

  return { opportunity: best, sizeUsd, leverage };
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
    return;
  }

  // DEX cross-chain trades (ETH↔BSC bridge) require on-chain signing.
  // Route to the Go HFT engine when available; otherwise reject.
  if (opp.strategy === 'dex') {
    if (isHFTEngineConfigured(env)) {
      await executeViaHFT(env, opp, sizeUsd);
      return;
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
      return;
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
      return;
    }
    throw new Error(
      'Funding rate harvest execution requires the Go HFT engine. ' +
      'Deploy the engine and set HFT_ENGINE_URL + HFT_ENGINE_SECRET, ' +
      'or set paper_trading=true to simulate.'
    );
  }

  // bybit and gateio are data-only (German regulatory restrictions).
  if (DATA_ONLY_EXCHANGES.has(opp.buyExchange) || DATA_ONLY_EXCHANGES.has(opp.sellExchange)) {
    throw new Error(
      `${opp.buyExchange || opp.sellExchange} is not available for live execution ` +
      `(German regulatory restrictions). Switching to paper mode is recommended.`
    );
  }

  const amount = (sizeUsd / opp.buyPrice).toFixed(6);

  // ── Perpetuals ────────────────────────────────────────────────────────────
  if (opp.isPerp) {
    // Determine if this is a SHORT (sell on perp exchange) or LONG (buy on perp)
    const perpExchanges = new Set(['mexc_perp', 'binance_perp', 'okx_perp', 'bybit_perp']);
    const isSellPerp = perpExchanges.has(opp.sellExchange);
    const side = isSellPerp ? 'SHORT' : 'LONG';

    // Primary: MEXC Futures (executable perp)
    const hasMEXC = hasExchangeCredentials(env, 'mexc');
    if (hasMEXC) {
      const sufficient = await hasSufficientUSDT(env, sizeUsd);
      if (sufficient) {
        await placeMEXCFuturesOrder(env, opp.symbol, side, amount, leverage);
        return;
      }
    }
    // MEXC perp unavailable or insufficient balance — fall back to spot hedge.
    // LONG perp (buy perp, sell spot) requires pre-existing base inventory which
    // the account typically won't hold; executing a blind SELL would fail.
    // For SHORT perp (sell perp, buy spot) we can safely BUY spot as the hedge.
    if (!isSellPerp) {
      throw new Error(
        `LONG perp live execution requires MEXC Futures (MEXC_API_KEY + MEXC_API_SECRET); ` +
        `spot-only fallback is unsafe without pre-existing base inventory. ` +
        `Configure MEXC Futures credentials or set paper_trading=true to simulate.`
      );
    }
    const fallback = await selectBestExchange(env, sizeUsd);
    if (!fallback) {
      throw new Error(
        `No configured exchange has sufficient USDT ($${sizeUsd.toFixed(2)}) for perps hedge trade`
      );
    }
    // SHORT perp fallback: buy spot as a partial hedge on the cheapest leg
    await placeExchangeMarketOrder(env, fallback, opp.symbol, 'BUY', amount, sizeUsd);
    return;
  }

  // ── CEX spatial arbitrage ─────────────────────────────────────────────────
  let buyExch  = opp.buyExchange;
  let sellExch = opp.sellExchange;

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
  await Promise.all([
    placeExchangeMarketOrder(env, buyExch,  opp.symbol, 'BUY',  amount, sizeUsd),
    placeExchangeMarketOrder(env, sellExch, opp.symbol, 'SELL', amount, sizeUsd)
  ]);
}
