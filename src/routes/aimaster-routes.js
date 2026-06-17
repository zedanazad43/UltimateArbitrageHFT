// src/routes/aimaster-routes.js
import { getAITradingDecision } from '../aimaster-bridge.js';

export function registerAIMasterRoutes(app) {
  app.post('/api/ai/aimaster/analyze', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const { opportunities, mode } = body;
      if (!opportunities || !Array.isArray(opportunities)) {
        return c.json({ error: 'opportunities array required' }, 400);
      }
      const context = { opportunities: opportunities.slice(0, 20), mode: mode || 'paper', timestamp: Date.now() };
      const decision = await getAITradingDecision(c.env, context);
      return c.json({
        success: true, recommendation: decision.recommendation,
        confidence: decision.confidence, reasoning: decision.reasoning,
        position_size_pct: decision.position_size_pct, risk_level: decision.risk_level,
        provider: 'deepseek', timestamp: Date.now(),
      });
    } catch (err) {
      console.error('[AIMaster Routes] Error:', err.message);
      return c.json({ error: err.message }, 500);
    }
  });

  app.get('/api/ai/aimaster/health', async (c) => {
    const hasDeepSeekKey = !!c.env.DEEPSEEK_API_KEY;
    const hasLocalServer = !!c.env.AIMASTER_STRATEGY_URL;
    let localHealthy = false;
    if (hasLocalServer) {
      try {
        const resp = await fetch(c.env.AIMASTER_STRATEGY_URL + '/health', { signal: AbortSignal.timeout(3000) });
        localHealthy = resp.ok;
      } catch (_) {}
    }
    return c.json({
      status: hasDeepSeekKey || localHealthy ? 'available' : 'unconfigured',
      deepseek_configured: hasDeepSeekKey,
      local_server: hasLocalServer ? (localHealthy ? 'healthy' : 'unreachable') : 'not_configured',
      timestamp: Date.now(),
    });
  });
}
