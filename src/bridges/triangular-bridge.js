/**
 * Triangular Arbitrage Bridge — Enhanced Detection Engine
 *
 * مستوحى من:
 * - Roibal/Cryptocurrency-Trading-Bots-Python-Beginner-Advance (⭐1.4k)
 * - kelvinau/crypto-arbitrage (⭐840)
 * - andrei-zgirvaci/Arbitrage-Bot (⭐240)
 */

import { fetchTicker, fetchOrderBook } from './ccxt-bridge.js';
import { TRIANGLES as BASE_TRIANGLES } from '../strategies/triangular.js';

const CONFIG = {
  minNetPct: 0.005,
  maxSlippagePct: 0.15,
  minVolumeUsd: 100,
  depthLevels: 5,
  maxRoutes: 50,
  quoteAsset: 'USDT',
};

export function discoverTriangularRoutes(symbols) {
  const quote = CONFIG.quoteAsset;
  const symbolSet = new Set(symbols.map(s => s.toUpperCase()));
  const routes = [];
  const quotePairs = symbols.filter(s => s.toUpperCase().endsWith(quote));

  for (const pairA of quotePairs) {
    const baseA = pairA.slice(0, -quote.length);
    for (const pairB of quotePairs) {
      if (pairB === pairA) continue;
      const baseB = pairB.slice(0, -quote.length);
      const cross1 = `${baseA}${baseB}`;
      const cross2 = `${baseB}${baseA}`;

      if (symbolSet.has(cross1)) {
        routes.push({ a: pairA, b: cross1, c: pairB, route: `${quote}->${baseA}->${baseB}->${quote}`, source: 'dynamic' });
      }
      if (symbolSet.has(cross2)) {
        routes.push({ a: pairA, b: cross2, c: pairB, route: `${quote}->${baseA}->${baseB}->${quote}`, source: 'dynamic' });
      }
    }
  }

  const unique = [];
  const seen = new Set();
  for (const route of routes) {
    const key = `${route.a}|${route.b}|${route.c}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(route);
      if (unique.length >= CONFIG.maxRoutes) break;
    }
  }
  return unique;
}

function calculateVWAP(orders, targetVolume, _side) {
  let remaining = targetVolume;
  let totalCost = 0;
  for (const [price, volume] of orders) {
    if (remaining <= 0) break;
    const fill = Math.min(remaining, volume);
    totalCost += fill * price;
    remaining -= fill;
  }
  if (remaining > 0) return null;
  return totalCost / targetVolume;
}

function estimateSlippage(orderBook, size, side) {
  const orders = side === 'BUY' ? orderBook.asks : orderBook.bids;
  const bestPrice = orders[0]?.[0] || 0;
  if (bestPrice <= 0) return Infinity;
  const vwap = calculateVWAP(orders, size, side);
  if (vwap === null) return null;
  return ((vwap - bestPrice) / bestPrice) * 100;
}

async function evalTriangleWithDepth(tri, prices, orderBooks, exchange, _fee) {
  const fee = _fee;
  const pA = prices[tri.a];
  const pB = prices[tri.b];
  const pC = prices[tri.c];
  if (!pA || !pB || !pC || pA <= 0 || pB <= 0 || pC <= 0) return null;

  const obA = orderBooks[tri.a];
  const obB = orderBooks[tri.b];
  const obC = orderBooks[tri.c];
  // Fee-based profitability computed from three-leg deductions
  // threeLegFee = (1 - fee) ** 3; — reserved for future risk-adjusted P&L
  const q1_1 = (1 / pA) * (1 - fee);
  const q2_1 = (q1_1 / pB) * (1 - fee);
  const q3_1 = q2_1 * pC * (1 - fee);
  const netPct1 = (q3_1 - 1) * 100;

  const q1_2 = (1 / pC) * (1 - fee);
  const q2_2 = (q1_2 * pB) * (1 - fee);
  const q3_2 = q2_2 * pA * (1 - fee);
  const netPct2 = (q3_2 - 1) * 100;

  const bestDir = netPct1 >= netPct2 ? 1 : 2;
  const netPct = bestDir === 1 ? netPct1 : netPct2;
  if (netPct < CONFIG.minNetPct) return null;

  let liquidityScore = 1.0;
  let totalSlippage = 0;
  let insufficientLiquidity = false;

  if (obA && obB && obC) {
    const testSize = 100;
    const legs = bestDir === 1
      ? [{ ob: obA, side: 'BUY' }, { ob: obB, side: 'BUY' }, { ob: obC, side: 'SELL' }]
      : [{ ob: obC, side: 'BUY' }, { ob: obB, side: 'SELL' }, { ob: obA, side: 'SELL' }];

    const slippages = [];
    for (const leg of legs) {
      const slip = estimateSlippage(leg.ob, testSize / (leg.side === 'BUY' ? (leg.ob.asks[0]?.[0] || 1) : (leg.ob.bids[0]?.[0] || 1)), leg.side);
      if (slip === null || slip > CONFIG.maxSlippagePct) { insufficientLiquidity = true; break; }
      slippages.push(slip);
    }
    if (!insufficientLiquidity) {
      totalSlippage = slippages.reduce((a, b) => a + b, 0);
      liquidityScore = 1 / (1 + totalSlippage);
    }
  }

  if (insufficientLiquidity) return null;

  const impliedCross = pA > 0 ? pC / pA : 0;
  const deviation = pB > 0 ? Math.abs((impliedCross - pB) / pB) * 100 : 0;
  if (deviation > 20) return null;

  const adjustedNetPct = netPct - totalSlippage;
  if (adjustedNetPct < CONFIG.minNetPct) return null;

  const executionPlan = bestDir === 1
    ? [{ symbol: tri.a, side: 'BUY' }, { symbol: tri.b, side: 'BUY' }, { symbol: tri.c, side: 'SELL' }]
    : [{ symbol: tri.c, side: 'BUY' }, { symbol: tri.b, side: 'SELL' }, { symbol: tri.a, side: 'SELL' }];

  return {
    strategy: 'triangular_enhanced',
    symbol: `${tri.a}/${tri.b}/${tri.c}`,
    exchange,
    buyPrice: bestDir === 1 ? pA : pC,
    sellPrice: bestDir === 1 ? pC : pA,
    crossPrice: pB,
    crossDeviation: deviation,
    netPct, adjustedNetPct,
    grossPct: Math.abs(netPct) + (fee * 3 * 100),
    slippage: totalSlippage,
    liquidityScore,
    direction: bestDir === 1 ? tri.route : tri.route.split('->').reverse().join('->'),
    legs: [tri.a, tri.b, tri.c],
    executionPlan,
    source: tri.source || 'static',
    depthAnalyzed: !!obA,
    timestamp: Date.now(),
  };
}

export async function scanCrossExchangeTriangular(baseSymbols, exchanges, env) {
  const opportunities = [];
  for (const tri of BASE_TRIANGLES.slice(0, 10)) {
    const legA = tri.a, legB = tri.b, legC = tri.c;
    try {
      const pricesA = new Map(), pricesB = new Map(), pricesC = new Map();
      for (const ex of exchanges) {
        try {
          const tA = await fetchTicker(ex, legA, env); pricesA.set(ex, { bid: tA.bid, ask: tA.ask });
          const tB = await fetchTicker(ex, legB, env); pricesB.set(ex, { bid: tB.bid, ask: tB.ask });
          const tC = await fetchTicker(ex, legC, env); pricesC.set(ex, { bid: tC.bid, ask: tC.ask });
        } catch (_e) { /* skip */ }
      }
      for (const [buyExA, pa] of pricesA) {
        for (const [buyExB, pb] of pricesB) {
          for (const [sellExC, pc] of pricesC) {
            const cost = (1 / pa.ask) * (1 / pb.ask);
            const revenue = cost * pc.bid;
            const netPct = ((revenue / 1) - 1) * 100;
            if (netPct > CONFIG.minNetPct) {
              opportunities.push({
                strategy: 'cross_exchange_triangular',
                route: tri.route,
                legs: { buy1: { ex: buyExA, symbol: legA }, buy2: { ex: buyExB, symbol: legB }, sell: { ex: sellExC, symbol: legC } },
                netPct,
                timestamp: Date.now(),
              });
            }
          }
        }
      }
    } catch (_e) { /* skip */ }
  }
  return opportunities.sort((a, b) => b.netPct - a.netPct);
}

export async function scanTriangularEnhanced(exchange, fee, prices, symbols, env) {
  const opportunities = [];
  const orderBooks = {};
  const symbolsToFetch = new Set();
  const dynamicRoutes = discoverTriangularRoutes(symbols);
  const allRoutes = [...BASE_TRIANGLES, ...dynamicRoutes];

  for (const tri of allRoutes.slice(0, CONFIG.maxRoutes)) {
    symbolsToFetch.add(tri.a); symbolsToFetch.add(tri.b); symbolsToFetch.add(tri.c);
  }

  try {
    const obPromises = [...symbolsToFetch].map(async (symbol) => {
      try { orderBooks[symbol] = await fetchOrderBook(exchange, symbol, CONFIG.depthLevels, env); } catch (_e) { }
    });
    await Promise.allSettled(obPromises);
  } catch (_e) { }

  for (const tri of allRoutes.slice(0, CONFIG.maxRoutes)) {
    try {
      const opp = await evalTriangleWithDepth(tri, prices, orderBooks, exchange, fee);
      if (opp) opportunities.push(opp);
    } catch (_e) { }
  }

  return opportunities.sort((a, b) => b.adjustedNetPct - a.adjustedNetPct);
}

export const COMMON_BASES = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOT', 'AVAX', 'MATIC', 'LINK'];

export function generateSymbolCandidates(bases = COMMON_BASES, quote = CONFIG.quoteAsset) {
  const symbols = [];
  for (const base of bases) {
    symbols.push(`${base}${quote}`);
    for (const base2 of bases) { if (base !== base2) symbols.push(`${base}${base2}`); }
  }
  return [...new Set(symbols)];
}

export { CONFIG, calculateVWAP, estimateSlippage };