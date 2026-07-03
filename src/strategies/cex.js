// nexus/src/strategies/cex.js — CEX Spatial Arbitrage Strategy

const MIN_SAFETY_FACTOR = 0.35; // net/gross must be ≥ 35%

// Estimated market-impact slippage (in % of trade value) applied per leg.
// Derived from empirical analysis of crypto order-book depth at ~$5k–$50k sizes.
// Inspired by Hummingbot's slippage buffer and harjus order-fill modelling.
// Exchange-specific overrides handle known thin-book exchanges.
const DEFAULT_SLIPPAGE_PCT = 0.05; // 5 bps per leg
const SLIPPAGE_OVERRIDES = {
  mexc:    0.03,  // MEXC has tight spreads on majors
  binance: 0.02,  // deepest order books
  bybit:   0.04,
  okx:     0.03,
  kucoin:  0.05,
  bitget:  0.06,
  gateio:  0.07,
  bitmart: 0.08,
  htx:     0.06,
};

/**
 * Returns estimated one-way slippage in percent for a given exchange.
 * @param {string} exchange
 * @returns {number}
 */
function slippagePct(exchange) {
  return SLIPPAGE_OVERRIDES[exchange] ?? DEFAULT_SLIPPAGE_PCT;
}

/**
 * Finds the best CEX arbitrage opportunities across the provided price sources.
 *
 * @param {string} symbol
 * @param {Array}  sources  — array of { price, exchange, fee } objects
 * @param {number} maxSpreadPct  — volatility guard: skip if gross spread exceeds this
 * @param {number} topN      — return top N opportunities (default 1, legacy behavior)
 * @returns {Array|object|null}  Array of top opportunities or single best (backward compatible)
 */
export function scanCEX(symbol, sources, maxSpreadPct, topN = 1) {
  if (sources.length < 2) return topN === 1 ? null : [];

  const prices = sources.map(s => s.price);
  const priceMin = Math.min(...prices);
  const priceMax = Math.max(...prices);
  const observedSpread = ((priceMax - priceMin) / priceMin) * 100;

  if (observedSpread > maxSpreadPct) {
    console.log(
      `⚠️  CEX ${symbol}: spread ${observedSpread.toFixed(2)}% exceeds ${maxSpreadPct}% guard — skipped`
    );
    return topN === 1 ? null : [];
  }

  const opportunities = [];
  for (let i = 0; i < sources.length; i++) {
    for (let j = 0; j < sources.length; j++) {
      if (i === j) continue;
      const buy  = sources[i];
      const sell = sources[j];
      if (sell.price <= buy.price) continue;

      const grossPct    = ((sell.price - buy.price) / buy.price) * 100;
      const totalFeePct = (buy.fee + sell.fee) * 100;
      const totalSlippagePct = slippagePct(buy.exchange) + slippagePct(sell.exchange);
      const netPct      = grossPct - totalFeePct - totalSlippagePct;
      if (netPct <= 0) continue;

      const safetyFactor = netPct / grossPct;
      if (safetyFactor < MIN_SAFETY_FACTOR) continue;

      opportunities.push({
        strategy:     'cex',
        symbol,
        buyExchange:  buy.exchange,
        sellExchange: sell.exchange,
        buyPrice:     buy.price,
        sellPrice:    sell.price,
        grossPct,
        netPct,
        safetyFactor,
        direction:    `${buy.exchange.toUpperCase()}→${sell.exchange.toUpperCase()}`,
        isPerp:       false,
        slippagePct:  totalSlippagePct,
        timestamp:    Date.now(),
      });
    }
  }

  // Sort by net profit descending
  opportunities.sort((a, b) => (b.netPct ?? 0) - (a.netPct ?? 0));

  // Return top N (or single best for backward compatibility)
  const top = opportunities.slice(0, topN);
  return topN === 1 ? (top.length > 0 ? top[0] : null) : top;
}
