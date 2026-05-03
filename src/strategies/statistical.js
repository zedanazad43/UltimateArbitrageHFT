// nexus/src/strategies/statistical.js — Statistical / Pairs Arbitrage Strategy
//
// Detects mean-reversion opportunities by computing the z-score of the price
// spread ratio between two highly correlated assets.  When the ratio deviates
// significantly from its rolling mean (measured in standard deviations), a
// convergence trade is signalled.
//
// The "rolling window" is maintained in Cloudflare KV between scan cycles so
// the Worker can build up sufficient history without external infrastructure.

// ── Constants ─────────────────────────────────────────────────────────────────

// Minimum number of historical data points before a z-score is considered valid.
const MIN_HISTORY_LENGTH = 10;

// Maximum history length stored in KV (circular buffer).
const MAX_HISTORY_LENGTH = 60;

// Z-score threshold: signal only when |z| exceeds this value.
// 2.0 ≈ 97.7th percentile of a normal distribution.
const ZSCORE_THRESHOLD = 2.0;

// Maximum z-score: extreme outliers are likely data errors, not arb opportunities.
const MAX_ZSCORE = 5.0;

// Minimum gross spread between the two assets on their respective exchanges.
const MIN_CROSS_SPREAD_PCT = 0.15;

// KV key prefix for ratio history storage.
const KV_PREFIX = 'statarb_history_';
const KV_TTL    = 7200; // 2-hour TTL — stale history is useless

// ── Correlated pair definitions ───────────────────────────────────────────────
// Each entry defines two assets whose prices are historically correlated.
// ratio = price(assetA) / price(assetB)
export const CORRELATED_PAIRS = [
  { id: 'BTC_ETH',   symbolA: 'BTCUSDT', symbolB: 'ETHUSDT',  label: 'BTC/ETH ratio' },
  { id: 'SOL_AVAX',  symbolA: 'SOLUSDT', symbolB: 'AVAXUSDT', label: 'SOL/AVAX ratio' },
  { id: 'BNB_ETH',   symbolA: 'BNBUSDT', symbolB: 'ETHUSDT',  label: 'BNB/ETH ratio' },
  { id: 'LINK_UNI',  symbolA: 'LINKUSDT', symbolB: 'UNIUSDT', label: 'LINK/UNI ratio' },
];

// ── Math helpers ──────────────────────────────────────────────────────────────

function mean(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stdDev(arr, mu) {
  const m = mu ?? mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function zScore(value, arr) {
  if (arr.length < MIN_HISTORY_LENGTH) return null;
  const m  = mean(arr);
  const sd = stdDev(arr, m);
  if (sd === 0) return null;
  return (value - m) / sd;
}

// ── KV persistence helpers ────────────────────────────────────────────────────

/**
 * Loads the circular ratio history for a pair from KV.
 * Returns an empty array when no history exists.
 */
async function loadHistory(env, pairId) {
  if (!env?.BOT_STATE) return [];
  try {
    const data = await env.BOT_STATE.get(`${KV_PREFIX}${pairId}`, 'json');
    return Array.isArray(data) ? data : [];
  } catch (_) { return []; }
}

/**
 * Appends a new ratio to the history and saves it back to KV.
 * Evicts the oldest entry when the buffer is full.
 */
async function saveHistory(env, pairId, history, newRatio) {
  if (!env?.BOT_STATE) return history;
  const updated = [...history, newRatio].slice(-MAX_HISTORY_LENGTH);
  try {
    await env.BOT_STATE.put(
      `${KV_PREFIX}${pairId}`,
      JSON.stringify(updated),
      { expirationTtl: KV_TTL }
    );
  } catch (_) {}
  return updated;
}

// ── Main scanner ──────────────────────────────────────────────────────────────

/**
 * Evaluates whether a statistical arbitrage opportunity exists for a given
 * correlated pair.
 *
 * @param {object}  env         — Cloudflare Worker env (for KV access)
 * @param {object}  pairDef     — entry from CORRELATED_PAIRS
 * @param {number}  priceA      — current price of assetA (USDT-quoted)
 * @param {number}  priceB      — current price of assetB (USDT-quoted)
 * @param {Array}   sourcesA    — [{ price, exchange, fee }] spot sources for assetA
 * @param {Array}   sourcesB    — [{ price, exchange, fee }] spot sources for assetB
 * @returns {object|null}  OpportunityObject or null
 */
export async function scanStatistical(env, pairDef, priceA, priceB, sourcesA, sourcesB) {
  if (!priceA || !priceB || priceA <= 0 || priceB <= 0) return null;

  const currentRatio = priceA / priceB;

  // Update rolling history
  const history       = await loadHistory(env, pairDef.id);
  const updatedHistory = await saveHistory(env, pairDef.id, history, currentRatio);

  if (updatedHistory.length < MIN_HISTORY_LENGTH) return null;

  const z = zScore(currentRatio, updatedHistory);
  if (z === null) return null;

  const absZ = Math.abs(z);
  if (absZ < ZSCORE_THRESHOLD || absZ > MAX_ZSCORE) return null;

  // ── Select best execution: buy undervalued, sell overvalued ────────────────
  // z > 0 → ratio is ABOVE mean → A is overpriced relative to B
  //   → sell A (use cheapest source), buy B (use cheapest source)
  // z < 0 → ratio is BELOW mean → A is underpriced relative to B
  //   → buy A, sell B

  const aOverpriced = z > 0;

  const bestSrcA = sourcesA.length > 0
    ? sourcesA.reduce((a, b) => (a.price < b.price ? a : b))
    : null;
  const bestSrcB = sourcesB.length > 0
    ? sourcesB.reduce((a, b) => (a.price < b.price ? a : b))
    : null;

  if (!bestSrcA || !bestSrcB) return null;

  // Expected convergence return = |z| * stdDev(ratio) / mean(ratio)
  const m         = mean(updatedHistory);
  const sd        = stdDev(updatedHistory, m);
  const historicalMean = m;
  const expectedReversion = m > 0 ? (absZ * sd / m) * 100 : 0; // as a percentage

  // Round-trip fee cost (both legs)
  const totalFeePct = (bestSrcA.fee + bestSrcB.fee) * 100 * 2;

  const crossSpread = Math.abs(priceA / priceB - historicalMean) / historicalMean * 100;
  if (crossSpread < MIN_CROSS_SPREAD_PCT) return null;

  const netPct = expectedReversion - totalFeePct;
  if (netPct <= 0) return null;

  const buySymbol  = aOverpriced ? pairDef.symbolB : pairDef.symbolA;
  const sellSymbol = aOverpriced ? pairDef.symbolA : pairDef.symbolB;
  const buySrc     = aOverpriced ? bestSrcB : bestSrcA;
  const sellSrc    = aOverpriced ? bestSrcA : bestSrcB;

  const grossPct    = expectedReversion;
  const safetyFactor = grossPct > 0 ? netPct / grossPct : 0;

  return {
    strategy:     'statistical',
    symbol:       `${pairDef.symbolA}/${pairDef.symbolB}`,
    buyExchange:  buySrc.exchange,
    sellExchange: sellSrc.exchange,
    buyPrice:     buySrc.price,
    sellPrice:    sellSrc.price,
    grossPct,
    netPct,
    safetyFactor,
    direction:    `${buySymbol}←→${sellSymbol} z=${z.toFixed(2)}`,
    isPerp:       false,
    // statistical-specific fields
    zScore:       z,
    ratio:        currentRatio,
    ratioMean:    historicalMean,
    ratioStdDev:  sd,
    pairId:       pairDef.id,
    pairLabel:    pairDef.label,
    historyLength: updatedHistory.length
  };
}
