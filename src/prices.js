// nexus/src/prices.js — Unified price fetching layer

// ── Minimal BigInt unit helpers (replaces ethers.parseUnits / formatUnits) ────
function parseUnits(value, decimals) {
  const factor = 10 ** decimals;
  return BigInt(Math.round(parseFloat(value) * factor)).toString();
}
function formatUnits(value, decimals) {
  return Number(BigInt(value)) / (10 ** decimals);
}

const FETCH_CF = { cf: { cacheTtl: 2, cacheEverything: true } };

// ── MarketStreamer Durable Object (WebSocket cache) ───────────────────────────

export async function getMarketStreamerPrice(env, symbol) {
  try {
    const id = env.MARKET_STREAMER.idFromName(symbol);
    const obj = env.MARKET_STREAMER.get(id);
    const resp = await obj.fetch('https://dummy/price');
    const data = await resp.json();
    if (data.price > 0) return { price: data.price, exchange: 'mexc', fee: 0.0005 };
  } catch (_) {}
  // Fallback to REST if WebSocket cache is cold
  return getMEXCSpotPrice(symbol);
}

// ── Spot price sources ────────────────────────────────────────────────────────

export async function getMEXCSpotPrice(symbol) {
  try {
    const resp = await fetch(
      `https://api.mexc.com/api/v3/ticker/price?symbol=${symbol}`,
      FETCH_CF
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const price = parseFloat(data.price);
    if (!price || isNaN(price)) return null;
    return { price, exchange: 'mexc', fee: 0.0005 };
  } catch (_) { return null; }
}

export async function getBinancePrice(symbol) {
  try {
    const resp = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`,
      FETCH_CF
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const price = parseFloat(data.price);
    if (!price || isNaN(price)) return null;
    return { price, exchange: 'binance', fee: 0.001 };
  } catch (_) { return null; }
}

export async function getKuCoinPrice(symbol) {
  try {
    const kuSymbol = symbol.endsWith('USDT') ? symbol.slice(0, -4) + '-USDT' : symbol;
    const resp = await fetch(
      `https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${kuSymbol}`,
      FETCH_CF
    );
    if (!resp.ok) return null;
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
    const resp = await fetch(
      `https://contract.mexc.com/api/v1/contract/ticker?symbol=${perpSymbol}`
    );
    if (!resp.ok) return null;
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
    const resp = await fetch(
      `https://api.0x.org/swap/allowance-holder/price?${params}`,
      { headers: { '0x-api-key': apiKey, '0x-version': 'v2' } }
    );
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
  const resp = await fetch(
    `https://api.g.alchemy.com/prices/v1/${apiKey}/tokens/by-symbol?symbols[]=${symbol}`
  );
  if (!resp.ok) throw new Error(`Alchemy HTTP ${resp.status}`);
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
  const resp = await fetch(`https://api.pancakeswap.info/api/v2/tokens/${tokenAddress}`);
  if (!resp.ok) throw new Error(`PancakeSwap HTTP ${resp.status}`);
  const data = await resp.json();
  const price = data?.data?.price;
  if (price === undefined || price === null) throw new Error('PancakeSwap missing price');
  return parseFloat(price);
}

// ── Aggregated fetch ──────────────────────────────────────────────────────────

/**
 * Fetches all spot price sources for a symbol in parallel.
 * Returns array of non-null PriceSource objects.
 */
export async function getAllSpotPrices(env, symbol) {
  const [rStreamer, rBinance, rKuCoin] = await Promise.allSettled([
    getMarketStreamerPrice(env, symbol),
    getBinancePrice(symbol),
    getKuCoinPrice(symbol)
  ]);
  return [
    rStreamer.status === 'fulfilled' ? rStreamer.value : null,
    rBinance.status  === 'fulfilled' ? rBinance.value  : null,
    rKuCoin.status   === 'fulfilled' ? rKuCoin.value   : null
  ].filter(Boolean);
}
