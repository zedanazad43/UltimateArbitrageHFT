import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { runScan, executeCexArbWithHedge } from '../src/orchestrator.js';

function createLockingEnv() {
  const activeLock = {
    token: 'active-token',
    expiresAt: Date.now() + 60_000,
  };

  return {
    BOT_STATE: {
      async get(key) {
        if (key === 'nexus_execution_lock') return activeLock;
        return null;
      },
      async put() {},
      async delete() {},
    },
  };
}

describe('runScan execution lock', () => {
  test('returns null immediately when lock is active', async () => {
    const env = createLockingEnv();
    const state = { trading_enabled: true };

    const result = await runScan(env, state, async () => ({ ok: true }));
    assert.equal(result, null);
  });
});

describe('executeCexArbWithHedge', () => {
  const args = {
    buyExch: 'mexc',
    sellExch: 'binance',
    symbol: 'BTCUSDT',
    amount: '0.001',
    requiredQuote: 100,
  };

  test('succeeds when both legs succeed', async () => {
    const calls = [];
    const placeOrder = async (_env, exchange, symbol, side, amount, requiredQuote) => {
      calls.push({ exchange, symbol, side, amount, requiredQuote });
      return { ok: true };
    };

    await assert.doesNotReject(() => executeCexArbWithHedge({}, args, placeOrder));
    assert.equal(calls.length, 2);
  });

  test('compensates exposure when one leg fails then throws compensated error', async () => {
    const calls = [];
    const placeOrder = async (_env, exchange, symbol, side) => {
      calls.push({ exchange, symbol, side });
      if (calls.length === 2) {
        throw new Error('sell leg failed');
      }
      return { ok: true };
    };

    await assert.rejects(
      () => executeCexArbWithHedge({}, args, placeOrder),
      /hedge closed residual exposure/
    );

    assert.equal(calls.length, 3);
    assert.equal(calls[2].exchange, 'mexc');
    assert.equal(calls[2].side, 'SELL');
  });

  test('throws open exposure error when compensation hedge fails', async () => {
    let callNo = 0;
    const placeOrder = async () => {
      callNo += 1;
      if (callNo === 2) throw new Error('sell leg failed');
      if (callNo === 3) throw new Error('hedge failed');
      return { ok: true };
    };

    await assert.rejects(
      () => executeCexArbWithHedge({}, args, placeOrder),
      /open exposure/
    );
  });
});
