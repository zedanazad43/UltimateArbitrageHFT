// ===== Ultra-Fast Price Engine v4.0 =====
// Parallel price fetching, WebSocket streams, in-memory caching, proxy bypass

import { getWebSocketPriceManager } from './ws-price-stream.js';

let _parallelEngine = null;

export class UltraFastPriceEngine {
    constructor(env) {
        this.env = env;
        this.priceCache = new Map();
        this.lastFetch = new Map();
        this.cacheTTL = 300; // 300ms cache for ultra-fast
        this.pendingFetches = new Map();
        this.priceFeeds = new Map();
    }

    /**
     * Fetches all prices in parallel with AbortController timeout.
     * Returns prices within 2-3 seconds max.
     */
    async fetchAllPrices(symbols = null, exchanges = null) {
        const startTime = Date.now();
        const targetSymbols = symbols || ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'ADAUSDT', 'DOGEUSDT', 'LTCUSDT', 'TRXUSDT', 'LINKUSDT', 'AVAXUSDT', 'DOTUSDT'];
        const targetExchanges = exchanges || ['mexc', 'binance', 'bitget', 'kucoin', 'htx', 'bybit', 'gateio', 'bitmart'];

        // Phase 1: Check cache (instant)
        const cached = this.getCachedPrices(targetSymbols, targetExchanges);
        const uncached = targetSymbols.filter(s => !cached[s] || Object.keys(cached[s]).length < targetExchanges.length);

        if (uncached.length === 0) {
            return { prices: cached, source: 'cache', latencyMs: Date.now() - startTime };
        }

        // Phase 2: Deduplicate in-flight requests
        const fetchKey = uncached.sort().join(',');
        if (this.pendingFetches.has(fetchKey)) {
            return this.pendingFetches.get(fetchKey);
        }

        // Phase 3: Parallel fetch with 3s timeout
        const fetchPromise = this.parallelFetch(uncached, targetExchanges, startTime);
        this.pendingFetches.set(fetchKey, fetchPromise);

        try {
            const result = await fetchPromise;
            return result;
        } finally {
            this.pendingFetches.delete(fetchKey);
        }
    }

    getCachedPrices(symbols, exchanges) {
        const result = {};
        const now = Date.now();

        for (const symbol of symbols) {
            const symCache = this.priceCache.get(symbol);
            if (!symCache) continue;

            const exchangePrices = {};
            let allCached = true;

            for (const ex of exchanges) {
                const cached = symCache[ex];
                if (cached && (now - cached.ts) < this.cacheTTL) {
                    exchangePrices[ex] = cached.price;
                } else {
                    allCached = false;
                }
            }

            if (allCached && Object.keys(exchangePrices).length > 0) {
                result[symbol] = exchangePrices;
            }
        }

        return result;
    }

    async parallelFetch(symbols, exchanges, startTime) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);

        const results = {};
        const batchSize = 3; // 3 exchanges per batch
        const exchangeBatches = [];

        for (let i = 0; i < exchanges.length; i += batchSize) {
            exchangeBatches.push(exchanges.slice(i, i + batchSize));
        }

        try {
            for (const batch of exchangeBatches) {
                const batchPromises = batch.map(ex =>
                    this.fetchExchangePrices(ex, symbols, controller.signal)
                        .catch(() => null)
                );

                const batchResults = await Promise.all(batchPromises);

                for (let i = 0; i < batch.length; i++) {
                    this.mergePrices(results, batch[i], batchResults[i], symbols);
                }
            }
        } finally {
            clearTimeout(timeout);
        }

        // Cache results
        this.cacheResults(results);

        return {
            prices: results,
            source: 'live',
            latencyMs: Date.now() - startTime,
            symbolsCount: symbols.length,
            exchangesCount: exchanges.length,
        };
    }

    async fetchExchangePrices(exchange, symbols, signal) {
        const urls = this.getPriceUrls(exchange, symbols);
        if (!urls.length) return null;

        try {
            const responses = await Promise.all(
                urls.map(url => fetch(url, { signal, headers: this.getHeaders(exchange) })
                    .then(r => r.ok ? r.json() : null)
                    .catch(() => null)
                )
            );

            return this.parseExchangePrices(exchange, responses, symbols);
        } catch {
            return null;
        }
    }

    getPriceUrls(exchange, symbols) {
        const urls = {
            mexc: [`https://api.mexc.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`],
            binance: [`https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`],
            bitget: symbols.map(s => `https://api.bitget.com/api/v2/spot/market/tickers?symbol=${s}`),
            kucoin: [`https://api.kucoin.com/api/v1/market/allTickers`],
            htx: [`https://api.huobi.pro/market/tickers`],
            bybit: [`https://api.bybit.com/v5/market/tickers?category=spot`],
            gateio: [`https://api.gateio.ws/api/v4/spot/tickers`],
            bitmart: [`https://api-cloud.bitmart.com/spot/quotation/v3/tickers`],
        };

        return urls[exchange] || [];
    }

    getHeaders(_exchange) {
        return {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0',
            'Accept-Encoding': 'gzip',
        };
    }

    parseExchangePrices(exchange, responses, symbols) {
        const prices = {};

        for (const data of responses) {
            if (!data) continue;

            try {
                switch (exchange) {
                    case 'mexc':
                    case 'binance':
                        (Array.isArray(data) ? data : []).forEach(item => {
                            if (item.symbol && symbols.includes(item.symbol)) {
                                prices[item.symbol] = parseFloat(item.price);
                            }
                        });
                        break;

                    case 'bitget':
                        if (data.data) {
                            (Array.isArray(data.data) ? data.data : [data.data]).forEach(item => {
                                if (item.symbol && symbols.includes(item.symbol)) {
                                    prices[item.symbol] = parseFloat(item.lastPr || item.close || 0);
                                }
                            });
                        }
                        break;

                    case 'kucoin':
                        if (data.data?.ticker) {
                            data.data.ticker.forEach(item => {
                                if (symbols.includes(item.symbol)) {
                                    prices[item.symbol] = parseFloat(item.last || item.buy || 0);
                                }
                            });
                        } else if (data.data?.time && typeof data.data.time === 'number') {
                            // All tickers format
                            const allTickers = data.data.ticker || [];
                            allTickers.forEach(item => {
                                if (symbols.includes(item.symbol)) {
                                    prices[item.symbol] = parseFloat(item.last || item.buy || 0);
                                }
                            });
                        }
                        break;

                    case 'htx':
                        if (data.data) {
                            data.data.forEach(item => {
                                const sym = item.symbol?.toUpperCase();
                                if (sym && symbols.includes(sym)) {
                                    prices[sym] = parseFloat(item.close || 0);
                                }
                            });
                        }
                        break;

                    case 'bybit':
                        if (data.result?.list) {
                            data.result.list.forEach(item => {
                                if (item.symbol && symbols.includes(item.symbol)) {
                                    prices[item.symbol] = parseFloat(item.lastPrice || 0);
                                }
                            });
                        }
                        break;

                    case 'gateio':
                        (Array.isArray(data) ? data : []).forEach(item => {
                            const sym = item.currency_pair?.replace('_', '').toUpperCase();
                            if (sym && symbols.includes(sym)) {
                                prices[sym] = parseFloat(item.last || 0);
                            }
                        });
                        break;

                    case 'bitmart':
                        if (data.data) {
                            (Array.isArray(data.data) ? data.data : []).forEach(item => {
                                if (item.symbol && symbols.includes(item.symbol)) {
                                    prices[item.symbol] = parseFloat(item.last || item.close || 0);
                                }
                            });
                        }
                        break;
                }
            } catch { }
        }

        return Object.keys(prices).length > 0 ? prices : null;
    }

    mergePrices(results, exchange, prices, symbols) {
        if (!prices) return;

        for (const symbol of symbols) {
            if (prices[symbol]) {
                if (!results[symbol]) results[symbol] = {};
                results[symbol][exchange] = prices[symbol];
            }
        }
    }

    cacheResults(results) {
        const now = Date.now();

        for (const [symbol, exchangePrices] of Object.entries(results)) {
            if (!this.priceCache.has(symbol)) {
                this.priceCache.set(symbol, {});
            }

            const symCache = this.priceCache.get(symbol);
            for (const [ex, price] of Object.entries(exchangePrices)) {
                symCache[ex] = { price, ts: now };
            }
        }
    }

    getStats() {
        const ws = getWebSocketPriceManager(this.env);
        return {
            cacheSize: this.priceCache.size,
            pendingFetches: this.pendingFetches.size,
            cacheTTL: this.cacheTTL,
            webSocket: ws.getStats(),
        };
    }

    /**
     * Syncs WebSocket live prices into the in-memory cache.
     * Call this once at startup — it subscribes to all exchanges and
     * continuously updates the cache with sub-second latency.
     */
    async connectWebSocketFeeds(symbols = null) {
        const ws = getWebSocketPriceManager(this.env);
        const targetSymbols = symbols || [...new Set([
            'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'ADAUSDT', 'DOGEUSDT',
            'LTCUSDT', 'TRXUSDT', 'LINKUSDT', 'AVAXUSDT', 'DOTUSDT'
        ])];

        const results = await ws.connectAll(targetSymbols);

        // Bridge WS prices into the UltraFastPriceEngine cache
        for (const result of results) {
            if (result?.exchange) {
                ws.subscribe(result.exchange, (prices) => {
                    this.cacheResults(prices);
                });
            }
        }

        return results;
    }
}

// ─── Lightning Executor: Sub-millisecond trade routing ────────────────────────

export class LightningExecutor {
    constructor(env) {
        this.env = env;
        this.executionCache = new Map();
        this.batchBuffer = [];
        this.batchTimer = null;
        this.batchInterval = 50; // 50ms batch window
        this.maxBatchSize = 10;
    }

    /**
     * Pre-warms execution routes by checking exchange connectivity.
     */
    async preWarm() {
        const exchanges = ['mexc', 'binance', 'bitget', 'kucoin', 'htx'];
        const warmups = exchanges.map(ex =>
            this.pingExchange(ex).catch(() => null)
        );
        await Promise.all(warmups);
        return { warmed: exchanges.length, timestamp: Date.now() };
    }

    async pingExchange(exchange) {
        const pingUrls = {
            mexc: 'https://api.mexc.com/api/v3/time',
            binance: 'https://api.binance.com/api/v3/time',
            bitget: 'https://api.bitget.com/api/v2/spot/public/time',
            kucoin: 'https://api.kucoin.com/api/v1/timestamp',
            htx: 'https://api.huobi.pro/v2/market-status',
        };

        const url = pingUrls[exchange];
        if (!url) return null;

        try {
            const resp = await fetch(url, { signal: AbortSignal.timeout(2000) });
            return resp.ok ? { exchange, latency: Date.now(), ok: true } : { exchange, ok: false };
        } catch {
            return { exchange, ok: false };
        }
    }

    /**
     * Batched execution: queues orders and executes in 50ms batches.
     */
    async batchExecute(order, executor) {
        this.batchBuffer.push({ order, executor, timestamp: Date.now() });

        if (this.batchBuffer.length >= this.maxBatchSize) {
            return this.flushBatch();
        }

        if (!this.batchTimer) {
            this.batchTimer = setTimeout(() => this.flushBatch(), this.batchInterval);
        }

        return { queued: true, batchSize: this.batchBuffer.length };
    }

    async flushBatch() {
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }

        if (this.batchBuffer.length === 0) return [];

        const batch = [...this.batchBuffer];
        this.batchBuffer = [];

        const startTime = Date.now();
        const results = await Promise.all(
            batch.map(({ order, executor }) => executor(order).catch(e => ({ error: e.message })))
        );

        return {
            executed: batch.length,
            latencyMs: Date.now() - startTime,
            results,
        };
    }
}

// ─── Proxy Bypass Engine: Route around WAF blocks ─────────────────────────────

export class ProxyBypassEngine {
    constructor(env) {
        this.env = env;
        this.bypassMethods = new Map();
        this.lastSuccess = new Map();
    }

    /**
     * Multi-method fetch: tries direct, then Railway proxy, then fallback.
     */
    async fetchWithBypass(url, exchange, options = {}) {
        const methods = this.getBypassMethods(exchange);
        const errors = [];

        for (const method of methods) {
            try {
                const result = await method(url, options);
                if (result && result.ok) {
                    this.lastSuccess.set(exchange, { method: method.name, ts: Date.now() });
                    return result;
                }
                if (result && (result.status === 403 || result.status === 429)) {
                    errors.push(`${method.name}: ${result.status}`);
                    continue;
                }
                if (result) return result;
            } catch (err) {
                errors.push(`${method.name}: ${err.message}`);
            }
        }

        throw new Error(`All bypass methods failed for ${exchange}: ${errors.join(' | ')}`);
    }

    getBypassMethods(exchange) {
        const gUrl = this.env.EXTERNAL_PROXY_FALLBACK_URL || '';

        return [
            // Method 1: Direct with browser headers (fastest)
            async (url, opts) => {
                const resp = await fetch(url, {
                    ...opts,
                    headers: {
                        ...(opts.headers || {}),
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/json',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Origin': `https://www.${exchange}.com`,
                        'Referer': `https://www.${exchange}.com/`,
                    },
                    signal: AbortSignal.timeout(5000),
                });
                return resp;
            },

            // Method 2: Via Railway proxy (bypasses Cloudflare WAF)
            gUrl ? async (url, opts) => {
                const proxyUrl = `${gUrl}?target=${encodeURIComponent(url)}`;
                const resp = await fetch(proxyUrl, {
                    method: opts.method || 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(opts.headers || {}),
                    },
                    body: opts.body,
                    signal: AbortSignal.timeout(8000),
                });
                return resp;
            } : null,

            // Method 3: Direct with no special headers
            async (url, opts) => {
                const resp = await fetch(url, {
                    ...opts,
                    signal: AbortSignal.timeout(5000),
                });
                return resp;
            },
        ].filter(Boolean);
    }
}

export function getUltraFastPriceEngine(env) {
    if (!_parallelEngine) {
        _parallelEngine = new UltraFastPriceEngine(env);
    }
    return _parallelEngine;
}
