import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadBotMemory,
  saveBotMemory,
  recordStrategyOutcome,
  recordEvaluation,
  summarizeMemory,
} from '../src/bot-memory.js';

// Minimal KV mock
function makeKvMock(initial = null) {
  let stored = initial;
  return {
    async get(key, opts) {
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
    const env = makeEnv(JSON.stringify(data));
    const mem = await loadBotMemory(env);
    assert.strictEqual(mem.strategyWeights.cex, 1.2);
    assert.strictEqual(mem.recommendations[0], 'test rec');
  });
});

describe('bot-memory: recordStrategyOutcome', () => {
  it('creates new strategy entry on first outcome', async () => {
    const env = makeEnv(null);
    const mem = await loadBotMemory(env);
    recordStrategyOutcome(mem, 'cex', { success: true, profitUsd: 1.5 });
    assert.ok(mem.strategyOutcomes.cex);
    assert.strictEqual(mem.strategyOutcomes.cex.wins, 1);
    assert.strictEqual(mem.strategyOutcomes.cex.losses, 0);
  });

  it('increments losses on failed outcome', async () => {
    const env = makeEnv(null);
    const mem = await loadBotMemory(env);
    recordStrategyOutcome(mem, 'dex', { success: false, profitUsd: -2 });
    assert.strictEqual(mem.strategyOutcomes.dex.losses, 1);
    assert.strictEqual(mem.strategyOutcomes.dex.wins, 0);
  });

  it('accumulates total profit correctly', async () => {
    const env = makeEnv(null);
    const mem = await loadBotMemory(env);
    recordStrategyOutcome(mem, 'cex', { success: true, profitUsd: 3.0 });
    recordStrategyOutcome(mem, 'cex', { success: true, profitUsd: 1.5 });
    assert.strictEqual(mem.strategyOutcomes.cex.wins, 2);
    assert.ok(Math.abs(mem.strategyOutcomes.cex.totalProfitUsd - 4.5) < 0.001);
  });
});

describe('bot-memory: recordEvaluation', () => {
  it('stores evaluation snapshot', async () => {
    const env = makeEnv(null);
    const mem = await loadBotMemory(env);
    recordEvaluation(mem, { score: 72, status: 'ok', recommendations: ['improve cex spread filter'] });
    assert.strictEqual(mem.evaluations.length, 1);
    assert.strictEqual(mem.evaluations[0].score, 72);
  });

  it('adjusts strategy weight upward for high score', async () => {
    const env = makeEnv(null);
    const mem = await loadBotMemory(env);
    mem.strategyWeights.cex = 1.0;
    recordEvaluation(mem, { score: 85, status: 'ok', recommendations: [], strategyScores: { cex: 0.9 } });
    assert.ok(mem.strategyWeights.cex > 1.0, 'weight should increase for high score');
  });

  it('adjusts strategy weight downward for low score', async () => {
    const env = makeEnv(null);
    const mem = await loadBotMemory(env);
    mem.strategyWeights.cex = 1.0;
    recordEvaluation(mem, { score: 30, status: 'poor', recommendations: [], strategyScores: { cex: 0.2 } });
    assert.ok(mem.strategyWeights.cex < 1.0, 'weight should decrease for low score');
  });

  it('never pushes weight below WEIGHT_MIN (0.2)', async () => {
    const env = makeEnv(null);
    const mem = await loadBotMemory(env);
    mem.strategyWeights.cex = 0.2;
    // Multiple poor evaluations
    for (let i = 0; i < 10; i++) {
      recordEvaluation(mem, { score: 10, status: 'poor', recommendations: [], strategyScores: { cex: 0.0 } });
    }
    assert.ok(mem.strategyWeights.cex >= 0.2, 'weight must not drop below 0.2');
  });

  it('never pushes weight above WEIGHT_MAX (2.0)', async () => {
    const env = makeEnv(null);
    const mem = await loadBotMemory(env);
    mem.strategyWeights.cex = 2.0;
    for (let i = 0; i < 10; i++) {
      recordEvaluation(mem, { score: 99, status: 'excellent', recommendations: [], strategyScores: { cex: 1.0 } });
    }
    assert.ok(mem.strategyWeights.cex <= 2.0, 'weight must not exceed 2.0');
  });

  it('caps evaluations array at MAX_EVALUATIONS (50)', async () => {
    const env = makeEnv(null);
    const mem = await loadBotMemory(env);
    for (let i = 0; i < 60; i++) {
      recordEvaluation(mem, { score: 50, status: 'ok', recommendations: [] });
    }
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
    const mem = await loadBotMemory(env);
    recordEvaluation(mem, { score: 60, status: 'ok', recommendations: [] });
    const summary = summarizeMemory(mem);
    assert.strictEqual(summary.hasData, true);
    assert.ok(summary.evaluationCount >= 1);
  });

  it('includes strategy win rate when outcomes exist', async () => {
    const env = makeEnv(null);
    const mem = await loadBotMemory(env);
    recordStrategyOutcome(mem, 'cex', { success: true, profitUsd: 2 });
    recordStrategyOutcome(mem, 'cex', { success: false, profitUsd: -1 });
    const summary = summarizeMemory(mem);
    assert.ok(summary.strategyStats);
    assert.ok(summary.strategyStats.cex);
    assert.ok(Math.abs(summary.strategyStats.cex.winRate - 0.5) < 0.01);
  });
});

describe('bot-memory: saveBotMemory round-trip', () => {
  it('persists and reloads data correctly', async () => {
    const kv = makeKvMock(null);
    const env = { BOT_STATE: kv };
    const mem = await loadBotMemory(env);
    recordStrategyOutcome(mem, 'triangular', { success: true, profitUsd: 0.8 });
    recordEvaluation(mem, { score: 77, status: 'ok', recommendations: ['increase spread threshold'] });
    await saveBotMemory(env, mem);

    const reloaded = await loadBotMemory(env);
    assert.strictEqual(reloaded.strategyOutcomes.triangular?.wins, 1);
    assert.strictEqual(reloaded.evaluations[0].score, 77);
    assert.strictEqual(reloaded.recommendations[0], 'increase spread threshold');
  });
});
