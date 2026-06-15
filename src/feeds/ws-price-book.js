// nexus/src/feeds/ws-price-book.js — WebSocket Price Feed Manager
//
// Maintains a real-time order book for supported exchanges via WebSocket.
// Falls back to REST polling when WebSocket is unavailable (Cloudflare Workers
// have limited WebSocket support via Durable Objects).
//
// Architecture:
//   1. Primary: Go HFT engine WebSocket (sub-ms, if HFT_ENGINE_URL is set)
//   2. Secondary: Cloudflare Durable Object WebSocket (if MARKET_STREAMER DO is bound)
//   3. Fallback: REST polling via prices.js (always available)

import { getAllSpotPrices } from '../prices.js';

// ── Price book state ─────────────────────────────────────────────────────────

class PriceBook {
    constructor() {
        /** @type {Map<string, Map<string, number>>} symbol → exchange → price */
        this.prices = new Map();
        this.lastUpdate = new Map(); // symbol → timestamp
        this.subscribers = new Map(); // symbol → Set<callback>
        this.maxAge = 5000; // max age in ms before considering stale
    }

    /**
     * Updates a price in the book.
     * @param {string} symbol - e.g. BTCUSDT
     * @param {string} exchange - e.g. binance
     * @param {number} price
     */
    update(symbol, exchange, price) {
        if (!this.prices.has(symbol)) {
            this.prices.set(symbol, new Map());
        }
        this.prices.get(symbol).set(exchange, price);
        this.lastUpdate.set(symbol, Date.now());

        // Notify subscribers
        const subs = this.subscribers.get(symbol);
        if (subs) {
            for (const cb of subs) {
                try { cb(symbol, exchange, price); } catch { /* subscriber error */ }
            }
        }
    }

    /**
     * Returns all prices for a symbol.
     * @param {string} symbol
     * @returns {{exchange: string, price: number}[]}
     */
    getAll(symbol) {
        const prices = this.prices.get(symbol);
        if (!prices) return [];
        const result = [];
        for (const [exchange, price] of prices) {
            result.push({ exchange, price });
        }
        return result;
    }

    /**
     * Returns the best bid/ask across all exchanges for a symbol.
     * @param {string} symbol
     * @returns {{bestBid: number, bestAsk: number, bestBidExchange: string, bestAskExchange: string}|null}
     */
    getBest(symbol) {
        const all = this.getAll(symbol);
        if (all.length < 2) return null;

        const sorted = [...all].sort((a, b) => a.price - b.price);
        return {
            bestBid: sorted.at(-1).price,
            bestBidExchange: sorted.at(-1).exchange,
            bestAsk: sorted[0].price,
            bestAskExchange: sorted[0].exchange,
        };
    }

    /**
     * Checks if price data is stale.
     * @param {string} symbol
     * @returns {boolean}
     */
    isStale(symbol) {
        const last = this.lastUpdate.get(symbol) || 0;
        return (Date.now() - last) > this.maxAge;
    }

    /**
     * Subscribe to price updates for a symbol.
     * @param {string} symbol
     * @param {function} callback
     */
    subscribe(symbol, callback) {
        if (!this.subscribers.has(symbol)) {
            this.subscribers.set(symbol, new Set());
        }
        this.subscribers.get(symbol).add(callback);
    }
}

// ── Singleton ────────────────────────────────────────────────────────────────

let _priceBook = null;

export function getPriceBook() {
    if (!_priceBook) {
        _priceBook = new PriceBook();
    }
    return _priceBook;
}

// ── HFT engine WebSocket bridge ──────────────────────────────────────────────

/**
 * Initializes WebSocket price feed via Go HFT engine.
 * The HFT engine maintains WebSocket connections to exchanges and exposes
 * a local HTTP endpoint that streams price updates.
 *
 * @param {object} env - Worker environment
 * @returns {Promise<boolean>} true if HFT feed is active
 */
export async function initHFTFeed(env) {
    const hftUrl = env.HFT_ENGINE_URL;
    if (!hftUrl) return false;

    try {
        // Query the HFT engine for current prices (REST fallback from WebSocket)
        const resp = await fetch(`${hftUrl}/prices`, {
            headers: env.HFT_ENGINE_SECRET
                ? { Authorization: `Bearer ${env.HFT_ENGINE_SECRET}` }
                : {},
        });

        if (!resp.ok) return false;

        const data = await resp.json();
        const book = getPriceBook();

        if (data && typeof data === 'object') {
            for (const [symbol, exchangeMap] of Object.entries(data)) {
                if (exchangeMap && typeof exchangeMap === 'object') {
                    for (const [exchange, price] of Object.entries(exchangeMap)) {
                        if (typeof price === 'number' && price > 0) {
                            book.update(symbol, exchange, price);
                        }
                    }
                }
            }
        }

        return true;
    } catch {
        return false;
    }
}

// ── Direct WebSocket connection to Binance ───────────────────────────────────

const BINANCE_WS_BASE = 'wss://stream.binance.com:9443/ws';

// MEXC WS base URL available for future market-data expansions
// const MEXC_WS_BASE = 'wss://wbs.mexc.com/ws';

/**
 * Generates WebSocket connection URLs for Binance mini-ticker streams.
 * @param {string[]} symbols - trading symbols (e.g. ['btcusdt', 'ethusdt'])
 * @returns {string}
 */
export function binanceStreamUrl(symbols) {
    const streams = symbols.map(s => `${s}@miniTicker`).join('/');
    return `${BINANCE_WS_BASE}/${streams}`;
}

/**
 * Processes a Binance mini-ticker message and updates the price book.
 * @param {object} msg - Binance mini-ticker message
 */
export function processBinanceTicker(msg) {
    if (!msg || !msg.s || !msg.c) return;
    const symbol = msg.s.toUpperCase();
    const price = Number.parseFloat(msg.c);
    if (!Number.isFinite(price) || price <= 0) return;

    const book = getPriceBook();
    book.update(symbol, 'binance_ws', price);
}

/**
 * Processes a MEXC ticker message and updates the price book.
 * @param {object} msg - MEXC ticker message
 */
export function processMexcTicker(msg) {
    if (!msg || !msg.s || !msg.c) return;
    const symbol = msg.s.toUpperCase();
    const price = Number.parseFloat(msg.c);
    if (!Number.isFinite(price) || price <= 0) return;

    const book = getPriceBook();
    book.update(symbol, 'mexc_ws', price);
}

// ── Aggregated price fetch (WebSocket-first, REST-fallback) ──────────────────

/**
 * Returns the best available prices for a symbol, preferring WebSocket data
 * and falling back to REST when WebSocket data is stale or unavailable.
 *
 * @param {object} env - Worker environment
 * @param {string} symbol - trading symbol
 * @param {Set} openCircuits - exchanges with open circuit breakers
 * @returns {Promise<Array>} array of { exchange, price, fee }
 */
export async function getLivePrices(env, symbol, openCircuits = new Set()) {
    const book = getPriceBook();

    // Try WebSocket book first (fastest — sub-ms)
    if (!book.isStale(symbol)) {
        const wsPrices = book.getAll(symbol);
        if (wsPrices.length >= 2) {
            return wsPrices.map(p => ({
                exchange: p.exchange.replace('_ws', ''),
                price: p.price,
                fee: 0.001, // default 0.1% fee assumption
            }));
        }
    }

    // Also try HFT engine
    await initHFTFeed(env);

    // Check again after HFT feed
    if (!book.isStale(symbol)) {
        const wsPrices = book.getAll(symbol);
        if (wsPrices.length >= 2) {
            return wsPrices.map(p => ({
                exchange: p.exchange,
                price: p.price,
                fee: 0.001,
            }));
        }
    }

    // REST fallback (always works)
    return getAllSpotPrices(env, symbol, openCircuits);
}

export { PriceBook };
