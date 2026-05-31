// src/routes/temporal-routes.js

export function registerTemporalRoutes(app, deps) {
  const {
    checkRateLimit,
    isAuthorized,
    authDenied,
    logAdminEvent,
    startWorkflow,
    stopWorkflow,
    terminateWorkflow,
    describeWorkflow,
    queryWorkflowStatus,
    setTradingModeSignal,
  } = deps;

  app.post('/api/temporal/start', async (c) => {
    const limited = await checkRateLimit(c.env, c);
    if (limited) return limited;
    if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
    if (!c.env.TEMPORAL_API_KEY) {
      return c.json({ error: 'TEMPORAL_API_KEY is not configured' }, 503);
    }
    try {
      const body = await c.req.json().catch(() => ({}));
      const workerUrl = c.env.TEMPORAL_WORKER_URL;
      if (!workerUrl) {
        return c.json({ error: 'TEMPORAL_WORKER_URL is not configured — set it via wrangler secret or [vars] in wrangler.toml' }, 503);
      }
      const result = await startWorkflow(c.env, {
        workerUrl,
        adminToken: c.env.ADMIN_TOKEN || '',
        cycleIntervalSeconds: body.cycleIntervalSeconds,
        maxCyclesBeforeReset: body.maxCyclesBeforeReset,
      });
      await logAdminEvent(c.env, 'temporal:start', c.req.raw);
      return c.json({ success: true, workflowId: 'arbitrage-trading-session', result });
    } catch (e) {
      console.error('[Temporal] start error:', e.message);
      return c.json({ error: e.message }, 500);
    }
  });

  app.post('/api/temporal/stop', async (c) => {
    const limited = await checkRateLimit(c.env, c);
    if (limited) return limited;
    if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
    if (!c.env.TEMPORAL_API_KEY) {
      return c.json({ error: 'TEMPORAL_API_KEY is not configured' }, 503);
    }
    try {
      const { force } = await c.req.json().catch(() => ({}));
      const result = force
        ? await terminateWorkflow(c.env)
        : await stopWorkflow(c.env);
      await logAdminEvent(c.env, force ? 'temporal:terminate' : 'temporal:stop', c.req.raw);
      return c.json({ success: true, result });
    } catch (e) {
      console.error('[Temporal] stop error:', e.message);
      return c.json({ error: e.message }, 500);
    }
  });

  app.get('/api/temporal/status', async (c) => {
    if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
    if (!c.env.TEMPORAL_API_KEY) {
      return c.json({ error: 'TEMPORAL_API_KEY is not configured' }, 503);
    }
    try {
      const [descResult, queryResult] = await Promise.allSettled([
        describeWorkflow(c.env),
        queryWorkflowStatus(c.env),
      ]);
      return c.json({
        success: true,
        description: descResult.status === 'fulfilled' ? descResult.value : { error: descResult.reason?.message },
        status: queryResult.status === 'fulfilled' ? queryResult.value : null,
      });
    } catch (e) {
      console.error('[Temporal] status error:', e.message);
      return c.json({ error: e.message }, 500);
    }
  });

  app.post('/api/temporal/mode', async (c) => {
    const limited = await checkRateLimit(c.env, c);
    if (limited) return limited;
    if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);
    if (!c.env.TEMPORAL_API_KEY) {
      return c.json({ error: 'TEMPORAL_API_KEY is not configured' }, 503);
    }
    try {
      const { paper } = await c.req.json().catch(() => ({}));
      if (typeof paper !== 'boolean') return c.json({ error: 'body must include { "paper": true|false }' }, 400);
      await setTradingModeSignal(c.env, paper);
      await logAdminEvent(c.env, paper ? 'temporal:mode:paper' : 'temporal:mode:live', c.req.raw);
      return c.json({ success: true, mode: paper ? 'paper' : 'live' });
    } catch (e) {
      console.error('[Temporal] mode error:', e.message);
      return c.json({ error: e.message }, 500);
    }
  });
}
