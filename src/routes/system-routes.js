// src/routes/system-routes.js

export function registerSystemRoutes(app, deps) {
  const {
    isAuthorized,
    authDenied,
    resetCircuitBreaker,
    perfOptimizer,
    reliabilityMgr,
    analyticsEngine,
  } = deps;

  app.get('/api/balances', async (c) => {
    if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

    try {
      const { getExchangeBalance } = await import('../exchange.js');
      const assets = (c.req.query('assets') || 'USDT,USDC,BTC,ETH,BNB,SOL').split(',').map(a => a.trim().toUpperCase());
      const exchangeFilter = c.req.query('exchange');
      const exchanges = ['mexc', 'binance', 'kucoin', 'bitget', 'bitmart', 'htx', 'bybit', 'gateio'];
      const filteredExchanges = exchangeFilter
        ? exchanges.filter(ex => ex === exchangeFilter.toLowerCase())
        : exchanges;

      const data = await Promise.all(
        filteredExchanges.map(async (ex) => {
          const balances = {};
          const configured = c.env[`${ex.toUpperCase()}_API_KEY`] ? true : false;

          if (configured) {
            for (const asset of assets) {
              try {
                balances[asset] = await getExchangeBalance(c.env, ex, asset);
              } catch (_) {
                balances[asset] = 0;
              }
            }
          }

          return { exchange: ex, configured, balances };
        })
      );

      return c.json({
        ok: true,
        data,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[/api/balances] error:', err.message);
      return c.json({
        ok: false,
        error: err.message,
        data: [],
        timestamp: new Date().toISOString(),
      }, 500);
    }
  });

  app.get('/api/analytics', async (c) => {
    if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

    try {
      const initialCapital = parseInt(c.req.query('capital') || '10000', 10);
      const report = analyticsEngine.getPerformanceReport(initialCapital);
      const equityData = analyticsEngine.getEquityCurveData().slice(-100);

      return c.json({
        ok: true,
        timestamp: new Date().toISOString(),
        report,
        equityCurve: equityData,
      });
    } catch (err) {
      return c.json({ ok: false, error: err.message }, 500);
    }
  });

  app.get('/api/performance', async (c) => {
    if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

    const metrics = perfOptimizer.getMetrics();
    return c.json({
      ok: true,
      timestamp: new Date().toISOString(),
      performance: metrics,
    });
  });

  app.get('/api/health', async (c) => {
    if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

    const healthStatus = reliabilityMgr.getHealthStatus();
    const errorReport = reliabilityMgr.getErrorReport(10);

    const overallHealth = Object.values(healthStatus).every((h) => h.status === 'healthy')
      ? 'HEALTHY'
      : 'DEGRADED';

    return c.json({
      ok: true,
      timestamp: new Date().toISOString(),
      overallHealth,
      checks: healthStatus,
      recentErrors: errorReport,
    });
  });

  app.post('/api/cb/reset', async (c) => {
    if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
    try {
      const body = await c.req.json().catch(() => ({}));
      const cb = await c.env.BOT_STATE.get('nexus_circuit_breaker', 'json').catch(() => ({}));
      const exchange = body.exchange || 'all';
      resetCircuitBreaker(cb, exchange === 'all' ? null : exchange);
      await c.env.BOT_STATE.put('nexus_circuit_breaker', JSON.stringify(cb), { expirationTtl: 7200 });
      return c.json({
        success: true,
        message: exchange === 'all' ? 'All circuits reset' : `Circuit reset for ${exchange}`,
        circuitBreaker: cb,
      });
    } catch (e) {
      return c.json({ success: false, error: e.message }, 500);
    }
  });

  app.post('/api/metrics/reset', async (c) => {
    if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

    perfOptimizer.resetMetrics();
    reliabilityMgr.resetErrorHistory();
    analyticsEngine.reset();

    return c.json({
      ok: true,
      message: 'All metrics have been reset',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/trades', async (c) => {
    if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

    try {
      const limit = parseInt(c.req.query('limit') || '20', 10);
      const trades = analyticsEngine.getRecentTrades(limit);

      return c.json({
        ok: true,
        data: trades || [],
        count: (trades || []).length,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[trades endpoint] error:', err.message);
      return c.json({
        ok: true,
        data: [],
        count: 0,
        timestamp: new Date().toISOString(),
        note: 'Trade history not available',
      });
    }
  });
}
