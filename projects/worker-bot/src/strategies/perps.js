// nexus/src/strategies/perps.js — Perpetuals vs Spot Arbitrage Strategy

const MIN_SAFETY_FACTOR = 0.20; // net/gross must be >= 20% (aggressive mode)

// Data-only exchanges that should never appear as execution venues.
// These exchanges are restricted by regulation (BaFin Germany) or lack API credentials.
const DATA_ONLY_EXCHANGES = new Set(['kraken', 'coinbase']);

// Estimated market-impact slippage (in % of trade value) applied per leg.
// Perpetuals typically have tighter spreads than spot, but still incur slippage.
const DEFAULT_SLIPPAGE_PCT = 0.04; // 4 bps per leg for perps
const SLIPPAGE_OVERRIDES = {
  mexc: 0.03,  // MEXC has tight spreads on majors
  binance: 0.02,  // deepest order books
  mexc_perp: 0.03,  // MEXC perps — moderate liquidity
  binance_perp: 0.02, // Binance USDM perps — deep liquidity
  bybit: 0.04,
  bybit_perp: 0.04, // Bybit linear perps
  kucoin: 0.05,
  bitget: 0.06,
  gateio: 0.07,
  bitmart: 0.08,
  htx: 0.06,
};

/**
 * Returns estimated one-way slippage in percent for a given exchange.
 * @param {string} exchange
 * @returns {number}
 */
function slippagePct(exchange) {
  return SLIPPAGE_OVERRIDES[exchange] ?? DEFAULT_SLIPPAGE_PCT;
}

function addRejection(options, reason, count = 1) {
  try {
    if (!options || !options.rejections || !reason || count <= 0) return;
    options.rejections[reason] = Number(options.rejections[reason] || 0) + Number(count || 0);
  } catch (_) {
    // never throw
  }
}

/**
 * Finds arbitrage between spot sources and perpetual sources (funding rate spread).
 * The perp price diverges from spot during high funding — we exploit that gap.
 * Accepts multiple perp sources (MEXC, Binance, Bybit) and evaluates all.
 *
 * @param {string} symbol
 * @param {Array}  spotSources — array of spot { price, exchange, fee }
 * @param {object|Array|null} perpSources — single perp source or array of perp sources
 * @param {number} maxSpreadPct — volatility guard
 * @param {object}  options — { minSafetyFactor, slippageMultiplier }
 * @returns {object|null} OpportunityObject or null
 */
export function scanPerps(symbol, spotSources, perpSources, maxSpreadPct, options = {}) {
  // Normalize to array — supports both old single-source and new multi-source callers
  const perps = Array.isArray(perpSources) ? perpSources.filter(Boolean) : (perpSources ? [perpSources] : []);

  if (perps.length === 0) {
    addRejection(options, 'missing_perp_source');
    return null;
  }
  if (spotSources.length < 1) {
    addRejection(options, 'missing_spot_sources');
    return null;
  }

  const minSafetyFactor = Number.isFinite(options?.minSafetyFactor)
    ? options.minSafetyFactor
    : MIN_SAFETY_FACTOR;
  const slippageMultiplier = Number.isFinite(options?.slippageMultiplier)
    ? options.slippageMultiplier
    : 1;

  let best = null;
  let rejectedNonPositiveSpread = 0;
  let rejectedDataOnlyVenue = 0;
  let rejectedNonPositiveNet = 0;
  let rejectedLowSafety = 0;

  // Evaluate against each perp source
  for (const perpSource of perps) {
    // Spread guard across all sources (spot + perp)
    const allSources = [...spotSources, perpSource];
    const prices = allSources.map(s => s.price);
    const priceMin = Math.min(...prices);
    const priceMax = Math.max(...prices);
    const spread = ((priceMax - priceMin) / priceMin) * 100;
    if (spread > maxSpreadPct) {
      addRejection(options, 'spread_guard_exceeded');
      continue;
    }

    // Evaluate spot→perp and perp→spot for each spot source against this perp
    for (const spot of spotSources) {
      for (const [buy, sell] of [[spot, perpSource], [perpSource, spot]]) {
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
            strategy: 'perps',
            symbol,
            buyExchange: buy.exchange,
            sellExchange: sell.exchange,
            buyPrice: buy.price,
            sellPrice: sell.price,
            grossPct,
            netPct,
            safetyFactor,
            direction: `${buy.exchange.toUpperCase()}→${sell.exchange.toUpperCase()}`,
            isPerp: true,
            slippagePct: totalSlippagePct,
            fundingRate: perpSource.fundingRate,
          };
        }
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
