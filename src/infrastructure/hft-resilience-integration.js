// src/infrastructure/hft-resilience-integration.js
// Integrates all resilience improvements: backup, persistence, circuit breaker, caching, observability

import { SmartCircuitBreaker, executeWithCircuitBreaker } from './circuit-breaker-advanced.js';
import { getPriceCacheManager } from './price-cache-manager.js';
import { getD1StatePersistence } from './d1-state-persistence.js';
import { getHFTObservability } from './hft-observability.js';

export class HFTResilienceManager {
  constructor(env, bindings) {
    this.env = env;
    this.bindings = bindings;

    // Initialize components
    this.circuitBreaker = new SmartCircuitBreaker(
      bindings.BOT_STATE,
      'railway-breaker'
    );
    this.priceCache = getPriceCacheManager(bindings.BOT_STATE, {
      cacheTTL: 100, // 100ms
      namespace: 'hft-prices',
    });
    this.d1State = getD1StatePersistence(bindings.DB);
    this.observability = getHFTObservability(bindings.ANALYTICS, env);

    this.railwayHealthy = true;
    this.useBackup = false;
  }

  async initialize() {
    try {
      await this.d1State.initialize();
      console.log('[HFT Resilience] Initialized D1 state persistence');
    } catch (err) {
      console.warn('[HFT Resilience] D1 initialization warning:', err.message);
    }
  }

  // Main entry point: scan with full resilience
  async scanOpportunities(railwayFn, backupFn = null) {
    const startTime = Date.now();

    // Try Railway with circuit breaker protection
    const result = await executeWithCircuitBreaker(
      this.circuitBreaker,
      async () => {
        const response = await railwayFn();
        const latency = Date.now() - startTime;
        await this.observability.recordRailwayLatency(
          '/api/scan',
          latency,
          true
        );
        return response;
      },
      async () => {
        // Fallback to backup (Durable Objects or cached data)
        console.warn('[HFT Resilience] Railway unavailable, using backup');
        await this.observability.recordFailoverEvent(
          'railway_timeout',
          'railway',
          'backup'
        );
        if (backupFn) return await backupFn();
        return null;
      }
    );

    if (!result.success && !result.fallback) {
      // Circuit is open
      console.error('[HFT Resilience] Circuit breaker OPEN');
      this.railwayHealthy = false;
      this.useBackup = true;
      return backupFn ? await backupFn() : null;
    }

    if (result.success) {
      this.railwayHealthy = true;
      this.useBackup = false;
    }

    return result.result;
  }

  // Sync state to D1 and Durable Objects
  async syncState(positions, prices, opportunity) {
    const syncStart = Date.now();

    try {
      // Parallel sync to D1 and HFT_BACKUP
      await Promise.all([
        // D1 persistence
        (async () => {
          for (const pos of positions || []) {
            await this.d1State.savePosition(pos);
          }
          for (const [symbol, price] of Object.entries(prices || {})) {
            for (const [exchange, p] of Object.entries(price || {})) {
              await this.d1State.savePrice(symbol, exchange, p);
            }
          }
          if (opportunity) {
            await this.d1State.recordOpportunity(opportunity);
          }
        })(),

        // Durable Objects backup (if available)
        (async () => {
          if (this.bindings.HFT_BACKUP) {
            const backupId = this.bindings.HFT_BACKUP.idFromName(
              'hft-state-backup'
            );
            const backup = this.bindings.HFT_BACKUP.get(backupId);
            try {
              await backup.fetch('https://backup/sync-state', {
                method: 'POST',
                body: JSON.stringify({ positions, prices, lastOpportunity: opportunity }),
              });
            } catch (err) {
              console.warn('[HFT Resilience] Durable Object sync failed:', err.message);
            }
          }
        })(),
      ]);

      const syncDuration = Date.now() - syncStart;
      await this.observability.recordD1Backup(
        'full_state',
        (positions?.length || 0) + Object.keys(prices || {}).length,
        syncDuration
      );
    } catch (err) {
      console.error('[HFT Resilience] State sync failed:', err);
    }
  }

  // Cache price updates
  async cachePriceUpdate(symbol, exchange, price) {
    await this.priceCache.setPrice(symbol, exchange, price);
    await this.priceCache.recordPriceHistory(symbol, exchange, price);
  }

  // Get cached price with fallback
  async getPriceWithFallback(symbol, exchange, railwayFn = null) {
    // Try cache first
    const cached = await this.priceCache.getPrice(symbol, exchange);
    if (cached) {
      return { ...cached, source: 'cache' };
    }

    // Try Railway if available
    if (railwayFn && this.railwayHealthy) {
      try {
        const price = await railwayFn();
        await this.cachePriceUpdate(symbol, exchange, price);
        return { price, source: 'railway' };
      } catch (err) {
        console.warn(`Failed to get price from Railway: ${err.message}`);
      }
    }

    // No price available
    return null;
  }

  // Record detected opportunity
  async recordOpportunity(opportunity) {
    await this.d1State.recordOpportunity(opportunity);
    await this.observability.recordOpportunity(opportunity);
  }

  // Get health status
  async getHealthStatus() {
    const circuitStatus = await this.circuitBreaker.getStatus();
    const d1Stats = await this.d1State.getHealthStats();
    const observabilityReport = await this.observability.getHealthReport();

    return {
      timestamp: Date.now(),
      circuitBreaker: circuitStatus,
      d1Backup: d1Stats,
      railwayHealthy: this.railwayHealthy,
      useBackup: this.useBackup,
      observability: observabilityReport,
      status:
        circuitStatus.state === 'open' || !this.railwayHealthy
          ? 'degraded'
          : 'healthy',
    };
  }

  // Reset circuit breaker (manual recovery)
  async resetCircuitBreaker() {
    await this.circuitBreaker.reset();
    this.railwayHealthy = true;
    console.log('[HFT Resilience] Circuit breaker manually reset');
  }
}

export function getHFTResilienceManager(env, bindings) {
  return new HFTResilienceManager(env, bindings);
}
