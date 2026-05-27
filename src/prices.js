// nexus/src/prices.js — Unified price fetching layer

import { BITGET_SPOT_SYMBOLS_FALLBACK } from './data/bitget-symbols-fallback.js';

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
const PRICE_FETCH_TIMEOUT_MS = 2500;
const SYMBOL_DISCOVERY_TIMEOUT_MS = 5000;
const BINANCE_EXCHANGE_INFO_ENDPOINTS = [
  'https://api.binance.com/api/v3/exchangeInfo',
  'https://api1.binance.com/api/v3/exchangeInfo',
  'https://api2.binance.com/api/v3/exchangeInfo',
  'https://api3.binance.com/api/v3/exchangeInfo',
  'https://data-api.binance.vision/api/v3/exchangeInfo',
];
const BINANCE_TICKER_ENDPOINTS = [
  'https://api.binance.com/api/v3/ticker/price',
  'https://api1.binance.com/api/v3/ticker/price',
  'https://api2.binance.com/api/v3/ticker/price',
  'https://api3.binance.com/api/v3/ticker/price',
  'https://data-api.binance.vision/api/v3/ticker/price',
];

const DEFAULT_SCAN_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT',
  'BNBUSDT', 'AVAXUSDT', 'MATICUSDT', 'LINKUSDT', 'UNIUSDT',
  'ADAUSDT', 'DOTUSDT', 'LTCUSDT', 'TRXUSDT', 'NEARUSDT'
];

export const DEFAULT_QUOTE_ASSETS = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'DAI', 'TUSD', 'BTC', 'ETH'];
const STABLE_QUOTES = new Set(['USDT', 'USDC', 'FDUSD', 'BUSD', 'DAI', 'TUSD']);

function normalizeQuoteAssets(values) {
  const raw = Array.isArray(values)
    ? values
    : String(values || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);

  const normalized = [...new Set(raw.map((q) => String(q).toUpperCase().replace(/[^A-Z0-9]/g, '')))]
    .filter((q) => q.length >= 3 && q.length <= 10);

  return normalized.length ? normalized : [...DEFAULT_QUOTE_ASSETS];
}

export function splitTradingSymbol(symbol, quoteAssets = DEFAULT_QUOTE_ASSETS) {
  const normalized = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!normalized || normalized.length < 5) return null;

  const quotes = normalizeQuoteAssets(quoteAssets).sort((a, b) => b.length - a.length);
  for (const quote of quotes) {
    if (!normalized.endsWith(quote)) continue;
    const base = normalized.slice(0, -quote.length);
    if (!base || base.length < 2 || base.length > 15) continue;
    if (!/^[A-Z0-9]{2,15}$/.test(base)) continue;
    return { symbol: normalized, base, quote };
  }

  return null;
}

function uniqSortedSymbols(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function isLikelyTradeableSymbol(value, quoteAssets = DEFAULT_QUOTE_ASSETS) {
  return !!splitTradingSymbol(value, quoteAssets);
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = SYMBOL_DISCOVERY_TIMEOUT_MS) {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('symbol-discovery-timeout')), timeoutMs);
  });
  const resp = await Promise.race([fetch(url, options), timeoutPromise]);
  if (!resp.ok) {
    await resp.body?.cancel();
    throw new Error(`HTTP ${resp.status}`);
  }
  return resp.json();
}

/**
 * Discover all currently tradeable MEXC spot USDT pairs.
 */
export async function discoverMEXCSpotSymbols(options = {}) {
  const quoteAssets = normalizeQuoteAssets(options.quoteAssets || DEFAULT_QUOTE_ASSETS);
  try {
    const data = await fetchJsonWithTimeout('https://api.mexc.com/api/v3/exchangeInfo', FETCH_CF);
    const symbols = (data?.symbols || [])
      .filter((s) => {
        const quote = String(s?.quoteAsset || '').toUpperCase();
        const status = String(s?.status || '').toUpperCase();
        return quoteAssets.includes(quote) && (status === 'TRADING' || status === '1' || status === 'ENABLED');
      })
      .map((s) => String(s?.symbol || '').toUpperCase())
      .filter((sym) => isLikelyTradeableSymbol(sym, quoteAssets));
    return uniqSortedSymbols(symbols);
  } catch (_) {
    return [];
  }
}

/**
 * Discover all currently tradeable Binance spot USDT pairs.
 */
export async function discoverBinanceSpotSymbols(options = {}) {
  const quoteAssets = normalizeQuoteAssets(options.quoteAssets || DEFAULT_QUOTE_ASSETS);
  for (const endpoint of BINANCE_EXCHANGE_INFO_ENDPOINTS) {
    try {
      const data = await fetchJsonWithTimeout(endpoint, FETCH_CF);
      const symbols = (data?.symbols || [])
        .filter((s) => {
          const quote = String(s?.quoteAsset || '').toUpperCase();
          const status = String(s?.status || '').toUpperCase();
          return quoteAssets.includes(quote) && status === 'TRADING';
        })
        .map((s) => String(s?.symbol || '').toUpperCase())
        .filter((sym) => isLikelyTradeableSymbol(sym, quoteAssets));
      if (symbols.length > 0) return uniqSortedSymbols(symbols);
    } catch (_) {
      // Continue to next Binance endpoint.
    }
  }

  return [];
}

/**
 * Discover all currently tradeable Bitget spot USDT pairs.
 */
export async function discoverBitgetSpotSymbols(options = {}) {
  const quoteAssets = normalizeQuoteAssets(options.quoteAssets || DEFAULT_QUOTE_ASSETS);
  const bitgetRequestOptions = {
    ...FETCH_CF,
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://www.bitget.com/',
    },
  };

  const parseV2 = (rows) => (rows || [])
    .filter((s) => {
      const symbol = String(s?.symbol || '').toUpperCase();
      const quote = String(s?.quoteCoin || '').toUpperCase();
      const status = String(s?.status || '').toLowerCase();
      const enabled = String(s?.enableStatus || '').toLowerCase();
      const listed = status.includes('online') || status.includes('normal') || status.includes('trading') || enabled.includes('online');
      return (quoteAssets.includes(quote) || isLikelyTradeableSymbol(symbol, quoteAssets)) && listed;
    })
    .map((s) => String(s?.symbol || '').toUpperCase())
    .filter((sym) => isLikelyTradeableSymbol(sym, quoteAssets));

  const parseV1 = (rows) => (rows || [])
    .filter((s) => {
      const symbol = String(s?.symbol || '').toUpperCase();
      const quote = String(s?.quoteCoin || '').toUpperCase();
      const status = String(s?.status || '').toLowerCase();
      const listed = status.includes('online') || status.includes('normal') || status.includes('trading');
      return (quoteAssets.includes(quote) || isLikelyTradeableSymbol(symbol, quoteAssets)) && listed;
    })
    .map((s) => String(s?.symbol || '').toUpperCase())
    .filter((sym) => isLikelyTradeableSymbol(sym, quoteAssets));

  const endpoints = [
    { url: 'https://api.bitget.com/api/v2/spot/public/symbols', parser: (d) => parseV2(d?.data) },
    { url: 'https://capi.bitget.com/api/v2/spot/public/symbols', parser: (d) => parseV2(d?.data) },
    { url: 'https://api.bitget.com/api/spot/v1/public/products', parser: (d) => parseV1(d?.data) },
    { url: 'https://capi.bitget.com/api/spot/v1/public/products', parser: (d) => parseV1(d?.data) },
  ];

  for (const endpoint of endpoints) {
    try {
      const data = await fetchJsonWithTimeout(endpoint.url, bitgetRequestOptions);
      const symbols = endpoint.parser(data);
      if (symbols.length > 0) return uniqSortedSymbols(symbols);
    } catch (_) {
      // Continue to fallback endpoint.
    }
  }

  return BITGET_SPOT_SYMBOLS_FALLBACK;
}

/**
 * Discover broad MetaMask-readable token symbols from a public Ethereum token list.
 * Returns symbols normalized to *USDT form* so they can be compared with CEX pairs.
 */
export async function discoverMetaMaskReadableSymbols(limit = 5000, quoteAssets = DEFAULT_QUOTE_ASSETS) {
  try {
    const data = await fetchJsonWithTimeout('https://tokens.coingecko.com/uniswap/all.json', FETCH_CF);
    const quotes = normalizeQuoteAssets(quoteAssets).filter((q) => STABLE_QUOTES.has(q));
    const symbols = (data?.tokens || [])
      .flatMap((t) => {
        const raw = String(t?.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!raw || raw.length < 2 || raw.length > 15 || raw === 'USDT') return [];
        const out = [];
        for (const quote of quotes.length ? quotes : ['USDT']) {
          out.push(`${raw}${quote}`);
        }
        return out;
      })
      .filter((sym) => isLikelyTradeableSymbol(sym, quoteAssets));
    return uniqSortedSymbols(symbols).slice(0, Math.max(1, limit));
  } catch (_) {
    return [];
  }
}

/**
 * Discover symbol catalogs per venue and aggregate union/intersection sets.
 */
export async function discoverSymbolCatalog(options = {}) {
  const metaMaskLimit = Number.isFinite(options.metaMaskLimit) ? options.metaMaskLimit : 5000;
  const quoteAssets = normalizeQuoteAssets(options.quoteAssets || DEFAULT_QUOTE_ASSETS);
  const [mexc, binance, bitget, metamask] = await Promise.all([
    discoverMEXCSpotSymbols({ quoteAssets }),
    discoverBinanceSpotSymbols({ quoteAssets }),
    discoverBitgetSpotSymbols({ quoteAssets }),
    discoverMetaMaskReadableSymbols(metaMaskLimit, quoteAssets),
  ]);

  const cexUnion = uniqSortedSymbols([...mexc, ...binance, ...bitget]);
  const cexIntersection = mexc.filter((s) => binance.includes(s) && bitget.includes(s));
  const walletReadableCex = cexUnion.filter((s) => metamask.includes(s));

  return {
    sources: {
      mexc,
      binance,
      bitget,
      metamask,
    },
    aggregate: {
      cexUnion,
      cexIntersection,
      walletReadableCex,
    },
  };
}

/**
 * Resolves symbols used by scan cycles when no static supported_symbols are set.
 * Uses CEX intersection first for reliability, then broadens to CEX union.
 */
export async function resolveDynamicScanSymbols(state = {}) {
  const maxSymbols = Math.max(15, Math.min(2000, Number(state.max_dynamic_symbols || 500)));
  const quoteAssets = normalizeQuoteAssets(state.scan_quote_assets || state.quote_assets || DEFAULT_QUOTE_ASSETS);
  const catalog = await discoverSymbolCatalog({
    metaMaskLimit: Number(state.max_metamask_symbols || 10000),
    quoteAssets,
  });

  const mode = String(state.scan_symbol_mode || '').toLowerCase();
  let preferred;
  if (mode === 'cex_intersection') {
    preferred = catalog.aggregate.cexIntersection;
  } else if (mode === 'wallet_readable') {
    preferred = catalog.aggregate.walletReadableCex;
  } else {
    // Default: broadest venue coverage for "all crypto tokens" scanning.
    preferred = catalog.aggregate.cexUnion;
  }

  if (!preferred.length && mode !== 'cex_union') {
    preferred = catalog.aggregate.cexUnion;
  }

  if (!preferred.length) return DEFAULT_SCAN_SYMBOLS;

  const priority = new Set(DEFAULT_SCAN_SYMBOLS);
  const prioritized = [
    ...preferred.filter((s) => priority.has(s)),
    ...preferred.filter((s) => !priority.has(s)),
  ];

  return prioritized.slice(0, maxSymbols);
}

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
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('price-fetch-timeout')), PRICE_FETCH_TIMEOUT_MS);
    });
    try {
      const resp = await Promise.race([fetch(url, options), timeoutPromise]);
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
  for (const baseUrl of BINANCE_TICKER_ENDPOINTS) {
    try {
      const resp = await fetchWithRetry(`${baseUrl}?symbol=${symbol}`, FETCH_CF);
      if (!resp || !resp.ok) {
        await resp?.body?.cancel();
        continue;
      }
      const data = await resp.json();
      const price = parseFloat(data.price);
      if (!price || isNaN(price)) continue;
      return { price, exchange: 'binance', fee: 0.001 };
    } catch (_) {
      // Continue to next Binance endpoint.
    }
  }

  return null;
}

export async function getKuCoinPrice(symbol) {
  try {
    const parsed = splitTradingSymbol(symbol);
    if (!parsed) return null;
    const kuSymbol = `${parsed.base}-${parsed.quote}`;
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

// Default funding rate when none is available from the exchange API.
const DEFAULT_FUNDING_RATE = 0;

/**
 * Fetches the MEXC perpetuals (contract) ticker price.
 * Lets network/HTTP errors bubble so the circuit breaker can distinguish
 * genuine connectivity failures from "symbol not listed" (null return).
 */
export async function getMEXCPerpPrice(symbol) {
  const perpSymbol = symbol.replace('USDT', '_USDT');
  const resp = await fetchWithRetry(
    `https://contract.mexc.com/api/v1/contract/ticker?symbol=${perpSymbol}`
  );
  if (!resp) {
    throw new Error(`MEXC perp API request failed for ${perpSymbol}: no response after retries`);
  }
  if (!resp.ok) {
    const status = resp.status;
    await resp.body?.cancel();
    if (status === 429 || status >= 500) {
      throw new Error(`MEXC perp API request failed for ${perpSymbol}: HTTP ${status}`);
    }
    // Treat client/API-level errors (for example, an unlisted symbol) as absence.
    return null;
  }
  const data = await resp.json();
  if (data.success && data.data?.lastPrice) {
    return { price: parseFloat(data.data.lastPrice), exchange: 'mexc_perp', fee: 0.0002 };
  }
  return null;
}

/**
 * Fetches Binance USDM Futures price and latest funding rate.
 * - Throws on 5xx server errors so the circuit breaker can detect outages.
 * - Returns null when the symbol has no futures contract (4xx/API errors).
 * - Transport-level errors throw naturally (fetchWithRetry re-throws lastErr).
 * fundingRate is expressed as a decimal (e.g. 0.0001 = 0.01% per 8-hour period).
 */
export async function getBinancePerpData(symbol) {
  const [tickerResp, fundingResp] = await Promise.all([
    fetchWithRetry(
      `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`,
      FETCH_CF
    ),
    fetchWithRetry(
      `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`,
      FETCH_CF
    )
  ]);

  if (!tickerResp) return null;
  if (tickerResp.status >= 500) {
    await tickerResp.body?.cancel();
    await fundingResp?.body?.cancel();
    throw new Error(`Binance USDM HTTP ${tickerResp.status} for ${symbol}`);
  }
  if (!tickerResp.ok) {
    await tickerResp.body?.cancel();
    await fundingResp?.body?.cancel();
    return null;
  }

  const tickerData = await tickerResp.json();
  const price = parseFloat(tickerData.price);
  if (!price || isNaN(price)) return null;

  let fundingRate = DEFAULT_FUNDING_RATE;
  if (fundingResp && fundingResp.ok) {
    const fundingData = await fundingResp.json();
    if (Array.isArray(fundingData) && fundingData.length > 0) {
      fundingRate = parseFloat(fundingData[0].fundingRate || '0');
    }
  } else {
    await fundingResp?.body?.cancel();
  }
  return { price, exchange: 'binance_perp', fee: 0.0004, fundingRate };
}

// ── DEX prices ────────────────────────────────────────────────────────────────

// ── DEXScreener public price ──────────────────────────────────────────────────
//
// DEXScreener aggregates DEX prices across multiple chains — no API key, no
// IP whitelist.  The endpoint is open to any IP including Cloudflare Workers.
// Returns the price from the highest-volume pair for the given token address.

/**
 * Fetches the USD price of a token from DEXScreener.
 *
 * @param {string} chainId       — e.g. 'ethereum', 'bsc', 'arbitrum'
 * @param {string} tokenAddress  — checksum or lowercase ERC-20/BEP-20 token address
 * @returns {{ price: number, exchange: string, fee: number }|null}
 */
export async function getDEXScreenerPrice(chainId, tokenAddress) {
  try {
    const resp = await fetchWithRetry(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
      FETCH_CF
    );
    if (!resp || !resp.ok) { await resp?.body?.cancel(); return null; }
    const data = await resp.json();
    // Filter to the requested chain and require a priceUsd field.
    const pairs = (data?.pairs || []).filter(p => p.chainId === chainId && p.priceUsd);
    if (!pairs.length) return null;
    // Use the highest-24h-volume pair for the most representative price.
    const best = pairs.reduce((a, b) => ((b.volume?.h24 || 0) > (a.volume?.h24 || 0) ? b : a));
    const price = parseFloat(best.priceUsd);
    if (!price || isNaN(price)) return null;
    return { price, exchange: 'dexscreener', fee: 0.0025 }; // avg DEX taker fee
  } catch (_) { return null; }
}

// ── CoinGecko public simple price ─────────────────────────────────────────────
//
// CoinGecko's /simple/price endpoint is public — no API key, no IP whitelist.
// Rate-limited to ~30 req/min by IP in the free tier; cached by CF edge (2 s).

/**
 * Fetches the USD price of a coin from CoinGecko Simple Price API.
 *
 * @param {string} coinId  — CoinGecko coin ID, e.g. 'ethereum', 'bitcoin', 'binancecoin'
 * @returns {number|null}  price in USD, or null on failure
 */
export async function getCoinGeckoSimplePrice(coinId) {
  try {
    const resp = await fetchWithRetry(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`,
      FETCH_CF
    );
    if (!resp || !resp.ok) { await resp?.body?.cancel(); return null; }
    const data = await resp.json();
    const price = data?.[coinId]?.usd;
    if (price === undefined || price === null) return null;
    return parseFloat(price);
  } catch (_) { return null; }
}

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

// ── Kraken public spot price ──────────────────────────────────────────────────
//
// Kraken's market-data endpoints are fully public — no API key, no IP whitelist.
// Symbol mapping: BTC → XBT (Kraken convention).
// Public endpoint: https://api.kraken.com/0/public/Ticker?pair=XBTUSDT

/**
 * Converts a standard symbol (e.g. BTCUSDT) to Kraken pair format (e.g. XBTUSDT).
 * Cross pairs (e.g. ETHBTC) become ETHXBT.
 * Kraken uses XBT as the symbol for Bitcoin (BTC).
 */
function toKrakenPair(symbol) {
  return symbol.replace(/^BTC/, 'XBT').replace(/BTC$/, 'XBT');
}

export async function getKrakenPrice(symbol) {
  try {
    const krakenPair = toKrakenPair(symbol);
    const resp = await fetchWithRetry(
      `https://api.kraken.com/0/public/Ticker?pair=${krakenPair}`,
      FETCH_CF
    );
    if (!resp || !resp.ok) { await resp?.body?.cancel(); return null; }
    const data = await resp.json();
    if (data.error?.length) return null;
    // Response has a dynamic key that is the pair name (Kraken may normalise it)
    const resultValues = Object.values(data.result || {});
    if (!resultValues.length) return null;
    const price = parseFloat(resultValues[0]?.c?.[0]);
    if (!price || isNaN(price)) return null;
    return { price, exchange: 'kraken', fee: 0.0016 }; // 0.16% taker fee (standard tier)
  } catch (_) { return null; }
}

// ── Coinbase public spot price ────────────────────────────────────────────────
//
// Coinbase v2 prices endpoint is fully public — no API key, no IP whitelist.
// Format: /v2/prices/{BASE}-{QUOTE}/spot  e.g. /v2/prices/BTC-USDT/spot

export async function getCoinbasePrice(symbol) {
  try {
    const parsed = splitTradingSymbol(symbol);
    if (!parsed) return null;
    const base = parsed.base;
    const quote = parsed.quote === 'USDT' ? 'USD' : parsed.quote;
    const resp = await fetchWithRetry(
      `https://api.coinbase.com/v2/prices/${base}-${quote}/spot`,
      FETCH_CF
    );
    if (!resp || !resp.ok) { await resp?.body?.cancel(); return null; }
    const data = await resp.json();
    const price = parseFloat(data?.data?.amount);
    if (!price || isNaN(price)) return null;
    return { price, exchange: 'coinbase', fee: 0.006 }; // 0.6% taker fee (advanced trade)
  } catch (_) { return null; }
}

/**
 * Free provider fallback (optional): Alpha Vantage currency exchange rate.
 * Requires ALPHA_VANTAGE_API_KEY.
 */
export async function getAlphaVantagePrice(env, symbol) {
  const apiKey = String(env?.ALPHA_VANTAGE_API_KEY || '').trim();
  if (!apiKey) return null;

  const parsed = splitTradingSymbol(symbol);
  if (!parsed) return null;
  const base = parsed.base;
  const quote = parsed.quote === 'USDT' ? 'USD' : parsed.quote;

  try {
    const endpoint = new URL('https://www.alphavantage.co/query');
    endpoint.searchParams.set('function', 'CURRENCY_EXCHANGE_RATE');
    endpoint.searchParams.set('from_currency', base);
    endpoint.searchParams.set('to_currency', quote);
    endpoint.searchParams.set('apikey', apiKey);

    const resp = await fetchWithRetry(endpoint.toString(), FETCH_CF, 1);
    if (!resp || !resp.ok) { await resp?.body?.cancel(); return null; }

    const data = await resp.json();
    const rate = parseFloat(data?.['Realtime Currency Exchange Rate']?.['5. Exchange Rate']);
    if (!rate || isNaN(rate)) return null;
    return { price: rate, exchange: 'alpha_vantage', fee: 0.0015 };
  } catch (_) {
    return null;
  }
}

/**
 * Free provider fallback (optional): Twelve Data spot price.
 * Requires TWELVE_DATA_API_KEY.
 */
export async function getTwelveDataPrice(env, symbol) {
  const apiKey = String(env?.TWELVE_DATA_API_KEY || '').trim();
  if (!apiKey) return null;

  const parsed = splitTradingSymbol(symbol);
  if (!parsed) return null;
  const base = parsed.base;
  const quote = parsed.quote === 'USDT' ? 'USD' : parsed.quote;

  try {
    const endpoint = new URL('https://api.twelvedata.com/price');
    endpoint.searchParams.set('symbol', `${base}/${quote}`);
    endpoint.searchParams.set('apikey', apiKey);

    const resp = await fetchWithRetry(endpoint.toString(), FETCH_CF, 1);
    if (!resp || !resp.ok) { await resp?.body?.cancel(); return null; }

    const data = await resp.json();
    const rate = parseFloat(data?.price);
    if (!rate || isNaN(rate)) return null;
    return { price: rate, exchange: 'twelve_data', fee: 0.0015 };
  } catch (_) {
    return null;
  }
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
    const parsed = splitTradingSymbol(symbol);
    if (!parsed) return null;
    const bmSymbol = `${parsed.base}_${parsed.quote}`;
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

// ── HTX (Huobi) spot price ────────────────────────────────────────────────────

export async function getHTXPrice(symbol) {
  try {
    // HTX uses lowercase symbols: BTCUSDT → btcusdt
    const htxSymbol = symbol.toLowerCase();
    const resp = await fetchWithRetry(
      `https://api.huobi.pro/market/detail/merged?symbol=${htxSymbol}`,
      FETCH_CF
    );
    if (!resp || !resp.ok) { await resp?.body?.cancel(); return null; }
    const data = await resp.json();
    if (data.status !== 'ok' || !data.tick?.close) return null;
    const price = parseFloat(data.tick.close);
    if (!price || isNaN(price)) return null;
    return { price, exchange: 'htx', fee: 0.002 };
  } catch (_) { return null; }
}

// ── Gate.io spot price ────────────────────────────────────────────────────────

export async function getGateioPrice(symbol) {
  try {
    const parsed = splitTradingSymbol(symbol);
    if (!parsed) return null;
    const gateSymbol = `${parsed.base}_${parsed.quote}`;
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

// ── Cross-pair price fetch ────────────────────────────────────────────────────
// Fetches a cross-pair price (e.g. ETHBTC) needed for triangular arbitrage.
// Each exchange has its own symbol format for cross pairs.

/**
 * Fetches a cross-pair price from Binance (e.g. ETHBTC, BNBBTC).
 * These are the most liquid cross pairs available on Binance.
 */
export async function getBinanceCrossPrice(crossSymbol) {
  try {
    const resp = await fetchWithRetry(
      `https://api.binance.com/api/v3/ticker/price?symbol=${crossSymbol}`,
      FETCH_CF
    );
    if (!resp || !resp.ok) { await resp?.body?.cancel(); return null; }
    const data = await resp.json();
    const price = parseFloat(data.price);
    if (!price || isNaN(price)) return null;
    return price;
  } catch (_) { return null; }
}

/**
 * Fetches a cross-pair price from MEXC.
 */
export async function getMEXCCrossPrice(crossSymbol) {
  try {
    const resp = await fetchWithRetry(
      `https://api.mexc.com/api/v3/ticker/price?symbol=${crossSymbol}`,
      FETCH_CF
    );
    if (!resp || !resp.ok) { await resp?.body?.cancel(); return null; }
    const data = await resp.json();
    const price = parseFloat(data.price);
    if (!price || isNaN(price)) return null;
    return price;
  } catch (_) { return null; }
}

/**
/**
 * Fetches a cross-pair price from KuCoin (public endpoint, no API key required).
 * Used for triangular arbitrage cross-pair data on KuCoin.
 */
export async function getKuCoinCrossPrice(crossSymbol) {
  try {
    // KuCoin uses dash-separated symbol: ETHBTC → ETH-BTC
    let kuSymbol = crossSymbol;
    for (const quote of ['BTC', 'ETH', 'BNB', 'USDT']) {
      if (crossSymbol.endsWith(quote) && crossSymbol.length > quote.length) {
        kuSymbol = `${crossSymbol.slice(0, -quote.length)}-${quote}`;
        break;
      }
    }
    const resp = await fetchWithRetry(
      `https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${kuSymbol}`,
      FETCH_CF
    );
    if (!resp || !resp.ok) { await resp?.body?.cancel(); return null; }
    const data = await resp.json();
    const price = parseFloat(data?.data?.price);
    if (!price || isNaN(price)) return null;
    return price;
  } catch (_) { return null; }
}

/**
 * Fetches a cross-pair price from Bybit (public endpoint, no API key required).
 * Used as an additional data source for triangular arbitrage cross-pair data.
 */
export async function getBybitCrossPrice(crossSymbol) {
  try {
    const resp = await fetchWithRetry(
      `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${crossSymbol}`,
      FETCH_CF
    );
    if (!resp || !resp.ok) { await resp?.body?.cancel(); return null; }
    const data = await resp.json();
    const ticker = data?.result?.list?.[0];
    if (!ticker?.lastPrice) return null;
    const price = parseFloat(ticker.lastPrice);
    if (!price || isNaN(price)) return null;
    return price;
  } catch (_) { return null; }
}

/**
 * Fetches triangular price data for a set of cross symbols from multiple exchanges.
 * Returns a map of { symbol: price } for each requested cross symbol.
 * Uses all available public sources (no API key required) with ordered fallback.
 *
 * Source priority: Binance (deepest liquidity) → MEXC → KuCoin → Bybit
 *
 * @param {string[]} crossSymbols  — e.g. ['ETHBTC', 'BNBBTC', 'XRPBTC']
 * @returns {object}  { ETHBTC: 0.052, BNBBTC: 0.0084, ... }
 */
export async function getCrossPairPrices(crossSymbols) {
  const tasks = crossSymbols.map(async sym => {
    // Each source is a public endpoint — no API key or IP whitelist required.
    const price = (
      await getBinanceCrossPrice(sym) ??
      await getMEXCCrossPrice(sym)    ??
      await getKuCoinCrossPrice(sym)  ??
      await getBybitCrossPrice(sym)
    );
    return [sym, price];
  });
  const entries = await Promise.allSettled(tasks);
  const result = {};
  for (const e of entries) {
    if (e.status === 'fulfilled' && e.value[1]) {
      result[e.value[0]] = e.value[1];
    }
  }
  return result;
}

// ── Aggregated fetch ──────────────────────────────────────────────────────────

/**
 * Fetches all spot price sources for a symbol in parallel.
 * Exchanges listed in the `openCircuits` Set are skipped (circuit breaker).
 * Returns array of non-null PriceSource objects.
 *
 * Sources marked (*) are fully public endpoints requiring no API key and no
 * IP-whitelisted API key — accessible from any IP, including Cloudflare Worker IPs.
 */
export async function getAllSpotPrices(env, symbol, openCircuits = new Set()) {
  const exchangeFetchers = [
    ['mexc',     () => getMarketStreamerPrice(env, symbol)],
    ['binance',  () => getBinancePrice(symbol)],            // (*) public
    ['kucoin',   () => getKuCoinPrice(symbol)],             // (*) public
    ['bitget',   () => getBitgetPrice(symbol)],             // (*) public
    ['bitmart',  () => getBitmartPrice(symbol)],            // (*) public
    ['bybit',    () => getBybitSpotPrice(symbol)],          // (*) public
    ['gateio',   () => getGateioPrice(symbol)],             // (*) public
    ['htx',      () => getHTXPrice(symbol)],                // (*) public
    ['kraken',   () => getKrakenPrice(symbol)],             // (*) public — no IP restriction
    ['coinbase', () => getCoinbasePrice(symbol)],           // (*) public — no IP restriction
    ['alpha_vantage', () => getAlphaVantagePrice(env, symbol)], // optional free API key
    ['twelve_data', () => getTwelveDataPrice(env, symbol)],     // optional free API key
  ];

  const tasks = exchangeFetchers.map(([name, fetcher]) =>
    openCircuits.has(name) ? Promise.resolve(null) : fetcher()
  );

  const results = await Promise.allSettled(tasks);
  return results
    .map(r => (r.status === 'fulfilled' ? r.value : null))
    .filter(Boolean);
}
