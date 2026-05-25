#!/usr/bin/env node

const BASE_URL = (process.env.SYMBOL_CATALOG_URL || 'https://ultimatearbitragehft.zedanazad43.workers.dev')
  .replace(/\/+$/, '');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.SYMBOL_CHECK_TIMEOUT_MS || 15000));

const MIN_MEXC = Math.max(1, Number(process.env.MIN_MEXC_SYMBOLS || 1000));
const MIN_BINANCE = Math.max(1, Number(process.env.MIN_BINANCE_SYMBOLS || 250));
const MIN_BITGET = Math.max(1, Number(process.env.MIN_BITGET_SYMBOLS || 300));
const MIN_METAMASK = Math.max(1, Number(process.env.MIN_METAMASK_SYMBOLS || 1000));
const MIN_SCAN = Math.max(1, Number(process.env.MIN_SCAN_SYMBOLS || 100));

function fail(message, details) {
  console.error(`[symbol-catalog-check] ${message}`);
  if (details) console.error(details);
  process.exit(1);
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new globalThis.AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

async function main() {
  if (!ADMIN_TOKEN) {
    fail('ADMIN_TOKEN is required');
  }

  const url = `${BASE_URL}/api/symbols/catalog?includeMetaMask=true&maxMetaMask=3000&maxScan=200`;
  const response = await fetchWithTimeout(url, {
    headers: {
      'x-admin-token': ADMIN_TOKEN,
      Accept: 'application/json',
    },
  }, REQUEST_TIMEOUT_MS);

  if (!response.ok) {
    const body = await response.text();
    fail(`HTTP ${response.status} from symbol catalog endpoint`, body.slice(0, 500));
  }

  const payload = await response.json();
  const summary = payload?.summary;
  if (!summary) {
    fail('Missing summary object in response');
  }

  const checks = [
    ['mexc', Number(summary.mexc || 0), MIN_MEXC],
    ['binance', Number(summary.binance || 0), MIN_BINANCE],
    ['bitget', Number(summary.bitget || 0), MIN_BITGET],
    ['metamask', Number(summary.metamask || 0), MIN_METAMASK],
    ['scanSymbols', Number(summary.scanSymbols || 0), MIN_SCAN],
  ];

  const failures = checks.filter(([, value, min]) => !Number.isFinite(value) || value < min);

  console.log('[symbol-catalog-check] summary:', JSON.stringify(summary));
  console.log('[symbol-catalog-check] thresholds:', JSON.stringify({
    mexc: MIN_MEXC,
    binance: MIN_BINANCE,
    bitget: MIN_BITGET,
    metamask: MIN_METAMASK,
    scanSymbols: MIN_SCAN,
  }));

  if (failures.length > 0) {
    const msg = failures
      .map(([name, value, min]) => `${name}: got ${value}, expected >= ${min}`)
      .join(' | ');
    fail(`Threshold check failed: ${msg}`);
  }

  console.log('[symbol-catalog-check] OK');
}

main().catch((error) => {
  fail(error?.message || 'Unknown error');
});
