// Edge price feed caching with KV — reduce Railway latency

export class PriceCacheManager {
  constructor(kv, config = {}) {
    this.kv = kv;
    this.config = {
      cacheTTL: config.cacheTTL || 100, // 100ms default
      maxPricesPerSymbol: config.maxPricesPerSymbol || 10,
      batchUpdateInterval: config.batchUpdateInterval || 1000, // 1s
      namespace: config.namespace || 'price-cache',
      ...config,
    };
    this.pendingUpdates = new Map();
    this.lastBatchTime = Date.now();
  }

  async getCacheKey(symbol, exchange) {
    return `${this.config.namespace}:${symbol}:${exchange}`;
  }

  async getPrice(symbol, exchange) {
    const key = await this.getCacheKey(symbol, exchange);
    try {
      const cached = await this.kv.get(key, 'json');
      if (cached && cached.timestamp > Date.now() - this.config.cacheTTL) {
        return {
          price: cached.price,
          source: 'cache',
          age: Date.now() - cached.timestamp,
        };
      }
    } catch (err) {
      console.error(`Failed to get price from cache: ${err.message}`);
    }
    return null;
  }

  async getPrices(symbols, exchange) {
    const prices = {};
    for (const symbol of symbols) {
      const price = await this.getPrice(symbol, exchange);
      if (price) {
        prices[symbol] = price;
      }
    }
    return prices;
  }

  async setPrice(symbol, exchange, price, metadata = {}) {
    const key = await this.getCacheKey(symbol, exchange);
    const data = {
      symbol,
      exchange,
      price,
      timestamp: Date.now(),
      ...metadata,
    };

    try {
      await this.kv.put(key, JSON.stringify(data), {
        expirationTtl: this.config.cacheTTL,
      });
    } catch (err) {
      console.error(`Failed to cache price: ${err.message}`);
    }
  }

  async batchSetPrices(priceUpdates) {
    // priceUpdates = [{ symbol, exchange, price }, ...]
    const promises = priceUpdates.map((update) =>
      this.setPrice(update.symbol, update.exchange, update.price)
    );
    await Promise.allSettled(promises);
  }

  async recordPriceHistory(symbol, exchange, price) {
    const historyKey = `${this.config.namespace}:history:${symbol}:${exchange}`;

    try {
      let history = await this.kv.get(historyKey, 'json');
      if (!history) history = [];

      history.push({ price, timestamp: Date.now() });

      // Keep only recent prices
      if (history.length > this.config.maxPricesPerSymbol) {
        history = history.slice(-this.config.maxPricesPerSymbol);
      }

      await this.kv.put(historyKey, JSON.stringify(history), {
        expirationTtl: 3600, // 1 hour
      });
    } catch (err) {
      console.error(`Failed to record price history: ${err.message}`);
    }
  }

  async getPriceHistory(symbol, exchange) {
    const historyKey = `${this.config.namespace}:history:${symbol}:${exchange}`;
    try {
      return await this.kv.get(historyKey, 'json');
    } catch {
      return [];
    }
  }

  async getMultiplePriceHistories(symbols, exchange) {
    const histories = {};
    for (const symbol of symbols) {
      histories[symbol] = await this.getPriceHistory(symbol, exchange);
    }
    return histories;
  }

  // Calculate price volatility from cache
  async calculateVolatility(symbol, exchange) {
    const history = await this.getPriceHistory(symbol, exchange);
    if (history.length < 2) return 0;

    const prices = history.map((p) => p.price);
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance =
      prices.reduce((a, p) => a + (p - mean) ** 2, 0) / prices.length;
    const volatility = Math.sqrt(variance);

    return { volatility, priceCount: prices.length, mean };
  }

  // Get best price across exchanges for a symbol
  async getBestPrice(symbol, exchanges) {
    const prices = await Promise.all(
      exchanges.map(async (exchange) => ({
        exchange,
        price: await this.getPrice(symbol, exchange),
      }))
    );

    return prices
      .filter((p) => p.price)
      .reduce((best, current) => {
        if (!best) return current;
        return current.price.price < best.price.price ? current : best;
      }, null);
  }

  // Statistics for cache efficiency
  async getCacheStats() {
    // Note: This is approximate since KV doesn't expose detailed stats
    return {
      cacheTTLMs: this.config.cacheTTL,
      maxHistorySize: this.config.maxPricesPerSymbol,
      batchIntervalMs: this.config.batchUpdateInterval,
      namespace: this.config.namespace,
      message: 'For detailed stats, check Cloudflare analytics',
    };
  }

  // Preload cache for frequently traded symbols
  async preloadSymbols(symbols, exchanges, priceData) {
    console.log(`Preloading ${symbols.length} symbols across ${exchanges.length} exchanges`);
    const updates = [];

    for (const symbol of symbols) {
      for (const exchange of exchanges) {
        const price = priceData[symbol]?.[exchange];
        if (price) {
          updates.push({ symbol, exchange, price });
        }
      }
    }

    await this.batchSetPrices(updates);
  }

  // Clear stale cache entries
  async clearCache(_pattern) {
    // KV doesn't support batch delete, so we'd need to track keys separately
    console.warn(
      'KV cache clearing requires manual key tracking. Consider using metadata.'
    );
  }
}

export function getPriceCacheManager(kv, config) {
  return new PriceCacheManager(kv, config);
}
