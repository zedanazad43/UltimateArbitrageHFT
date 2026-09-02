// src/data/fundamentals.js — SEC EDGAR fundamentals: 10-Q / 10-K via free public API
// Uses https://data.sec.gov (no API key required).

const EDGAR_BASE = 'https://data.sec.gov';
const EDGAR_COMPANY_FACTS = `${EDGAR_BASE}/api/xbrl/companyfacts`;
const EDGAR_COMPANY_CONCEPT = `${EDGAR_BASE}/api/xbrl/companyconcept`;
const EDGAR_SUBMISSIONS = `${EDGAR_BASE}/submissions`;
const SEARCH_BASE = 'https://efts.sec.gov/LATEST/search-index';

/**
 * Pads CIK to 10 digits as EDGAR requires.
 */
function padCIK(cik) {
  return String(cik).padStart(10, '0');
}

/**
 * Resolves a ticker symbol to a CIK number using EDGAR's ticker map.
 * @param {string} ticker  — e.g. 'AAPL'
 * @returns {Promise<string|null>} CIK string or null
 */
export async function tickerToCIK(ticker) {
  try {
    const url = `${EDGAR_BASE}/files/company_tickers.json`;
    const res = await fetch(url, { headers: { 'User-Agent': 'UltimateArbitrageHFT/1.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    const upper = ticker.toUpperCase();
    for (const entry of Object.values(data)) {
      if (entry.ticker === upper) return padCIK(entry.cik_str);
    }
    return null;
  } catch { return null; }
}

/**
 * Fetches all XBRL company facts for a given CIK.
 * Returns the full fact set (us-gaap, dei, ifrs-full namespaces).
 * @param {string} cik
 * @returns {Promise<object|null>}
 */
export async function getCompanyFacts(cik) {
  try {
    const url = `${EDGAR_COMPANY_FACTS}/CIK${padCIK(cik)}.json`;
    const res = await fetch(url, { headers: { 'User-Agent': 'UltimateArbitrageHFT/1.0' } });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

/**
 * Fetches a specific XBRL concept (e.g. 'Revenues') for a company.
 * @param {string} cik
 * @param {string} taxonomy   — 'us-gaap' | 'dei' | 'ifrs-full'
 * @param {string} concept    — e.g. 'Revenues', 'NetIncomeLoss'
 * @returns {Promise<object|null>}
 */
export async function getConceptData(cik, taxonomy, concept) {
  try {
    const url = `${EDGAR_COMPANY_CONCEPT}/CIK${padCIK(cik)}/${taxonomy}/${concept}.json`;
    const res = await fetch(url, { headers: { 'User-Agent': 'UltimateArbitrageHFT/1.0' } });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

/**
 * Extracts annual or quarterly filing periods from XBRL concept data.
 *
 * IMPORTANT (Vibe-Trading fix): Each (start, end) span is unique per period.
 * A 10-Q files both the true quarter AND the year-to-date frame under the same
 * end date. We key on (accn, start, end) to avoid duplicates.
 *
 * @param {object} conceptData — result from getConceptData()
 * @param {'annual'|'quarterly'|'all'} period
 * @returns {Array<{ filed, start, end, val, form, frame }>}
 */
export function extractPeriods(conceptData, period = 'annual') {
  const units = conceptData?.units;
  if (!units) return [];

  const rows = [];
  for (const unitType of Object.values(units)) {
    for (const item of (Array.isArray(unitType) ? unitType : [])) {
      if (!item.val || !item.end) continue;
      const form = (item.form || '').toUpperCase();
      if (period === 'annual'    && !form.includes('10-K')) continue;
      if (period === 'quarterly' && !form.includes('10-Q')) continue;
      rows.push({
        filed: item.filed,
        start: item.start,
        end:   item.end,
        val:   item.val,
        form,
        accn:  item.accn,
        frame: item.frame
      });
    }
  }

  // Deduplicate by (accn, start, end) — prevents quarterly 10-Q vs YTD ambiguity
  const seen = new Set();
  return rows.filter(r => {
    const key = `${r.accn}|${r.start}|${r.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => (a.end > b.end ? -1 : 1));
}

/**
 * High-level: get income statement fundamentals for a ticker.
 * Returns Revenues, NetIncomeLoss, OperatingIncomeLoss, EPS.
 *
 * @param {string} ticker  — e.g. 'AAPL'
 * @param {'annual'|'quarterly'} period
 * @returns {Promise<{ ok: boolean, ticker, cik, revenues, netIncome, operatingIncome, eps }>}
 */
export async function getFundamentals(ticker, period = 'annual') {
  const cik = await tickerToCIK(ticker);
  if (!cik) return { ok: false, ticker, error: 'CIK not found' };

  const concepts = ['Revenues', 'NetIncomeLoss', 'OperatingIncomeLoss',
                    'EarningsPerShareBasic', 'Assets', 'StockholdersEquity'];

  const results = await Promise.allSettled(
    concepts.map(c => getConceptData(cik, 'us-gaap', c))
  );

  const extract = (data) => extractPeriods(data, period).slice(0, 8);
  const [revenues, netIncome, operatingIncome, eps, assets, equity] =
    results.map(r => (r.status === 'fulfilled' && r.value ? extract(r.value) : []));

  const hasData = revenues.length > 0 || netIncome.length > 0;

  return {
    ok: hasData,
    ticker,
    cik,
    period,
    revenues:         revenues.map(r => ({ date: r.end, value: r.val, form: r.form })),
    net_income:       netIncome.map(r => ({ date: r.end, value: r.val, form: r.form })),
    operating_income: operatingIncome.map(r => ({ date: r.end, value: r.val, form: r.form })),
    eps:              eps.map(r => ({ date: r.end, value: r.val, form: r.form })),
    assets:           assets.map(r => ({ date: r.end, value: r.val, form: r.form })),
    equity:           equity.map(r => ({ date: r.end, value: r.val, form: r.form }))
  };
}

/**
 * Get recent SEC filings (10-K, 10-Q, 8-K) for a ticker.
 * @param {string} ticker
 * @param {number} limit
 * @returns {Promise<Array>}
 */
export async function getRecentFilings(ticker, limit = 10) {
  const cik = await tickerToCIK(ticker);
  if (!cik) return [];
  try {
    const url = `${EDGAR_SUBMISSIONS}/CIK${padCIK(cik)}.json`;
    const res = await fetch(url, { headers: { 'User-Agent': 'UltimateArbitrageHFT/1.0' } });
    if (!res.ok) return [];
    const data = await res.json();
    const filings = data?.filings?.recent;
    if (!filings) return [];
    const n = Math.min(limit, (filings.accessionNumber || []).length);
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({
        accession:   filings.accessionNumber[i],
        form:        filings.form[i],
        filed:       filings.filingDate[i],
        description: filings.primaryDocument[i]
      });
    }
    return out;
  } catch { return []; }
}
