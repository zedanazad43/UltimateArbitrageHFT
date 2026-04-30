// nexus/src/strategies/funding.js — Funding Rate Harvest Strategy
//
// When a perpetual's funding rate is sufficiently high (positive or negative),
// holding a delta-neutral position (long spot + short perp, or vice-versa)
// generates risk-free yield equal to the collected funding payment minus
// round-trip fees.  This strategy surfaces such opportunities for the
// orchestrator to act on.

// Minimum absolute funding rate to consider (per 8-hour settlement period).
// 0.0001 = 0.01% per period ≈ 10.95% APY — below this the edge is marginal.
const MIN_FUNDING_RATE = 0.0001;

// Cap: funding rates above 1% per period usually revert before settlement.
const MAX_FUNDING_RATE = 0.01;

// Maximum allowed spot-vs-perp price divergence before the spread guard fires.
// Above this the mark price is unreliable and execution slippage would eat profit.
const MAX_DIVERGENCE_PCT = 2.0;

/**
 * Evaluates whether a funding-rate harvest trade is worthwhile.
 *
 * @param {string}      symbol        — e.g. 'BTCUSDT'
 * @param {Array}       spotSources   — [{ price, exchange, fee }]
 * @param {object|null} perpData      — { price, exchange, fee, fundingRate }
 * @param {number}      maxSpreadPct  — additional volatility guard from config
 * @returns {object|null}  OpportunityObject or null
 */
export function scanFundingRate(symbol, spotSources, perpData, maxSpreadPct) {
  if (!perpData || spotSources.length < 1) return null;

  const fundingRate = perpData.fundingRate ?? 0;
  const absFunding  = Math.abs(fundingRate);

  if (absFunding < MIN_FUNDING_RATE) return null;
  if (absFunding > MAX_FUNDING_RATE) return null;

  // Use cheapest spot source to minimise entry cost
  const bestSpot = spotSources.reduce((a, b) => (a.price < b.price ? a : b));

  // Reject if spot and perp price diverge suspiciously (stale data / illiquid)
  const divergencePct = Math.abs(perpData.price - bestSpot.price) / bestSpot.price * 100;
  if (divergencePct > Math.min(maxSpreadPct, MAX_DIVERGENCE_PCT)) return null;

  // P&L per period = |fundingRate| - round-trip taker fees (enter + exit, both legs)
  const roundTripFeePct = (bestSpot.fee + perpData.fee) * 2 * 100;
  const fundingPct      = absFunding * 100;
  const netPct          = fundingPct - roundTripFeePct;

  if (netPct <= 0) return null;

  if (fundingPct === 0) return null;
  const safetyFactor = netPct / fundingPct;

  // Positive funding → shorts receive payment → go long spot + short perp
  // Negative funding → longs receive payment  → go short spot + long perp
  const receiveFunding = fundingRate >= 0; // true = receive as short perp
  const buyExchange  = receiveFunding ? bestSpot.exchange : perpData.exchange;
  const sellExchange = receiveFunding ? perpData.exchange : bestSpot.exchange;
  const buyPrice     = receiveFunding ? bestSpot.price    : perpData.price;
  const sellPrice    = receiveFunding ? perpData.price    : bestSpot.price;
  const perpSide     = receiveFunding ? 'SHORT'           : 'LONG';

  return {
    strategy:       'funding',
    symbol,
    buyExchange,
    sellExchange,
    buyPrice,
    sellPrice,
    grossPct:       fundingPct,
    netPct,
    safetyFactor,
    direction:      `SPOT→${perpData.exchange.toUpperCase()} ${perpSide} (funding harvest)`,
    isPerp:         true,
    fundingRate,
    perpSide,
    fundingHarvest: true
  };
}
