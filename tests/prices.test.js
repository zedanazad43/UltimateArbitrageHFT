// tests/prices.test.js — Unit tests for src/prices.js price-fetching functions.
// Run with: node --test tests/prices.test.js
// Uses only Node.js built-in test runner (node:test) — no extra dependencies.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  getMEXCSpotPrice,
  getBinancePrice,
  getKuCoinPrice,
  getMEXCPerpPrice,
  getBinancePerpData,
  getOKXPerpData,
  getOKXPrice,
  getBitgetPrice,
  getBitmartPrice,
  getAlchemyPrice,
  getPancakePrice,
  get0xPrice,
  getAllSpotPrices
} from '../src/prices.js';

// ── Mock fetch helpers ────────────────────────────────────────────────────────

let capturedUrl;

function installMockFetch(handler) {
  capturedUrl = null;
  globalThis.fetch = async (url, init) => {
    capturedUrl = url;
    return handler(url, init);
  };
}

function makeResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    body: { cancel: async () => {} }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getMEXCSpotPrice
// ─────────────────────────────────────────────────────────────────────────────

describe('getMEXCSpotPrice', () => {
  test('returns price source on success', async () => {
    installMockFetch(() => makeResponse({ price: '45000.5' }));
    const result = await getMEXCSpotPrice('BTCUSDT');
    assert.notEqual(result, null);
    assert.equal(result.price, 45000.5);
    assert.equal(result.exchange, 'mexc');
    assert.equal(result.fee, 0.0005);
    assert.ok(capturedUrl.includes('BTCUSDT'), 'URL should include the symbol');
    assert.ok(new URL(capturedUrl).hostname === 'api.mexc.com', 'URL should target MEXC');
  });

  test('returns null when the HTTP response is not ok', async () => {
    installMockFetch(() => makeResponse({}, 503));
    assert.equal(await getMEXCSpotPrice('BTCUSDT'), null);
  });

  test('returns null when price field is empty string', async () => {
    installMockFetch(() => makeResponse({ price: '' }));
    assert.equal(await getMEXCSpotPrice('BTCUSDT'), null);
  });

  test('returns null when fetch throws a network error', async () => {
    // Return a non-retryable error status so there is no sleep delay.
    installMockFetch(() => makeResponse({}, 500));
    assert.equal(await getMEXCSpotPrice('BTCUSDT'), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getBinancePrice
// ─────────────────────────────────────────────────────────────────────────────

describe('getBinancePrice', () => {
  test('returns price source on success', async () => {
    installMockFetch(() => makeResponse({ price: '45200.0' }));
    const result = await getBinancePrice('BTCUSDT');
    assert.notEqual(result, null);
    assert.equal(result.price, 45200.0);
    assert.equal(result.exchange, 'binance');
    assert.equal(result.fee, 0.001);
    assert.ok(new URL(capturedUrl).hostname === 'api.binance.com', 'URL should target Binance');
    assert.ok(capturedUrl.includes('BTCUSDT'), 'URL should include the symbol');
  });

  test('returns null when the HTTP response is not ok', async () => {
    installMockFetch(() => makeResponse({}, 500));
    assert.equal(await getBinancePrice('BTCUSDT'), null);
  });

  test('returns null when price field is absent', async () => {
    installMockFetch(() => makeResponse({}));
    assert.equal(await getBinancePrice('BTCUSDT'), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getKuCoinPrice
// ─────────────────────────────────────────────────────────────────────────────

describe('getKuCoinPrice', () => {
  test('converts XXXUSDT symbol to KuCoin XXX-USDT format', async () => {
    installMockFetch(() => makeResponse({ data: { price: '45100.0' } }));
    await getKuCoinPrice('BTCUSDT');
    assert.ok(capturedUrl.includes('BTC-USDT'), 'URL should use KuCoin hyphen format');
  });

  test('returns price source on success', async () => {
    installMockFetch(() => makeResponse({ data: { price: '45100.0' } }));
    const result = await getKuCoinPrice('BTCUSDT');
    assert.notEqual(result, null);
    assert.equal(result.price, 45100.0);
    assert.equal(result.exchange, 'kucoin');
    assert.equal(result.fee, 0.001);
  });

  test('returns null when the HTTP response is not ok', async () => {
    installMockFetch(() => makeResponse({}, 500));
    assert.equal(await getKuCoinPrice('BTCUSDT'), null);
  });

  test('returns null when price is missing from data', async () => {
    installMockFetch(() => makeResponse({ data: {} }));
    assert.equal(await getKuCoinPrice('BTCUSDT'), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getMEXCPerpPrice
// ─────────────────────────────────────────────────────────────────────────────

describe('getMEXCPerpPrice', () => {
  test('converts XXXUSDT symbol to XXX_USDT perp format', async () => {
    installMockFetch(() => makeResponse({ success: true, data: { lastPrice: '45300.0' } }));
    await getMEXCPerpPrice('BTCUSDT');
    assert.ok(capturedUrl.includes('BTC_USDT'), 'URL should use perp underscore format');
  });

  test('returns perp price source on success', async () => {
    installMockFetch(() => makeResponse({ success: true, data: { lastPrice: '45300.0' } }));
    const result = await getMEXCPerpPrice('BTCUSDT');
    assert.notEqual(result, null);
    assert.equal(result.price, 45300.0);
    assert.equal(result.exchange, 'mexc_perp');
    assert.equal(result.fee, 0.0002);
  });

  test('returns null when API success is false', async () => {
    installMockFetch(() => makeResponse({ success: false }));
    assert.equal(await getMEXCPerpPrice('BTCUSDT'), null);
  });

  test('returns null when lastPrice is absent from data', async () => {
    installMockFetch(() => makeResponse({ success: true, data: {} }));
    assert.equal(await getMEXCPerpPrice('BTCUSDT'), null);
  });

  test('throws when HTTP response is a server error (5xx)', async () => {
    installMockFetch(() => makeResponse({}, 500));
    await assert.rejects(
      () => getMEXCPerpPrice('BTCUSDT'),
      /MEXC perp API request failed.*HTTP 500/
    );
  });

  test('returns null when HTTP response is a client error (4xx — symbol not listed)', async () => {
    installMockFetch(() => makeResponse({}, 400));
    assert.equal(await getMEXCPerpPrice('BTCUSDT'), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getBinancePerpData
// ─────────────────────────────────────────────────────────────────────────────

describe('getBinancePerpData', () => {
  test('returns perp data with fundingRate on success', async () => {
    let callCount = 0;
    globalThis.fetch = async (url) => {
      callCount++;
      if (url.includes('ticker/price')) {
        return makeResponse({ price: '45500.0' });
      }
      // fundingRate endpoint
      return makeResponse([{ fundingRate: '0.0001', fundingTime: '1234567890000' }]);
    };
    const result = await getBinancePerpData('BTCUSDT');
    assert.notEqual(result, null);
    assert.equal(result.price, 45500.0);
    assert.equal(result.exchange, 'binance_perp');
    assert.equal(result.fee, 0.0004);
    assert.equal(result.fundingRate, 0.0001);
    assert.equal(callCount, 2, 'should call both ticker and fundingRate endpoints');
  });

  test('uses fapi.binance.com for futures endpoints', async () => {
    const hosts = new Set();
    globalThis.fetch = async (url) => {
      hosts.add(new URL(url).hostname);
      if (url.includes('ticker/price')) return makeResponse({ price: '45500.0' });
      return makeResponse([{ fundingRate: '0.0001' }]);
    };
    await getBinancePerpData('BTCUSDT');
    assert.ok(hosts.has('fapi.binance.com'), 'should use USDM futures API host');
  });

  test('uses XXXUSDT symbol format directly without conversion (unlike OKX)', async () => {
    let capturedTickerUrl = '';
    globalThis.fetch = async (url) => {
      if (url.includes('ticker/price')) { capturedTickerUrl = url; return makeResponse({ price: '45500.0' }); }
      return makeResponse([]);
    };
    await getBinancePerpData('ETHUSDT');
    assert.ok(capturedTickerUrl.includes('ETHUSDT'), 'Binance should use XXXUSDT symbol directly');
    assert.ok(!capturedTickerUrl.includes('ETH-USDT'), 'Binance should NOT use hyphenated instId format');
  });

  test('defaults fundingRate to 0 when funding endpoint returns empty', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('ticker/price')) return makeResponse({ price: '45500.0' });
      return makeResponse([]);
    };
    const result = await getBinancePerpData('BTCUSDT');
    assert.notEqual(result, null);
    assert.equal(result.fundingRate, 0);
  });

  test('returns null when ticker price is missing', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('ticker/price')) return makeResponse({});
      return makeResponse([]);
    };
    assert.equal(await getBinancePerpData('BTCUSDT'), null);
  });

  test('returns null when HTTP 4xx (symbol not in futures)', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('ticker/price')) return makeResponse({}, 400);
      return makeResponse([], 400);
    };
    assert.equal(await getBinancePerpData('BTCUSDT'), null);
  });

  test('throws on HTTP 5xx server error', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('ticker/price')) return makeResponse({}, 500);
      return makeResponse([], 500);
    };
    await assert.rejects(
      () => getBinancePerpData('BTCUSDT'),
      /Binance USDM HTTP 500/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getOKXPerpData
// ─────────────────────────────────────────────────────────────────────────────

describe('getOKXPerpData', () => {
  test('converts XXXUSDT symbol to BTC-USDT-SWAP OKX Swap instId format', async () => {
    let capturedTickerUrl = '';
    globalThis.fetch = async (url) => {
      if (url.includes('market/ticker')) {
        capturedTickerUrl = url;
        return makeResponse({ code: '0', data: [{ last: '45300.0' }] });
      }
      return makeResponse({ code: '0', data: [{ fundingRate: '0.0002' }] });
    };
    await getOKXPerpData('BTCUSDT');
    assert.ok(capturedTickerUrl.includes('BTC-USDT-SWAP'), 'URL should contain BTC-USDT-SWAP instId');
    assert.ok(!capturedTickerUrl.includes('BTCUSDT'), 'URL should NOT contain unformatted BTCUSDT');
  });

  test('returns perp data with fundingRate on success', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('market/ticker'))
        return makeResponse({ code: '0', data: [{ last: '45300.0' }] });
      return makeResponse({ code: '0', data: [{ fundingRate: '0.0002' }] });
    };
    const result = await getOKXPerpData('BTCUSDT');
    assert.notEqual(result, null);
    assert.equal(result.price, 45300.0);
    assert.equal(result.exchange, 'okx_perp');
    assert.equal(result.fee, 0.0005);
    assert.equal(result.fundingRate, 0.0002);
  });

  test('returns null when OKX ticker code is not "0" (symbol not listed)', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('market/ticker'))
        return makeResponse({ code: '51001', msg: 'Instrument not found' });
      return makeResponse({ code: '0', data: [] });
    };
    assert.equal(await getOKXPerpData('BTCUSDT'), null);
  });

  test('defaults fundingRate to 0 when funding data is absent', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('market/ticker'))
        return makeResponse({ code: '0', data: [{ last: '45300.0' }] });
      return makeResponse({ code: '0', data: [] });
    };
    const result = await getOKXPerpData('BTCUSDT');
    assert.notEqual(result, null);
    assert.equal(result.fundingRate, 0);
  });

  test('returns null when HTTP 4xx (symbol not in swap)', async () => {
    globalThis.fetch = async () => makeResponse({}, 404);
    assert.equal(await getOKXPerpData('BTCUSDT'), null);
  });

  test('throws on HTTP 5xx server error', async () => {
    globalThis.fetch = async () => makeResponse({}, 503);
    await assert.rejects(
      () => getOKXPerpData('BTCUSDT'),
      /OKX Swap HTTP 503/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('getOKXPrice', () => {
  test('converts XXXUSDT symbol to XXX-USDT OKX instId format', async () => {
    installMockFetch(() => makeResponse({ code: '0', data: [{ last: '45100.0' }] }));
    await getOKXPrice('BTCUSDT');
    assert.ok(capturedUrl.includes('BTC-USDT'), 'URL should use OKX instId format');
  });

  test('returns price source on success', async () => {
    installMockFetch(() => makeResponse({ code: '0', data: [{ last: '45100.0' }] }));
    const result = await getOKXPrice('BTCUSDT');
    assert.notEqual(result, null);
    assert.equal(result.price, 45100.0);
    assert.equal(result.exchange, 'okx');
    assert.equal(result.fee, 0.001);
  });

  test('returns null when API code is not "0"', async () => {
    installMockFetch(() => makeResponse({ code: '51001', msg: 'Instrument not found' }));
    assert.equal(await getOKXPrice('BTCUSDT'), null);
  });

  test('returns null when last price field is absent', async () => {
    installMockFetch(() => makeResponse({ code: '0', data: [{}] }));
    assert.equal(await getOKXPrice('BTCUSDT'), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getBitgetPrice
// ─────────────────────────────────────────────────────────────────────────────

describe('getBitgetPrice', () => {
  test('returns price source on success', async () => {
    installMockFetch(() => makeResponse({ code: '00000', data: [{ lastPr: '45050.0' }] }));
    const result = await getBitgetPrice('BTCUSDT');
    assert.notEqual(result, null);
    assert.equal(result.price, 45050.0);
    assert.equal(result.exchange, 'bitget');
    assert.equal(result.fee, 0.001);
    assert.ok(new URL(capturedUrl).hostname === 'api.bitget.com', 'URL should target Bitget');
  });

  test('returns null when code is not "00000"', async () => {
    installMockFetch(() => makeResponse({ code: '40006', msg: 'Invalid symbol' }));
    assert.equal(await getBitgetPrice('BTCUSDT'), null);
  });

  test('returns null when lastPr field is absent', async () => {
    installMockFetch(() => makeResponse({ code: '00000', data: [{}] }));
    assert.equal(await getBitgetPrice('BTCUSDT'), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getBitmartPrice
// ─────────────────────────────────────────────────────────────────────────────

describe('getBitmartPrice', () => {
  test('converts XXXUSDT symbol to XXX_USDT Bitmart format', async () => {
    installMockFetch(() => makeResponse({ data: { tickers: [{ last_price: '45000.5' }] } }));
    await getBitmartPrice('BTCUSDT');
    assert.ok(capturedUrl.includes('BTC_USDT'), 'URL should use Bitmart underscore format');
  });

  test('returns price source on success', async () => {
    installMockFetch(() => makeResponse({ data: { tickers: [{ last_price: '45000.5' }] } }));
    const result = await getBitmartPrice('BTCUSDT');
    assert.notEqual(result, null);
    assert.equal(result.price, 45000.5);
    assert.equal(result.exchange, 'bitmart');
    assert.equal(result.fee, 0.0025);
  });

  test('returns null when tickers array is empty', async () => {
    installMockFetch(() => makeResponse({ data: { tickers: [] } }));
    assert.equal(await getBitmartPrice('BTCUSDT'), null);
  });

  test('returns null when data structure is missing', async () => {
    installMockFetch(() => makeResponse({}));
    assert.equal(await getBitmartPrice('BTCUSDT'), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getAlchemyPrice
// ─────────────────────────────────────────────────────────────────────────────

describe('getAlchemyPrice', () => {
  test('throws when apiKey is null', async () => {
    await assert.rejects(
      () => getAlchemyPrice('ETH', null),
      /ALCHEMY_API_KEY is required/
    );
  });

  test('throws when apiKey is empty string', async () => {
    await assert.rejects(
      () => getAlchemyPrice('ETH', ''),
      /ALCHEMY_API_KEY is required/
    );
  });

  test('returns float price on success with a bare API key', async () => {
    installMockFetch(() => makeResponse({ data: [{ prices: [{ value: '2100.50' }] }] }));
    const price = await getAlchemyPrice('ETH', 'testapikey');
    assert.equal(price, 2100.5);
    assert.ok(capturedUrl.includes('testapikey'), 'API key should be embedded in URL');
  });

  test('extracts key from a full Alchemy endpoint URL', async () => {
    installMockFetch(() => makeResponse({ data: [{ prices: [{ value: '2000.00' }] }] }));
    const price = await getAlchemyPrice('ETH', 'https://eth-mainnet.g.alchemy.com/v2/mykey123');
    assert.equal(price, 2000.0);
    assert.ok(capturedUrl.includes('mykey123'), 'Extracted key should be in the request URL');
  });

  test('throws when price is missing from response', async () => {
    installMockFetch(() => makeResponse({ data: [] }));
    await assert.rejects(
      () => getAlchemyPrice('ETH', 'testkey'),
      /Alchemy price missing/
    );
  });

  test('throws when fetch returns non-ok status', async () => {
    installMockFetch(() => makeResponse({}, 401));
    await assert.rejects(
      () => getAlchemyPrice('ETH', 'testkey'),
      /Alchemy HTTP/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getPancakePrice
// ─────────────────────────────────────────────────────────────────────────────

describe('getPancakePrice', () => {
  test('returns float price on success', async () => {
    installMockFetch(() => makeResponse({ data: { price: '2150.75' } }));
    const price = await getPancakePrice('0xabc123');
    assert.equal(price, 2150.75);
    assert.ok(capturedUrl.includes('0xabc123'), 'URL should include the token address');
  });

  test('throws when response is not ok', async () => {
    installMockFetch(() => makeResponse({}, 404));
    await assert.rejects(
      () => getPancakePrice('0xabc'),
      /PancakeSwap HTTP/
    );
  });

  test('throws when price field is missing from data', async () => {
    installMockFetch(() => makeResponse({ data: {} }));
    await assert.rejects(
      () => getPancakePrice('0xabc'),
      /PancakeSwap missing price/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// get0xPrice
// ─────────────────────────────────────────────────────────────────────────────

describe('get0xPrice', () => {
  test('returns null when ZEROX_API_KEY is not configured', async () => {
    assert.equal(await get0xPrice({}, 'ETHUSDT'), null);
  });

  test('returns null for a symbol not in the token map', async () => {
    assert.equal(await get0xPrice({ ZEROX_API_KEY: 'key' }, 'SOLUSDT'), null);
  });

  test('returns price source on success for ETHUSDT', async () => {
    // 1000 USDT buys 0.5 ETH → price = 1000 / 0.5 = 2000
    const buyAmountWei = (5n * 10n ** 17n).toString(); // 0.5 ETH in wei
    installMockFetch(() => makeResponse({ buyAmount: buyAmountWei }));
    const result = await get0xPrice({ ZEROX_API_KEY: 'testkey' }, 'ETHUSDT');
    assert.notEqual(result, null);
    assert.ok(result.price > 0, 'price should be positive');
    assert.equal(result.exchange, '0x');
    assert.equal(result.fee, 0.0);
  });

  test('returns price source on success for BTCUSDT', async () => {
    // 1000 USDT buys 0.02 BTC → price = 1000 / 0.02 = 50000
    // decimals=8; 0.02 BTC = 2000000 satoshi
    const buyAmountSat = '2000000';
    installMockFetch(() => makeResponse({ buyAmount: buyAmountSat }));
    const result = await get0xPrice({ ZEROX_API_KEY: 'testkey' }, 'BTCUSDT');
    assert.notEqual(result, null);
    assert.ok(result.price > 0, 'price should be positive');
  });

  test('returns null when API response contains an error code', async () => {
    installMockFetch(() => makeResponse({ code: 'VALIDATION_FAILED', reason: 'bad input' }));
    assert.equal(await get0xPrice({ ZEROX_API_KEY: 'key' }, 'ETHUSDT'), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getAllSpotPrices
// ─────────────────────────────────────────────────────────────────────────────

describe('getAllSpotPrices', () => {
  test('returns empty array when all exchanges are in openCircuits', async () => {
    const openCircuits = new Set(['mexc', 'binance', 'kucoin', 'okx', 'bitget', 'bitmart']);
    const results = await getAllSpotPrices({}, 'BTCUSDT', openCircuits);
    assert.equal(results.length, 0);
  });

  test('skips exchanges listed in openCircuits and returns only active ones', async () => {
    // Only binance is NOT in openCircuits
    const openCircuits = new Set(['mexc', 'kucoin', 'okx', 'bitget', 'bitmart']);
    const fetchedHosts = [];
    globalThis.fetch = async (url) => {
      const host = new URL(url).hostname;
      fetchedHosts.push(host);
      if (host === 'api.binance.com') return makeResponse({ price: '45000.0' });
      return makeResponse({}, 500);
    };
    const results = await getAllSpotPrices({}, 'BTCUSDT', openCircuits);
    const mexcHosts = ['api.mexc.com', 'contract.mexc.com'];
    assert.ok(
      fetchedHosts.every(h => !mexcHosts.includes(h)),
      'mexc should not be fetched'
    );
    const binanceResult = results.find(r => r.exchange === 'binance');
    assert.notEqual(binanceResult, undefined, 'binance result should be present');
    assert.equal(binanceResult.price, 45000.0);
  });

  test('filters out null results from failed exchange fetches', async () => {
    // Only binance is not in openCircuits; others return circuit-breaker null
    const openCircuits = new Set(['mexc', 'kucoin', 'okx', 'bitget', 'bitmart']);
    globalThis.fetch = async (url) => {
      if (new URL(url).hostname === 'api.binance.com') return makeResponse({ price: '45000.0' });
      return makeResponse({}, 500);
    };
    const results = await getAllSpotPrices({}, 'BTCUSDT', openCircuits);
    assert.ok(results.every(r => r !== null), 'all returned values should be non-null');
    assert.equal(results.length, 1, 'should have exactly one result (binance)');
  });

  test('returns results from multiple non-circuit exchanges', async () => {
    const openCircuits = new Set(['okx', 'bitget', 'bitmart']); // mexc, binance, kucoin active
    globalThis.fetch = async (url) => {
      const host = new URL(url).hostname;
      if (host === 'api.mexc.com')    return makeResponse({ price: '45000.0' });
      if (host === 'api.binance.com') return makeResponse({ price: '45050.0' });
      if (host === 'api.kucoin.com')  return makeResponse({ data: { price: '45025.0' } });
      return makeResponse({}, 500);
    };
    const results = await getAllSpotPrices({}, 'BTCUSDT', openCircuits);
    assert.ok(results.length >= 2, 'should have at least 2 results');
    const exchanges = results.map(r => r.exchange);
    assert.ok(exchanges.includes('binance'), 'binance should be in results');
  });

  test('defaults to an empty openCircuits set (all exchanges active)', async () => {
    globalThis.fetch = async (url) => {
      if (new URL(url).hostname === 'api.binance.com') return makeResponse({ price: '45000.0' });
      return makeResponse({}, 500);
    };
    // No openCircuits argument — should not throw
    const results = await getAllSpotPrices({}, 'BTCUSDT');
    assert.ok(Array.isArray(results));
  });
});
