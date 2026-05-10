import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';

describe('API auth hardening', () => {
  test('blocks /api/status without admin token when ADMIN_TOKEN is configured', async () => {
    const env = { ADMIN_TOKEN: 'secret-token' };
    const req = new Request('https://example.com/api/status');
    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 401);
  });

  test('allows /api/status with valid x-admin-token', async () => {
    const kv = {
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
    const env = { ADMIN_TOKEN: 'secret-token', BOT_STATE: kv };
    const req = new Request('https://example.com/api/status', {
      headers: { 'x-admin-token': 'secret-token' }
    });
    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 200);
  });

  test('blocks /api/export without admin token', async () => {
    const env = { ADMIN_TOKEN: 'secret-token' };
    const req = new Request('https://example.com/api/export');
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
    const req = new Request('https://example.com/telegram/webhook', {
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
