/**
 * Unit tests for src/infra/proxy-pool.js
 * Tests PROXY_MODE routing (off/auto/required) and DIRECT_EXCHANGES bypass.
 * Uses Node.js built-in node:test runner.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ProxyPool, getGlobalProxyPool } from '../src/infra/proxy-pool.js';

function makeEnv(overrides = {}) {
  return { PROXY_MODE: 'auto', DIRECT_EXCHANGES: '', ...overrides };
}

// --- PROXY_MODE off ---

describe('ProxyPool PROXY_MODE=off', () => {
  test('shouldProxy returns false for any exchange', () => {
    const pool = new ProxyPool(makeEnv({ PROXY_MODE: 'off' }));
    assert.equal(pool.shouldProxy('binance'), false);
    assert.equal(pool.shouldProxy('mexc'), false);
    assert.equal(pool.shouldProxy(), false);
  });

  test('proxyMode is off', () => {
    const pool = new ProxyPool(makeEnv({ PROXY_MODE: 'off' }));
    assert.equal(pool.proxyMode, 'off');
  });
});

// --- PROXY_MODE auto ---

describe('ProxyPool PROXY_MODE=auto', () => {
  test('shouldProxy returns true when no proxies are configured (auto routes through)', () => {
    // In auto mode, shouldProxy returns true (meaning: attempt proxy if available),
    // but fetchWithProxy falls back to direct when no proxies are loaded.
    const pool = new ProxyPool(makeEnv({ PROXY_MODE: 'auto' }));
    assert.equal(pool.availableCount, 0);
    // shouldProxy is true even in auto — the *fallback* is handled in fetchWithProxy
    assert.equal(pool.shouldProxy('binance'), true);
  });

  test('proxyMode defaults to auto when env has no PROXY_MODE', () => {
    const pool = new ProxyPool({});
    assert.equal(pool.proxyMode, 'auto');
  });

  test('defaults to auto for unrecognized PROXY_MODE values', () => {
    const pool = new ProxyPool(makeEnv({ PROXY_MODE: 'banana' }));
    assert.equal(pool.proxyMode, 'auto');
  });
});

// --- PROXY_MODE required ---

describe('ProxyPool PROXY_MODE=required', () => {
  test('proxyMode is required', () => {
    const pool = new ProxyPool(makeEnv({ PROXY_MODE: 'required' }));
    assert.equal(pool.proxyMode, 'required');
  });

  test('shouldProxy returns true for any exchange in required mode', () => {
    const pool = new ProxyPool(makeEnv({ PROXY_MODE: 'required' }));
    assert.equal(pool.shouldProxy('binance'), true);
    assert.equal(pool.shouldProxy('bybit'), true);
  });

  test('fetchWithProxy throws when no proxies configured in required mode', async () => {
    const pool = new ProxyPool(makeEnv({ PROXY_MODE: 'required' }));
    await assert.rejects(
      () => pool.fetchWithProxy('https://api.example.com/test'),
      /proxy.*required|no.*proxy/i
    );
  });

  test('shouldProxy returns true for non-bypassed exchange after adding PROXY_URL', () => {
    const pool = new ProxyPool(makeEnv({
      PROXY_MODE: 'required',
      PROXY_URL: 'http://proxy.example.com:8080',
    }));
    pool.initialize();
    assert.ok(pool.availableCount > 0);
    assert.equal(pool.shouldProxy('binance'), true);
  });
});

// --- DIRECT_EXCHANGES bypass ---

describe('ProxyPool DIRECT_EXCHANGES bypass', () => {
  test('shouldProxy returns false for exchanges in DIRECT_EXCHANGES', () => {
    // shouldProxy() is constructor-initialized, no initialize() needed
    const pool = new ProxyPool(makeEnv({
      PROXY_MODE: 'required',
      DIRECT_EXCHANGES: 'binance,mexc',
    }));
    assert.equal(pool.shouldProxy('binance'), false);
    assert.equal(pool.shouldProxy('mexc'), false);
  });

  test('shouldProxy returns true for exchanges NOT in DIRECT_EXCHANGES', () => {
    const pool = new ProxyPool(makeEnv({
      PROXY_MODE: 'required',
      DIRECT_EXCHANGES: 'binance',
    }));
    assert.equal(pool.shouldProxy('bybit'), true);
    assert.equal(pool.shouldProxy('bitmart'), true);
  });

  test('handles spaces and case in DIRECT_EXCHANGES', () => {
    const pool = new ProxyPool(makeEnv({
      PROXY_MODE: 'required',
      DIRECT_EXCHANGES: ' Binance , MEXC ',
    }));
    assert.equal(pool.shouldProxy('binance'), false);
    assert.equal(pool.shouldProxy('mexc'), false);
  });
});

// --- availableCount ---

describe('ProxyPool availableCount', () => {
  test('returns 0 before initialize when no proxy vars are set', () => {
    const pool = new ProxyPool(makeEnv());
    assert.equal(pool.availableCount, 0);
  });

  test('returns > 0 after initialize with PROXY_URL', () => {
    const pool = new ProxyPool(makeEnv({ PROXY_URL: 'http://proxy.example.com:8080' }));
    pool.initialize();
    assert.ok(pool.availableCount > 0);
  });

  test('accepts multiple proxies from PROXY_LIST JSON array', () => {
    const proxyList = JSON.stringify([
      { url: 'http://p1.example.com:8080' },
      { url: 'http://p2.example.com:8080' },
    ]);
    const pool = new ProxyPool(makeEnv({ PROXY_LIST: proxyList }));
    pool.initialize();
    assert.ok(pool.availableCount >= 2);
  });
});

// --- auto mode fallback via fetchWithProxy ---

describe('ProxyPool PROXY_MODE=auto direct fallback', () => {
  test('fetchWithProxy falls back to direct fetch when no proxies are configured', async () => {
    const pool = new ProxyPool(makeEnv({ PROXY_MODE: 'auto' }));
    let capturedUrl;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { status: 200, json: async () => ({ ok: true }) };
    };
    try {
      const res = await pool.fetchWithProxy('https://api.example.com/test');
      assert.equal(res.status, 200);
      assert.equal(capturedUrl, 'https://api.example.com/test');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// --- getGlobalProxyPool singleton ---

describe('getGlobalProxyPool singleton', () => {
  test('returns object with proxyMode string and shouldProxy function', () => {
    const pool = getGlobalProxyPool(makeEnv());
    assert.equal(typeof pool.proxyMode, 'string');
    assert.equal(typeof pool.shouldProxy, 'function');
    assert.equal(typeof pool.fetchWithProxy, 'function');
  });
});
