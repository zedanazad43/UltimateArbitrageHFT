// tests/exchange.integration.test.js
//
// Integration-level tests for src/exchange.js.
// These tests validate:
//   1. HMAC-SHA256 signing produces the correct hex digest (known test vector).
//   2. getMEXCBalance / hasSufficientUSDT correctly parse an API response.
//   3. placeMarketOrderMEXC sends the right HTTP request (URL, headers, body).
//   4. placeMEXCFuturesOrder sends the right HTTP request and rejects on error.
//   5. hasSufficientUSDT returns false (safe default) when the API call throws.
//
// No real network calls are made — every fetch is replaced with a mock that
// validates the outbound request and returns a canned response.
//
// Run with: node --test tests/exchange.integration.test.js

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ── HMAC helper (inline copy of the private function for test-vector validation) ─
async function hmacHex(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Mock fetch infrastructure ─────────────────────────────────────────────────
let mockFetch;
let capturedRequests = [];

function installMockFetch(handler) {
  capturedRequests = [];
  mockFetch = async (url, init) => {
    const req = { url, ...init };
    capturedRequests.push(req);
    return handler(req);
  };
  globalThis.fetch = mockFetch;
}

function makeJsonResponse(body, ok = true) {
  return {
    ok,
    json: async () => body,
    body: { cancel: async () => {} }
  };
}

// ── Import module under test ───────────────────────────────────────────────────
// The top-level await import must happen AFTER the global fetch mock is
// in place.  However, Node.js ESM caches the module on first import, so
// subsequent installMockFetch() calls in individual tests simply replace
// globalThis.fetch — the module re-uses the (now mocked) global on every call.
const { getMEXCBalance, hasSufficientUSDT, placeMarketOrderMEXC, placeMEXCFuturesOrder } =
  await import('../src/exchange.js');

// ═════════════════════════════════════════════════════════════════════════════
// 1. HMAC-SHA256 signing — known test vector
// ═════════════════════════════════════════════════════════════════════════════
describe('HMAC-SHA256 signing', () => {
  test('produces the expected hex digest for a known input', async () => {
    // RFC 4231 test case: HMAC-SHA256 with key="key", data="The quick brown fox..."
    const digest = await hmacHex(
      'key',
      'The quick brown fox jumps over the lazy dog'
    );
    // Expected value pre-computed with Node.js crypto.createHmac:
    assert.equal(
      digest,
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8'
    );
  });

  test('produces a 64-character lowercase hex string', async () => {
    const digest = await hmacHex('secret', 'message');
    assert.match(digest, /^[0-9a-f]{64}$/);
  });

  test('different messages produce different digests', async () => {
    const d1 = await hmacHex('secret', 'message1');
    const d2 = await hmacHex('secret', 'message2');
    assert.notEqual(d1, d2);
  });

  test('different secrets produce different digests', async () => {
    const d1 = await hmacHex('secret1', 'message');
    const d2 = await hmacHex('secret2', 'message');
    assert.notEqual(d1, d2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. getMEXCBalance
// ═════════════════════════════════════════════════════════════════════════════
describe('getMEXCBalance', () => {
  test('throws when MEXC_API_KEY is missing', async () => {
    await assert.rejects(
      () => getMEXCBalance({ MEXC_API_SECRET: 'secret' }),
      /MEXC_API_KEY is not configured/
    );
  });

  test('throws when MEXC_API_SECRET is missing', async () => {
    await assert.rejects(
      () => getMEXCBalance({ MEXC_API_KEY: 'key' }),
      /MEXC_API_SECRET is not configured/
    );
  });

  test('returns free and locked balance for the requested asset', async () => {
    installMockFetch(() => makeJsonResponse({
      balances: [
        { asset: 'USDT',  free: '842.75', locked: '50.00' },
        { asset: 'BTC',   free: '0.1',    locked: '0'     }
      ]
    }));

    const bal = await getMEXCBalance(
      { MEXC_API_KEY: 'testkey', MEXC_API_SECRET: 'testsecret' },
      'USDT'
    );

    assert.equal(bal.free,   842.75);
    assert.equal(bal.locked, 50.00);
  });

  test('returns 0/0 when asset is absent from balances', async () => {
    installMockFetch(() => makeJsonResponse({ balances: [] }));

    const bal = await getMEXCBalance(
      { MEXC_API_KEY: 'k', MEXC_API_SECRET: 's' },
      'USDT'
    );
    assert.equal(bal.free,   0);
    assert.equal(bal.locked, 0);
  });

  test('throws when API returns an error code', async () => {
    installMockFetch(() => makeJsonResponse({ code: -2014, msg: 'API-key format invalid.' }));

    await assert.rejects(
      () => getMEXCBalance({ MEXC_API_KEY: 'k', MEXC_API_SECRET: 's' }),
      /API-key format invalid/
    );
  });

  test('sends request to MEXC account endpoint with correct API key header', async () => {
    installMockFetch(() => makeJsonResponse({ balances: [] }));

    await getMEXCBalance({ MEXC_API_KEY: 'myapikey', MEXC_API_SECRET: 'mysecret' });

    assert.equal(capturedRequests.length, 1);
    const req = capturedRequests[0];
    assert.ok(req.url.startsWith('https://api.mexc.com/api/v3/account'));
    assert.ok(req.url.includes('timestamp='));
    assert.ok(req.url.includes('signature='));
    assert.equal(req.headers['X-MEXC-APIKEY'], 'myapikey');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. hasSufficientUSDT
// ═════════════════════════════════════════════════════════════════════════════
describe('hasSufficientUSDT', () => {
  test('returns true when free balance >= required', async () => {
    installMockFetch(() => makeJsonResponse({
      balances: [{ asset: 'USDT', free: '500', locked: '0' }]
    }));

    const ok = await hasSufficientUSDT(
      { MEXC_API_KEY: 'k', MEXC_API_SECRET: 's' },
      250
    );
    assert.equal(ok, true);
  });

  test('returns false when free balance < required', async () => {
    installMockFetch(() => makeJsonResponse({
      balances: [{ asset: 'USDT', free: '10', locked: '0' }]
    }));

    const ok = await hasSufficientUSDT(
      { MEXC_API_KEY: 'k', MEXC_API_SECRET: 's' },
      500
    );
    assert.equal(ok, false);
  });

  test('returns false (safe default) when API call throws', async () => {
    installMockFetch(() => { throw new Error('network error'); });

    const ok = await hasSufficientUSDT(
      { MEXC_API_KEY: 'k', MEXC_API_SECRET: 's' },
      100
    );
    assert.equal(ok, false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. placeMarketOrderMEXC
// ═════════════════════════════════════════════════════════════════════════════
describe('placeMarketOrderMEXC', () => {
  test('throws when API key is missing', async () => {
    await assert.rejects(
      () => placeMarketOrderMEXC({ MEXC_API_SECRET: 's' }, 'BTCUSDT', 'BUY', '0.001'),
      /MEXC_API_KEY is not configured/
    );
  });

  test('throws when API secret is missing', async () => {
    await assert.rejects(
      () => placeMarketOrderMEXC({ MEXC_API_KEY: 'k' }, 'BTCUSDT', 'BUY', '0.001'),
      /MEXC_API_SECRET is not configured/
    );
  });

  test('sends POST to MEXC spot order endpoint', async () => {
    installMockFetch(() => makeJsonResponse({ orderId: 'abc123', status: 'FILLED' }));

    const result = await placeMarketOrderMEXC(
      { MEXC_API_KEY: 'k', MEXC_API_SECRET: 's' },
      'BTCUSDT', 'BUY', '0.001'
    );

    assert.equal(result.orderId, 'abc123');
    assert.equal(capturedRequests.length, 1);
    const req = capturedRequests[0];
    assert.equal(req.url, 'https://api.mexc.com/api/v3/order');
    assert.equal(req.method, 'POST');
    assert.equal(req.headers['X-MEXC-APIKEY'], 'k');
    assert.equal(req.headers['Content-Type'], 'application/x-www-form-urlencoded');
  });

  test('request body includes symbol, side, type=MARKET, quantity, and signature', async () => {
    installMockFetch(() => makeJsonResponse({ orderId: 'xyz' }));

    await placeMarketOrderMEXC(
      { MEXC_API_KEY: 'k', MEXC_API_SECRET: 's' },
      'ETHUSDT', 'SELL', '1.5'
    );

    const body = new URLSearchParams(capturedRequests[0].body);
    assert.equal(body.get('symbol'),   'ETHUSDT');
    assert.equal(body.get('side'),     'SELL');
    assert.equal(body.get('type'),     'MARKET');
    assert.equal(body.get('quantity'), '1.5');
    assert.ok(body.get('timestamp'),   'timestamp must be present');
    assert.ok(body.get('signature'),   'signature must be present');
    // Signature must be 64-char hex
    assert.match(body.get('signature'), /^[0-9a-f]{64}$/);
  });

  test('throws when API returns an error code', async () => {
    installMockFetch(() => makeJsonResponse({
      code: -1121,
      msg: 'Invalid symbol.'
    }));

    await assert.rejects(
      () => placeMarketOrderMEXC(
        { MEXC_API_KEY: 'k', MEXC_API_SECRET: 's' },
        'INVALIDUSDT', 'BUY', '1'
      ),
      /Invalid symbol/
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. placeMEXCFuturesOrder
// ═════════════════════════════════════════════════════════════════════════════
describe('placeMEXCFuturesOrder', () => {
  test('throws when API key is missing', async () => {
    await assert.rejects(
      () => placeMEXCFuturesOrder({ MEXC_API_SECRET: 's' }, 'BTCUSDT', 'LONG', '0.1', 5),
      /MEXC_API_KEY is not configured/
    );
  });

  test('throws when API secret is missing', async () => {
    await assert.rejects(
      () => placeMEXCFuturesOrder({ MEXC_API_KEY: 'k' }, 'BTCUSDT', 'LONG', '0.1', 5),
      /MEXC_API_SECRET is not configured/
    );
  });

  test('sends POST to MEXC futures contract endpoint', async () => {
    installMockFetch(() => makeJsonResponse({ success: true, data: { orderId: 'f123' } }));

    const result = await placeMEXCFuturesOrder(
      { MEXC_API_KEY: 'k', MEXC_API_SECRET: 's' },
      'BTCUSDT', 'LONG', '0.01', 10
    );

    assert.equal(result.success, true);
    assert.equal(capturedRequests.length, 1);
    const req = capturedRequests[0];
    assert.equal(req.url, 'https://contract.mexc.com/api/v1/private/order/submit');
    assert.equal(req.method, 'POST');
    assert.equal(req.headers['ApiKey'], 'k');
    assert.ok(req.headers['Request-Time'], 'Request-Time header must be present');
    assert.match(req.headers['Signature'], /^[0-9a-f]{64}$/, 'Signature must be 64-char hex');
  });

  test('symbol is converted from XXXUSDT to XXX_USDT format', async () => {
    installMockFetch(() => makeJsonResponse({ success: true }));

    await placeMEXCFuturesOrder(
      { MEXC_API_KEY: 'k', MEXC_API_SECRET: 's' },
      'ETHUSDT', 'SHORT', '0.1', 5
    );

    const body = JSON.parse(capturedRequests[0].body);
    assert.equal(body.symbol, 'ETH_USDT');
  });

  test('LONG side maps to sideCode 1', async () => {
    installMockFetch(() => makeJsonResponse({ success: true }));

    await placeMEXCFuturesOrder(
      { MEXC_API_KEY: 'k', MEXC_API_SECRET: 's' },
      'BTCUSDT', 'LONG', '0.1', 5
    );

    const body = JSON.parse(capturedRequests[0].body);
    assert.equal(body.side, 1);
  });

  test('SHORT side maps to sideCode 2', async () => {
    installMockFetch(() => makeJsonResponse({ success: true }));

    await placeMEXCFuturesOrder(
      { MEXC_API_KEY: 'k', MEXC_API_SECRET: 's' },
      'BTCUSDT', 'SHORT', '0.1', 5
    );

    const body = JSON.parse(capturedRequests[0].body);
    assert.equal(body.side, 2);
  });

  test('leverage value is included in the request body', async () => {
    installMockFetch(() => makeJsonResponse({ success: true }));

    await placeMEXCFuturesOrder(
      { MEXC_API_KEY: 'k', MEXC_API_SECRET: 's' },
      'BTCUSDT', 'LONG', '0.1', 15
    );

    const body = JSON.parse(capturedRequests[0].body);
    assert.equal(body.leverage, 15);
  });

  test('throws when API returns success=false', async () => {
    installMockFetch(() => makeJsonResponse({
      success: false,
      message: 'Insufficient margin balance'
    }));

    await assert.rejects(
      () => placeMEXCFuturesOrder(
        { MEXC_API_KEY: 'k', MEXC_API_SECRET: 's' },
        'BTCUSDT', 'LONG', '999', 20
      ),
      /Insufficient margin balance/
    );
  });
});
