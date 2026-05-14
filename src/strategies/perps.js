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
 * @returns {object|null} OpportunityObject or null
 */
export function scanPerps(symbol, spotSources, perpSource, maxSpreadPct) {
  if (!perpSource || spotSources.length < 1) return null;

  // Spread guard across all sources (spot + perp)
  const allSources = [...spotSources, perpSource];
  const prices     = allSources.map(s => s.price);
  const priceMin   = Math.min(...prices);
  const priceMax   = Math.max(...prices);
  const spread     = ((priceMax - priceMin) / priceMin) * 100;
  if (spread > maxSpreadPct) return null;

  let best = null;
  // Evaluate spot→perp and perp→spot directions for each spot source
  for (const spot of spotSources) {
    for (const [buy, sell] of [[spot, perpSource], [perpSource, spot]]) {
      if (sell.price <= buy.price) continue;

      const grossPct    = ((sell.price - buy.price) / buy.price) * 100;
      const totalFeePct = (buy.fee + sell.fee) * 100;
      const netPct      = grossPct - totalFeePct;
      if (netPct <= 0) continue;

      const safetyFactor = netPct / grossPct;
      if (safetyFactor < MIN_SAFETY_FACTOR) continue;

      if (!best || netPct > best.netPct) {
        best = {
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
          isPerp:       true
        };
      }
    }
  }
  return best;
}
