// nexus/src/strategies/cex.js — CEX Spatial Arbitrage Strategy

const MIN_SAFETY_FACTOR = 0.4; // net/gross must be ≥ 40%

/**
 * Finds the best CEX arbitrage opportunity across the provided price sources.
 *
 * @param {string} symbol
 * @param {Array}  sources  — array of { price, exchange, fee } objects
 * @param {number} maxSpreadPct  — volatility guard: skip if gross spread exceeds this
 * @returns {object|null}  OpportunityObject or null
 */
export function scanCEX(symbol, sources, maxSpreadPct) {
  if (sources.length < 2) return null;

  const prices = sources.map(s => s.price);
  const priceMin = Math.min(...prices);
  const priceMax = Math.max(...prices);
  const observedSpread = ((priceMax - priceMin) / priceMin) * 100;

  if (observedSpread > maxSpreadPct) {
    console.log(
      `⚠️  CEX ${symbol}: spread ${observedSpread.toFixed(2)}% exceeds ${maxSpreadPct}% guard — skipped`
    );
    return null;
  }

  let best = null;
  for (let i = 0; i < sources.length; i++) {
    for (let j = 0; j < sources.length; j++) {
      if (i === j) continue;
      const buy  = sources[i];
      const sell = sources[j];
      if (sell.price <= buy.price) continue;

      const grossPct    = ((sell.price - buy.price) / buy.price) * 100;
      const totalFeePct = (buy.fee + sell.fee) * 100;
      const netPct      = grossPct - totalFeePct;
      if (netPct <= 0) continue;

      const safetyFactor = netPct / grossPct;
      if (safetyFactor < MIN_SAFETY_FACTOR) continue;

      if (!best || netPct > best.netPct) {
        best = {
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
          isPerp:       false
        };
      }
    }
  }
  return best;
}
