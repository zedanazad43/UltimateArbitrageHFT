// tests/hft-client.test.js — Unit tests for src/hft-client.js
// Run with: node --test tests/hft-client.test.js
// Uses only Node.js built-in test runner (node:test) — no extra dependencies.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  isHFTEngineConfigured,
  scanFromHFT,
  executeViaHFT,
} from '../src/hft-client.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** Returns a minimal Go-style Opportunity object */
function goOpp(overrides = {}) {
  return {
    Strategy:     'cex',
    Symbol:       'BTCUSDT',
    BuyExchange:  'Mexc',
    SellExchange: 'Binance',
    BuyPrice:     60000,
    SellPrice:    60600,
    GrossPct:     1.0,
    NetPct:       0.8,
    SafetyFactor: 0.8,
    Direction:    'MEXC→BINANCE',
    IsPerp:       false,
    ...overrides,
  };
}

// ── isHFTEngineConfigured ─────────────────────────────────────────────────────

describe('isHFTEngineConfigured', () => {
  test('returns false when HFT_ENGINE_URL is absent', () => {
    assert.equal(isHFTEngineConfigured({}), false);
  });

  test('returns false when HFT_ENGINE_URL is an empty string', () => {
    assert.equal(isHFTEngineConfigured({ HFT_ENGINE_URL: '' }), false);
  });

  test('returns true when HFT_ENGINE_URL is set', () => {
    assert.equal(isHFTEngineConfigured({ HFT_ENGINE_URL: 'http://localhost:8080' }), true);
  });
});

// ── scanFromHFT ───────────────────────────────────────────────────────────────

describe('scanFromHFT', () => {
  beforeEach(() => {
    globalThis.fetch = undefined;
  });

  test('returns null when HFT_ENGINE_URL is not configured', async () => {
    const result = await scanFromHFT({});
    assert.equal(result, null);
  });

  test('returns null when the engine returns a non-ok response', async () => {
    globalThis.fetch = async () => makeResponse({ error: 'internal error' }, 500);
    const result = await scanFromHFT({ HFT_ENGINE_URL: 'http://localhost:8080' });
    assert.equal(result, null);
  });

  test('returns null when fetch throws', async () => {
    globalThis.fetch = async () => { throw new Error('connection refused'); };
    const result = await scanFromHFT({ HFT_ENGINE_URL: 'http://localhost:8080' });
    assert.equal(result, null);
  });

  test('returns null when opportunity is null in response', async () => {
    globalThis.fetch = async () => makeResponse({ opportunity: null });
    const result = await scanFromHFT({ HFT_ENGINE_URL: 'http://localhost:8080' });
    assert.equal(result, null);
  });

  test('returns a normalised OpportunityObject when opportunity is present', async () => {
    globalThis.fetch = async () => makeResponse({ opportunity: goOpp() });
    const result = await scanFromHFT({ HFT_ENGINE_URL: 'http://localhost:8080' });

    assert.notEqual(result, null);
    // Fields should be lowercased / normalised
    assert.equal(result.strategy,     'cex');
    assert.equal(result.symbol,       'BTCUSDT');
    assert.equal(result.buyExchange,  'mexc');   // lowercased
    assert.equal(result.sellExchange, 'binance'); // lowercased
    assert.equal(result.buyPrice,     60000);
    assert.equal(result.sellPrice,    60600);
    assert.equal(result.netPct,       0.8);
    assert.equal(result.isPerp,       false);
    assert.equal(result.source,       'hft_engine');
  });

  test('sends Authorization header when HFT_ENGINE_SECRET is set', async () => {
    let capturedHeaders;
    globalThis.fetch = async (_url, opts) => {
      capturedHeaders = opts?.headers || {};
      return makeResponse({ opportunity: goOpp() });
    };
    await scanFromHFT({ HFT_ENGINE_URL: 'http://localhost:8080', HFT_ENGINE_SECRET: 'mysecret' });
    assert.equal(capturedHeaders['Authorization'], 'Bearer mysecret');
  });

  test('does not send Authorization header when HFT_ENGINE_SECRET is absent', async () => {
    let capturedHeaders;
    globalThis.fetch = async (_url, opts) => {
      capturedHeaders = opts?.headers || {};
      return makeResponse({ opportunity: goOpp() });
    };
    await scanFromHFT({ HFT_ENGINE_URL: 'http://localhost:8080' });
    assert.equal(capturedHeaders['Authorization'], undefined);
  });

  test('normalises camelCase fields from engine (tolerant of both field styles)', async () => {
    // The engine may return either PascalCase or camelCase — the client should handle both
    const camelOpp = {
      strategy: 'perps', symbol: 'ETHUSDT', buyExchange: 'Mexc', sellExchange: 'Bybit',
      buyPrice: 3000, sellPrice: 3030, grossPct: 1.0, netPct: 0.7,
      safetyFactor: 0.7, direction: 'MEXC→BYBIT', isPerp: true,
    };
    globalThis.fetch = async () => makeResponse({ opportunity: camelOpp });
    const result = await scanFromHFT({ HFT_ENGINE_URL: 'http://localhost:8080' });

    assert.notEqual(result, null);
    assert.equal(result.strategy,     'perps');
    assert.equal(result.buyExchange,  'mexc');
    assert.equal(result.isPerp,       true);
    assert.equal(result.source,       'hft_engine');
  });
});

// ── executeViaHFT ─────────────────────────────────────────────────────────────

describe('executeViaHFT', () => {
  const sampleOpp = {
    strategy: 'dex', symbol: 'ETHUSDT',
    buyExchange: 'ethereum', sellExchange: 'bsc',
    buyPrice: 3000, sellPrice: 3150,
    grossPct: 5.0, netPct: 4.8,
    safetyFactor: 0.96, direction: 'ETH→BSC', isPerp: false,
  };

  test('throws when HFT_ENGINE_URL is not configured', async () => {
    await assert.rejects(
      () => executeViaHFT({}, sampleOpp, 500),
      /HFT_ENGINE_URL is not configured/
    );
  });

  test('throws when the engine returns a non-ok response', async () => {
    globalThis.fetch = async () => makeResponse({ error: 'insufficient balance' }, 400);
    await assert.rejects(
      () => executeViaHFT({ HFT_ENGINE_URL: 'http://localhost:8080' }, sampleOpp, 500),
      /HFT engine execute failed/
    );
  });

  test('resolves without throwing on a successful 200 response', async () => {
    globalThis.fetch = async () => makeResponse({ success: true });
    await assert.doesNotReject(
      () => executeViaHFT({ HFT_ENGINE_URL: 'http://localhost:8080' }, sampleOpp, 500)
    );
  });

  test('sends a POST request with the correct body', async () => {
    let capturedBody;
    globalThis.fetch = async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return makeResponse({ success: true });
    };
    await executeViaHFT({ HFT_ENGINE_URL: 'http://localhost:8080' }, sampleOpp, 250);

    // The body should include the denormalised (PascalCase) opportunity and size
    assert.equal(capturedBody.size_usd, 250);
    assert.equal(capturedBody.opportunity.Strategy, 'dex');
    assert.equal(capturedBody.opportunity.Symbol,   'ETHUSDT');
    assert.equal(capturedBody.opportunity.BuyPrice, 3000);
  });

  test('sends Authorization header when HFT_ENGINE_SECRET is set', async () => {
    let capturedHeaders;
    globalThis.fetch = async (_url, opts) => {
      capturedHeaders = opts?.headers || {};
      return makeResponse({ success: true });
    };
    await executeViaHFT(
      { HFT_ENGINE_URL: 'http://localhost:8080', HFT_ENGINE_SECRET: 'tok' },
      sampleOpp, 100
    );
    assert.equal(capturedHeaders['Authorization'], 'Bearer tok');
  });
});
