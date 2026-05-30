// nexus/src/strategies/cex.js — CEX Spatial Arbitrage Strategy

const MIN_SAFETY_FACTOR = 0.35; // net/gross must be >= 35%

// Data-only exchanges that should never appear as execution venues.
// These exchanges are restricted by regulation (BaFin Germany) or lack API credentials.
const DATA_ONLY_EXCHANGES = new Set(['bybit', 'gateio', 'kraken', 'coinbase']);

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
 * Finds the best CEX arbitrage opportunity across the provided price sources.
 *
 * @param {string} symbol
 * @param {Array}  sources  — array of { price, exchange, fee } objects
 * @param {number} maxSpreadPct  — volatility guard: skip if gross spread exceeds this
 * @returns {object|null}  OpportunityObject or null
 */
export function scanCEX(symbol, sources, maxSpreadPct, options = {}) {
  if (sources.length < 2) return null;

  const minSafetyFactor = Number.isFinite(options?.minSafetyFactor)
    ? options.minSafetyFactor
    : MIN_SAFETY_FACTOR;
  const slippageMultiplier = Number.isFinite(options?.slippageMultiplier)
    ? options.slippageMultiplier
    : 1;

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

      // Skip opportunities involving data-only exchanges as execution venues
      if (DATA_ONLY_EXCHANGES.has(buy.exchange) || DATA_ONLY_EXCHANGES.has(sell.exchange)) continue;

      const grossPct    = ((sell.price - buy.price) / buy.price) * 100;
      const totalFeePct = (buy.fee + sell.fee) * 100;
      // Deduct estimated market-impact slippage on both legs
      const totalSlippagePct = (slippagePct(buy.exchange) + slippagePct(sell.exchange)) * slippageMultiplier;
      const netPct      = grossPct - totalFeePct - totalSlippagePct;
      if (netPct <= 0) continue;

      const safetyFactor = netPct / grossPct;
      if (safetyFactor < minSafetyFactor) continue;

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
          isPerp:       false,
          slippagePct:  totalSlippagePct
        };
      }
    }
  }
  return best;
}
