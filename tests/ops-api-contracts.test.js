import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';

function createKvMock(stateOverrides = {}) {
  const state = {
    trading_enabled: true,
    paper_trading: false,
    daily_pnl: 12.5,
    daily_trades: 2,
    total_pnl: 81.43,
    total_trades: 42,
    initial_capital: 91.43,
    ...stateOverrides,
  };

  return {
    async get(key) {
      if (key === 'trading_state') return state;
      return null;
    },
    async put() {},
  };
}

function createDbMock() {
  return {
    prepare() {
      return {
        bind() {
          return {
            async all() { return { results: [] }; },
            async run() { return {}; },
          };
        },
        async all() { return { results: [] }; },
      };
    },
  };
}

describe('operator-facing API contracts', () => {
  test('report includes top-level state summary aliases', async () => {
    const env = {
      ADMIN_TOKEN: 'secret-token',
      BOT_STATE: createKvMock(),
      DB: createDbMock(),
    };
    const req = new globalThis.Request('https://example.com/api/report', {
      headers: { 'x-admin-token': 'secret-token' },
    });

    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.tradingEnabled, true);
    assert.equal(body.paperMode, false);
    assert.equal(body.totalProfit, 81.43);
    assert.equal(body.todayProfit, 12.5);
    assert.equal(body.totalTrades, 0);
    assert.equal(body.capital, 172.86);
    assert.equal(body.success, true);
    assert.deepEqual(body.data, body.metrics);
  });

  test('readiness fails when configured exchange auth probe fails', async (t) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: -2015, msg: 'invalid credentials' }),
      text: async () => JSON.stringify({ code: -2015, msg: 'invalid credentials' }),
      headers: new (globalThis.Headers ?? class Headers { get(){}set(){}has(){} })(),
    });
    t.after(() => {
      globalThis.fetch = originalFetch;
    });

    const env = {
      ADMIN_TOKEN: 'secret-token',
      BOT_STATE: createKvMock(),
      DB: createDbMock(),
      TELEGRAM_CHAT_ID: 'chat',
      TELEGRAM_TOKEN: 'token',
      MEXC_API_KEY: 'bad-key',
      MEXC_API_SECRET: 'bad-secret',
    };

    const req = new globalThis.Request('https://example.com/api/readiness', {
      headers: { 'x-admin-token': 'secret-token' },
    });

    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.readyForLive, false);
    assert.equal(body.checks.configuredExchangeCount, 1);
    assert.equal(body.checks.authValidatedExchangeCount, 0);
    assert.equal(body.checks.exchangeAuthFailures, 1);
    assert.equal(body.checks.executionExchangesReady, false);
    assert.equal(body.exchanges.mexc.configured, true);
    assert.equal(body.exchanges.mexc.authValidated, false);
    assert.match(body.note, /authenticated balance checks/i);
  });

  test('control panel serves x-admin-token based API wiring', async () => {
    const req = new globalThis.Request('https://example.com/control-panel', {
      headers: { 'x-admin-token': 'secret-token' },
    });
    const res = await worker.fetch(req, { ADMIN_TOKEN: 'secret-token' }, {});
    assert.equal(res.status, 200);

    const html = await res.text();
    assert.match(html, /x-admin-token/);
    assert.match(html, /\/api\/bitmart\/stats/);
    assert.match(html, /\/api\/execution-health/);
  });
});