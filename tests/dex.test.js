// tests/dex.test.js — Unit tests for src/strategies/dex.js.
// Run with: node --test tests/dex.test.js
// Uses only Node.js built-in test runner (node:test) — no extra dependencies.
//
// DEX strategy calls getAlchemyPrice and getPancakePrice, which in turn call
// globalThis.fetch.  We intercept fetch by URL to control both price sources.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { scanDEX, DEX_TOKENS } from '../src/strategies/dex.js';

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
// DEX_TOKENS config
// ─────────────────────────────────────────────────────────────────────────────

describe('DEX_TOKENS config', () => {
  test('exports an array with at least 3 entries', () => {
    assert.ok(Array.isArray(DEX_TOKENS), 'DEX_TOKENS should be an array');
    assert.ok(DEX_TOKENS.length >= 3, `expected ≥ 3 tokens, got ${DEX_TOKENS.length}`);
  });

  test('each token has required fields', () => {
    for (const tok of DEX_TOKENS) {
      assert.ok(typeof tok.symbol === 'string' && tok.symbol.length > 0,
        `token ${JSON.stringify(tok)} missing symbol`);
      assert.ok(typeof tok.alchemySymbol === 'string' && tok.alchemySymbol.length > 0,
        `token ${tok.symbol} missing alchemySymbol`);
      assert.ok(typeof tok.bscAddress === 'string' && tok.bscAddress.startsWith('0x'),
        `token ${tok.symbol} missing/invalid bscAddress`);
    }
  });

  test('includes ETH, BTC, and BNB pairs', () => {
    const symbols = DEX_TOKENS.map(t => t.symbol);
    assert.ok(symbols.includes('ETHUSDT'), 'should include ETHUSDT');
    assert.ok(symbols.includes('BTCUSDT'), 'should include BTCUSDT');
    assert.ok(symbols.includes('BNBUSDT'), 'should include BNBUSDT');
  });

  test('all BSC addresses are unique (no duplicates)', () => {
    const addrs = DEX_TOKENS.map(t => t.bscAddress.toLowerCase());
    const unique = new Set(addrs);
    assert.equal(unique.size, addrs.length, 'BSC addresses should all be unique');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// scanDEX — key checks
// ─────────────────────────────────────────────────────────────────────────────

describe('scanDEX', () => {
  test('returns null when ALCHEMY_API_KEY is not configured', async () => {
    const prevAlchemyApiKey = process.env.ALCHEMY_API_KEY;
    delete process.env.ALCHEMY_API_KEY;

    const result = await scanDEX({});
    assert.equal(result, null);

    if (prevAlchemyApiKey === undefined) {
      delete process.env.ALCHEMY_API_KEY;
    } else {
      process.env.ALCHEMY_API_KEY = prevAlchemyApiKey;
    }
  });

  test('accepts ALCHEMY_ETHEREUM_ENDPOINT as an alternative key', async () => {
    // Use a 0.1% spread (below MIN_SPREAD_PCT=0.3%) so the function proceeds past
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

  test('returns null when all pair spreads are below the 0.3% minimum', async () => {
    // 0.25% spread on all pairs — below MIN_SPREAD_PCT = 0.3
    installPriceMock(2000, 2005);
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
    assert.equal(result.buyExchange,  'ethereum');
    assert.equal(result.sellExchange, 'bsc');
    assert.equal(result.direction,    'ETH→BSC');
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

  test('opportunity includes gasEstimateUSD field', async () => {
    installPriceMock(2000, 2100);
    const result = await scanDEX({ ALCHEMY_API_KEY: 'testkey' });
    assert.notEqual(result, null);
    assert.ok(typeof result.gasEstimateUSD === 'number' && result.gasEstimateUSD > 0,
      'gasEstimateUSD should be a positive number');
  });

  test('symbol field matches one of the configured DEX_TOKENS', async () => {
    installPriceMock(2000, 2100);
    const result = await scanDEX({ ALCHEMY_API_KEY: 'testkey' });
    assert.notEqual(result, null);
    const symbols = DEX_TOKENS.map(t => t.symbol);
    assert.ok(symbols.includes(result.symbol),
      `result.symbol "${result.symbol}" should be in DEX_TOKENS`);
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

  test('uses the WETH BSC address when fetching PancakeSwap price for ETH', async () => {
    const wethBSCAddress = DEX_TOKENS.find(t => t.symbol === 'ETHUSDT').bscAddress;
    const pancakeUrls = [];
    globalThis.fetch = async (url) => {
      const host = new URL(url).hostname;
      if (host === 'api.pancakeswap.info') {
        pancakeUrls.push(url);
        return makeResponse({ data: { price: '2100' } });
      }
      return makeResponse({ data: [{ prices: [{ value: '2000' }] }] });
    };
    await scanDEX({ ALCHEMY_API_KEY: 'testkey' });
    assert.ok(
      pancakeUrls.some(u => u.includes(wethBSCAddress)),
      'At least one PancakeSwap URL should include the WETH BSC contract address'
    );
  });

  test('scans multiple token pairs (queries PancakeSwap for each DEX_TOKEN)', async () => {
    const pancakeUrls = [];
    globalThis.fetch = async (url) => {
      const host = new URL(url).hostname;
      if (host === 'api.pancakeswap.info') {
        pancakeUrls.push(url);
        return makeResponse({ data: { price: '100' } }); // below spread threshold
      }
      return makeResponse({ data: [{ prices: [{ value: '100' }] }] });
    };
    await scanDEX({ ALCHEMY_API_KEY: 'testkey' });
    // Each DEX_TOKEN should trigger a PancakeSwap query.
    assert.ok(pancakeUrls.length >= DEX_TOKENS.length,
      `expected ≥ ${DEX_TOKENS.length} PancakeSwap calls, got ${pancakeUrls.length}`);
  });

  test('returns the highest-netPct opportunity when multiple pairs are profitable', async () => {
    // We simulate different spreads per pair by routing by BSC token address.
    const wethAddress = DEX_TOKENS.find(t => t.symbol === 'ETHUSDT').bscAddress.toLowerCase();
    const wbtcAddress = DEX_TOKENS.find(t => t.symbol === 'BTCUSDT').bscAddress.toLowerCase();

    globalThis.fetch = async (url) => {
      const host = new URL(url).hostname;
      if (host === 'api.g.alchemy.com') {
        // Return 1000 as the Ethereum price for any symbol
        return makeResponse({ data: [{ prices: [{ value: '1000' }] }] });
      }
      if (host === 'api.pancakeswap.info') {
        // WETH on BSC: 5% higher (large spread)
        if (url.toLowerCase().includes(wethAddress)) return makeResponse({ data: { price: '1050' } });
        // WBTC on BSC: 3% higher (smaller spread)
        if (url.toLowerCase().includes(wbtcAddress)) return makeResponse({ data: { price: '1030' } });
        // BNB: 0.1% higher (below threshold)
        return makeResponse({ data: { price: '1001' } });
      }
      throw new Error(`Unexpected fetch host: ${host}`);
    };

    const result = await scanDEX({ ALCHEMY_API_KEY: 'testkey' });
    assert.notEqual(result, null, 'should return an opportunity');
    // ETH has the largest spread — it should win.
    assert.equal(result.symbol, 'ETHUSDT', 'should pick the highest-spread pair (ETHUSDT)');
  });
});

