import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadBotMemory,
  recordStrategyOutcome,
  recordEvaluation,
  summarizeMemory,
} from '../src/bot-memory.js';

// Minimal KV mock: stores one value, round-trips through JSON
function makeKvMock(initial = null) {
  let stored = initial ? JSON.stringify(initial) : null;
  return {
    async get(_key, opts) {
      if (stored === null) return null;
      return opts === 'json' ? JSON.parse(stored) : stored;
    },
    async put(_key, value) {
      stored = typeof value === 'string' ? value : JSON.stringify(value);
    },
  };
}

function makeEnv(initial = null) {
  return { BOT_STATE: makeKvMock(initial) };
}

describe('bot-memory: loadBotMemory', () => {
  it('returns default structure when KV is empty', async () => {
    const env = makeEnv(null);
    const mem = await loadBotMemory(env);
    assert.strictEqual(mem.version, 1);
    assert.ok(Array.isArray(mem.evaluations));
    assert.ok(typeof mem.strategyOutcomes === 'object');
    assert.ok(typeof mem.strategyWeights === 'object');
    assert.ok(Array.isArray(mem.recommendations));
  });

  it('returns stored data if KV has valid memory', async () => {
    const data = {
      version: 1,
      evaluations: [{ ts: 1000, score: 85 }],
      strategyOutcomes: {},
      strategyWeights: { cex: 1.2 },
      autoTuning: {},
      recommendations: ['test rec'],
    };
    const env = makeEnv(data);
    const mem = await loadBotMemory(env);
    assert.strictEqual(mem.strategyWeights.cex, 1.2);
    assert.strictEqual(mem.recommendations[0], 'test rec');
  });
});

describe('bot-memory: recordStrategyOutcome', () => {
  it('creates new strategy entry on first outcome', async () => {
    const env = makeEnv(null);
    await recordStrategyOutcome(env, 'cex', { success: true, pnlUsd: 1.5 });
    const mem = await loadBotMemory(env);
    assert.ok(mem.strategyOutcomes.cex);
    assert.strictEqual(mem.strategyOutcomes.cex.wins, 1);
    assert.strictEqual(mem.strategyOutcomes.cex.losses, 0);
  });

  it('increments losses on failed outcome', async () => {
    const env = makeEnv(null);
    await recordStrategyOutcome(env, 'dex', { success: false, pnlUsd: -2 });
    const mem = await loadBotMemory(env);
    assert.strictEqual(mem.strategyOutcomes.dex.losses, 1);
    assert.strictEqual(mem.strategyOutcomes.dex.wins, 0);
  });

  it('accumulates total profit correctly', async () => {
    const env = makeEnv(null);
    await recordStrategyOutcome(env, 'cex', { success: true, pnlUsd: 3.0 });
    await recordStrategyOutcome(env, 'cex', { success: true, pnlUsd: 1.5 });
    const mem = await loadBotMemory(env);
    assert.strictEqual(mem.strategyOutcomes.cex.wins, 2);
    assert.ok(Math.abs(mem.strategyOutcomes.cex.totalPnlUsd - 4.5) < 0.001);
  });
});

describe('bot-memory: recordEvaluation', () => {
  it('stores evaluation snapshot', async () => {
    const env = makeEnv(null);
    await recordEvaluation(env, { recommendations: ['improve cex spread filter'] });
    const mem = await loadBotMemory(env);
    assert.strictEqual(mem.evaluations.length, 1);
    assert.ok(mem.evaluations[0].ts > 0);
  });

  it('adjusts strategy weight upward when scale recommendation present', async () => {
    const env = makeEnv(null);
    await recordEvaluation(env, { recommendations: ['scale cex'] });
    const mem = await loadBotMemory(env);
    assert.ok(mem.strategyWeights.cex > 1.0, 'weight should increase');
  });

  it('adjusts strategy weight downward when de-risk recommendation present', async () => {
    const env = makeEnv(null);
    await recordEvaluation(env, { recommendations: ['de-risk cex'] });
    const mem = await loadBotMemory(env);
    assert.ok(mem.strategyWeights.cex < 1.0, 'weight should decrease');
  });

  it('never pushes weight below WEIGHT_MIN (0.2)', async () => {
    const env = makeEnv(null);
    for (let i = 0; i < 15; i++) {
      await recordEvaluation(env, { recommendations: ['de-risk cex'] });
    }
    const mem = await loadBotMemory(env);
    assert.ok(mem.strategyWeights.cex >= 0.2, 'weight must not drop below 0.2');
  });

  it('never pushes weight above WEIGHT_MAX (2.0)', async () => {
    const env = makeEnv(null);
    for (let i = 0; i < 15; i++) {
      await recordEvaluation(env, { recommendations: ['scale cex'] });
    }
    const mem = await loadBotMemory(env);
    assert.ok(mem.strategyWeights.cex <= 2.0, 'weight must not exceed 2.0');
  });

  it('caps evaluations array at MAX_EVALUATIONS (50)', async () => {
    const env = makeEnv(null);
    for (let i = 0; i < 60; i++) {
      await recordEvaluation(env, { recommendations: [] });
    }
    const mem = await loadBotMemory(env);
    assert.ok(mem.evaluations.length <= 50, 'evaluations must be capped at 50');
  });
});

describe('bot-memory: summarizeMemory', () => {
  it('returns hasData=false when memory is empty', async () => {
    const env = makeEnv(null);
    const mem = await loadBotMemory(env);
    const summary = summarizeMemory(mem);
    assert.strictEqual(summary.hasData, false);
  });

  it('returns hasData=true with evaluation data', async () => {
    const env = makeEnv(null);
    await recordEvaluation(env, { recommendations: [] });
    const mem = await loadBotMemory(env);
    const summary = summarizeMemory(mem);
    assert.strictEqual(summary.hasData, true);
    assert.ok(summary.evaluationCount >= 1);
  });

  it('includes strategy win rate when outcomes exist', async () => {
    const env = makeEnv(null);
    await recordStrategyOutcome(env, 'cex', { success: true, pnlUsd: 2 });
    await recordStrategyOutcome(env, 'cex', { success: false, pnlUsd: -1 });
    await recordEvaluation(env, { recommendations: [] });
    const mem = await loadBotMemory(env);
    const summary = summarizeMemory(mem);
    assert.ok(summary.strategyStats);
    const cexStat = summary.strategyStats.find(s => s.strategy === 'cex');
    assert.ok(cexStat, 'cex stat should exist');
    assert.ok(Math.abs(cexStat.winRate - 50) < 0.1, 'win rate should be ~50%');
  });
});

describe('bot-memory: saveBotMemory round-trip', () => {
  it('persists and reloads data correctly', async () => {
    const env = makeEnv(null);
    await recordStrategyOutcome(env, 'triangular', { success: true, pnlUsd: 0.8 });
    await recordEvaluation(env, { recommendations: ['increase spread threshold'] });
    const reloaded = await loadBotMemory(env);
    assert.strictEqual(reloaded.strategyOutcomes.triangular?.wins, 1);
    assert.ok(reloaded.evaluations.length >= 1);
    assert.ok(reloaded.recommendations.includes('increase spread threshold'));
  });
});
