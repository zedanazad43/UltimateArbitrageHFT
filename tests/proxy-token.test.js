import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

function requireProxyToken(env, c) {
  const expected = env.PROXY_TOKEN;
  if (!expected) return null;
  const provided = c.req.header('x-proxy-token') || '';
  if (provided !== expected) return { status: 401, text: 'Invalid proxy token' };
  return null;
}

class FakeCtx {
  constructor(env, headers) {
    this.env = env;
    this._headers = headers;
  }
  header(name) {
    return this._headers[name] || '';
  }
}

describe('proxy token guard', () => {
  test('blocks request without token', () => {
    const env = { PROXY_TOKEN: 'secret-123' };
    const blocked = requireProxyToken(env, new FakeCtx(env, {}));
    assert.equal(blocked.status, 401);
    assert.equal(blocked.text, 'Invalid proxy token');
  });

  test('allows request with valid token', () => {
    const env = { PROXY_TOKEN: 'secret-123' };
    const blocked = requireProxyToken(env, new FakeCtx(env, { 'x-proxy-token': 'secret-123' }));
    assert.equal(blocked, null);
  });
});
