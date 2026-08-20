// src/data/etf.js — ETF constituents lookup (Yahoo Finance / iShares free APIs)
// No API key required for Yahoo Finance quote data.

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v1/finance';
const ISHARES_BASE = 'https://www.ishares.com/us/products';

/**
 * Fetch ETF quote summary from Yahoo Finance.
 * @param {string} symbol   — e.g. 'SPY', 'QQQ', 'XIC.TO'
 * @returns {Promise<object|null>}
 */
export async function getETFQuote(symbol) {
  try {
    const url = `${YAHOO_BASE}/quoteSummary/${encodeURIComponent(symbol)}?modules=price,summaryProfile,topHoldings`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'UltimateArbitrageHFT/1.0' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.quoteSummary?.result?.[0] ?? null;
  } catch { return null; }
}

/**
 * Fetch top ETF holdings from Yahoo Finance topHoldings module.
 * Returns up to 25 holdings with symbol, name, and weight.
 *
 * @param {string} symbol
 * @returns {Promise<{ symbol, holdings: Array<{ symbol, name, weight }>, error?: string }>}
 */
export async function getETFHoldings(symbol) {
  try {
    const url = `${YAHOO_BASE}/quoteSummary/${encodeURIComponent(symbol)}?modules=topHoldings`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'UltimateArbitrageHFT/1.0' }
    });
    if (!res.ok) return { symbol, holdings: [], error: `HTTP ${res.status}` };
    const data = await res.json();
    const raw = data?.quoteSummary?.result?.[0]?.topHoldings?.holdings ?? [];
    const holdings = raw.map(h => ({
      symbol: h.symbol,
      name:   h.holdingName,
      weight: h.holdingPercent?.raw ?? 0
    }));
    return { symbol, holdings };
  } catch (e) {
    return { symbol, holdings: [], error: e.message };
  }
}

/**
 * Detect the settlement currency of an ETF/equity symbol.
 * Rules:
 *   - .TO / .V  → CAD
 *   - .HK       → HKD
 *   - .L / .LON → GBP
 *   - .PA / .AMS / .F → EUR
 *   - .T (Tokyo) → JPY
 *   - default   → USD
 *
 * @param {string} symbol
 * @returns {string} ISO 4217 currency code
 */
export function detectCurrency(symbol) {
  if (!symbol) return 'USD';
  const upper = symbol.toUpperCase();
  if (upper.endsWith('.TO') || upper.endsWith('.V'))  return 'CAD';
  if (upper.endsWith('.HK'))                           return 'HKD';
  if (upper.endsWith('.L') || upper.endsWith('.LON')) return 'GBP';
  if (upper.endsWith('.PA') || upper.endsWith('.AMS') || upper.endsWith('.F')) return 'EUR';
  if (upper.endsWith('.T'))                            return 'JPY';
  return 'USD';
}

/**
 * ETF look-through: resolve constituents for a list of ETF symbols.
 * Returns a merged, deduplicated list of underlying equities with weights.
 *
 * @param {string[]} etfSymbols
 * @returns {Promise<Array<{ symbol, name, weight, source }>>}
 */
export async function etfLookThrough(etfSymbols) {
  const results = await Promise.allSettled(
    etfSymbols.map(sym => getETFHoldings(sym))
  );

  const consolidated = new Map();

  results.forEach((r, idx) => {
    if (r.status !== 'fulfilled') return;
    const { holdings } = r.value;
    const etfSym = etfSymbols[idx];
    for (const h of holdings) {
      if (!h.symbol) continue;
      const key = h.symbol.toUpperCase();
      if (consolidated.has(key)) {
        consolidated.get(key).weight += h.weight;
      } else {
        consolidated.set(key, { symbol: h.symbol, name: h.name, weight: h.weight, source: etfSym });
      }
    }
  });

  return [...consolidated.values()].sort((a, b) => b.weight - a.weight);
}

/**
 * Classify a mixed-currency portfolio: group positions by settlement currency.
 * Refuses mixed-currency aggregation (returns groups, not a combined total).
 *
 * @param {Array<{ symbol: string, value: number }>} positions
 * @returns {object} keyed by currency, each value is { positions, totalValue }
 */
export function splitByCurrency(positions) {
  const groups = {};
  for (const pos of positions) {
    const currency = detectCurrency(pos.symbol);
    if (!groups[currency]) groups[currency] = { positions: [], totalValue: 0 };
    groups[currency].positions.push(pos);
    groups[currency].totalValue += pos.value;
  }
  return groups;
}
