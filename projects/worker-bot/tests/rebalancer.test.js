import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeRebalancePolicy,
  buildRebalanceWeights,
  computeRebalancePlan,
} from '../src/rebalancer.js';

describe('rebalancer policy normalization', () => {
  test('applies defaults and clamps values', () => {
    const policy = normalizeRebalancePolicy({
      enabled: true,
      targetBufferPct: 9,
      minTransferUsd: -10,
      maxShiftPctPerCycle: 0,
    });

    assert.equal(policy.enabled, true);
    assert.equal(policy.targetBufferPct, 0.5);
    assert.equal(policy.minTransferUsd, 1);
    assert.equal(policy.maxShiftPctPerCycle, 0.01);
  });
});

describe('rebalancer weights', () => {
  test('gives higher buy weight to deficit exchanges', () => {
    const balances = [
      { exchange: 'mexc', configured: true, balance: 400 },
      { exchange: 'binance', configured: true, balance: 100 },
    ];

    const { weights } = buildRebalanceWeights(balances, { enabled: true });

    assert.ok(weights.binance > 1);
    assert.ok(weights.mexc < 1);
  });
});

describe('rebalancer plan', () => {
  test('returns transfer suggestions for imbalanced balances', () => {
    const balances = [
      { exchange: 'mexc', configured: true, balance: 600 },
      { exchange: 'binance', configured: true, balance: 150 },
      { exchange: 'kucoin', configured: true, balance: 150 },
    ];

    const plan = computeRebalancePlan(balances, {
      enabled: true,
      targetBufferPct: 0.1,
      minTransferUsd: 10,
      maxShiftPctPerCycle: 0.5,
    });

    assert.equal(plan.summary.rebalancingNeeded, true);
    assert.ok(plan.estimatedTransfers.length > 0);
    assert.ok(plan.summary.estimatedShiftUsd > 0);
  });

  test('returns no transfers when within buffer', () => {
    const balances = [
      { exchange: 'mexc', configured: true, balance: 100 },
      { exchange: 'binance', configured: true, balance: 102 },
      { exchange: 'kucoin', configured: true, balance: 98 },
    ];

    const plan = computeRebalancePlan(balances, {
      enabled: true,
      targetBufferPct: 0.1,
      minTransferUsd: 10,
      maxShiftPctPerCycle: 0.5,
    });

    assert.equal(plan.summary.rebalancingNeeded, false);
    assert.equal(plan.estimatedTransfers.length, 0);
  });
});
