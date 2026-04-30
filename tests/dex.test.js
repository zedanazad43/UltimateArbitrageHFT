// tests/dex.test.js — Unit tests for src/strategies/dex.js.
// Run with: node --test tests/dex.test.js
// Uses only Node.js built-in test runner (node:test) — no extra dependencies.
//
// DEX strategy calls getAlchemyPrice and getPancakePrice, which in turn call
// globalThis.fetch.  We intercept fetch by URL to control both price sources.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { scanDEX } from '../src/strategies/dex.js';

// WETH_BSC_ADDRESS mirrors the private constant in src/strategies/dex.js.
// It is duplicated here intentionally — the constant is not exported — so the
// test can assert that PancakeSwap is queried for the correct token address.
// If the address changes in dex.js, this constant must be updated here too.
const WETH_BSC_ADDRESS = '0x2170ed0880ac9a755fd29b2688956bd959f933f8';

// ── Mock fetch helpers ────────────────────────────────────────────────────────

function makeResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    body: { cancel: async () => {} }
  };
}

/**
 * Installs a fetch mock that routes requests to Alchemy and PancakeSwap
 * by comparing the parsed hostname of each request URL.
 *
 * @param {number} ethPrice   - ETH price returned by Alchemy API
 * @param {number} bscPrice   - ETH-on-BSC price returned by PancakeSwap API
 */
function installPriceMock(ethPrice, bscPrice) {
  globalThis.fetch = async (url) => {
    const host = new URL(url).hostname;
    // Alchemy Prices API can be served from multiple subdomains of alchemy.com
    if (host === 'api.g.alchemy.com' || host === 'eth-mainnet.g.alchemy.com') {
      return makeResponse({ data: [{ prices: [{ value: String(ethPrice) }] }] });
    }
    if (host === 'api.pancakeswap.info') {
      return makeResponse({ data: { price: String(bscPrice) } });
    }
    throw new Error(`Unexpected fetch host: ${host}`);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// scanDEX
// ─────────────────────────────────────────────────────────────────────────────

describe('scanDEX', () => {
  test('returns null when ALCHEMY_API_KEY is not configured', async () => {
    const result = await scanDEX({});
    assert.equal(result, null);
  });

  test('accepts ALCHEMY_ETHEREUM_ENDPOINT as an alternative key', async () => {
    // Use a 0.1% spread (below MIN_SPREAD_PCT=0.5%) so the function proceeds past
    // the key check but then returns null from the spread guard — not from a
    // missing-key guard.  If the key were not accepted the function would return
    // null *before* calling fetch at all, and we would never reach the spread check.
    let fetchWasCalled = false;
    globalThis.fetch = async (url) => {
      fetchWasCalled = true;
      const host = new URL(url).hostname;
      if (host === 'api.g.alchemy.com' || host === 'eth-mainnet.g.alchemy.com') {
        return makeResponse({ data: [{ prices: [{ value: '2000' }] }] });
      }
      if (host === 'api.pancakeswap.info') {
        return makeResponse({ data: { price: '2002' } }); // 0.1% spread
      }
      throw new Error(`Unexpected fetch host: ${host}`);
    };
    await scanDEX({ ALCHEMY_ETHEREUM_ENDPOINT: 'https://eth-mainnet.g.alchemy.com/v2/testkey' });
    assert.equal(fetchWasCalled, true, 'fetch should have been called (key was accepted)');
  });

  test('returns null when the price spread is below the 0.5% minimum', async () => {
    // 0.3% spread — below MIN_SPREAD_PCT = 0.5
    installPriceMock(2000, 2006);
    const result = await scanDEX({ ALCHEMY_API_KEY: 'testkey' });
    assert.equal(result, null);
  });

  test('returns null when net profit is zero or negative (spread <= BRIDGE_COST_PCT)', async () => {
    // 0.2% gross spread equals the bridge cost → netPct = 0 → no opportunity
    installPriceMock(2000, 2004);
    const result = await scanDEX({ ALCHEMY_API_KEY: 'testkey' });
    assert.equal(result, null);
  });

  test('returns opportunity when BSC price > ETH price (buy on Ethereum, sell on BSC)', async () => {
    // 5% spread: ethPrice=2000, bscPrice=2100 → buy on ETH, sell on BSC
    installPriceMock(2000, 2100);
    const result = await scanDEX({ ALCHEMY_API_KEY: 'testkey' });

    assert.notEqual(result, null);
    assert.equal(result.strategy,     'dex');
    assert.equal(result.symbol,       'ETHUSDT');
    assert.equal(result.buyExchange,  'ethereum');
    assert.equal(result.sellExchange, 'bsc');
    assert.equal(result.direction,    'ETH→BSC');
    assert.equal(result.buyPrice,     2000);
    assert.equal(result.sellPrice,    2100);
    assert.ok(result.netPct > 0, 'netPct should be positive');
    assert.equal(result.isPerp, false);
  });

  test('returns opportunity when ETH price > BSC price (buy on BSC, sell on Ethereum)', async () => {
    // 5% spread: ethPrice=2100, bscPrice=2000 → buy on BSC, sell on ETH
    installPriceMock(2100, 2000);
    const result = await scanDEX({ ALCHEMY_API_KEY: 'testkey' });

    assert.notEqual(result, null);
    assert.equal(result.buyExchange,  'bsc');
    assert.equal(result.sellExchange, 'ethereum');
    assert.equal(result.direction,    'BSC→ETH');
    assert.equal(result.buyPrice,     2000);
    assert.equal(result.sellPrice,    2100);
  });

  test('netPct equals absSpread minus BRIDGE_COST_PCT (0.2%)', async () => {
    // exactAbsSpread = (2100 - 2000) / 2000 * 100 = 5%
    // netPct = 5 - 0.2 = 4.8
    installPriceMock(2000, 2100);
    const result = await scanDEX({ ALCHEMY_API_KEY: 'testkey' });
    assert.notEqual(result, null);
    assert.ok(Math.abs(result.grossPct - 5.0) < 0.01, `expected grossPct ≈ 5, got ${result.grossPct}`);
    assert.ok(Math.abs(result.netPct - 4.8) < 0.01, `expected netPct ≈ 4.8, got ${result.netPct}`);
  });

  test('safetyFactor equals netPct / grossPct', async () => {
    installPriceMock(2000, 2100);
    const result = await scanDEX({ ALCHEMY_API_KEY: 'testkey' });
    assert.notEqual(result, null);
    const expected = result.netPct / result.grossPct;
    assert.ok(Math.abs(result.safetyFactor - expected) < 0.0001);
  });

  test('returns null (does not throw) when Alchemy fetch fails', async () => {
    // Return a bad response that makes getAlchemyPrice throw (missing price field).
    globalThis.fetch = async (url) => {
      const host = new URL(url).hostname;
      if (host === 'api.g.alchemy.com') return makeResponse({ data: [] });
      if (host === 'api.pancakeswap.info') return makeResponse({ data: { price: '2100' } });
      throw new Error(`Unexpected fetch host: ${host}`);
    };
    const result = await scanDEX({ ALCHEMY_API_KEY: 'testkey' });
    assert.equal(result, null, 'scanDEX should catch errors and return null');
  });

  test('returns null (does not throw) when PancakeSwap fetch fails', async () => {
    // Return a bad response that makes getPancakePrice throw (missing price field).
    globalThis.fetch = async (url) => {
      const host = new URL(url).hostname;
      if (host === 'api.g.alchemy.com') return makeResponse({ data: [{ prices: [{ value: '2000' }] }] });
      if (host === 'api.pancakeswap.info') return makeResponse({ data: {} }); // missing price
      throw new Error(`Unexpected fetch host: ${host}`);
    };
    const result = await scanDEX({ ALCHEMY_API_KEY: 'testkey' });
    assert.equal(result, null, 'scanDEX should catch errors and return null');
  });

  test('uses the WETH BSC address when fetching PancakeSwap price', async () => {
    let pancakeUrl;
    globalThis.fetch = async (url) => {
      const host = new URL(url).hostname;
      if (host === 'api.pancakeswap.info') {
        pancakeUrl = url;
        return makeResponse({ data: { price: '2100' } });
      }
      return makeResponse({ data: [{ prices: [{ value: '2000' }] }] });
    };
    await scanDEX({ ALCHEMY_API_KEY: 'testkey' });
    assert.ok(
      pancakeUrl && pancakeUrl.includes(WETH_BSC_ADDRESS),
      'PancakeSwap URL should include the WETH BSC contract address'
    );
  });
});
