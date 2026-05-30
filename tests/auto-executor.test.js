/**
 * Unit tests for src/strategies/auto-executor.js
 * Covers: DEFAULT_CONFIG values, setPaperMode toggle, strategy cooldowns,
 * executeOpportunity paper simulation, getStats() shape, DATA_ONLY_EXCHANGES
 * validation, canOpenPosition() gating, and executeBatch() cap.
 *
 * Uses Node.js built-in node:test runner.
 * No mocking required — AutoExecutor instantiates cleanly with a plain env object.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AutoExecutor, getAutoExecutor } from '../src/strategies/auto-executor.js';

function makeEnv(overrides = {}) {
  return { PROXY_MODE: 'auto', DIRECT_EXCHANGES: '', ...overrides };
}

function makeOpportunity(overrides = {}) {
  return {
    strategy: 'cex',
    symbol: 'BTC/USDT',
    buyExchange: 'mexc',
    sellExchange: 'binance',
    netPct: 0.5,
    spreadPct: 0.5,
    confidence: 0.8,
    suggestedSize: 50,
    ...overrides,
  };
}

// ─── Constructor / DEFAULT_CONFIG ─────────────────────────────────────────────

describe('AutoExecutor — constructor', () => {
  test('starts in paper mode by default', () => {
    const exe = new AutoExecutor(makeEnv());
    assert.equal(exe.config.paperMode, true);
  });

  test('has expected DEFAULT_CONFIG values', () => {
    const exe = new AutoExecutor(makeEnv());
    assert.equal(exe.config.maxExecutionsPerBatch, 2);
    assert.equal(exe.config.strategyCooldownMs, 120000);
    assert.equal(exe.config.strategyFailureLimit, 3);
    assert.equal(exe.config.minSpreadPct, 0.15);
    assert.equal(exe.config.maxPositionUsd, 5);
    assert.equal(exe.config.minPositionUsd, 1);
    assert.equal(exe.config.safePositionMaxUsd, 500);
  });

  test('allows config overrides', () => {
    const exe = new AutoExecutor(makeEnv(), { paperMode: false, maxPositionUsd: 999 });
    assert.equal(exe.config.paperMode, false);
    assert.equal(exe.config.maxPositionUsd, 999);
  });

  test('initializes counters to zero', () => {
    const exe = new AutoExecutor(makeEnv());
    assert.equal(exe.totalTrades, 0);
    assert.equal(exe.totalPnl, 0);
    assert.equal(exe.winCount, 0);
    assert.equal(exe.lossCount, 0);
    assert.equal(exe.positions.length, 0);
  });

  test('supports risk sizing and drawdown config overrides', () => {
    const exe = new AutoExecutor(makeEnv(), {
      riskWinRate: 0.6,
      riskRewardRatio: 2.5,
      initialCapitalUsd: 1500,
      maxDailyLossUsd: 40,
    });
    assert.equal(exe.config.riskWinRate, 0.6);
    assert.equal(exe.config.riskRewardRatio, 2.5);
    assert.equal(exe.config.initialCapitalUsd, 1500);
    assert.equal(exe.config.maxDailyLossUsd, 40);
  });
});

// ─── setPaperMode() ──────────────────────────────────────────────────────────

describe('AutoExecutor.setPaperMode()', () => {
  test('toggles paper mode to false', () => {
    const exe = new AutoExecutor(makeEnv());
    exe.setPaperMode(false);
    assert.equal(exe.config.paperMode, false);
  });

  test('can be toggled back to true', () => {
    const exe = new AutoExecutor(makeEnv(), { paperMode: false });
    exe.setPaperMode(true);
    assert.equal(exe.config.paperMode, true);
  });
});

// ─── Strategy cooldowns ───────────────────────────────────────────────────────

describe('AutoExecutor — strategy cooldowns', () => {
  test('a strategy is not cooling down initially', () => {
    const exe = new AutoExecutor(makeEnv());
    assert.equal(exe.isStrategyCoolingDown('cex'), false);
  });

  test('enters cooldown after strategyFailureLimit consecutive failures', () => {
    const exe = new AutoExecutor(makeEnv(), { strategyFailureLimit: 3, strategyCooldownMs: 60000 });
    exe.markStrategyFailure('cex', 'err1');
    exe.markStrategyFailure('cex', 'err2');
    exe.markStrategyFailure('cex', 'err3');  // 3rd failure triggers cooldown
    assert.equal(exe.isStrategyCoolingDown('cex'), true);
  });

  test('does NOT enter cooldown before failure limit is reached', () => {
    const exe = new AutoExecutor(makeEnv(), { strategyFailureLimit: 5 });
    exe.markStrategyFailure('cex', 'err1');
    exe.markStrategyFailure('cex', 'err2');
    assert.equal(exe.isStrategyCoolingDown('cex'), false);
  });

  test('clears cooldown on markStrategySuccess()', () => {
    const exe = new AutoExecutor(makeEnv(), { strategyFailureLimit: 1 });
    exe.markStrategyFailure('cex', 'err1');
    assert.equal(exe.isStrategyCoolingDown('cex'), true);
    exe.markStrategySuccess('cex');
    assert.equal(exe.isStrategyCoolingDown('cex'), false);
  });
});

// ─── canOpenPosition() ────────────────────────────────────────────────────────

describe('AutoExecutor.canOpenPosition()', () => {
  test('returns true when no positions and no cooldown', () => {
    const exe = new AutoExecutor(makeEnv());
    assert.equal(exe.canOpenPosition(), true);
  });

  test('returns false when cooldown has not elapsed', () => {
    const exe = new AutoExecutor(makeEnv(), { cooldownMs: 9999999 });
    exe.lastTradeTime = Date.now();
    assert.equal(exe.canOpenPosition(), false);
  });

  test('returns false when max open positions is reached', () => {
    const exe = new AutoExecutor(makeEnv(), { maxOpenPositions: 1 });
    exe.positions = [{ status: 'open' }];
    assert.equal(exe.canOpenPosition(), false);
  });
});

// ─── scoreOpportunity() ───────────────────────────────────────────────────────

describe('AutoExecutor.scoreOpportunity()', () => {
  test('returns -1 for spread below minSpreadPct', () => {
    const exe = new AutoExecutor(makeEnv(), { minSpreadPct: 0.5 });
    const opp = makeOpportunity({ netPct: 0.1 });
    assert.equal(exe.scoreOpportunity(opp), -1);
  });

  test('returns -1 for unknown strategy', () => {
    const exe = new AutoExecutor(makeEnv());
    const opp = makeOpportunity({ strategy: 'nonexistent' });
    assert.equal(exe.scoreOpportunity(opp), -1);
  });

  test('returns positive score for valid opportunity', () => {
    const exe = new AutoExecutor(makeEnv());
    const opp = makeOpportunity({ netPct: 1.0, confidence: 0.8 });
    const score = exe.scoreOpportunity(opp);
    assert.ok(score > 0, `expected score > 0, got ${score}`);
  });
});

// ─── executeOpportunity() — paper mode ────────────────────────────────────────

describe('AutoExecutor.executeOpportunity() — paper mode', () => {
  test('returns position with status closed and positive pnl', async () => {
    const exe = new AutoExecutor(makeEnv(), { paperMode: true });
    const opp = makeOpportunity({ netPct: 0.5 });
    const pos = await exe.executeOpportunity(opp, 50);
    assert.equal(pos.status, 'closed');
    assert.ok(pos.pnl >= 0, `expected pnl >= 0, got ${pos.pnl}`);
    assert.equal(exe.totalTrades, 1);
  });

  test('increments totalPnl in paper mode', async () => {
    const exe = new AutoExecutor(makeEnv(), { paperMode: true });
    const opp = makeOpportunity({ netPct: 1.0 });
    await exe.executeOpportunity(opp, 100);
    assert.ok(exe.totalPnl > 0, `expected totalPnl > 0, got ${exe.totalPnl}`);
  });

  test('fillResult.simulated is true in paper mode', async () => {
    const exe = new AutoExecutor(makeEnv(), { paperMode: true });
    const pos = await exe.executeOpportunity(makeOpportunity(), 50);
    assert.equal(pos.fillResult?.simulated, true);
  });
});

// ─── executeOpportunity() — DATA_ONLY_EXCHANGES validation ───────────────────

describe('AutoExecutor.executeOpportunity() — DATA_ONLY_EXCHANGES', () => {
  test('live execution on data-only exchange sets position status to failed', async () => {
    const exe = new AutoExecutor(makeEnv(), { paperMode: false });
    // 'bybit' is in DATA_ONLY_EXCHANGES
    const opp = makeOpportunity({ buyExchange: 'bybit', sellExchange: 'binance' });
    const pos = await exe.executeOpportunity(opp, 50);
    assert.equal(pos.status, 'failed');
  });
});

// ─── executeBatch() — maxExecutionsPerBatch cap ───────────────────────────────

describe('AutoExecutor.executeBatch() — batch cap', () => {
  test('executes at most maxExecutionsPerBatch opportunities per call', async () => {
    const exe = new AutoExecutor(makeEnv(), {
      paperMode: true,
      maxExecutionsPerBatch: 2,
      cooldownMs: 0,
    });
    // Pre-set running and balance to skip refreshPortfolioBalance
    exe._running = true;
    exe._portfolioBalance = 10000;

    const opportunities = Array.from({ length: 5 }, (_, i) =>
      makeOpportunity({ netPct: 1.0, symbol: `COIN${i}/USDT`, suggestedSize: 50 })
    );
    const executed = await exe.executeBatch(opportunities);
    assert.ok(
      executed.length <= 2,
      `expected at most 2 executions, got ${executed.length}`
    );
  });

  test('halts batch when latest trade breaches per-trade loss guard', async () => {
    const exe = new AutoExecutor(makeEnv(), {
      paperMode: true,
      cooldownMs: 0,
      maxExecutionsPerBatch: 1,
      stopLossPct: 0.02,
    });
    exe._running = true;
    exe._portfolioBalance = 1000;
    exe.tradeHistory.push({
      id: 't1',
      strategy: 'cex',
      symbol: 'BTC/USDT',
      pnl: -100,
      status: 'closed',
      closedAt: Date.now(),
    });
    const executed = await exe.executeBatch([
      makeOpportunity({ netPct: 1.0, suggestedSize: 50 })
    ]);
    assert.equal(executed.length, 0);
  });
});

// ─── getStats() ───────────────────────────────────────────────────────────────

describe('AutoExecutor.getStats()', () => {
  test('returns expected top-level keys', () => {
    const exe = new AutoExecutor(makeEnv());
    const stats = exe.getStats();
    assert.ok('running' in stats, 'missing: running');
    assert.equal(stats.paperMode, true);
    assert.equal(stats.totalTrades, 0);
    assert.ok('winRate' in stats, 'missing: winRate');
    assert.ok('proxyRouting' in stats, 'missing: proxyRouting');
    assert.ok('strategies' in stats, 'missing: strategies');
    assert.ok('strategyHealth' in stats, 'missing: strategyHealth');
    assert.ok('recentTrades' in stats, 'missing: recentTrades');
  });

  test('proxyRouting includes mode, usingProxy, availableProxies', () => {
    const exe = new AutoExecutor(makeEnv());
    const { proxyRouting } = exe.getStats();
    assert.equal(typeof proxyRouting.mode, 'string');
    assert.equal(typeof proxyRouting.usingProxy, 'boolean');
    assert.equal(typeof proxyRouting.availableProxies, 'number');
  });

  test('reflects setPaperMode toggle in getStats()', () => {
    const exe = new AutoExecutor(makeEnv());
    exe.setPaperMode(false);
    assert.equal(exe.getStats().paperMode, false);
  });

  test('includes 6 strategies by default', () => {
    const exe = new AutoExecutor(makeEnv());
    assert.equal(exe.getStats().strategies.length, 6);
  });
});

// ─── getAutoExecutor() singleton ─────────────────────────────────────────────

describe('getAutoExecutor()', () => {
  test('returns same instance on repeated calls', () => {
    const env = makeEnv();
    const a = getAutoExecutor(env);
    const b = getAutoExecutor(env);
    assert.equal(a, b);
  });

  test('returned instance has proxyRouting in getStats()', () => {
    const exe = getAutoExecutor(makeEnv());
    const stats = exe.getStats();
    assert.ok('proxyRouting' in stats);
  });
});
