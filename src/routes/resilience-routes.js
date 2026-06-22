// src/routes/resilience-routes.js
// API endpoints for resilience monitoring and management

import { getHFTResilienceManager } from '../infrastructure/hft-resilience-integration.js';

export function registerResilienceRoutes(app, env, bindings) {
  // GET /resilience/health — Detailed health report
  app.get('/resilience/health', async (c) => {
    const resilience = getHFTResilienceManager(env, bindings);
    const health = await resilience.getHealthStatus();
    return c.json(health);
  });

  // GET /resilience/circuit-breaker — Circuit breaker status
  app.get('/resilience/circuit-breaker', async (c) => {
    const resilience = getHFTResilienceManager(env, bindings);
    const status = await resilience.circuitBreaker.getStatus();
    return c.json(status);
  });

  // POST /resilience/reset-breaker — Manual reset
  app.post('/resilience/reset-breaker', async (c) => {
    if (!isAdmin(c)) return c.json({ error: 'Unauthorized' }, 403);
    const resilience = getHFTResilienceManager(env, bindings);
    await resilience.resetCircuitBreaker();
    return c.json({ success: true, message: 'Circuit breaker reset' });
  });

  // GET /resilience/cache-stats — Price cache statistics
  app.get('/resilience/cache-stats', async (c) => {
    const resilience = getHFTResilienceManager(env, bindings);
    const stats = await resilience.priceCache.getCacheStats();
    return c.json(stats);
  });

  // GET /resilience/d1-stats — D1 backup statistics
  app.get('/resilience/d1-stats', async (c) => {
    const resilience = getHFTResilienceManager(env, bindings);
    const stats = await resilience.d1State.getHealthStats();
    return c.json(stats);
  });

  // GET /resilience/report — Full resilience report
  app.get('/resilience/report', async (c) => {
    const resilience = getHFTResilienceManager(env, bindings);
    const health = await resilience.getHealthStatus();

    return c.json({
      timestamp: Date.now(),
      summary: health.status,
      circuitBreaker: health.circuitBreaker,
      d1Backup: health.d1Backup,
      railwayStatus: health.railwayHealthy ? 'healthy' : 'unhealthy',
      failoverActive: health.useBackup,
      recommendations: health.observability.recommendations,
    });
  });
}

function isAdmin(c) {
  // Simple auth check - can be improved
  const auth = c.req.header('Authorization');
  return auth && auth.includes('Bearer admin');
}
