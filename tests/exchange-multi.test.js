// tests/exchange-multi.test.js — Tests for Binance, KuCoin, Bitget, Bitmart
// exchange functions plus the exchange dispatcher helpers in src/exchange.js.
// Run with: node --test tests/exchange-multi.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  getBinanceBalance, placeMarketOrderBinance,
  getKuCoinBalance, placeMarketOrderKuCoin,
  getBitgetBalance, placeMarketOrderBitget,
  getBitmartBalance, placeMarketOrderBitmart,
  hasExchangeCredentials,
  getRequiredCredentialKeys,
  getMissingCredentialKeys,
  getExchangeBalance,
  placeExchangeMarketOrder
} from '../src/exchange.js';

// ── Mock fetch helpers ────────────────────────────────────────────────────────

let capturedRequests = [];

function installMockFetch(handler) {
  capturedRequests = [];
  globalThis.fetch = async (url, init) => {
    const req = { url, ...init };
    capturedRequests.push(req);
    return handler(req);
  };
}

function makeJsonResponse(body, ok = true) {
  const jsonText = JSON.stringify(body);
  return {
    ok,
    status: ok ? 200 : 400,
    json:   async () => body,
    text:   async () => jsonText,
    body: { cancel: async () => {} }
  };
}

/** Simulates an upstream that returns a non-JSON body (e.g. Cloudflare error page). */
function makeTextResponse(text, status = 400) {
  return {
    ok:     status >= 200 && status < 300,
    status,
    json:   async () => { throw new SyntaxError(`Unexpected token '${text[0] ?? '?'}'`); },
    text:   async () => text,
    body: { cancel: async () => {} }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// hasExchangeCredentials — pure synchronous function
// ─────────────────────────────────────────────────────────────────────────────

describe('hasExchangeCredentials', () => {
  test('returns false for an unknown exchange', () => {
    assert.equal(hasExchangeCredentials({ FOO_KEY: 'k' }, 'unknown'), false);
  });

  test('returns false when required keys are missing from env', () => {
    assert.equal(hasExchangeCredentials({ MEXC_API_KEY: 'k' }, 'mexc'), false);
  });

  test('returns true when all required keys are present for mexc', () => {
    const env = { MEXC_API_KEY: 'k', MEXC_API_SECRET: 's' };
    assert.equal(hasExchangeCredentials(env, 'mexc'), true);
  });

  test('returns true when all three required keys are present for kucoin', () => {
    const env = { KUCOIN_API_KEY: 'k', KUCOIN_SECRET_KEY: 's', KUCOIN_PASSPHRASE: 'p' };
    assert.equal(hasExchangeCredentials(env, 'kucoin'), true);
  });

  test('returns false when any of the three kucoin keys is missing', () => {
    const env = { KUCOIN_API_KEY: 'k', KUCOIN_SECRET_KEY: 's' }; // missing passphrase
    assert.equal(hasExchangeCredentials(env, 'kucoin'), false);
  });

  test('is case-insensitive for exchange name', () => {
    const env = { MEXC_API_KEY: 'k', MEXC_API_SECRET: 's' };
    assert.equal(hasExchangeCredentials(env, 'MEXC'), true);
  });

  test('returns false when env is empty', () => {
    assert.equal(hasExchangeCredentials({}, 'binance'), false);
  });

  test('returns true when KUCOIN_API_SECRET alias is used instead of KUCOIN_SECRET_KEY', () => {
    const env = { KUCOIN_API_KEY: 'k', KUCOIN_API_SECRET: 's', KUCOIN_PASSPHRASE: 'p' };
    assert.equal(hasExchangeCredentials(env, 'kucoin'), true);
  });

  test('returns true when BITGET_API_SECRET alias is used instead of BITGET_SECRET_KEY', () => {
    const env = { BITGET_API_KEY: 'k', BITGET_API_SECRET: 's', BITGET_API_PASSPHRASE: 'p' };
    assert.equal(hasExchangeCredentials(env, 'bitget'), true);
  });

  test('returns true when BITMART_API_SECRET alias is used instead of BITMART_SECRET_KEY', () => {
    const env = { BITMART_API_KEY: 'k', BITMART_API_SECRET: 's', BITMART_MEMO: 'm' };
    assert.equal(hasExchangeCredentials(env, 'bitmart'), true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getRequiredCredentialKeys — pure synchronous function
// ─────────────────────────────────────────────────────────────────────────────

describe('getRequiredCredentialKeys', () => {
  test('returns correct two-key list for mexc', () => {
    const keys = getRequiredCredentialKeys('mexc');
    assert.deepEqual(keys, ['MEXC_API_KEY', 'MEXC_API_SECRET']);
  });

  test('returns correct two-key list for binance', () => {
    const keys = getRequiredCredentialKeys('binance');
    assert.deepEqual(keys, ['BINANCE_API_KEY', 'BINANCE_API_SECRET']);
  });

  test('returns correct three-key list for kucoin', () => {
    const keys = getRequiredCredentialKeys('kucoin');
    assert.deepEqual(keys, ['KUCOIN_API_KEY', 'KUCOIN_SECRET_KEY', 'KUCOIN_PASSPHRASE']);
  });

  test('returns correct three-key list for bitget', () => {
    const keys = getRequiredCredentialKeys('bitget');
    assert.deepEqual(keys, ['BITGET_API_KEY', 'BITGET_SECRET_KEY', 'BITGET_API_PASSPHRASE']);
  });

  test('returns correct three-key list for bitmart', () => {
    const keys = getRequiredCredentialKeys('bitmart');
    assert.deepEqual(keys, ['BITMART_API_KEY', 'BITMART_SECRET_KEY', 'BITMART_MEMO']);
  });

  test('returns empty array for unknown exchange', () => {
    assert.deepEqual(getRequiredCredentialKeys('unknown'), []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getMissingCredentialKeys — alias-aware missing key reporting
// ─────────────────────────────────────────────────────────────────────────────

describe('getMissingCredentialKeys', () => {
  test('returns empty array when all canonical keys are present', () => {
    const env = { KUCOIN_API_KEY: 'k', KUCOIN_SECRET_KEY: 's', KUCOIN_PASSPHRASE: 'p' };
    assert.deepEqual(getMissingCredentialKeys(env, 'kucoin'), []);
  });

  test('returns empty array when alias key satisfies the canonical requirement', () => {
    const env = { KUCOIN_API_KEY: 'k', KUCOIN_API_SECRET: 's', KUCOIN_PASSPHRASE: 'p' };
    assert.deepEqual(getMissingCredentialKeys(env, 'kucoin'), []);
  });

  test('returns canonical key with alias hint when neither is set', () => {
    const env = { KUCOIN_API_KEY: 'k', KUCOIN_PASSPHRASE: 'p' };
    const missing = getMissingCredentialKeys(env, 'kucoin');
    assert.equal(missing.length, 1);
    assert.ok(missing[0].includes('KUCOIN_SECRET_KEY'), 'should mention canonical key');
    assert.ok(missing[0].includes('KUCOIN_API_SECRET'), 'should mention alias key');
  });

  test('returns canonical key (no alias) when a non-aliased key is missing', () => {
    const env = { KUCOIN_API_KEY: 'k', KUCOIN_SECRET_KEY: 's' };
    const missing = getMissingCredentialKeys(env, 'kucoin');
    assert.equal(missing.length, 1);
    assert.equal(missing[0], 'KUCOIN_PASSPHRASE');
  });

  test('returns empty array for bitget when BITGET_API_SECRET alias is set', () => {
    const env = { BITGET_API_KEY: 'k', BITGET_API_SECRET: 's', BITGET_API_PASSPHRASE: 'p' };
    assert.deepEqual(getMissingCredentialKeys(env, 'bitget'), []);
  });

  test('returns empty array for bitmart when BITMART_API_SECRET alias is set', () => {
    const env = { BITMART_API_KEY: 'k', BITMART_API_SECRET: 's', BITMART_MEMO: 'm' };
    assert.deepEqual(getMissingCredentialKeys(env, 'bitmart'), []);
  });

  test('returns empty array for unknown exchange', () => {
    assert.deepEqual(getMissingCredentialKeys({}, 'unknown'), []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getBinanceBalance
// ─────────────────────────────────────────────────────────────────────────────

describe('getBinanceBalance', () => {
  test('throws when BINANCE_API_KEY is missing', async () => {
    await assert.rejects(
      () => getBinanceBalance({ BINANCE_API_SECRET: 's' }),
      /BINANCE_API_KEY is not configured/
    );
  });

  test('throws when BINANCE_API_SECRET is missing', async () => {
    await assert.rejects(
      () => getBinanceBalance({ BINANCE_API_KEY: 'k' }),
      /BINANCE_API_SECRET is not configured/
    );
  });

  test('returns free and locked balance for the requested asset', async () => {
    installMockFetch(() => makeJsonResponse({
      balances: [
        { asset: 'USDT', free: '1200.50', locked: '100.00' },
        { asset: 'BTC',  free: '0.05',   locked: '0'      }
      ]
    }));
    const bal = await getBinanceBalance(
      { BINANCE_API_KEY: 'k', BINANCE_API_SECRET: 's' },
      'USDT'
    );
    assert.equal(bal.free,   1200.5);
    assert.equal(bal.locked, 100.0);
  });

  test('returns 0/0 when the asset is absent from balances', async () => {
    installMockFetch(() => makeJsonResponse({ balances: [] }));
    const bal = await getBinanceBalance(
      { BINANCE_API_KEY: 'k', BINANCE_API_SECRET: 's' },
      'USDT'
    );
    assert.equal(bal.free,   0);
    assert.equal(bal.locked, 0);
  });

  test('throws when API returns an error code', async () => {
    installMockFetch(() => makeJsonResponse({ code: -1100, msg: 'Illegal characters in parameter' }));
    await assert.rejects(
      () => getBinanceBalance({ BINANCE_API_KEY: 'k', BINANCE_API_SECRET: 's' }),
      /Illegal characters in parameter/
    );
  });

  test('sends request to Binance account endpoint with correct API key header', async () => {
    installMockFetch(() => makeJsonResponse({ balances: [] }));
    await getBinanceBalance({ BINANCE_API_KEY: 'mykey', BINANCE_API_SECRET: 'mysecret' });
    assert.equal(capturedRequests.length, 1);
    const req = capturedRequests[0];
    assert.ok(req.url.startsWith('https://api.binance.com/api/v3/account'));
    assert.ok(req.url.includes('signature='));
    assert.equal(req.headers['X-MBX-APIKEY'], 'mykey');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// placeMarketOrderBinance
// ─────────────────────────────────────────────────────────────────────────────

describe('placeMarketOrderBinance', () => {
  test('throws when BINANCE_API_KEY is missing', async () => {
    await assert.rejects(
      () => placeMarketOrderBinance({ BINANCE_API_SECRET: 's' }, 'BTCUSDT', 'BUY', '0.001', 100),
      /BINANCE_API_KEY is not configured/
    );
  });

  test('throws when BINANCE_API_SECRET is missing', async () => {
    await assert.rejects(
      () => placeMarketOrderBinance({ BINANCE_API_KEY: 'k' }, 'BTCUSDT', 'BUY', '0.001', 100),
      /BINANCE_API_SECRET is not configured/
    );
  });

  test('sends POST to Binance order endpoint', async () => {
    installMockFetch(() => makeJsonResponse({ orderId: 'b1', status: 'FILLED' }));
    const result = await placeMarketOrderBinance(
      { BINANCE_API_KEY: 'k', BINANCE_API_SECRET: 's' },
      'BTCUSDT', 'BUY', '0.001', 100
    );
    assert.equal(result.orderId, 'b1');
    assert.equal(capturedRequests.length, 1);
    const req = capturedRequests[0];
    assert.equal(req.url, 'https://api.binance.com/api/v3/order');
    assert.equal(req.method, 'POST');
    assert.equal(req.headers['X-MBX-APIKEY'], 'k');
  });

  test('BUY order body uses quoteOrderQty (USDT amount)', async () => {
    installMockFetch(() => makeJsonResponse({ orderId: 'b2' }));
    await placeMarketOrderBinance(
      { BINANCE_API_KEY: 'k', BINANCE_API_SECRET: 's' },
      'ETHUSDT', 'BUY', '0.5', 250
    );
    const body = new URLSearchParams(capturedRequests[0].body);
    assert.equal(body.get('quoteOrderQty'), '250.00', 'BUY should use quoteOrderQty');
    assert.equal(body.get('quantity'), null, 'BUY should not have quantity field');
  });

  test('SELL order body uses quantity (base asset amount)', async () => {
    installMockFetch(() => makeJsonResponse({ orderId: 'b3' }));
    await placeMarketOrderBinance(
      { BINANCE_API_KEY: 'k', BINANCE_API_SECRET: 's' },
      'ETHUSDT', 'SELL', '0.75', 300
    );
    const body = new URLSearchParams(capturedRequests[0].body);
    assert.equal(body.get('quantity'), '0.75', 'SELL should use quantity');
    assert.equal(body.get('quoteOrderQty'), null, 'SELL should not have quoteOrderQty field');
  });

  test('throws when API returns an error code', async () => {
    installMockFetch(() => makeJsonResponse({ code: -1121, msg: 'Invalid symbol.' }));
    await assert.rejects(
      () => placeMarketOrderBinance(
        { BINANCE_API_KEY: 'k', BINANCE_API_SECRET: 's' },
        'INVALIDUSDT', 'BUY', '1', 100
      ),
      /Invalid symbol/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getKuCoinBalance
// ─────────────────────────────────────────────────────────────────────────────

describe('getKuCoinBalance', () => {
  test('throws when KUCOIN_API_KEY is missing', async () => {
    await assert.rejects(
      () => getKuCoinBalance({ KUCOIN_SECRET_KEY: 's', KUCOIN_PASSPHRASE: 'p' }),
      /KUCOIN_API_KEY is not configured/
    );
  });

  test('throws when KUCOIN_SECRET_KEY is missing', async () => {
    await assert.rejects(
      () => getKuCoinBalance({ KUCOIN_API_KEY: 'k', KUCOIN_PASSPHRASE: 'p' }),
      /KUCOIN_SECRET_KEY.*is not configured/
    );
  });

  test('throws when KUCOIN_PASSPHRASE is missing', async () => {
    await assert.rejects(
      () => getKuCoinBalance({ KUCOIN_API_KEY: 'k', KUCOIN_SECRET_KEY: 's' }),
      /KUCOIN_PASSPHRASE is not configured/
    );
  });

  test('returns summed free balance across multiple account entries', async () => {
    installMockFetch(() => makeJsonResponse({
      code: '200000',
      data: [
        { available: '300.00' },
        { available: '200.50' }
      ]
    }));
    const bal = await getKuCoinBalance(
      { KUCOIN_API_KEY: 'k', KUCOIN_SECRET_KEY: 's', KUCOIN_PASSPHRASE: 'p' },
      'USDT'
    );
    assert.ok(Math.abs(bal.free - 500.5) < 0.001, `expected 500.5, got ${bal.free}`);
    assert.equal(bal.locked, 0);
  });

  test('returns 0 when data is empty', async () => {
    installMockFetch(() => makeJsonResponse({ code: '200000', data: [] }));
    const bal = await getKuCoinBalance(
      { KUCOIN_API_KEY: 'k', KUCOIN_SECRET_KEY: 's', KUCOIN_PASSPHRASE: 'p' },
      'USDT'
    );
    assert.equal(bal.free, 0);
  });

  test('throws when API returns error code', async () => {
    // Omit msg so the fallback "KuCoin balance error <code>" message is used.
    installMockFetch(() => makeJsonResponse({ code: '400006' }));
    await assert.rejects(
      () => getKuCoinBalance({ KUCOIN_API_KEY: 'k', KUCOIN_SECRET_KEY: 's', KUCOIN_PASSPHRASE: 'p' }),
      /KuCoin balance error/
    );
  });

  test('sends request with correct KuCoin auth headers', async () => {
    installMockFetch(() => makeJsonResponse({ code: '200000', data: [] }));
    await getKuCoinBalance(
      { KUCOIN_API_KEY: 'mykckey', KUCOIN_SECRET_KEY: 's', KUCOIN_PASSPHRASE: 'p' },
      'USDT'
    );
    const req = capturedRequests[0];
    assert.equal(req.headers['KC-API-KEY'], 'mykckey');
    assert.ok(req.headers['KC-API-SIGN'], 'KC-API-SIGN header must be present');
    assert.ok(req.headers['KC-API-TIMESTAMP'], 'KC-API-TIMESTAMP header must be present');
    assert.equal(req.headers['KC-API-KEY-VERSION'], '2');
  });

  test('accepts KUCOIN_API_SECRET alias in place of KUCOIN_SECRET_KEY', async () => {
    installMockFetch(() => makeJsonResponse({ code: '200000', data: [{ available: '100.00' }] }));
    const bal = await getKuCoinBalance(
      { KUCOIN_API_KEY: 'k', KUCOIN_API_SECRET: 'alias-secret', KUCOIN_PASSPHRASE: 'p' },
      'USDT'
    );
    assert.ok(Math.abs(bal.free - 100) < 0.001, 'balance should be read using alias secret');
  });

  test('throws with alias hint when both KUCOIN_SECRET_KEY and alias are absent', async () => {
    await assert.rejects(
      () => getKuCoinBalance({ KUCOIN_API_KEY: 'k', KUCOIN_PASSPHRASE: 'p' }),
      /KUCOIN_SECRET_KEY/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// placeMarketOrderKuCoin
// ─────────────────────────────────────────────────────────────────────────────

describe('placeMarketOrderKuCoin', () => {
  test('throws when any credential is missing', async () => {
    await assert.rejects(
      () => placeMarketOrderKuCoin({}, 'BTCUSDT', 'BUY', '0.001', 100),
      /KUCOIN_API_KEY is not configured/
    );
  });

  test('converts XXXUSDT symbol to KuCoin XXX-USDT format in order body', async () => {
    installMockFetch(() => makeJsonResponse({ code: '200000', data: { orderId: 'kc1' } }));
    await placeMarketOrderKuCoin(
      { KUCOIN_API_KEY: 'k', KUCOIN_SECRET_KEY: 's', KUCOIN_PASSPHRASE: 'p' },
      'BTCUSDT', 'BUY', '0.001', 100
    );
    const body = JSON.parse(capturedRequests[0].body);
    assert.equal(body.symbol, 'BTC-USDT', 'symbol should be in KuCoin format');
  });

  test('BUY order body includes funds field (USDT amount)', async () => {
    installMockFetch(() => makeJsonResponse({ code: '200000', data: { orderId: 'kc2' } }));
    await placeMarketOrderKuCoin(
      { KUCOIN_API_KEY: 'k', KUCOIN_SECRET_KEY: 's', KUCOIN_PASSPHRASE: 'p' },
      'ETHUSDT', 'BUY', '0.5', 300
    );
    const body = JSON.parse(capturedRequests[0].body);
    assert.equal(body.funds, '300.00', 'BUY should use funds (USDT amount)');
    assert.equal(body.size, undefined, 'BUY should not have size field');
  });

  test('SELL order body includes size field (base asset amount)', async () => {
    installMockFetch(() => makeJsonResponse({ code: '200000', data: { orderId: 'kc3' } }));
    await placeMarketOrderKuCoin(
      { KUCOIN_API_KEY: 'k', KUCOIN_SECRET_KEY: 's', KUCOIN_PASSPHRASE: 'p' },
      'ETHUSDT', 'SELL', '0.5', 300
    );
    const body = JSON.parse(capturedRequests[0].body);
    assert.equal(body.size, '0.5', 'SELL should use size (base asset amount)');
    assert.equal(body.funds, undefined, 'SELL should not have funds field');
  });

  test('throws when API returns error code', async () => {
    // Omit msg so the fallback "KuCoin spot error <code>" message is used.
    installMockFetch(() => makeJsonResponse({ code: '300000' }));
    await assert.rejects(
      () => placeMarketOrderKuCoin(
        { KUCOIN_API_KEY: 'k', KUCOIN_SECRET_KEY: 's', KUCOIN_PASSPHRASE: 'p' },
        'BTCUSDT', 'BUY', '0.001', 100
      ),
      /KuCoin spot error/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getBitgetBalance
// ─────────────────────────────────────────────────────────────────────────────

describe('getBitgetBalance', () => {
  test('throws when BITGET_API_KEY is missing', async () => {
    await assert.rejects(
      () => getBitgetBalance({ BITGET_SECRET_KEY: 's', BITGET_API_PASSPHRASE: 'p' }),
      /BITGET_API_KEY is not configured/
    );
  });

  test('throws when BITGET_SECRET_KEY is missing', async () => {
    await assert.rejects(
      () => getBitgetBalance({ BITGET_API_KEY: 'k', BITGET_API_PASSPHRASE: 'p' }),
      /BITGET_SECRET_KEY.*is not configured/
    );
  });

  test('throws when BITGET_API_PASSPHRASE is missing', async () => {
    await assert.rejects(
      () => getBitgetBalance({ BITGET_API_KEY: 'k', BITGET_SECRET_KEY: 's' }),
      /BITGET_API_PASSPHRASE is not configured/
    );
  });

  test('returns free and locked balance on success', async () => {
    installMockFetch(() => makeJsonResponse({
      code: '00000',
      data: [{ coin: 'USDT', available: '600.00', frozen: '20.00' }]
    }));
    const bal = await getBitgetBalance(
      { BITGET_API_KEY: 'k', BITGET_SECRET_KEY: 's', BITGET_API_PASSPHRASE: 'p' },
      'USDT'
    );
    assert.equal(bal.free,   600.0);
    assert.equal(bal.locked, 20.0);
  });

  test('returns 0/0 when asset is absent from data', async () => {
    installMockFetch(() => makeJsonResponse({ code: '00000', data: [] }));
    const bal = await getBitgetBalance(
      { BITGET_API_KEY: 'k', BITGET_SECRET_KEY: 's', BITGET_API_PASSPHRASE: 'p' },
      'USDT'
    );
    assert.equal(bal.free,   0);
    assert.equal(bal.locked, 0);
  });

  test('throws when API returns error code', async () => {
    installMockFetch(() => makeJsonResponse({ code: '40006', msg: 'Invalid API key' }));
    await assert.rejects(
      () => getBitgetBalance({ BITGET_API_KEY: 'k', BITGET_SECRET_KEY: 's', BITGET_API_PASSPHRASE: 'p' }),
      /Invalid API key/
    );
  });

  test('accepts BITGET_API_SECRET alias in place of BITGET_SECRET_KEY', async () => {
    installMockFetch(() => makeJsonResponse({
      code: '00000',
      data: [{ coin: 'USDT', available: '250.00', frozen: '0' }]
    }));
    const bal = await getBitgetBalance(
      { BITGET_API_KEY: 'k', BITGET_API_SECRET: 'alias-secret', BITGET_API_PASSPHRASE: 'p' },
      'USDT'
    );
    assert.equal(bal.free, 250.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// placeMarketOrderBitget
// ─────────────────────────────────────────────────────────────────────────────

describe('placeMarketOrderBitget', () => {
  test('throws when any credential is missing', async () => {
    await assert.rejects(
      () => placeMarketOrderBitget({}, 'BTCUSDT', 'BUY', '0.001', 100),
      /BITGET_API_KEY is not configured/
    );
  });

  test('BUY order uses sizeUsd as size', async () => {
    installMockFetch(() => makeJsonResponse({ code: '00000', data: { orderId: 'bg1' } }));
    await placeMarketOrderBitget(
      { BITGET_API_KEY: 'k', BITGET_SECRET_KEY: 's', BITGET_API_PASSPHRASE: 'p' },
      'BTCUSDT', 'BUY', '0.001', 200
    );
    const body = JSON.parse(capturedRequests[0].body);
    // BUY: size = sizeUsd.toFixed(8)
    assert.ok(body.size.includes('200'), 'BUY size should be based on USDT amount');
    assert.equal(body.side, 'buy');
    assert.equal(body.orderType, 'market');
  });

  test('SELL order uses quantity as size', async () => {
    installMockFetch(() => makeJsonResponse({ code: '00000', data: { orderId: 'bg2' } }));
    await placeMarketOrderBitget(
      { BITGET_API_KEY: 'k', BITGET_SECRET_KEY: 's', BITGET_API_PASSPHRASE: 'p' },
      'ETHUSDT', 'SELL', '1.5', 200
    );
    const body = JSON.parse(capturedRequests[0].body);
    assert.equal(body.size, '1.5', 'SELL size should be base asset quantity');
  });

  test('throws when API returns error code', async () => {
    installMockFetch(() => makeJsonResponse({ code: '40001', msg: 'Insufficient balance' }));
    await assert.rejects(
      () => placeMarketOrderBitget(
        { BITGET_API_KEY: 'k', BITGET_SECRET_KEY: 's', BITGET_API_PASSPHRASE: 'p' },
        'BTCUSDT', 'BUY', '0.001', 100
      ),
      /Insufficient balance/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getBitmartBalance
// ─────────────────────────────────────────────────────────────────────────────

describe('getBitmartBalance', () => {
  test('throws when BITMART_API_KEY is missing', async () => {
    await assert.rejects(
      () => getBitmartBalance({ BITMART_SECRET_KEY: 's', BITMART_MEMO: 'm' }),
      /BITMART_API_KEY is not configured/
    );
  });

  test('throws when BITMART_SECRET_KEY is missing', async () => {
    await assert.rejects(
      () => getBitmartBalance({ BITMART_API_KEY: 'k', BITMART_MEMO: 'm' }),
      /BITMART_SECRET_KEY.*is not configured/
    );
  });

  test('throws when BITMART_MEMO is missing', async () => {
    await assert.rejects(
      () => getBitmartBalance({ BITMART_API_KEY: 'k', BITMART_SECRET_KEY: 's' }),
      /BITMART_MEMO is not configured/
    );
  });

  test('returns free and locked balance on success', async () => {
    installMockFetch(() => makeJsonResponse({
      code: 1000,
      data: { wallet: [{ currency: 'USDT', available: '400.00', frozen: '30.00' }] }
    }));
    const bal = await getBitmartBalance(
      { BITMART_API_KEY: 'k', BITMART_SECRET_KEY: 's', BITMART_MEMO: 'm' },
      'USDT'
    );
    assert.equal(bal.free,   400.0);
    assert.equal(bal.locked, 30.0);
  });

  test('returns 0/0 when asset is absent from wallet', async () => {
    installMockFetch(() => makeJsonResponse({ code: 1000, data: { wallet: [] } }));
    const bal = await getBitmartBalance(
      { BITMART_API_KEY: 'k', BITMART_SECRET_KEY: 's', BITMART_MEMO: 'm' },
      'USDT'
    );
    assert.equal(bal.free,   0);
    assert.equal(bal.locked, 0);
  });

  test('throws when API returns error code', async () => {
    installMockFetch(() => makeJsonResponse({ code: 40001, message: 'Bad request' }));
    await assert.rejects(
      () => getBitmartBalance({ BITMART_API_KEY: 'k', BITMART_SECRET_KEY: 's', BITMART_MEMO: 'm' }),
      /Bad request/
    );
  });

  test('sends request with correct Bitmart auth headers', async () => {
    installMockFetch(() => makeJsonResponse({ code: 1000, data: { wallet: [] } }));
    await getBitmartBalance(
      { BITMART_API_KEY: 'mybmkey', BITMART_SECRET_KEY: 's', BITMART_MEMO: 'mymemo' },
      'USDT'
    );
    const req = capturedRequests[0];
    assert.equal(req.headers['X-BM-KEY'], 'mybmkey');
    assert.ok(req.headers['X-BM-SIGN'], 'X-BM-SIGN header must be present');
    assert.ok(req.headers['X-BM-TIMESTAMP'], 'X-BM-TIMESTAMP must be present');
  });

  test('accepts BITMART_API_SECRET alias in place of BITMART_SECRET_KEY', async () => {
    installMockFetch(() => makeJsonResponse({
      code: 1000,
      data: { wallet: [{ currency: 'USDT', available: '75.00', frozen: '0' }] }
    }));
    const bal = await getBitmartBalance(
      { BITMART_API_KEY: 'k', BITMART_API_SECRET: 'alias-secret', BITMART_MEMO: 'm' },
      'USDT'
    );
    assert.equal(bal.free, 75.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// placeMarketOrderBitmart
// ─────────────────────────────────────────────────────────────────────────────

describe('placeMarketOrderBitmart', () => {
  test('throws when any credential is missing', async () => {
    await assert.rejects(
      () => placeMarketOrderBitmart({}, 'BTCUSDT', 'BUY', '0.001', 100),
      /BITMART_API_KEY is not configured/
    );
  });

  test('converts XXXUSDT symbol to XXX_USDT Bitmart format in order body', async () => {
    installMockFetch(() => makeJsonResponse({ code: 1000, data: { order_id: 'bm1' } }));
    await placeMarketOrderBitmart(
      { BITMART_API_KEY: 'k', BITMART_SECRET_KEY: 's', BITMART_MEMO: 'm' },
      'BTCUSDT', 'BUY', '0.001', 100
    );
    const body = JSON.parse(capturedRequests[0].body);
    assert.equal(body.symbol, 'BTC_USDT', 'symbol should be in Bitmart underscore format');
  });

  test('BUY order uses notional (USDT amount)', async () => {
    installMockFetch(() => makeJsonResponse({ code: 1000, data: { order_id: 'bm2' } }));
    await placeMarketOrderBitmart(
      { BITMART_API_KEY: 'k', BITMART_SECRET_KEY: 's', BITMART_MEMO: 'm' },
      'ETHUSDT', 'BUY', '0.5', 500
    );
    const body = JSON.parse(capturedRequests[0].body);
    assert.ok(body.notional !== undefined, 'BUY should have notional field');
    assert.ok(body.notional.includes('500'), 'notional should be based on USDT amount');
    assert.equal(body.size, undefined, 'BUY should not have size field');
  });

  test('SELL order uses size (base asset amount)', async () => {
    installMockFetch(() => makeJsonResponse({ code: 1000, data: { order_id: 'bm3' } }));
    await placeMarketOrderBitmart(
      { BITMART_API_KEY: 'k', BITMART_SECRET_KEY: 's', BITMART_MEMO: 'm' },
      'ETHUSDT', 'SELL', '2.0', 500
    );
    const body = JSON.parse(capturedRequests[0].body);
    assert.equal(body.size, '2.0', 'SELL should use size (base asset amount)');
    assert.equal(body.notional, undefined, 'SELL should not have notional field');
  });

  test('throws when API returns error code', async () => {
    installMockFetch(() => makeJsonResponse({ code: 40001, message: 'Insufficient balance' }));
    await assert.rejects(
      () => placeMarketOrderBitmart(
        { BITMART_API_KEY: 'k', BITMART_SECRET_KEY: 's', BITMART_MEMO: 'm' },
        'BTCUSDT', 'BUY', '0.001', 100
      ),
      /Insufficient balance/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getExchangeBalance — dispatcher
// ─────────────────────────────────────────────────────────────────────────────

describe('getExchangeBalance', () => {
  test('returns 0 for an unknown exchange (safe default)', async () => {
    const result = await getExchangeBalance({}, 'unknown_exchange', 'USDT');
    assert.equal(result, 0);
  });

  test('delegates to getMEXCBalance and returns the free balance', async () => {
    installMockFetch(() => makeJsonResponse({
      balances: [{ asset: 'USDT', free: '850.00', locked: '0' }]
    }));
    const free = await getExchangeBalance(
      { MEXC_API_KEY: 'k', MEXC_API_SECRET: 's' },
      'mexc',
      'USDT'
    );
    assert.equal(free, 850.0);
  });

  test('delegates to getBinanceBalance and returns the free balance', async () => {
    installMockFetch(() => makeJsonResponse({
      balances: [{ asset: 'USDT', free: '1500.00', locked: '0' }]
    }));
    const free = await getExchangeBalance(
      { BINANCE_API_KEY: 'k', BINANCE_API_SECRET: 's' },
      'binance',
      'USDT'
    );
    assert.equal(free, 1500.0);
  });

  test('propagates error when the underlying balance call throws', async () => {
    // No credentials → getMEXCBalance throws → getExchangeBalance propagates
    await assert.rejects(
      () => getExchangeBalance({}, 'mexc', 'USDT'),
      /MEXC_API_KEY is not configured/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getBinanceBalance — recvWindow regression
// ─────────────────────────────────────────────────────────────────────────────

describe('getBinanceBalance — recvWindow', () => {
  test('includes recvWindow parameter in query string to tolerate clock drift', async () => {
    installMockFetch(() => makeJsonResponse({ balances: [] }));
    await getBinanceBalance({ BINANCE_API_KEY: 'k', BINANCE_API_SECRET: 's' });
    assert.ok(
      capturedRequests[0].url.includes('recvWindow='),
      'Binance URL must include recvWindow to prevent timestamp-drift errors'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getKuCoinBalance — all account types
// ─────────────────────────────────────────────────────────────────────────────

describe('getKuCoinBalance — all account types', () => {
  test('queries without type filter so main and trade accounts are included', async () => {
    installMockFetch(() => makeJsonResponse({ code: '200000', data: [] }));
    await getKuCoinBalance(
      { KUCOIN_API_KEY: 'k', KUCOIN_SECRET_KEY: 's', KUCOIN_PASSPHRASE: 'p' },
      'USDT'
    );
    const url = capturedRequests[0].url;
    assert.ok(!url.includes('type='), 'URL must not contain a type= filter');
    assert.ok(url.includes('currency=USDT'), 'URL must filter by currency');
  });

  test('sums available across all account types (main, trade, margin)', async () => {
    installMockFetch(() => makeJsonResponse({
      code: '200000',
      data: [
        { type: 'main',  available: '500.00', holds: '0'     },
        { type: 'trade', available: '250.00', holds: '25.00' }
      ]
    }));
    const bal = await getKuCoinBalance(
      { KUCOIN_API_KEY: 'k', KUCOIN_SECRET_KEY: 's', KUCOIN_PASSPHRASE: 'p' },
      'USDT'
    );
    assert.ok(Math.abs(bal.free   - 750) < 0.001, `expected free=750, got ${bal.free}`);
    assert.ok(Math.abs(bal.locked -  25) < 0.001, `expected locked=25, got ${bal.locked}`);
  });

  test('reports holds (locked) balance correctly', async () => {
    installMockFetch(() => makeJsonResponse({
      code: '200000',
      data: [{ type: 'trade', available: '100.00', holds: '40.00' }]
    }));
    const bal = await getKuCoinBalance(
      { KUCOIN_API_KEY: 'k', KUCOIN_SECRET_KEY: 's', KUCOIN_PASSPHRASE: 'p' },
      'USDT'
    );
    assert.equal(bal.free,   100.0);
    assert.equal(bal.locked,  40.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// placeExchangeMarketOrder — dispatcher
// ─────────────────────────────────────────────────────────────────────────────

describe('placeExchangeMarketOrder', () => {
  test('throws for an unknown exchange', async () => {
    await assert.rejects(
      () => placeExchangeMarketOrder({}, 'unknown', 'BTCUSDT', 'BUY', '0.001', 100),
      /No execution layer for exchange: unknown/
    );
  });

  test('delegates to placeMarketOrderMEXC for mexc exchange', async () => {
    installMockFetch(() => makeJsonResponse({ orderId: 'mx1' }));
    const result = await placeExchangeMarketOrder(
      { MEXC_API_KEY: 'k', MEXC_API_SECRET: 's' },
      'mexc',
      'BTCUSDT', 'BUY', '0.001', 100
    );
    assert.equal(result.orderId, 'mx1');
    assert.ok(new URL(capturedRequests[0].url).hostname === 'api.mexc.com');
  });

  test('delegates to placeMarketOrderBinance for binance exchange', async () => {
    installMockFetch(() => makeJsonResponse({ orderId: 'bn1' }));
    const result = await placeExchangeMarketOrder(
      { BINANCE_API_KEY: 'k', BINANCE_API_SECRET: 's' },
      'binance',
      'BTCUSDT', 'BUY', '0.001', 100
    );
    assert.equal(result.orderId, 'bn1');
    assert.ok(new URL(capturedRequests[0].url).hostname === 'api.binance.com');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Non-JSON upstream error handling
// ─────────────────────────────────────────────────────────────────────────────

describe('non-JSON upstream error handling', () => {
  test('getBitgetBalance reports HTTP status and raw snippet when response is not JSON', async () => {
    installMockFetch(() => makeTextResponse('Access denied', 403));
    await assert.rejects(
      () => getBitgetBalance({ BITGET_API_KEY: 'k', BITGET_SECRET_KEY: 's', BITGET_API_PASSPHRASE: 'p' }),
      (err) => {
        assert.ok(err.message.includes('Access denied'), 'should include raw snippet');
        return true;
      }
    );
  });

  test('getKuCoinBalance reports HTTP status and raw snippet when response is not JSON', async () => {
    installMockFetch(() => makeTextResponse('upstream connect error', 503));
    await assert.rejects(
      () => getKuCoinBalance({ KUCOIN_API_KEY: 'k', KUCOIN_SECRET_KEY: 's', KUCOIN_PASSPHRASE: 'p' }),
      (err) => {
        assert.ok(err.message.includes('upstream connect error'), 'should include raw snippet');
        assert.ok(err.message.includes('503'), 'should include HTTP status');
        return true;
      }
    );
  });

  test('getBitmartBalance reports HTTP status and raw snippet when response is not JSON', async () => {
    installMockFetch(() => makeTextResponse('Service Unavailable', 503));
    await assert.rejects(
      () => getBitmartBalance({ BITMART_API_KEY: 'k', BITMART_SECRET_KEY: 's', BITMART_MEMO: 'm' }),
      (err) => {
        assert.ok(err.message.includes('Service Unavailable'), 'should include raw snippet');
        assert.ok(err.message.includes('503'), 'should include HTTP status');
        return true;
      }
    );
  });
});
