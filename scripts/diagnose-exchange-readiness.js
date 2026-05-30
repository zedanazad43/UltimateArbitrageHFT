#!/usr/bin/env node

const BASE_URL = process.env.BASE_URL || 'https://ultimatearbitragehft.zedanazad43.workers.dev';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

const REQUIRED_KEYS = {
  mexc: ['MEXC_API_KEY', 'MEXC_API_SECRET'],
  binance: ['BINANCE_API_KEY', 'BINANCE_API_SECRET'],
  kucoin: ['KUCOIN_API_KEY', 'KUCOIN_SECRET_KEY', 'KUCOIN_PASSPHRASE'],
  okx: ['OKX_API_KEY', 'OKX_API_SECRET', 'OKX_PASSPHRASE'],
  bitget: ['BITGET_API_KEY', 'BITGET_SECRET_KEY', 'BITGET_API_PASSPHRASE'],
  bitmart: ['BITMART_API_KEY', 'BITMART_SECRET_KEY', 'BITMART_MEMO'],
  htx: ['HTX_API_KEY', 'HTX_API_SECRET'],
};

function authHeaders() {
  if (!ADMIN_TOKEN) return {};
  return { 'x-admin-token': ADMIN_TOKEN };
}

async function getJson(path) {
  const url = `${BASE_URL}${path}`;
  const resp = await fetch(url, { headers: authHeaders() });
  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${path}: non-JSON response (HTTP ${resp.status})`);
  }
  if (!resp.ok) {
    throw new Error(`${path}: HTTP ${resp.status} ${json?.error || json?.message || text}`);
  }
  return json;
}

function statusLabel(ok) {
  return ok ? 'OK' : 'FIX';
}

function normalizeError(err) {
  return String(err || '').trim() || null;
}

function guidanceForError(exchange, err) {
  if (!err) return 'No action needed.';
  const e = err.toLowerCase();
  if (e.includes('format invalid') || e.includes('invalid') || e.includes('not exists') || e.includes('api key')) {
    return `Regenerate ${exchange.toUpperCase()} API credentials, verify key/secret/passphrase mapping, and re-upload worker secrets.`;
  }
  if (e.includes('recv-window') || e.includes('timestamp') || e.includes('signature')) {
    return `Check ${exchange.toUpperCase()} signing inputs (timestamp/recv-window/signature) and exchange account API permissions.`;
  }
  return `Review ${exchange.toUpperCase()} API credentials and permissions; then test balance endpoint again.`;
}

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  if (!ADMIN_TOKEN) {
    console.error('ADMIN_TOKEN is required. Example: ADMIN_TOKEN=xxxx node scripts/diagnose-exchange-readiness.js');
    process.exit(1);
  }

  const [balances, platforms, status, perps, dex] = await Promise.all([
    getJson('/api/balances'),
    getJson('/api/platforms'),
    getJson('/api/status'),
    getJson('/api/perps'),
    getJson('/api/dex'),
  ]);

  printSection('Global Strategy Runtime');
  console.log(`trading_enabled      : ${status.trading_enabled}`);
  console.log(`paper_trading        : ${status.paper_trading}`);
  console.log(`multi_strategy_live  : ${status.multi_strategy_live}`);
  const enabledExecutionExchanges = Array.isArray(status.enabledExecutionExchanges)
    ? status.enabledExecutionExchanges
    : [];
  console.log(`execution_exchanges  : ${enabledExecutionExchanges.length ? enabledExecutionExchanges.join(', ') : 'default'}`);
  const flags = status.strategy_flags || {};
  for (const key of ['cex', 'dex', 'perps', 'funding', 'triangular', 'statistical']) {
    console.log(`strategy_${key.padEnd(11, ' ')}: ${flags[key] !== false}`);
  }

  printSection('Exchange Readiness');
  const rows = Array.isArray(balances?.data) ? balances.data : [];
  for (const row of rows) {
    const exchange = row.exchange;
    const isDataOnly = !!row.dataOnly;
    const configured = !!row.configured;
    const missing = row.missing_keys || [];
    const balance = row.balance;
    const err = normalizeError(row.error);
    const required = REQUIRED_KEYS[exchange] || [];

    const ready = isDataOnly || (configured && !err);
    console.log(`\n[${statusLabel(ready)}] ${exchange.toUpperCase()}`);
    console.log(`configured : ${configured}`);
    if (required.length) console.log(`required   : ${required.join(', ')}`);
    if (missing.length) console.log(`missing    : ${missing.join(', ')}`);
    console.log(`balance    : ${balance === null ? 'n/a' : balance}`);
    if (isDataOnly) {
      console.log('mode       : data-only feed');
    }
    if (err) {
      console.log(`error      : ${err}`);
      console.log(`action     : ${guidanceForError(exchange, err)}`);
    }
  }

  printSection('Platform Cards (dashboard source)');
  for (const p of (platforms.platforms || [])) {
    const ready = p.dataOnly
      ? true
      : (p.type === 'web3' ? dex.executionReady : (!p.error && p.configured));
    console.log(`[${statusLabel(ready)}] ${p.name.toUpperCase()} | configured=${p.configured} | balance=${p.balance} | error=${p.error || 'none'}`);
  }

  printSection('Perps + DEX Execution');
  console.log(`perpsEnabled         : ${perps.perpsEnabled}`);
  console.log(`mexcFuturesConfigured: ${perps.mexcFuturesConfigured}`);
  console.log(`hftEngineConfigured  : ${dex.hftEngineConfigured}`);
  console.log(`dexExecutionReady    : ${dex.executionReady}`);
  console.log(`dexExecutionNote     : ${dex.executionNote}`);

  printSection('Priority Fix Order');
  const priority = [
    'mexc',
    'binance',
    'bitget',
    'kucoin',
    'okx',
    'bitmart',
    'htx',
  ];
  priority.forEach((ex, i) => {
    const found = rows.find(r => r.exchange === ex);
    if (!found) {
      console.log(`${i + 1}. [SKIP] ${ex.toUpperCase()} -> excluded by execution allowlist`);
      return;
    }
    const err = normalizeError(found?.error);
    const pending = (!found?.configured) || !!err;
    const state = pending ? 'FIX' : 'OK';
    console.log(`${i + 1}. [${state}] ${ex.toUpperCase()}${err ? ` -> ${err}` : ''}`);
  });
  const dexState = dex.executionReady ? 'OK' : 'FIX';
  console.log(`8. [${dexState}] DEX/HFT_ENGINE${dex.executionReady ? '' : ' -> set HFT_ENGINE_URL + HFT_ENGINE_SECRET'}`);
}

main().catch((err) => {
  console.error('diagnose-exchange-readiness failed:', err.message);
  process.exit(1);
});
