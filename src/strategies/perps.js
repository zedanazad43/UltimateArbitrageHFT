// nexus/src/strategies/perps.js — Perpetuals vs Spot Arbitrage Strategy

const MIN_SAFETY_FACTOR = 0.35; // net/gross must be >= 35%

// Data-only exchanges that should never appear as execution venues.
// These exchanges are restricted by regulation (BaFin Germany) or lack API credentials.
const DATA_ONLY_EXCHANGES = new Set(['bybit', 'gateio', 'kraken', 'coinbase']);

// Estimated market-impact slippage (in % of trade value) applied per leg.
// Perpetuals typically have tighter spreads than spot, but still incur slippage.
const DEFAULT_SLIPPAGE_PCT = 0.04; // 4 bps per leg for perps
const SLIPPAGE_OVERRIDES = {
  mexc:      0.03,  // MEXC has tight spreads on majors
  binance:   0.02,  // deepest order books
  mexc_perp: 0.03,  // MEXC perps — moderate liquidity
  bybit:     0.04,
  kucoin:    0.05,
  bitget:    0.06,
  gateio:    0.07,
  bitmart:   0.08,
  htx:       0.06,
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
 * Finds arbitrage between spot sources and the perpetual (funding rate spread).
 * The perp price diverges from spot during high funding — we exploit that gap.
 *
 * @param {string} symbol
 * @param {Array}  spotSources — array of spot { price, exchange, fee }
 * @param {object|null} perpSource — { price, exchange, fee } from MEXC perps
 * @param {number} maxSpreadPct — volatility guard
 * @param {object}  options — { minSafetyFactor, slippageMultiplier }
 * @returns {object|null} OpportunityObject or null
 */
export function scanPerps(symbol, spotSources, perpSource, maxSpreadPct, options = {}) {
  if (!perpSource || spotSources.length < 1) return null;

  const minSafetyFactor = Number.isFinite(options?.minSafetyFactor)
    ? options.minSafetyFactor
    : MIN_SAFETY_FACTOR;
  const slippageMultiplier = Number.isFinite(options?.slippageMultiplier)
    ? options.slippageMultiplier
    : 1;

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
          slippagePct:  totalSlippagePct
        };
      }
    }
  }
  return best;
}
