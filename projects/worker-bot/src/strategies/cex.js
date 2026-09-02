// nexus/src/strategies/cex.js — CEX Spatial Arbitrage Strategy

const MIN_SAFETY_FACTOR = 0.20; // net/gross must be >= 20% (aggressive mode)

// Data-only exchanges that should never appear as execution venues.
// These exchanges are restricted by regulation (BaFin Germany) or lack API credentials.
const DATA_ONLY_EXCHANGES = new Set(['kraken', 'coinbase']);

// Exchanges that are currently unreachable (e.g. geo-blocked / tunnel down).
// scanCEX will skip these as execution venues but still use reachable ones.
const UNREACHABLE_EXCHANGES = new Set(
  (process.env.UNREACHABLE_EXCHANGES || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
);

function addRejection(options, reason, count = 1) {
  if (!options || !options.rejections || !reason || count <= 0) return;
  options.rejections[reason] = Number(options.rejections[reason] || 0) + Number(count || 0);
}

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
  const executionSources = (Array.isArray(sources) ? sources : []).filter(
    (s) => s && !DATA_ONLY_EXCHANGES.has(String(s.exchange || '').toLowerCase())
  ).filter(
    (s) => !UNREACHABLE_EXCHANGES.has(String(s.exchange || '').toLowerCase())
  );

  if (executionSources.length < 2) {
    addRejection(options, 'insufficient_sources');
    addRejection(options, 'insufficient_execution_sources');
    return null;
  }

  const minSafetyFactor = Number.isFinite(options?.minSafetyFactor)
    ? options.minSafetyFactor
    : MIN_SAFETY_FACTOR;
  const slippageMultiplier = Number.isFinite(options?.slippageMultiplier)
    ? options.slippageMultiplier
    : 1;

  const prices = executionSources.map(s => s.price);
  const priceMin = Math.min(...prices);
  const priceMax = Math.max(...prices);
  const observedSpread = ((priceMax - priceMin) / priceMin) * 100;

  if (observedSpread > maxSpreadPct) {
    console.log(
      `⚠️  CEX ${symbol}: spread ${observedSpread.toFixed(2)}% exceeds ${maxSpreadPct}% guard — skipped`
    );
    addRejection(options, 'spread_guard_exceeded');
    return null;
  }

  let best = null;
  let rejectedNonPositiveSpread = 0;
  let rejectedDataOnlyVenue = 0;
  let rejectedNonPositiveNet = 0;
  let rejectedLowSafety = 0;
  for (let i = 0; i < executionSources.length; i++) {
    for (let j = 0; j < executionSources.length; j++) {
      if (i === j) continue;
      const buy = executionSources[i];
      const sell = executionSources[j];
      if (sell.price <= buy.price) {
        rejectedNonPositiveSpread++;
        continue;
      }

      // Skip opportunities involving data-only exchanges as execution venues
      if (DATA_ONLY_EXCHANGES.has(buy.exchange) || DATA_ONLY_EXCHANGES.has(sell.exchange)) {
        rejectedDataOnlyVenue++;
        continue;
      }

      const grossPct = ((sell.price - buy.price) / buy.price) * 100;
      const totalFeePct = (buy.fee + sell.fee) * 100;
      // Deduct estimated market-impact slippage on both legs
      const totalSlippagePct = (slippagePct(buy.exchange) + slippagePct(sell.exchange)) * slippageMultiplier;
      const netPct = grossPct - totalFeePct - totalSlippagePct;
      if (netPct <= 0) {
        rejectedNonPositiveNet++;
        continue;
      }

      const safetyFactor = netPct / grossPct;
      if (safetyFactor < minSafetyFactor) {
        rejectedLowSafety++;
        continue;
      }

      if (!best || netPct > best.netPct) {
        best = {
          strategy: 'cex',
          symbol,
          buyExchange: buy.exchange,
          sellExchange: sell.exchange,
          buyPrice: buy.price,
          sellPrice: sell.price,
          grossPct,
          netPct,
          safetyFactor,
          direction: `${buy.exchange.toUpperCase()}→${sell.exchange.toUpperCase()}`,
          isPerp: false,
          slippagePct: totalSlippagePct
        };
      }
    }
  }
  if (!best) {
    addRejection(options, 'non_positive_spread', rejectedNonPositiveSpread);
    addRejection(options, 'data_only_execution_venue', rejectedDataOnlyVenue);
    addRejection(options, 'non_positive_net_after_fees_slippage', rejectedNonPositiveNet);
    addRejection(options, 'safety_below_threshold', rejectedLowSafety);
  }
  return best;
}
