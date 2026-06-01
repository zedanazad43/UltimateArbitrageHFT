import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';

function createStateKvMock(initialState = {}) {
  let state = {
    trading_enabled: true,
    paper_trading: false,
    spot_only_lock: false,
    strategy_flags: {
      cex: true,
      dex: false,
      perps: false,
      funding: false,
      triangular: true,
      statistical: false,
    },
    ...initialState,
  };

  return {
    async get(key, type) {
      if (key !== 'trading_state') return null;
      if (type === 'json') return state;
      return JSON.stringify(state);
    },
    async put(key, value) {
      if (key !== 'trading_state') return;
      state = typeof value === 'string' ? JSON.parse(value) : value;
    },
  };
}

function createReq(url, token, init = {}) {
  const headers = new globalThis.Headers(init.headers || {});
  if (token) headers.set('x-admin-token', token);
  return new globalThis.Request(url, {
    ...init,
    headers,
  });
}

describe('spot-only lock safety', () => {
  test('requires admin token for /api/safety-state', async () => {
    const env = {
      ADMIN_TOKEN: 'secret-token',
      BOT_STATE: createStateKvMock(),
    };
    const req = new globalThis.Request('https://example.com/api/safety-state');
    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 401);
  });

  test('blocks /config attempts to enable perps/funding while lock is active', async () => {
    const env = {
      ADMIN_TOKEN: 'secret-token',
      BOT_STATE: createStateKvMock({
        spot_only_lock: true,
        strategy_flags: {
          cex: true,
          dex: false,
          perps: false,
          funding: false,
          triangular: true,
          statistical: false,
        },
      }),
    };

    const req = createReq('https://example.com/config', 'secret-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        strategy_flags: {
          perps: true,
          funding: true,
        },
      }),
    });

    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 200);

    const safetyReq = createReq('https://example.com/api/safety-state', 'secret-token');
    const safetyRes = await worker.fetch(safetyReq, env, {});
    assert.equal(safetyRes.status, 200);
    const body = await safetyRes.json();

    assert.equal(body.spotOnlyLock, true);
    assert.equal(body.strategyFlags.perps, false);
    assert.equal(body.strategyFlags.funding, false);
    assert.equal(typeof body.lastConfigChangeTs, 'number');
    assert.ok(body.lastConfigChangeTs > 0);
  });

  test('explicit perps enable unlocks and enables perps/funding', async () => {
    const env = {
      ADMIN_TOKEN: 'secret-token',
      BOT_STATE: createStateKvMock({
        spot_only_lock: true,
        strategy_flags: {
          cex: true,
          dex: false,
          perps: false,
          funding: false,
          triangular: true,
          statistical: false,
        },
      }),
    };

    const req = createReq('https://example.com/strategy/perps/enable', 'secret-token', {
      method: 'POST',
    });
    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 200);

    const safetyReq = createReq('https://example.com/api/safety-state', 'secret-token');
    const safetyRes = await worker.fetch(safetyReq, env, {});
    assert.equal(safetyRes.status, 200);
    const body = await safetyRes.json();

    assert.equal(body.spotOnlyLock, false);
    assert.equal(body.strategyFlags.perps, true);
    assert.equal(body.strategyFlags.funding, true);
  });
});
