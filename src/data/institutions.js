// src/data/institutions.js — Institutional holdings: SEC 13F analysis
// Uses SEC EDGAR XBRL API (free, no API key required).

import { tickerToCIK, getCompanyFacts } from './fundamentals.js';

const EDGAR_BASE = 'https://data.sec.gov';
const EDGAR_SUBMISSIONS = `${EDGAR_BASE}/submissions`;

/**
 * Fetches the list of 13F filings for a given CIK (an institutional manager).
 * @param {string} cik  — manager's CIK (padded)
 * @returns {Promise<Array<{ accession, filed, quarter }>>}
 */
export async function get13FFilings(cik) {
  try {
    const url = `${EDGAR_SUBMISSIONS}/CIK${cik}.json`;
    const res = await fetch(url, { headers: { 'User-Agent': 'UltimateArbitrageHFT/1.0' } });
    if (!res.ok) return [];
    const data = await res.json();
    const filings = data?.filings?.recent;
    if (!filings) return [];
    const out = [];
    const n = (filings.accessionNumber || []).length;
    for (let i = 0; i < n; i++) {
      if ((filings.form[i] || '').toUpperCase() === '13F-HR') {
        out.push({
          accession: filings.accessionNumber[i],
          filed:     filings.filingDate[i],
          quarter:   filings.reportDate?.[i] ?? null
        });
      }
    }
    return out.sort((a, b) => (b.filed > a.filed ? 1 : -1));
  } catch { return []; }
}

/**
 * Fetches the actual 13F-HR XML from EDGAR for a specific accession number.
 * Returns parsed holdings array.
 *
 * @param {string} cik
 * @param {string} accession  — e.g. '0001234567-23-000001'
 * @returns {Promise<Array<{ name, cusip, value, shares, type }>>}
 */
export async function fetch13FHoldings(cik, accession) {
  try {
    const acc = accession.replace(/-/g, '');
    const indexUrl = `${EDGAR_BASE}/Archives/edgar/data/${parseInt(cik)}/` +
                     `${acc}/${accession}-index.htm`;
    const indexRes = await fetch(indexUrl, { headers: { 'User-Agent': 'UltimateArbitrageHFT/1.0' } });
    if (!indexRes.ok) return [];
    const html   = await indexRes.text();

    // Find the infotable XML document link
    const match = html.match(/href="([^"]+infotable[^"]*\.xml)"/i);
    if (!match) return [];

    const xmlUrl = `${EDGAR_BASE}${match[1].startsWith('/') ? '' : '/Archives/edgar/data/'+parseInt(cik)+'/'+acc+'/'}${match[1]}`;
    const xmlRes = await fetch(xmlUrl, { headers: { 'User-Agent': 'UltimateArbitrageHFT/1.0' } });
    if (!xmlRes.ok) return [];
    const xml = await xmlRes.text();

    return parse13FXml(xml);
  } catch { return []; }
}

/**
 * Parses 13F-HR infotable XML into holdings array.
 * @param {string} xml
 * @returns {Array<{ name, cusip, value, shares, type }>}
 */
function parse13FXml(xml) {
  const holdings = [];
  // Match each <infoTable> block
  const blocks = xml.match(/<infoTable>([\s\S]*?)<\/infoTable>/gi) || [];
  for (const block of blocks) {
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'));
      return m ? m[1].trim() : '';
    };
    const value  = parseFloat(get('value')   || '0');
    const shares = parseFloat(get('sshPrnamt') || get('sshPrnamtAmt') || '0');
    holdings.push({
      name:   get('nameOfIssuer'),
      cusip:  get('cusip'),
      value:  value * 1000, // values in 13F are in $thousands
      shares,
      type:   get('titleOfClass') || get('putCall') || 'COM'
    });
  }
  return holdings.sort((a, b) => b.value - a.value);
}

/**
 * Computes quarter-over-quarter position diffs for a manager.
 *
 * @param {Array} currentQ   — holdings from current quarter
 * @param {Array} prevQ      — holdings from previous quarter
 * @returns {Array<{ cusip, name, action, valueChange, sharesChange, currentValue, prevValue }>}
 */
export function computePositionDiffs(currentQ, prevQ) {
  const prevMap = new Map(prevQ.map(h => [h.cusip, h]));
  const currMap = new Map(currentQ.map(h => [h.cusip, h]));
  const diffs = [];

  // Check current holdings vs previous
  for (const [cusip, curr] of currMap) {
    const prev = prevMap.get(cusip);
    if (!prev) {
      diffs.push({ cusip, name: curr.name, action: 'new', valueChange: curr.value, sharesChange: curr.shares, currentValue: curr.value, prevValue: 0 });
    } else {
      const dv = curr.value - prev.value;
      const ds = curr.shares - prev.shares;
      if (Math.abs(dv) > 1000) { // ignore < $1k noise
        diffs.push({
          cusip, name: curr.name,
          action:       dv > 0 ? 'increased' : 'reduced',
          valueChange:  dv,
          sharesChange: ds,
          currentValue: curr.value,
          prevValue:    prev.value,
          pctChange:    prev.value > 0 ? (dv / prev.value) * 100 : 0
        });
      }
    }
  }

  // Positions fully exited
  for (const [cusip, prev] of prevMap) {
    if (!currMap.has(cusip)) {
      diffs.push({ cusip, name: prev.name, action: 'exited', valueChange: -prev.value, sharesChange: -prev.shares, currentValue: 0, prevValue: prev.value });
    }
  }

  return diffs.sort((a, b) => Math.abs(b.valueChange) - Math.abs(a.valueChange));
}

/**
 * High-level: get institutional holdings summary with QoQ diffs.
 * @param {string} managerCIK   — CIK of the institutional manager (e.g. Berkshire Hathaway)
 * @returns {Promise<{ ok, cik, latest, previous, diffs }>}
 */
export async function getInstitutionalHoldings(managerCIK) {
  const cik = String(managerCIK).padStart(10, '0');
  const filings = await get13FFilings(cik);
  if (filings.length === 0) return { ok: false, cik, error: 'No 13F filings found' };

  const [latestFiling, prevFiling] = filings;
  const [latest, previous] = await Promise.all([
    fetch13FHoldings(cik, latestFiling.accession),
    prevFiling ? fetch13FHoldings(cik, prevFiling.accession) : Promise.resolve([])
  ]);

  const diffs = computePositionDiffs(latest, previous);

  return {
    ok: true,
    cik,
    latest_quarter:   latestFiling.quarter,
    previous_quarter: prevFiling?.quarter ?? null,
    holdings_count:   latest.length,
    total_value_usd:  latest.reduce((s, h) => s + h.value, 0),
    latest:           latest.slice(0, 50),  // top 50 positions
    diffs:            diffs.slice(0, 30)    // top 30 changes
  };
}
