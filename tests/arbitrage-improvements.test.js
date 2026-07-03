// tests/arbitrage-improvements.test.js — Tests for HFT Arbitrage Improvements
// Uses Node.js native test runner

import test from 'node:test';
import assert from 'node:assert';

import {
  getFeeStructure,
  calculateRoundTripFee,
  calculateNetProfit,
  meetsMinimumProfitability,
  estimateLiquidityImpact,
} from '../src/utils/fees.js';

import { PriceCache } from '../src/utils/price-cache.js';

import { OpportunityRanker } from '../src/utils/opportunity-ranker.js';

import {
  validateOrderSize,
  estimateSlippage,
  estimateExecutionCost,
  isTradeFeasible,
  calculateOptimalOrderSize,
} from '../src/utils/liquidity.js';

import { PerformanceTracker } from '../src/utils/performance-tracker.js';

// ── Fees Tests ───────────────────────────────────────────────────────────────
test('Fees - get fee structure', () => {
  const fees = getFeeStructure('binance');
  assert.strictEqual(fees.takerFee, 0.001);
  assert(fees.gasEstimate > 0, 'Gas estimate should be positive');
});

test('Fees - round-trip fee calculation', () => {
  const fee = calculateRoundTripFee('mexc', 2, false);
  assert.strictEqual(fee, 0.002, 'Should be 2 × 0.001');
});

test('Fees - net profit calculation', () => {
  const net = calculateNetProfit(2.5, 0.5);
  assert.strictEqual(net, 2.0, 'Should be 2.5% - 0.5%');
});

test('Fees - minimum profitability check', () => {
  const trade = { netPct: 0.5, safetyFactor: 0.5 };
  assert(meetsMinimumProfitability(trade, { minNetPct: 0.01, minSafetyFactor: 0.35 }));
});

test('Fees - liquidity impact', () => {
  const impact = estimateLiquidityImpact(1000, 100000, 0.1);
  assert(impact > 0, 'Impact should be positive');
  assert(impact <= 0.1, 'Impact should not exceed maximum');
});

// ── Price Cache Tests ────────────────────────────────────────────────────────
test('PriceCache - store and retrieve', () => {
  const cache = new PriceCache(5000);
  cache.set('BTCUSDT', 65000, { exchange: 'mexc', fee: 0.001 });
  const entry = cache.get('BTCUSDT');
  assert(entry !== null, 'Entry should exist');
  assert.strictEqual(entry.price, 65000);
});

test('PriceCache - batch operations', () => {
  const cache = new PriceCache(5000);
  cache.setBatch({
    BTCUSDT: { price: 65000, exchange: 'mexc' },
    ETHUSDT: { price: 3380, exchange: 'binance' },
  });
  assert.strictEqual(cache.size(), 2, 'Should have 2 entries');
});

test('PriceCache - statistics', () => {
  const cache = new PriceCache(5000);
  cache.set('BTCUSDT', 65000, {});
  cache.get('BTCUSDT');
  cache.get('ETHUSDT');
  const stats = cache.getStats();
  assert.strictEqual(stats.hits, 1);
  assert.strictEqual(stats.misses, 1);
});

test('PriceCache - invalidate', () => {
  const cache = new PriceCache(5000);
  cache.set('BTCUSDT', 65000, {});
  const removed = cache.invalidate('BTCUSDT');
  assert(removed);
  assert(cache.get('BTCUSDT') === null);
});

// ── Opportunity Ranker Tests ─────────────────────────────────────────────────
test('OpportunityRanker - score opportunities', () => {
  const ranker = new OpportunityRanker();
  const opp = {
    netPct: 0.5,
    safetyFactor: 0.6,
    timestamp: Date.now(),
  };
  const score = ranker.score(opp);
  assert(score > 0, 'Score should be positive');
  assert(score <= 100, 'Score should not exceed 100');
});

test('OpportunityRanker - minimum filters', () => {
  const ranker = new OpportunityRanker();
  const opp = { netPct: 0.005, safetyFactor: 0.2 };
  assert(!ranker.meetsMinimumFilters(opp));
});

test('OpportunityRanker - rank top N', () => {
  const ranker = new OpportunityRanker();
  const opps = [
    { netPct: 0.5, safetyFactor: 0.6, strategy: 'cex', symbol: 'BTC', timestamp: Date.now() },
    { netPct: 0.3, safetyFactor: 0.5, strategy: 'dex', symbol: 'ETH', timestamp: Date.now() },
    { netPct: 0.8, safetyFactor: 0.7, strategy: 'triangular', symbol: 'SOL', timestamp: Date.now() },
  ];
  const top = ranker.rankTopN(opps, 2);
  assert(top.length <= 2, 'Should return at most 2 opportunities');
  assert(top[0].score >= (top[1]?.score ?? 0), 'First should score higher');
});

test('OpportunityRanker - diversify', () => {
  const ranker = new OpportunityRanker();
  const opps = [
    { netPct: 0.5, safetyFactor: 0.6, buyExchange: 'mexc', strategy: 'cex' },
    { netPct: 0.4, safetyFactor: 0.5, buyExchange: 'mexc', strategy: 'cex' },
    { netPct: 0.3, safetyFactor: 0.4, buyExchange: 'binance', strategy: 'dex' },
  ];
  const diverse = ranker.diversify(opps, { maxSameExchange: 1 });
  const mexcCount = diverse.filter(o => o.buyExchange === 'mexc').length;
  assert(mexcCount <= 1, 'Should have at most 1 MEXC opportunity');
});

// ── Liquidity Tests ──────────────────────────────────────────────────────────
test('Liquidity - validate order size', () => {
  const result = validateOrderSize('mexc', 50);
  assert(result.valid);
});

test('Liquidity - reject small orders', () => {
  const result = validateOrderSize('mexc', 1);
  assert(!result.valid);
  assert(result.reason.includes('minimum'));
});

test('Liquidity - estimate slippage', () => {
  const slip = estimateSlippage('binance', 10000, 100000);
  assert(slip.estimatedSlippagePct >= 0);
});

test('Liquidity - execution cost', () => {
  const cost = estimateExecutionCost('binance', 10000, 0.001);
  assert(cost.feeUSD !== undefined);
  assert(cost.slippageUSD !== undefined);
});

test('Liquidity - trade feasibility', () => {
  const trade = {
    symbol: 'BTCUSDT',
    buyExchange: 'mexc',
    sellExchange: 'binance',
    netPct: 0.5,
  };
  const feasible = isTradeFeasible(trade, 10000);
  assert(feasible.feasible !== undefined);
  assert(Array.isArray(feasible.issues));
});

test('Liquidity - optimal order size', () => {
  const size = calculateOptimalOrderSize('binance', 50000);
  assert(size > 0);
  assert(size <= 50000);
});

// ── Performance Tracker Tests ────────────────────────────────────────────────
test('PerformanceTracker - record predictions', () => {
  const tracker = new PerformanceTracker();
  const opp = { strategy: 'cex', symbol: 'BTCUSDT', netPct: 0.5 };
  const id = tracker.recordPrediction(opp, { detectionTime: 100 });
  assert(id);
  assert.strictEqual(tracker.records.length, 1);
});

test('PerformanceTracker - record outcomes', () => {
  const tracker = new PerformanceTracker();
  const id = tracker.recordPrediction({ strategy: 'cex', symbol: 'BTC', netPct: 0.5 });
  tracker.recordOutcome(id, { actualNetPct: 0.45, executionTime: 200, succeeded: true });
  const record = tracker.records.find(r => r.id === id);
  assert.strictEqual(record.actualNetPct, 0.45);
  assert(record.succeeded);
});

test('PerformanceTracker - strategy records', () => {
  const tracker = new PerformanceTracker();
  tracker.recordPrediction({ strategy: 'cex', symbol: 'BTC', netPct: 0.5 });
  tracker.recordPrediction({ strategy: 'dex', symbol: 'ETH', netPct: 0.3 });
  const cexRecords = tracker.getStrategyRecords('cex');
  assert.strictEqual(cexRecords.length, 1);
});

test('PerformanceTracker - failure analysis', () => {
  const tracker = new PerformanceTracker();
  const id = tracker.recordPrediction({ strategy: 'cex', symbol: 'BTC', netPct: 0.5 });
  tracker.recordOutcome(id, {
    actualNetPct: 0,
    executionTime: 100,
    succeeded: false,
    failureReason: 'liquidity-insufficient'
  });
  const analysis = tracker.getFailureAnalysis();
  assert(analysis.totalFailures > 0);
});

test('PerformanceTracker - CSV export', () => {
  const tracker = new PerformanceTracker();
  tracker.recordPrediction({ strategy: 'cex', symbol: 'BTC', netPct: 0.5 });
  const csv = tracker.exportCSV();
  assert(csv.includes('Strategy'));
  assert(csv.includes('cex'));
});

// ── Integration Tests ────────────────────────────────────────────────────────
test('Integration - workflow with all utilities', () => {
  const opportunities = [
    {
      strategy: 'cex',
      symbol: 'BTCUSDT',
      netPct: 0.5,
      safetyFactor: 0.6,
      buyExchange: 'mexc',
      sellExchange: 'binance',
      timestamp: Date.now(),
    },
    {
      strategy: 'dex',
      symbol: 'ETHUSDT',
      netPct: 0.3,
      safetyFactor: 0.5,
      buyExchange: 'ethereum',
      sellExchange: 'bsc',
      timestamp: Date.now(),
    },
  ];

  // Filter by profitability
  const profitable = opportunities.filter(opp =>
    meetsMinimumProfitability(opp, { minNetPct: 0.01, minSafetyFactor: 0.35 })
  );
  assert.strictEqual(profitable.length, 2);

  // Rank
  const ranker = new OpportunityRanker();
  const top = ranker.rankTopN(profitable, 2);
  assert(top.length <= 2);

  // Check feasibility
  for (const opp of top) {
    const feasible = isTradeFeasible(opp, 10000);
    assert(feasible.feasible !== undefined);
  }

  // Track performance
  const tracker = new PerformanceTracker();
  const id = tracker.recordPrediction(top[0]);
  tracker.recordOutcome(id, { actualNetPct: 0.48, executionTime: 100, succeeded: true });
  assert.strictEqual(tracker.records.length, 1);
});
