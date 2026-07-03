// src/utils/price-cache.js — Price Caching Engine with TTL
//
// Reduces redundant API calls by caching price data with configurable
// time-to-live (TTL). Supports multiple cache levels and automatic expiration.

/**
 * Price cache entry
 * @typedef {object} CacheEntry
 * @property {number} price        — price value
 * @property {number} timestamp    — milliseconds since epoch
 * @property {string} exchange     — source exchange
 * @property {number} fee          — taker fee
 * @property {string} source       — data source identifier
 */

export class PriceCache {
  /**
   * @param {number} defaultTTLMs — default time-to-live in milliseconds (default: 5000ms)
   */
  constructor(defaultTTLMs = 5000) {
    this.cache = new Map();
    this.defaultTTLMs = defaultTTLMs;
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      refreshes: 0,
    };
  }

  /**
   * Get cached price if still valid, or null if expired.
   *
   * @param {string} symbol — trading pair (e.g., 'BTCUSDT')
   * @param {number} maxAgeMsOverride — optional override for max age
   * @returns {CacheEntry|null}
   */
  get(symbol, maxAgeMsOverride = null) {
    const entry = this.cache.get(symbol);
    if (!entry) {
      this.stats.misses++;
      return null;
    }

    const maxAgeMs = maxAgeMsOverride ?? this.defaultTTLMs;
    const ageMs = Date.now() - entry.timestamp;

    if (ageMs > maxAgeMs) {
      this.cache.delete(symbol);
      this.stats.evictions++;
      return null;
    }

    this.stats.hits++;
    return entry;
  }

  /**
   * Store price in cache with optional custom TTL.
   *
   * @param {string} symbol
   * @param {number} price
   * @param {object} metadata — { exchange, fee, source }
   * @param {number} ttlMsOverride — optional override for TTL
   */
  set(symbol, price, metadata = {}, ttlMsOverride = null) {
    const entry = {
      price,
      timestamp: Date.now(),
      exchange: metadata.exchange || 'unknown',
      fee: metadata.fee ?? 0.001,
      source: metadata.source || 'manual',
      ttlMs: ttlMsOverride ?? this.defaultTTLMs,
    };
    this.cache.set(symbol, entry);
  }

  /**
   * Batch set multiple prices (reduces call overhead).
   *
   * @param {object} entries — map of symbol → { price, exchange, fee, source }
   * @param {number} ttlMsOverride
   */
  setBatch(entries, ttlMsOverride = null) {
    const timestamp = Date.now();
    for (const [symbol, data] of Object.entries(entries)) {
      const entry = {
        price: data.price,
        timestamp,
        exchange: data.exchange || 'unknown',
        fee: data.fee ?? 0.001,
        source: data.source || 'batch',
        ttlMs: ttlMsOverride ?? this.defaultTTLMs,
      };
      this.cache.set(symbol, entry);
    }
  }

  /**
   * Check if a price is in cache and valid.
   *
   * @param {string} symbol
   * @returns {boolean}
   */
  has(symbol) {
    return this.get(symbol) !== null;
  }

  /**
   * Get multiple prices, returning only valid cached entries.
   *
   * @param {Array<string>} symbols
   * @returns {object} map of symbol → price (only valid entries)
   */
  getMultiple(symbols) {
    const result = {};
    for (const symbol of symbols) {
      const entry = this.get(symbol);
      if (entry) result[symbol] = entry.price;
    }
    return result;
  }

  /**
   * Get cache age in ms.
   *
   * @param {string} symbol
   * @returns {number|null}
   */
  getAge(symbol) {
    const entry = this.cache.get(symbol);
    if (!entry) return null;
    return Date.now() - entry.timestamp;
  }

  /**
   * Clear all cached prices.
   */
  clear() {
    this.cache.clear();
    this.stats.evictions += this.cache.size;
  }

  /**
   * Remove specific symbol from cache.
   *
   * @param {string} symbol
   * @returns {boolean} true if removed, false if not found
   */
  invalidate(symbol) {
    return this.cache.delete(symbol);
  }

  /**
   * Remove all entries matching a predicate.
   *
   * @param {Function} predicate — (symbol, entry) => boolean
   * @returns {number} count removed
   */
  invalidateWhere(predicate) {
    let count = 0;
    for (const [symbol, entry] of this.cache.entries()) {
      if (predicate(symbol, entry)) {
        this.cache.delete(symbol);
        count++;
      }
    }
    this.stats.evictions += count;
    return count;
  }

  /**
   * Get cache statistics.
   *
   * @returns {object}
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: hitRate.toFixed(2) + '%',
    };
  }

  /**
   * Reset statistics counters.
   */
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      refreshes: 0,
    };
  }

  /**
   * Get cache size in entries.
   *
   * @returns {number}
   */
  size() {
    return this.cache.size;
  }

  /**
   * List all cached symbols.
   *
   * @returns {Array<string>}
   */
  keys() {
    return Array.from(this.cache.keys());
  }

  /**
   * Estimate memory usage (rough).
   *
   * @returns {number} estimated bytes
   */
  estimateMemoryBytes() {
    let bytes = 0;
    for (const entry of this.cache.values()) {
      bytes += entry.symbol?.length ?? 0;
      bytes += 8; // timestamp
      bytes += 8; // price (number)
      bytes += 50; // metadata overhead
    }
    return bytes;
  }
}

// ── Global cache instance ─────────────────────────────────────────────────────

export const globalPriceCache = new PriceCache(5000); // 5-second default TTL

/**
 * Helper to fetch with cache fallback.
 *
 * @param {string} symbol
 * @param {Function} fetchFn — async function that fetches fresh price
 * @param {number} maxAgeMsOverride
 * @returns {Promise<object|null>} price entry or null
 */
export async function fetchWithCache(symbol, fetchFn, maxAgeMsOverride = null) {
  // Try cache first
  const cached = globalPriceCache.get(symbol, maxAgeMsOverride);
  if (cached) return cached;

  // Cache miss — fetch fresh
  try {
    const fresh = await fetchFn();
    if (fresh && fresh.price > 0) {
      globalPriceCache.set(symbol, fresh.price, fresh);
      return fresh;
    }
  } catch (err) {
    console.error(`[price-cache] fetchFn failed for ${symbol}:`, err.message);
  }

  return null;
}

/**
 * Warm cache with multiple symbol fetches in parallel.
 *
 * @param {Array} symbols
 * @param {Function} batchFetchFn — async function that fetches prices for array of symbols
 */
export async function warmCache(symbols, batchFetchFn) {
  try {
    const prices = await batchFetchFn(symbols);
    globalPriceCache.setBatch(prices);
  } catch (err) {
    console.error('[price-cache] warmCache failed:', err.message);
  }
}
