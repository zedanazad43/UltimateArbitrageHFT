// nexus/src/strategies/perps.js — Perpetuals vs Spot Arbitrage Strategy

const MIN_SAFETY_FACTOR = 0.35; // net/gross must be ≥ 35%

/**
 * Finds arbitrage between spot sources and the perpetual (funding rate spread).
 * The perp price diverges from spot during high funding — we exploit that gap.
 *
 * @param {string} symbol
 * @param {Array}  spotSources — array of spot { price, exchange, fee }
 * @param {object|null} perpSource — { price, exchange, fee } from MEXC perps
 * @param {number} maxSpreadPct — volatility guard
 * @param {number} topN — return top N opportunities (default 1, legacy behavior)
 * @returns {Array|object|null} Array of top opportunities or single best (backward compatible)
 */
export function scanPerps(symbol, spotSources, perpSource, maxSpreadPct, topN = 1) {
  if (!perpSource || spotSources.length < 1) return topN === 1 ? null : [];

  const allSources = [...spotSources, perpSource];
  const prices     = allSources.map(s => s.price);
  const priceMin   = Math.min(...prices);
  const priceMax   = Math.max(...prices);
  const spread     = ((priceMax - priceMin) / priceMin) * 100;
  if (spread > maxSpreadPct) return topN === 1 ? null : [];

  const opportunities = [];
  for (const spot of spotSources) {
    for (const [buy, sell] of [[spot, perpSource], [perpSource, spot]]) {
      if (sell.price <= buy.price) continue;

      const grossPct    = ((sell.price - buy.price) / buy.price) * 100;
      const totalFeePct = (buy.fee + sell.fee) * 100;
      const netPct      = grossPct - totalFeePct;
      if (netPct <= 0) continue;

      const safetyFactor = netPct / grossPct;
      if (safetyFactor < MIN_SAFETY_FACTOR) continue;

      opportunities.push({
        strategy:     'perps',
        symbol,
        buyExchange:  buy.exchange,
        sellExchange: sell.exchange,
        buyPrice:     buy.price,
        sellPrice:    sell.price,
        grossPct,
        netPct,
        safetyFactor,
        direction:    `${buy.exchange.toUpperCase()}→${sell.exchange.toUpperCase()}`,
        isPerp:       true,
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
