import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';

function createKvMock() {
  return {
    async get(key) {
      if (key === 'trading_state') {
        return {
          trading_enabled: true,
          paper_trading: true,
          daily_pnl: 0,
          daily_trades: 0,
          total_pnl: 0,
          total_trades: 0,
        };
      }
      return null;
    },
    async put() {}
  };
}

describe('API auth hardening', () => {
  test('blocks /api/status without admin token when ADMIN_TOKEN is configured', async () => {
    const env = { ADMIN_TOKEN: 'secret-token' };
    const req = new globalThis.Request('https://example.com/api/status');
    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 401);
  });

  test('allows /api/status with valid x-admin-token', async () => {
    const env = { ADMIN_TOKEN: 'secret-token', BOT_STATE: createKvMock() };
    const req = new globalThis.Request('https://example.com/api/status', {
      headers: { 'x-admin-token': 'secret-token' }
    });
    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 200);
  });

  test('allows /api/status with valid workflow token header', async () => {
    const env = { WORKFLOW_ADMIN_TOKEN: 'workflow-token', BOT_STATE: createKvMock() };
    const req = new globalThis.Request('https://example.com/api/status', {
      headers: { 'x-admin-token': 'workflow-token' }
    });
    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 200);
  });

  test('blocks /api/alerts/test without admin token', async () => {
    const env = { ADMIN_TOKEN: 'secret-token' };
    const req = new globalThis.Request('https://example.com/api/alerts/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 401);
  });

  test('sends /api/alerts/test to Telegram with a valid admin token', async (t) => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url, ...init });
      return {
        ok: true,
        status: 200,
        text: async () => '',
        body: { cancel: async () => {} },
      };
    };
    t.after(() => {
      globalThis.fetch = originalFetch;
    });

    const env = {
      ADMIN_TOKEN: 'secret-token',
      TELEGRAM_BOT_TOKEN: 'bot-token',
      TELEGRAM_CHAT_ID: '123456',
    };
    const req = new globalThis.Request('https://example.com/api/alerts/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': 'secret-token',
      },
      body: JSON.stringify({ message: 'Manual alert check' }),
    });

    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.preview, 'Manual alert check');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.telegram.org/botbot-token/sendMessage');

    const payload = JSON.parse(requests[0].body);
    assert.equal(payload.chat_id, '123456');
    assert.equal(payload.text, 'Manual alert check');
    assert.equal(payload.parse_mode, 'Markdown');
  });

  test('returns 503 from /api/alerts/test when Telegram is not configured', async () => {
    const env = { ADMIN_TOKEN: 'secret-token' };
    const req = new globalThis.Request('https://example.com/api/alerts/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': 'secret-token',
      },
      body: JSON.stringify({}),
    });

    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /not configured/i);
  });

  test('blocks /api/export without admin token', async () => {
    const env = { ADMIN_TOKEN: 'secret-token' };
    const req = new globalThis.Request('https://example.com/api/export');
    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 401);
  });


  test('blocks /api/pnl without admin token', async () => {
    const env = { ADMIN_TOKEN: 'secret-token' };
    const req = new globalThis.Request('https://example.com/api/pnl');
    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 401);
  });

  test('blocks /api/report without admin token', async () => {
    const env = { ADMIN_TOKEN: 'secret-token' };
    const req = new globalThis.Request('https://example.com/api/report');
    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 401);
  });

  test('blocks /api/logs without admin token', async () => {
    const env = { ADMIN_TOKEN: 'secret-token' };
    const req = new globalThis.Request('https://example.com/api/logs');
    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 401);
  });
});

describe('Telegram chat allowlist', () => {
  test('rejects webhook commands from unauthorized chat IDs', async () => {
    const env = {
      TELEGRAM_BOT_TOKEN: 'bot-token',
      TELEGRAM_CHAT_ID: '123456'
    };
    const req = new globalThis.Request('https://example.com/telegram/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          chat: { id: 999999 },
          text: '/status'
        }
      })
    });
    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.ok, false);
  });
});
