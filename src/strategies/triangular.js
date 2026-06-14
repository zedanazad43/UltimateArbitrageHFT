// nexus/src/strategies/triangular.js — Triangular Arbitrage Strategy
//
// Detects A→B→C→A price discrepancies on a single exchange.
// Classic route: USDT → BTC (buy BTC/USDT)
//                      → ETH (sell BTC for ETH via ETH/BTC price)
//                      → USDT (sell ETH/USDT)
// Profit arises when the implied cross rate differs from the quoted cross rate.

// Minimum net profit to report (after 3 legs of taker fees).
const MIN_NET_PCT = 0.005; // 0.005% — tighter live capture for MEXC-focused execution

// Maximum allowed cross-rate deviation (used to reject extreme outliers only).
const MAX_LEG_SPREAD_PCT = 20;

/**
 * Triangular path definition.
 * - `a`: base quote pair  (e.g. BTCUSDT)
 * - `b`: cross pair       (e.g. ETHBTC)
 * - `c`: derived quote pair (e.g. ETHUSDT)
 * - `route`: human-readable trade direction
 *
 * Direction 1: USDT → buy A → sell A/B cross → sell B for USDT
 * Direction 2: USDT → buy B → buy A via cross → sell A for USDT
 *
 * Extended with additional high-liquidity paths sourced from analysis of
 * triangular-arb bots (harjus, OKX-triangular-arbitrage, hummingbot amm_arb).
 */
const TRIANGLES = [
  // ── BTC-base triangles ────────────────────────────────────────────────────
  { a: 'BTCUSDT', b: 'ETHBTC', c: 'ETHUSDT', route: 'USDT→BTC→ETH→USDT' },
  { a: 'BTCUSDT', b: 'BNBBTC', c: 'BNBUSDT', route: 'USDT→BTC→BNB→USDT' },
  { a: 'BTCUSDT', b: 'SOLBTC', c: 'SOLUSDT', route: 'USDT→BTC→SOL→USDT' },
  { a: 'BTCUSDT', b: 'XRPBTC', c: 'XRPUSDT', route: 'USDT→BTC→XRP→USDT' },
  { a: 'BTCUSDT', b: 'ADABTC', c: 'ADAUSDT', route: 'USDT→BTC→ADA→USDT' },
  { a: 'BTCUSDT', b: 'DOTBTC', c: 'DOTUSDT', route: 'USDT→BTC→DOT→USDT' },
  { a: 'BTCUSDT', b: 'LINKBTC', c: 'LINKUSDT', route: 'USDT→BTC→LINK→USDT' },
  { a: 'BTCUSDT', b: 'LTCBTC', c: 'LTCUSDT', route: 'USDT→BTC→LTC→USDT' },
  { a: 'BTCUSDT', b: 'AVAXBTC', c: 'AVAXUSDT', route: 'USDT→BTC→AVAX→USDT' },
  // ── ETH-base triangles ────────────────────────────────────────────────────
  { a: 'ETHUSDT', b: 'BNBETH', c: 'BNBUSDT', route: 'USDT→ETH→BNB→USDT' },
  { a: 'ETHUSDT', b: 'LINKETH', c: 'LINKUSDT', route: 'USDT→ETH→LINK→USDT' },
  { a: 'ETHUSDT', b: 'DOTETH', c: 'DOTUSDT', route: 'USDT→ETH→DOT→USDT' },
  { a: 'ETHUSDT', b: 'UNIETH', c: 'UNIUSDT', route: 'USDT→ETH→UNI→USDT' },
  // ── BNB-base triangles ────────────────────────────────────────────────────
  { a: 'BNBUSDT', b: 'BNBBTC', c: 'BTCUSDT', route: 'USDT→BNB→BTC→USDT' },
  { a: 'BNBUSDT', b: 'SOLBNB', c: 'SOLUSDT', route: 'USDT→BNB→SOL→USDT' },
  { a: 'BNBUSDT', b: 'XRPBNB', c: 'XRPUSDT', route: 'USDT→BNB→XRP→USDT' },
  { a: 'BNBUSDT', b: 'ADABNB', c: 'ADAUSDT', route: 'USDT→BNB→ADA→USDT' },
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
  // For BTCUSDT, ETHBTC, ETHUSDT:
  //   pA = BTC/USDT price (e.g. 65000)
  //   pB = ETH/BTC price: 1 ETH = pB BTC (e.g. 0.052 means 1 ETH costs 0.052 BTC)
  //   pC = ETH/USDT price (e.g. 3380)
  //
  // Dir-1: USDT → BTC → ETH → USDT
  //   q1 = 1 / pA                   (BTC received)
  //   q2 = q1 / pB                  (ETH received: with q1 BTC, get q1/pB ETH since 1 ETH costs pB BTC)
  //   q3 = q2 * pC                  (USDT received)
  const q1_1 = (1 / pA) * (1 - fee);
  const q2_1 = (q1_1 / pB) * (1 - fee);
  const q3_1 = q2_1 * pC * (1 - fee);
  const netPct1 = (q3_1 - 1) * 100;

  // ── Direction 2: USDT → C → A via cross (reverse) → USDT ──────────────────
  // Dir-2: USDT → ETH → BTC → USDT
  //   q1 = 1 / pC                   (ETH received)
  //   q2 = q1 * pB                  (BTC received: selling ETH gets q1 * pB BTC since 1 ETH = pB BTC)
  //   q3 = q2 * pA                  (USDT received)
  const q1_2 = (1 / pC) * (1 - fee);
  const q2_2 = (q1_2 * pB) * (1 - fee);
  const q3_2 = q2_2 * pA * (1 - fee);
  const netPct2 = (q3_2 - 1) * 100;

  const bestDir = netPct1 >= netPct2 ? 1 : 2;
  const netPct = bestDir === 1 ? netPct1 : netPct2;
  const grossPct = Math.abs(netPct) + (fee * 3 * 100); // approx gross
  const direction = bestDir === 1 ? tri.route : tri.route.split('→').reverse().join('→');
  const executionPlan = bestDir === 1
    ? [
      { symbol: tri.a, side: 'BUY' },
      { symbol: tri.b, side: 'BUY' },
      { symbol: tri.c, side: 'SELL' },
    ]
    : [
      { symbol: tri.c, side: 'BUY' },
      { symbol: tri.b, side: 'SELL' },
      { symbol: tri.a, side: 'SELL' },
    ];

  if (netPct < MIN_NET_PCT) return null;

  // Implied vs quoted cross rate deviation check
  const impliedCross = pA > 0 ? pC / pA : 0;
  const quotedCross = pB;
  const deviation = quotedCross > 0
    ? Math.abs((impliedCross - quotedCross) / quotedCross) * 100
    : 0;
  if (deviation > MAX_LEG_SPREAD_PCT) return null;

  return {
    strategy: 'triangular',
    symbol: `${tri.a}/${tri.b}/${tri.c}`,
    buyExchange: exchange,
    sellExchange: exchange,
    buyPrice: pA,
    sellPrice: pC,
    grossPct,
    netPct,
    safetyFactor: grossPct > 0 ? netPct / grossPct : 0,
    direction,
    isPerp: false,
    legs: [tri.a, tri.b, tri.c],
    executionPlan,
    crossPrice: pB,
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

// ── Dynamic triangular route generation ──────────────────────────────────────

/**
 * Dynamically generates triangular arbitrage routes from a price book.
 * Instead of relying on the 19 hardcoded routes, this scans all available
 * symbols and generates every possible USDT→X→Y→USDT path where all three
 * pairs exist in the price book.
 *
 * @param {object} prices - map of symbol → price, e.g. { BTCUSDT: 65000, ETHBTC: 0.052, ... }
 * @returns {Array} dynamic triangle definitions [{a, b, c, route}]
 */
export function generateDynamicTriangles(prices) {
  if (!prices || typeof prices !== 'object') return TRIANGLES;

  const symbols = Object.keys(prices).filter(k => {
    const p = prices[k];
    return p > 0 && Number.isFinite(p);
  });

  // Extract base/quote pairs ending in USDT
  const usdtPairs = {};
  const crossPairs = {};

  for (const sym of symbols) {
    if (sym.endsWith('USDT') && sym.length > 5) {
      const base = sym.slice(0, -4); // e.g. BTC from BTCUSDT
      usdtPairs[base] = prices[sym];
    } else if (sym.length >= 5) {
      // Try to extract base and quote from non-USDT pairs
      const QUOTES = ['BTC', 'ETH', 'BNB', 'USDT'];
      for (const q of QUOTES.sort((a, b) => b.length - a.length)) {
        if (sym.endsWith(q) && sym.length > q.length) {
          const b = sym.slice(0, -q.length);
          if (b.length >= 2) {
            crossPairs[sym] = { base: b, quote: q, price: prices[sym] };
            break;
          }
        }
      }
    }
  }

  // Generate all possible triangles: A→B→C→A
  const dynamicTriangles = [];
  const bases = Object.keys(usdtPairs);

  for (const a of bases) {
    for (const c of bases) {
      if (a === c) continue;
      // Look for cross pair: C/A (e.g. ETHBTC means 1 ETH = X BTC)
      const crossKey = `${c}${a}`;
      if (crossPairs[crossKey]) {
        const route = `USDT→${a}→${c}→USDT`;
        dynamicTriangles.push({
          a: `${a}USDT`,
          b: crossKey,
          c: `${c}USDT`,
          route,
        });
      }
    }
  }

  // If dynamic generation produced results, use those; otherwise fall back to hardcoded
  return dynamicTriangles.length > 0 ? dynamicTriangles : TRIANGLES;
}

/**
 * Scans dynamic triangular routes for a given exchange.
 * @param {string} exchange - exchange identifier
 * @param {number} fee - taker fee per leg
 * @param {object} prices - map of symbol → price
 * @returns {object|null} best triangular opportunity or null
 */
export function scanTriangularDynamic(exchange, fee, prices) {
  if (!prices || typeof prices !== 'object') return null;

  const triangles = generateDynamicTriangles(prices);
  let best = null;

  for (const tri of triangles) {
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
