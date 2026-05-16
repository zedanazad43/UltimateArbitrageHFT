// tests/platforms-api.test.js — Tests for the /api/platforms endpoint logic.
// Run with: node --test tests/platforms-api.test.js
// Uses only Node.js built-in test runner (node:test) — no extra dependencies.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  hasExchangeCredentials,
  getMissingCredentialKeys,
} from '../src/exchange.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Mirrors the PLATFORM_META definition in index.js */
const PLATFORM_META = [
  { name: 'mexc',    type: 'cex', executionMode: 'spot+futures', strategies: ['cex','perps','funding','triangular'], note: 'Primary CEX' },
  { name: 'binance', type: 'cex', executionMode: 'spot',         strategies: ['cex','triangular'],                  note: 'Binance spot' },
  { name: 'bitget',  type: 'cex', executionMode: 'spot',         strategies: ['cex'],                               note: 'Bitget spot'  },
];

const METAMASK_ENTRY = {
  name: 'metamask', type: 'web3', executionMode: 'browser-signing',
  configured: true, missingKeys: [], balance: null,
  strategies: ['dex-gmx','dex-dydx'],
  note: 'Web3 browser wallet',
};

/**
 * Simulates the /api/platforms handler logic (synchronous mock of balance).
 * In production the handler calls getExchangeBalance; here we accept a balanceMap
 * for deterministic testing.
 */
async function buildPlatformsResponse(env, balanceMap = {}) {
  const platforms = await Promise.all(
    PLATFORM_META.map(async ({ name, type, executionMode, strategies, note }) => {
      const configured = hasExchangeCredentials(env, name);
      const missingKeys = configured ? [] : getMissingCredentialKeys(env, name);
      let balance = null;
      if (configured) {
        // Use injected balanceMap rather than live network calls
        balance = balanceMap[name] ?? null;
      }
      return { name, type, executionMode, configured, missingKeys, balance, strategies, note };
    })
  );

  platforms.push({ ...METAMASK_ENTRY });

  const configuredCount = platforms.filter(p => p.configured).length;
  return {
    success: true,
    summary: { total: platforms.length, configured: configuredCount, unconfigured: platforms.length - configuredCount },
    platforms,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary counts
// ─────────────────────────────────────────────────────────────────────────────

describe('/api/platforms — summary counts', () => {
  test('always returns 4 platforms in total', async () => {
    const res = await buildPlatformsResponse({});
    assert.equal(res.platforms.length, 4);
    assert.equal(res.summary.total, 4);
  });

  test('summary.configured = 1 when only metamask is ready', async () => {
    const res = await buildPlatformsResponse({});
    // MetaMask always configured; no CEX keys provided
    assert.equal(res.summary.configured, 1);
    assert.equal(res.summary.unconfigured, 3);
  });

  test('summary.configured = 4 when all 3 CEX and MetaMask are configured', async () => {
    const env = {
      MEXC_API_KEY: 'k', MEXC_API_SECRET: 's',
      BINANCE_API_KEY: 'k', BINANCE_API_SECRET: 's',
      BITGET_API_KEY: 'k', BITGET_API_SECRET: 's',
    };
    const res = await buildPlatformsResponse(env);
    assert.equal(res.summary.configured, 4);
    assert.equal(res.summary.unconfigured, 0);
  });

  test('summary.configured = 2 when only mexc and metamask are ready', async () => {
    const env = { MEXC_API_KEY: 'k', MEXC_API_SECRET: 's' };
    const res = await buildPlatformsResponse(env);
    assert.equal(res.summary.configured, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Individual platform status
// ─────────────────────────────────────────────────────────────────────────────

describe('/api/platforms — per-platform configured flag', () => {
  test('mexc is configured when both API key and secret are present', async () => {
    const env = { MEXC_API_KEY: 'k', MEXC_API_SECRET: 's' };
    const res = await buildPlatformsResponse(env);
    const mexc = res.platforms.find(p => p.name === 'mexc');
    assert.equal(mexc.configured, true);
    assert.deepEqual(mexc.missingKeys, []);
  });

  test('mexc is not configured when secret is missing', async () => {
    const env = { MEXC_API_KEY: 'k' };
    const res = await buildPlatformsResponse(env);
    const mexc = res.platforms.find(p => p.name === 'mexc');
    assert.equal(mexc.configured, false);
    assert.ok(mexc.missingKeys.length > 0, 'missingKeys must list the missing secret');
    assert.ok(mexc.missingKeys.some(k => k.includes('SECRET')), 'missing key should reference SECRET');
  });

  test('binance is not configured when keys are absent', async () => {
    const res = await buildPlatformsResponse({});
    const binance = res.platforms.find(p => p.name === 'binance');
    assert.equal(binance.configured, false);
    assert.ok(binance.missingKeys.length > 0);
  });

  test('metamask is always configured = true', async () => {
    const res = await buildPlatformsResponse({});
    const mm = res.platforms.find(p => p.name === 'metamask');
    assert.equal(mm.configured, true);
    assert.deepEqual(mm.missingKeys, []);
  });

  test('metamask type is web3', async () => {
    const res = await buildPlatformsResponse({});
    const mm = res.platforms.find(p => p.name === 'metamask');
    assert.equal(mm.type, 'web3');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Balance field
// ─────────────────────────────────────────────────────────────────────────────

describe('/api/platforms — balance field', () => {
  test('balance is null for unconfigured CEX platforms', async () => {
    const res = await buildPlatformsResponse({});
    for (const p of res.platforms.filter(p => p.type === 'cex' && !p.configured)) {
      assert.equal(p.balance, null);
    }
  });

  test('balance is null for metamask (web3)', async () => {
    const res = await buildPlatformsResponse({});
    const mm = res.platforms.find(p => p.name === 'metamask');
    assert.equal(mm.balance, null);
  });

  test('balance is populated for configured CEX when balanceMap provides a value', async () => {
    const env = { MEXC_API_KEY: 'k', MEXC_API_SECRET: 's' };
    const res = await buildPlatformsResponse(env, { mexc: 1234.56 });
    const mexc = res.platforms.find(p => p.name === 'mexc');
    assert.equal(mexc.balance, 1234.56);
  });

  test('balance remains null for a configured platform when no balance value available', async () => {
    const env = { MEXC_API_KEY: 'k', MEXC_API_SECRET: 's' };
    const res = await buildPlatformsResponse(env, {}); // no balance injected
    const mexc = res.platforms.find(p => p.name === 'mexc');
    assert.equal(mexc.balance, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Response shape
// ─────────────────────────────────────────────────────────────────────────────

describe('/api/platforms — response shape', () => {
  test('success is true', async () => {
    const res = await buildPlatformsResponse({});
    assert.equal(res.success, true);
  });

  test('each platform has required fields', async () => {
    const res = await buildPlatformsResponse({});
    const REQUIRED = ['name','type','executionMode','configured','missingKeys','balance','strategies','note'];
    for (const p of res.platforms) {
      for (const field of REQUIRED) {
        assert.ok(Object.prototype.hasOwnProperty.call(p, field), `platform ${p.name} missing field: ${field}`);
      }
    }
  });

  test('missingKeys is always an array', async () => {
    const res = await buildPlatformsResponse({});
    for (const p of res.platforms) {
      assert.ok(Array.isArray(p.missingKeys), `${p.name}.missingKeys must be an array`);
    }
  });

  test('strategies is always a non-empty array', async () => {
    const res = await buildPlatformsResponse({});
    for (const p of res.platforms) {
      assert.ok(Array.isArray(p.strategies) && p.strategies.length > 0,
        `${p.name}.strategies must be non-empty`);
    }
  });
});
