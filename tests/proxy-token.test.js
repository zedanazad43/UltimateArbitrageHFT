const { Hono } = require('hono');

function requireProxyToken(env, c) {
  const expected = env.PROXY_TOKEN;
  if (!expected) return null;
  const provided = c.req.header('x-proxy-token') || '';
  if (provided !== expected) return { status: 401, text: 'Invalid proxy token' };
  return null;
}

describe('proxy token guard', () => {
  test('blocks request without token', async () => {
    const app = new Hono();
    app.get('/status', async (c) => {
      const blocked = requireProxyToken(c.env, c);
      if (blocked) return c.text(blocked.text, blocked.status);
      return c.json({ ok: true });
    });
    const res = await app.request('http://localhost/status', { headers: {} });
    expect(res.status).toBe(401);
  });

  test('allows request with valid token', async () => {
    const app = new Hono();
    app.get('/status', async (c) => {
      const blocked = requireProxyToken(c.env, c);
      if (blocked) return c.text(blocked.text, blocked.status);
      return c.json({ ok: true });
    });
    const res = await app.request('http://localhost/status', { headers: { 'x-proxy-token': 'secret-123' } });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
  });
});
