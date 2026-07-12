// src/routes/geo-bypass-routes.js
// Endpoints for geo-bypass management and diagnostics

export function registerGeoBypassRoutes(app, _env, _bindings) {
  // Diagnose opportunity drought
  app.get('/geo-bypass/diagnose', async (c) => {
    const { getStrategyAnalyzer } = await import(
      '../infrastructure/strategy-analyzer.js'
    );
    const analyzer = getStrategyAnalyzer(c.env.DB, c.env);
    const diagnosis = await analyzer.diagnoseEmptyStreak(10);
    const performance = await analyzer.getStrategyPerformance(24);
    const recommendations = await analyzer.recommendTunables();

    return c.json({
      diagnosis,
      performance,
      recommendations,
      timestamp: Date.now(),
    });
  });

  // Spot-lock recovery
  app.post('/geo-bypass/spotlock-recover', async (c) => {
    const { getSpotLockRecovery } = await import(
      '../infrastructure/spotlock-recovery.js'
    );
    const recovery = getSpotLockRecovery(c.env.DB, c.env.BOT_STATE);
    const result = await recovery.autoRecover();

    return c.json({
      recovery: result,
      health: await recovery.getHealth(),
      timestamp: Date.now(),
    });
  });

  // Check proxy status
  app.get('/geo-bypass/proxy-status', async (c) => {
    const { getAdvancedProxyManager } = await import(
      '../infrastructure/advanced-proxy-manager.js'
    );
    const proxy = getAdvancedProxyManager(c.env);
    const stats = proxy.getStats();

    return c.json({
      proxyManager: stats,
      configured: {
        brightData: !!c.env.BRIGHT_DATA_USER,
        oxylabs: !!c.env.OXYLABS_USER,
      },
      timestamp: Date.now(),
    });
  });

  // Check tunnel health
  app.get('/geo-bypass/tunnel-health', async (c) => {
    const { getCloudFlareTunnelRouter } = await import(
      '../infrastructure/cloudflare-tunnel-router.js'
    );
    const router = getCloudFlareTunnelRouter(c.env);
    const health = await router.checkTunnelHealth();

    return c.json({
      tunnels: health,
      timestamp: Date.now(),
    });
  });

  // Full geo-bypass report
  app.get('/geo-bypass/report', async (c) => {
    const cfCountry = c.req.header('CF-IPCountry') || 'unknown';

    const { getStrategyAnalyzer } = await import(
      '../infrastructure/strategy-analyzer.js'
    );
    const { getAdvancedProxyManager } = await import(
      '../infrastructure/advanced-proxy-manager.js'
    );
    const { getCloudFlareTunnelRouter } = await import(
      '../infrastructure/cloudflare-tunnel-router.js'
    );
    const { getSpotLockRecovery } = await import(
      '../infrastructure/spotlock-recovery.js'
    );

    const analyzer = getStrategyAnalyzer(c.env.DB, c.env);
    const proxy = getAdvancedProxyManager(c.env);
    const router = getCloudFlareTunnelRouter(c.env);
    const spotlock = getSpotLockRecovery(c.env.DB, c.env.BOT_STATE);

    const [diagnosis, proxyStats, tunnelHealth, spotlockHealth] =
      await Promise.all([
        analyzer.diagnoseEmptyStreak(10),
        Promise.resolve(proxy.getStats()),
        router.checkTunnelHealth(),
        spotlock.getHealth(),
      ]);

    return c.json({
      timestamp: Date.now(),
      userCountry: cfCountry,
      diagnosis,
      infrastructure: {
        proxy: proxyStats,
        tunnels: tunnelHealth,
        spotlock: spotlockHealth,
      },
      recommendations: {
        primary:
          cfCountry === 'US'
            ? '🌍 Geo-blocking detected. Enable proxy or tunnel.'
            : '✅ No geo-blocking detected.',
        actionItems: diagnosis.recommendations,
      },
    });
  });

  // Admin: Force reset all systems
  app.post('/geo-bypass/force-reset', async (c) => {
    // Check admin auth
    const adminSecret = c.req.header('X-Admin-Secret');
    if (adminSecret !== c.env.ADMIN_SECRET) {
      return c.json({ error: 'Unauthorized' }, 403);
    }

    const { getSpotLockRecovery } = await import(
      '../infrastructure/spotlock-recovery.js'
    );
    const spotlock = getSpotLockRecovery(c.env.DB, c.env.BOT_STATE);

    const result = await spotlock.forceReset();

    return c.json({
      action: 'force-reset',
      result,
      timestamp: Date.now(),
    });
  });
}
