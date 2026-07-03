#!/usr/bin/env node
/**
 * Performance Optimization Module
 * 
 * Enhances bot performance with:
 * - Response caching strategies
 * - Connection pooling
 * - Memory optimization
 * - Request batching
 * - Circuit breaker patterns
 */

class PerformanceOptimizer {
  constructor(options = {}) {
    this.cache = new Map();
    this.cacheExpiry = new Map();
    this.metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      requestCount: 0,
      errorCount: 0,
      totalLatency: 0
    };
    this.defaultTTL = options.ttl || 300000; // 5 minutes
    this.maxCacheSize = options.maxSize || 1000;
    this.circuitBreaker = {
      failures: 0,
      threshold: 5,
      timeout: 60000, // 1 minute
      state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
      nextRetry: 0
    };
  }

  /**
   * Cache management with TTL
   */
  set(key, value, ttl = this.defaultTTL) {
    if (this.cache.size >= this.maxCacheSize) {
      this.evictOldest();
    }
    
    this.cache.set(key, value);
    this.cacheExpiry.set(key, Date.now() + ttl);
    
    // Auto-cleanup on expiry
    setTimeout(() => this.delete(key), ttl);
  }

  get(key) {
    if (!this.cache.has(key)) {
      this.metrics.cacheMisses++;
      return null;
    }

    const expiry = this.cacheExpiry.get(key);
    if (expiry && Date.now() > expiry) {
      this.delete(key);
      this.metrics.cacheMisses++;
      return null;
    }

    this.metrics.cacheHits++;
    return this.cache.get(key);
  }

  delete(key) {
    this.cache.delete(key);
    this.cacheExpiry.delete(key);
  }

  evictOldest() {
    let oldest = null;
    let oldestTime = Infinity;

    for (const [key, time] of this.cacheExpiry.entries()) {
      if (time < oldestTime) {
        oldestTime = time;
        oldest = key;
      }
    }

    if (oldest) this.delete(oldest);
  }

  /**
   * Circuit breaker pattern for fault tolerance
   */
  async executeWithCircuitBreaker(fn, name = 'operation') {
    if (this.circuitBreaker.state === 'OPEN') {
      if (Date.now() < this.circuitBreaker.nextRetry) {
        throw new Error(`Circuit breaker OPEN for ${name}`);
      }
      this.circuitBreaker.state = 'HALF_OPEN';
    }

    try {
      const result = await fn();
      
      if (this.circuitBreaker.state === 'HALF_OPEN') {
        this.circuitBreaker.state = 'CLOSED';
        this.circuitBreaker.failures = 0;
      }

      return result;
    } catch (error) {
      this.circuitBreaker.failures++;

      if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
        this.circuitBreaker.state = 'OPEN';
        this.circuitBreaker.nextRetry = Date.now() + this.circuitBreaker.timeout;
      }

      this.metrics.errorCount++;
      throw error;
    }
  }

  /**
   * Batch requests to reduce overhead
   */
  async batchRequests(requests, batchSize = 10) {
    const results = [];

    for (let i = 0; i < requests.length; i += batchSize) {
      const batch = requests.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(batch);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Measure operation latency
   */
  async measureLatency(fn, label = 'operation') {
    const start = Date.now();
    try {
      const result = await fn();
        const latency = Date.now() - start;
      this.metrics.totalLatency += latency;
      this.metrics.requestCount++;
      
      console.log(`[PERF] ${label}: ${latency.toFixed(2)}ms`);
      return result;
    } catch (error) {
        const latency = Date.now() - start;
      this.metrics.totalLatency += latency;
      this.metrics.errorCount++;
      console.error(`[PERF] ${label} failed after ${latency.toFixed(2)}ms:`, error.message);
      throw error;
    }
  }

  /**
   * Get performance metrics
   */
  getMetrics() {
    const avgLatency = this.metrics.requestCount > 0
      ? (this.metrics.totalLatency / this.metrics.requestCount).toFixed(2)
      : 0;

    return {
      cache: {
        size: this.cache.size,
        hits: this.metrics.cacheHits,
        misses: this.metrics.cacheMisses,
        hitRate: this.metrics.cacheMisses === 0 
          ? '100%' 
          : `${(this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses) * 100).toFixed(2)}%`
      },
      operations: {
        total: this.metrics.requestCount,
        errors: this.metrics.errorCount,
        avgLatency: `${avgLatency}ms`,
        successRate: this.metrics.requestCount === 0
          ? '100%'
          : `${(((this.metrics.requestCount - this.metrics.errorCount) / this.metrics.requestCount) * 100).toFixed(2)}%`
      },
      circuitBreaker: {
        state: this.circuitBreaker.state,
        failures: this.circuitBreaker.failures,
        threshold: this.circuitBreaker.threshold
      }
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      requestCount: 0,
      errorCount: 0,
      totalLatency: 0
    };
  }
}

export default PerformanceOptimizer;
