// nexus/src/orchestrator.js — Unified Decision Engine
//
// Runs all three strategies (CEX, DEX, Perps) in parallel across all supported
// symbols, selects the single best opportunity, applies unified risk checks,
// and executes one trade per scan cycle.

import { getAllSpotPrices, getMEXCPerpPrice, get0xPrice } from './prices.js';
import { scanCEX }   from './strategies/cex.js';
import { scanDEX }   from './strategies/dex.js';
import { scanPerps } from './strategies/perps.js';
import { logTrade }  from './db.js';
import { calculateAdaptiveLeverage, calculatePositionSize } from './risk.js';
import { placeMarketOrderMEXC, placeMEXCFuturesOrder }      from './exchange.js';

const SUPPORTED_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT',
  'BNBUSDT', 'AVAXUSDT', 'MATICUSDT', 'LINKUSDT', 'UNIUSDT',
  'ADAUSDT', 'DOTUSDT', 'LTCUSDT', 'TRXUSDT', 'NEARUSDT'
];

/**
 * Main scan-and-execute cycle.
 *
 * @param {object}   env        — Cloudflare Worker env bindings
 * @param {object}   state      — current trading_state from KV (mutated in place)
 * @param {function} sendAlert  — async (env, msg) => void
 * @returns {object|null}  trade result or null when no trade was made
 */
export async function runScan(env, state, sendAlert) {
  const maxSpreadPct  = state.max_spread_pct   ?? 5.0;
  const initialCapital = state.initial_capital ?? 1000;
  const equity        = initialCapital + (state.total_pnl || 0);
  const paperMode     = state.paper_trading !== false;

  const allOpportunities = [];
  // lastScan carries the best opportunity per strategy for status endpoints
  const lastScan = { timestamp: Date.now(), cex: null, dex: null, perps: null };

  // ── Scan all symbols (CEX + Perps) and DEX in parallel ──────────────────────
  const [, dexOpp] = await Promise.all([
    Promise.all(
      SUPPORTED_SYMBOLS.map(async symbol => {
        try {
          const [spotSources, perpSource, zeroXSource] = await Promise.all([
            getAllSpotPrices(env, symbol),
            getMEXCPerpPrice(symbol),
            get0xPrice(env, symbol)
          ]);

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

  if (dexOpp) {
    allOpportunities.push(dexOpp);
    lastScan.dex = dexOpp;
  }

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

  // ── Pick highest net-profit opportunity ──────────────────────────────────────
  const best = allOpportunities.reduce((a, b) => (a.netPct > b.netPct ? a : b));
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
    state.win_rate         || 0.55,
    state.risk_reward_ratio || 2.0
  );
  const sizeUsd = Math.min(baseSize * leverage, equity * 0.5);
  const mode          = paperMode ? 'paper' : 'live';
  const strategyLabel = `${best.strategy}:${best.direction}`;
  const levStr        = leverage > 1 ? ` | ${leverage}x` : '';

  // ── Execute or log paper trade ───────────────────────────────────────────────
  if (paperMode) {
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

  // ── Update state counters (caller saves state to KV) ────────────────────────
  const tradePnl = sizeUsd * best.netPct / 100;
  state.daily_pnl          = (state.daily_pnl   || 0) + tradePnl;
  state.total_pnl          = (state.total_pnl   || 0) + tradePnl;
  state.daily_trades       = (state.daily_trades || 0) + 1;
  state.total_trades       = (state.total_trades || 0) + 1;
  state.last_trade_timestamp = Date.now();

  await logTrade(env, { strategy: strategyLabel, sizeUsd, netPct: best.netPct, mode });

  return { opportunity: best, sizeUsd, leverage };
}

// ── Trade execution ──────────────────────────────────────────────────────────

async function executeTrade(env, opp, sizeUsd, leverage) {
  const amount = (sizeUsd / opp.buyPrice).toFixed(6);

  if (opp.isPerp) {
    // Perps strategy: short the perp when perp > spot, long when spot > perp
    const side = opp.sellExchange.includes('perp') ? 'SHORT' : 'LONG';
    await placeMEXCFuturesOrder(env, opp.symbol, side, amount, leverage);
  } else if (opp.buyExchange === 'mexc') {
    await placeMarketOrderMEXC(env, opp.symbol, 'BUY', amount);
  } else if (opp.sellExchange === 'mexc') {
    await placeMarketOrderMEXC(env, opp.symbol, 'SELL', amount);
  } else {
    // Neither leg is MEXC spot (e.g. binance→kucoin) — use MEXC futures as proxy
    await placeMEXCFuturesOrder(env, opp.symbol, 'LONG', amount, Math.max(leverage, 2));
  }
}
