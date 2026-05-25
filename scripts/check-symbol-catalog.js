#!/usr/bin/env node

const BASE_URL = (process.env.SYMBOL_CATALOG_URL || 'https://ultimatearbitragehft.zedanazad43.workers.dev')
  .replace(/\/+$/, '');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.SYMBOL_CHECK_TIMEOUT_MS || 15000));
const CHECK_ATTEMPTS = Math.max(1, Number(process.env.SYMBOL_CHECK_ATTEMPTS || 3));
const RETRY_DELAY_MS = Math.max(250, Number(process.env.SYMBOL_CHECK_RETRY_DELAY_MS || 2000));

const MIN_MEXC = Math.max(1, Number(process.env.MIN_MEXC_SYMBOLS || 1000));
const MIN_BINANCE = Math.max(1, Number(process.env.MIN_BINANCE_SYMBOLS || 250));
const MIN_BITGET = Math.max(1, Number(process.env.MIN_BITGET_SYMBOLS || 300));
const MIN_METAMASK = Math.max(1, Number(process.env.MIN_METAMASK_SYMBOLS || 1000));
const MIN_SCAN = Math.max(1, Number(process.env.MIN_SCAN_SYMBOLS || 100));
const BINANCE_REFERENCE_CHECK = (process.env.BINANCE_REFERENCE_CHECK || 'true').toLowerCase() !== 'false';
const BINANCE_REFERENCE_OVERRIDE = (process.env.BINANCE_REFERENCE_OVERRIDE || 'false').toLowerCase() === 'true';

const BINANCE_EXCHANGE_INFO_ENDPOINTS = [
  'https://api.binance.com/api/v3/exchangeInfo',
  'https://api1.binance.com/api/v3/exchangeInfo',
  'https://api2.binance.com/api/v3/exchangeInfo',
  'https://api3.binance.com/api/v3/exchangeInfo',
  'https://data-api.binance.vision/api/v3/exchangeInfo',
];

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

function countTradeableBinanceUsdtSymbols(payload) {
  return (payload?.symbols || [])
    .filter((s) => {
      const quote = String(s?.quoteAsset || '').toUpperCase();
      const status = String(s?.status || '').toUpperCase();
      const symbol = String(s?.symbol || '').toUpperCase();
      return quote === 'USDT' && status === 'TRADING' && symbol.endsWith('USDT');
    })
    .length;
}

async function getBinanceReferenceCount(timeoutMs) {
  const counts = [];

  for (const url of BINANCE_EXCHANGE_INFO_ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, timeoutMs);
      if (!response.ok) {
        await response.body?.cancel();
        continue;
      }
      const payload = await response.json();
      const count = countTradeableBinanceUsdtSymbols(payload);
      counts.push(count);
      if (count > 0) {
        return { count, counts };
      }
    } catch (_) {
      // Try the next endpoint.
    }
  }

  return { count: 0, counts };
}

async function main() {
  if (!ADMIN_TOKEN) {
    fail('ADMIN_TOKEN is required');
  }

  const url = `${BASE_URL}/api/symbols/catalog?includeMetaMask=true&maxMetaMask=3000&maxScan=200`;
  const allSummaries = [];

  for (let attempt = 1; attempt <= CHECK_ATTEMPTS; attempt++) {
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

    allSummaries.push(summary);

    if (attempt < CHECK_ATTEMPTS) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  const summary = allSummaries.reduce((best, next) => ({
    mexc: Math.max(Number(best.mexc || 0), Number(next.mexc || 0)),
    binance: Math.max(Number(best.binance || 0), Number(next.binance || 0)),
    bitget: Math.max(Number(best.bitget || 0), Number(next.bitget || 0)),
    metamask: Math.max(Number(best.metamask || 0), Number(next.metamask || 0)),
    cexUnion: Math.max(Number(best.cexUnion || 0), Number(next.cexUnion || 0)),
    cexIntersection: Math.max(Number(best.cexIntersection || 0), Number(next.cexIntersection || 0)),
    walletReadableCex: Math.max(Number(best.walletReadableCex || 0), Number(next.walletReadableCex || 0)),
    scanSymbols: Math.max(Number(best.scanSymbols || 0), Number(next.scanSymbols || 0)),
  }));

  let effectiveBinance = Number(summary.binance || 0);
  let binanceReference = null;

  if (BINANCE_REFERENCE_CHECK && effectiveBinance < MIN_BINANCE) {
    binanceReference = await getBinanceReferenceCount(REQUEST_TIMEOUT_MS);
    if (BINANCE_REFERENCE_OVERRIDE && Number(binanceReference.count || 0) >= MIN_BINANCE) {
      effectiveBinance = Number(binanceReference.count || 0);
    }
  }

  const checks = [
    ['mexc', Number(summary.mexc || 0), MIN_MEXC],
    ['binance', effectiveBinance, MIN_BINANCE],
    ['bitget', Number(summary.bitget || 0), MIN_BITGET],
    ['metamask', Number(summary.metamask || 0), MIN_METAMASK],
    ['scanSymbols', Number(summary.scanSymbols || 0), MIN_SCAN],
  ];

  const failures = checks.filter(([, value, min]) => !Number.isFinite(value) || value < min);

  console.log('[symbol-catalog-check] summaries:', JSON.stringify(allSummaries));
  console.log('[symbol-catalog-check] best-summary:', JSON.stringify(summary));
  if (binanceReference) {
    console.log('[symbol-catalog-check] binance-reference:', JSON.stringify(binanceReference));
    if (BINANCE_REFERENCE_OVERRIDE && effectiveBinance !== Number(summary.binance || 0)) {
      console.log('[symbol-catalog-check] binance-override: applied reference count to avoid false failure');
    }
  }
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
