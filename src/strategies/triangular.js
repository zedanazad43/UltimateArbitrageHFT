// nexus/src/strategies/triangular.js — Triangular Arbitrage Strategy
//
// Detects A→B→C→A price discrepancies on a single exchange.
// Classic route: USDT → BTC (buy BTC/USDT)
//                      → ETH (sell BTC for ETH via ETH/BTC price)
//                      → USDT (sell ETH/USDT)
// Profit arises when the implied cross rate differs from the quoted cross rate.

// Minimum net profit to report (after 3 legs of taker fees).
const MIN_NET_PCT = 0.01; // 0.01% — triangular arb margins are tight

// Maximum allowed spread in any single leg (volatility guard).
const MAX_LEG_SPREAD_PCT = 3.0;

/**
 * Triangular path definition.
 * - `a`: base quote pair  (e.g. BTCUSDT)
 * - `b`: cross pair       (e.g. ETHBTC)
 * - `c`: derived quote pair (e.g. ETHUSDT)
 * - `route`: human-readable trade direction
 *
 * Direction 1: USDT → buy A → sell A/B cross → sell B for USDT
 * Direction 2: USDT → buy B → buy A via cross → sell A for USDT
 */
const TRIANGLES = [
  { a: 'BTCUSDT', b: 'ETHBTC', c: 'ETHUSDT', route: 'USDT→BTC→ETH→USDT' },
  { a: 'BNBUSDT', b: 'BNBBTC', c: 'BTCUSDT', route: 'USDT→BNB→BTC→USDT' },
  { a: 'SOLUSDT', b: 'SOLBTC', c: 'BTCUSDT', route: 'USDT→SOL→BTC→USDT' },
  { a: 'ETHUSDT', b: 'BNBETH', c: 'BNBUSDT', route: 'USDT→ETH→BNB→USDT' },
];

/**
 * Evaluates triangular arbitrage for one triangle definition.
 *
 * @param {object} tri   — { a, b, c, route } triangle definition
 * @param {number} pA    — price of pair A/USDT (e.g. BTC/USDT)
 * @param {number} pB    — price of cross pair A/B (e.g. ETH/BTC)
 * @param {number} pC    — price of pair C/USDT (e.g. ETH/USDT)
 * @param {string} exchange — exchange label
 * @param {number} fee   — taker fee per leg (decimal, e.g. 0.001)
 * @returns {object|null} OpportunityObject or null
 */
function evalTriangle(tri, pA, pB, pC, exchange, fee) {
  if (!pA || !pB || !pC) return null;
  if (pA <= 0 || pB <= 0 || pC <= 0) return null;

  // ── Direction 1: USDT → A → C via cross → USDT ────────────────────────────
  // Step 1: 1 USDT → (1/pA) units of A (buy A/USDT)
  // Step 2: (1/pA) units of A → (1/pA)/(pB_inverseRatio) units of C
  //         cross pair is A/B = pB  ⟹  1 unit A = pB units of C if B is USDT? No.
  //
  // For BTCUSDT, ETHBTC, ETHUSDT:
  //   pA = BTC/USDT price
  //   pB = ETH/BTC price  (amount of ETH per 1 BTC)
  //   pC = ETH/USDT price
  //
  // Dir-1: USDT → BTC → ETH → USDT
  //   q1 = 1 / pA                   (BTC received, after buying BTC/USDT)
  //   q2 = q1 * pB                  (ETH received, after selling ETH/BTC at pB)
  //   q3 = q2 * pC                  (USDT received, after selling ETH/USDT)
  //   gross_1 = q3 - 1 (starting USDT)
  //   fees deducted 3× as a multiplier: (1-fee)^3
  const q1_1 = (1 / pA) * (1 - fee);
  const q2_1 = q1_1 * pB * (1 - fee);
  const q3_1 = q2_1 * pC * (1 - fee);
  const netPct1 = (q3_1 - 1) * 100;

  // ── Direction 2: USDT → C → A via cross (reverse) → USDT ──────────────────
  //   USDT → ETH → BTC → USDT
  //   q1 = 1 / pC                   (ETH received)
  //   q2 = q1 / pB                  (BTC received, selling ETH/BTC = selling ETH, buying BTC)
  //   q3 = q2 * pA                  (USDT received)
  const q1_2 = (1 / pC) * (1 - fee);
  const q2_2 = (q1_2 / pB) * (1 - fee);
  const q3_2 = q2_2 * pA * (1 - fee);
  const netPct2 = (q3_2 - 1) * 100;

  const bestDir   = netPct1 >= netPct2 ? 1 : 2;
  const netPct    = bestDir === 1 ? netPct1 : netPct2;
  const grossPct  = Math.abs(netPct) + (fee * 3 * 100); // approx gross
  const direction = bestDir === 1 ? tri.route : tri.route.split('→').reverse().join('→');

  if (netPct < MIN_NET_PCT) return null;

  // Implied vs quoted cross rate deviation check
  const impliedCross = pA > 0 ? pC / pA : 0;
  const quotedCross  = pB;
  const deviation    = quotedCross > 0
    ? Math.abs((impliedCross - quotedCross) / quotedCross) * 100
    : 0;
  if (deviation > MAX_LEG_SPREAD_PCT) return null;

  return {
    strategy:    'triangular',
    symbol:      `${tri.a}/${tri.b}/${tri.c}`,
    buyExchange:  exchange,
    sellExchange: exchange,
    buyPrice:     pA,
    sellPrice:    pC,
    grossPct,
    netPct,
    safetyFactor: grossPct > 0 ? netPct / grossPct : 0,
    direction,
    isPerp:       false,
    legs: [tri.a, tri.b, tri.c],
    crossDeviation: deviation
  };
}

/**
 * Scans all configured triangles for one exchange.
 *
 * @param {string} exchange  — exchange identifier
 * @param {number} fee       — taker fee per leg (decimal)
 * @param {object} prices    — map of symbol → price, e.g. { BTCUSDT: 65000, ETHBTC: 0.052, ETHUSDT: 3380 }
 * @returns {object|null}    Best triangular OpportunityObject or null
 */
export function scanTriangular(exchange, fee, prices) {
  if (!prices || typeof prices !== 'object') return null;

  let best = null;

  for (const tri of TRIANGLES) {
    const pA = prices[tri.a];
    const pB = prices[tri.b];
    const pC = prices[tri.c];

    const opp = evalTriangle(tri, pA, pB, pC, exchange, fee);
    if (opp && (!best || opp.netPct > best.netPct)) {
      best = opp;
    }
  }

  return best;
}

/** Exported triangle definitions so callers can know which cross-pair symbols to fetch. */
export { TRIANGLES };
