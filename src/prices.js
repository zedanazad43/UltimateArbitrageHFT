// nexus/src/prices.js — Unified price fetching layer

// ── Minimal BigInt unit helpers (replaces ethers.parseUnits / formatUnits) ────
function parseUnits(value, decimals) {
  // Use string-based multiplication to avoid floating-point precision loss
  const [int, frac = ''] = parseFloat(value).toFixed(decimals).split('.');
  return BigInt(int + frac.slice(0, decimals).padEnd(decimals, '0')).toString();
}
function formatUnits(value, decimals) {
  return Number(BigInt(value)) / (10 ** decimals);
}

const FETCH_CF = { cf: { cacheTtl: 2, cacheEverything: true } };

// ── Retry / rate-limit helper ─────────────────────────────────────────────────

/**
 * Fetches a URL with automatic retry on transient errors and 429 rate-limit responses.
 *
 * @param {string}  url
 * @param {object}  options  — standard fetch options
 * @param {number}  maxRetries  — number of extra attempts after the first (default 2)
 * @returns {Response|null}  resolved Response, or null when all retries are exhausted
 */
async function fetchWithRetry(url, options = {}, maxRetries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(url, options);
      if (resp.status === 429) {
        await resp.body?.cancel();
        if (attempt < maxRetries) {
          // Exponential back-off: 1 s, 2 s, …
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        return null;
      }
      return resp;
    } catch (e) {
      lastErr = e;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }
  throw lastErr || new Error('fetchWithRetry: all attempts failed');
}

// ── MarketStreamer Durable Object (WebSocket cache) ───────────────────────────

export async function getMarketStreamerPrice(env, symbol) {
  try {
    const id = env.MARKET_STREAMER.idFromName(symbol);
    const obj = env.MARKET_STREAMER.get(id);
    const resp = await obj.fetch(`https://dummy/price?symbol=${symbol}`);
    const data = await resp.json();
    if (data.price > 0) return { price: data.price, exchange: 'mexc', fee: 0.0005 };
  } catch (_) {}
  // Fallback to REST if WebSocket cache is cold
  return getMEXCSpotPrice(symbol);
}

// ── Spot price sources ────────────────────────────────────────────────────────

export async function getMEXCSpotPrice(symbol) {
  try {
    const resp = await fetchWithRetry(
      `https://api.mexc.com/api/v3/ticker/price?symbol=${symbol}`,
      FETCH_CF
    );
    if (!resp || !resp.ok) { await resp?.body?.cancel(); return null; }
    const data = await resp.json();
    const price = parseFloat(data.price);
    if (!price || isNaN(price)) return null;
    return { price, exchange: 'mexc', fee: 0.0005 };
  } catch (_) { return null; }
}

export async function getBinancePrice(symbol) {
  try {
    const resp = await fetchWithRetry(
      `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`,
      FETCH_CF
    );
    if (!resp || !resp.ok) { await resp?.body?.cancel(); return null; }
    const data = await resp.json();
    const price = parseFloat(data.price);
    if (!price || isNaN(price)) return null;
    return { price, exchange: 'binance', fee: 0.001 };
  } catch (_) { return null; }
}

export async function getKuCoinPrice(symbol) {
  try {
    const kuSymbol = symbol.endsWith('USDT') ? symbol.slice(0, -4) + '-USDT' : symbol;
    const resp = await fetchWithRetry(
      `https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${kuSymbol}`,
      FETCH_CF
    );
    if (!resp || !resp.ok) { await resp?.body?.cancel(); return null; }
    const data = await resp.json();
    const price = parseFloat(data?.data?.price);
    if (!price || isNaN(price)) return null;
    return { price, exchange: 'kucoin', fee: 0.001 };
  } catch (_) { return null; }
}

// ── Perpetuals price ──────────────────────────────────────────────────────────

export async function getMEXCPerpPrice(symbol) {
  try {
    const perpSymbol = symbol.replace('USDT', '_USDT');
    const resp = await fetchWithRetry(
      `https://contract.mexc.com/api/v1/contract/ticker?symbol=${perpSymbol}`
    );
    if (!resp || !resp.ok) { await resp?.body?.cancel(); return null; }
    const data = await resp.json();
    if (data.success && data.data?.lastPrice) {
      return { price: parseFloat(data.data.lastPrice), exchange: 'mexc_perp', fee: 0.0002 };
    }
  } catch (_) {}
  return null;
}

// ── DEX prices ────────────────────────────────────────────────────────────────

export async function get0xPrice(env, symbol) {
  const apiKey = env.ZEROX_API_KEY;
  if (!apiKey) return null;

  const tokenMap = {
    'ETHUSDT': {
      sell: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      buy:  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      decimals: 18
    },
    'BTCUSDT': {
      sell: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      buy:  '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      decimals: 8
    }
  };
  const token = tokenMap[symbol];
  if (!token) return null;

  try {
    const amount = parseUnits('1000', 6);
    const params = new URLSearchParams({
      chainId: '1',
      sellToken: token.sell,
      buyToken: token.buy,
      sellAmount: amount,
      slippageBps: '50'
    });
    const resp = await fetchWithRetry(
      `https://api.0x.org/swap/allowance-holder/price?${params}`,
      { headers: { '0x-api-key': apiKey, '0x-version': 'v2' } }
    );
    if (!resp) return null;
    const data = await resp.json();
    if (data.code) return null;
    const buyAmount = formatUnits(data.buyAmount, token.decimals);
    return { price: 1000 / buyAmount, exchange: '0x', fee: 0.0 };
  } catch (_) { return null; }
}

/**
 * Alchemy token price (used for ETH cross-chain DEX scan).
 * Throws on failure — callers should handle errors.
 */
export async function getAlchemyPrice(symbol, apiKey) {
  if (!apiKey) throw new Error('ALCHEMY_API_KEY is required');
  // Accept either a raw API key or a full Alchemy endpoint URL
  // (e.g. https://eth-mainnet.g.alchemy.com/v2/<key>) — extract the key from the path.
  const key = apiKey.startsWith('http') ? apiKey.split('/').pop() : apiKey;
  const resp = await fetchWithRetry(
    `https://api.g.alchemy.com/prices/v1/${key}/tokens/by-symbol?symbols[]=${symbol}`
  );
  if (!resp) throw new Error('Alchemy fetch failed after retries');
  if (!resp.ok) { await resp.body?.cancel(); throw new Error(`Alchemy HTTP ${resp.status}`); }
  const data = await resp.json();
  const price = data?.data?.[0]?.prices?.[0]?.value;
  if (!price) throw new Error('Alchemy price missing in response');
  return parseFloat(price);
}

/**
 * PancakeSwap token price on BSC (used for cross-chain DEX scan).
 * Throws on failure — callers should handle errors.
 */
export async function getPancakePrice(tokenAddress) {
  const resp = await fetchWithRetry(`https://api.pancakeswap.info/api/v2/tokens/${tokenAddress}`);
  if (!resp || !resp.ok) { await resp?.body?.cancel(); throw new Error(`PancakeSwap HTTP ${resp?.status}`); }
  const data = await resp.json();
  const price = data?.data?.price;
  if (price === undefined || price === null) throw new Error('PancakeSwap missing price');
  return parseFloat(price);
}

// ── OKX spot price ────────────────────────────────────────────────────────────

export async function getOKXPrice(symbol) {
  try {
    const okxInstId = symbol.replace(/USDT$/, '-USDT');
    const resp = await fetchWithRetry(
      `https://www.okx.com/api/v5/market/ticker?instId=${okxInstId}`,
      FETCH_CF
    );
    if (!resp || !resp.ok) { await resp?.body?.cancel(); return null; }
    const data = await resp.json();
    if (data.code !== '0' || !data.data?.[0]?.last) return null;
    const price = parseFloat(data.data[0].last);
    if (!price || isNaN(price)) return null;
    return { price, exchange: 'okx', fee: 0.001 };
  } catch (_) { return null; }
}

// ── Bitget spot price ─────────────────────────────────────────────────────────

export async function getBitgetPrice(symbol) {
  try {
    const resp = await fetchWithRetry(
      `https://api.bitget.com/api/v2/spot/market/tickers?symbol=${symbol}`,
      FETCH_CF
    );
    if (!resp || !resp.ok) { await resp?.body?.cancel(); return null; }
    const data = await resp.json();
    if (data.code !== '00000' || !data.data?.[0]?.lastPr) return null;
    const price = parseFloat(data.data[0].lastPr);
    if (!price || isNaN(price)) return null;
    return { price, exchange: 'bitget', fee: 0.001 };
  } catch (_) { return null; }
}

// ── Bitmart spot price ────────────────────────────────────────────────────────

export async function getBitmartPrice(symbol) {
  try {
    // Bitmart uses underscore separator: BTC_USDT, SHIB_USDT, etc.
    const bmSymbol = symbol.replace(/USDT$/, '_USDT');
    const resp = await fetchWithRetry(
      `https://api-cloud.bitmart.com/spot/v1/ticker?symbol=${bmSymbol}`,
      FETCH_CF
    );
    if (!resp || !resp.ok) { await resp?.body?.cancel(); return null; }
    const data = await resp.json();
    const lastPrice = data?.data?.tickers?.[0]?.last_price;
    if (!lastPrice) return null;
    const price = parseFloat(lastPrice);
    if (!price || isNaN(price)) return null;
    return { price, exchange: 'bitmart', fee: 0.0025 };
  } catch (_) { return null; }
}

// ── Bybit spot price ──────────────────────────────────────────────────────────

export async function getBybitSpotPrice(symbol) {
  try {
    const resp = await fetchWithRetry(
      `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`,
      FETCH_CF
    );
    if (!resp || !resp.ok) { await resp?.body?.cancel(); return null; }
    const data = await resp.json();
    const ticker = data?.result?.list?.[0];
    if (!ticker?.lastPrice) return null;
    const price = parseFloat(ticker.lastPrice);
    if (!price || isNaN(price)) return null;
    return { price, exchange: 'bybit', fee: 0.001 };
  } catch (_) { return null; }
}

// ── Bybit perpetual price + funding rate ──────────────────────────────────────

/**
 * Returns Bybit linear perpetual price AND the current funding rate.
 * fundingRate is expressed as a decimal (e.g. 0.0001 = 0.01% per period).
 */
export async function getBybitPerpData(symbol) {
  try {
    const resp = await fetchWithRetry(
      `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`,
      FETCH_CF
    );
    if (!resp || !resp.ok) { await resp?.body?.cancel(); return null; }
    const data = await resp.json();
    const ticker = data?.result?.list?.[0];
    if (!ticker?.lastPrice) return null;
    const price = parseFloat(ticker.lastPrice);
    if (!price || isNaN(price)) return null;
    return {
      price,
      exchange:    'bybit_perp',
      fee:         0.0006,
      fundingRate: parseFloat(ticker.fundingRate || '0')
    };
  } catch (_) { return null; }
}

// ── Gate.io spot price ────────────────────────────────────────────────────────

export async function getGateioPrice(symbol) {
  try {
    const gateSymbol = symbol.endsWith('USDT')
      ? symbol.slice(0, -4) + '_USDT'
      : symbol;
    const resp = await fetchWithRetry(
      `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${gateSymbol}`,
      FETCH_CF
    );
    if (!resp || !resp.ok) { await resp?.body?.cancel(); return null; }
    const data = await resp.json();
    const ticker = Array.isArray(data) ? data[0] : data;
    if (!ticker?.last) return null;
    const price = parseFloat(ticker.last);
    if (!price || isNaN(price)) return null;
    return { price, exchange: 'gateio', fee: 0.002 };
  } catch (_) { return null; }
}

// ── Aggregated fetch ──────────────────────────────────────────────────────────

/**
 * Fetches all spot price sources for a symbol in parallel.
 * Exchanges listed in the `openCircuits` Set are skipped (circuit breaker).
 * Returns array of non-null PriceSource objects.
 */
export async function getAllSpotPrices(env, symbol, openCircuits = new Set()) {
  const exchangeFetchers = [
    ['mexc',    () => getMarketStreamerPrice(env, symbol)],
    ['binance', () => getBinancePrice(symbol)],
    ['kucoin',  () => getKuCoinPrice(symbol)],
    ['okx',     () => getOKXPrice(symbol)],
    ['bitget',  () => getBitgetPrice(symbol)],
    ['bitmart', () => getBitmartPrice(symbol)],
    ['bybit',   () => getBybitSpotPrice(symbol)],
    ['gateio',  () => getGateioPrice(symbol)],
  ];

  const tasks = exchangeFetchers.map(([name, fetcher]) =>
    openCircuits.has(name) ? Promise.resolve(null) : fetcher()
  );

  const results = await Promise.allSettled(tasks);
  return results
    .map(r => (r.status === 'fulfilled' ? r.value : null))
    .filter(Boolean);
}
