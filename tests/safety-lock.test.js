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

  const store = new Map();
  store.set('trading_state', state);

  return {
    async get(key, type) {
      if (!store.has(key)) return null;
      const value = store.get(key);
      if (type === 'json') return value;
      return JSON.stringify(value);
    },
    async put(key, value) {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      store.set(key, parsed);
      if (key === 'trading_state') state = parsed;
    },
    _seed(key, value) {
      store.set(key, value);
    }
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

  test('safety-state exposes core strategy guard payload shape', async () => {
    const kv = createStateKvMock({
      spot_only_lock: true,
      strategy_flags: {
        cex: true,
        dex: true,
        perps: false,
        funding: false,
        triangular: true,
        statistical: true,
      },
    });

    kv._seed('core_strategy_guard_stats', {
      hourStart: 1780416000000,
      count: 3,
    });
    kv._seed('core_strategy_guard_last', {
      at: 1780416123456,
      previous_flags: {
        cex: true,
        dex: true,
        perps: false,
        funding: false,
        triangular: false,
        statistical: false,
      },
      strategy_flags: {
        cex: true,
        dex: true,
        perps: false,
        funding: false,
        triangular: true,
        statistical: true,
      },
    });

    const env = {
      ADMIN_TOKEN: 'secret-token',
      BOT_STATE: kv,
    };

    const safetyReq = createReq('https://example.com/api/safety-state', 'secret-token');
    const safetyRes = await worker.fetch(safetyReq, env, {});
    assert.equal(safetyRes.status, 200);
    const body = await safetyRes.json();

    assert.equal(typeof body.coreStrategyGuard, 'object');
    assert.equal(body.coreStrategyGuard.countThisHour, 3);
    assert.equal(body.coreStrategyGuard.hourStartTs, 1780416000000);
    assert.equal(body.coreStrategyGuard.lastInterventionTs, 1780416123456);
    assert.equal(body.coreStrategyGuard.previousFlags.triangular, false);
    assert.equal(body.coreStrategyGuard.previousFlags.statistical, false);
    assert.equal(body.coreStrategyGuard.nextFlags.triangular, true);
    assert.equal(body.coreStrategyGuard.nextFlags.statistical, true);
  });
});
