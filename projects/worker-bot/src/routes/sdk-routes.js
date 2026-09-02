// src/routes/sdk-routes.js
import SDKBridge from '../sdk-bridge.js';

export function registerSdkRoutes(app, deps = {}) {
  const env = deps?.env;
  const bridge = env ? SDKBridge.instance(env) : null;

  app.get('/api/sdk/status', async (c) => {
    const effectiveBridge = bridge || SDKBridge.instance(c.env || {});
    return c.json({
      copilot: !!effectiveBridge.copilot,
      cfBindings: {
        KV: !!(c.env.BOT_STATE || c.env.KV_STORAGE),
        D1: !!(c.env.DB || c.env.MY_D1),
        AI: !!c.env.AIWORKER,
        TELEGRAM: !!(c.env.TELEGRAM_BOT_TOKEN && c.env.TELEGRAM_CHAT_ID),
      },
    });
  });

  app.post('/api/sdk/copilot/ask', async (c) => {
    const effectiveBridge = bridge || SDKBridge.instance(c.env || {});
    try {
      const { prompt, command, toolSets } = await c.req.json().catch(() => ({}));
      if (!prompt) return c.json({ error: 'prompt required' }, 400);
      const result = await effectiveBridge.askCopilot(prompt, { command, toolSets });
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e?.message || e) }, 500);
    }
  });

  app.post('/api/sdk/tools/telegram', async (c) => {
    const effectiveBridge = bridge || SDKBridge.instance(c.env || {});
    try {
      const { text } = await c.req.json().catch(() => ({}));
      if (!text) return c.json({ error: 'text required' }, 400);
      return c.json(await effectiveBridge.sendTelegram(text));
    } catch (e) {
      return c.json({ error: String(e?.message || e) }, 500);
    }
  });

  app.get('/api/sdk/tools/kv/:key', async (c) => {
    const effectiveBridge = bridge || SDKBridge.instance(c.env || {});
    try {
      const value = await effectiveBridge.kvGet(c.req.param('key'));
      return c.json({ key: c.req.param('key'), value });
    } catch (e) {
      return c.json({ error: String(e?.message || e) }, 500);
    }
  });

  app.post('/api/sdk/tools/kv/:key', async (c) => {
    const effectiveBridge = bridge || SDKBridge.instance(c.env || {});
    try {
      const { value, expirationTtl, metadata } = await c.req.json().catch(() => ({}));
      if (value === undefined) return c.json({ error: 'value required' }, 400);
      await effectiveBridge.kvPut(c.req.param('key'), value, { expirationTtl, metadata });
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: String(e?.message || e) }, 500);
    }
  });

  app.post('/api/sdk/tools/d1', async (c) => {
    const effectiveBridge = bridge || SDKBridge.instance(c.env || {});
    try {
      const { sql, params, binding } = await c.req.json().catch(() => ({}));
      if (!sql) return c.json({ error: 'sql required' }, 400);
      const result = await effectiveBridge.d1Run(sql, Array.isArray(params) ? params : [], { binding });
      return c.json(result);
    } catch (e) {
      return c.json({ error: String(e?.message || e) }, 500);
    }
  });

  app.post('/api/sdk/tools/ai-chat', async (c) => {
    const effectiveBridge = bridge || SDKBridge.instance(c.env || {});
    try {
      const { prompt, model } = await c.req.json().catch(() => ({}));
      if (!prompt) return c.json({ error: 'prompt required' }, 400);
      return c.json(await effectiveBridge.aiChat(prompt, { model }));
    } catch (e) {
      return c.json({ error: String(e?.message || e) }, 500);
    }
  });
}
