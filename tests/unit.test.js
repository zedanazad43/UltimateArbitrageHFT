// tests/unit.test.js — Unit tests for pure strategy and risk functions.
// Run with: node --test tests/unit.test.js
// Uses only Node.js built-in test runner (node:test) — no extra dependencies.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ── Import the modules under test ─────────────────────────────────────────────
// These are pure functions with no Cloudflare-specific dependencies.
import { scanCEX }   from '../src/strategies/cex.js';
import { scanPerps } from '../src/strategies/perps.js';
import {
  calculateAdaptiveLeverage,
  calculatePositionSize
} from '../src/risk.js';

// ─────────────────────────────────────────────────────────────────────────────
// scanCEX
// ─────────────────────────────────────────────────────────────────────────────

describe('scanCEX', () => {
  test('returns null when fewer than 2 sources', () => {
    const result = scanCEX('BTCUSDT', [{ price: 50000, exchange: 'mexc', fee: 0.001 }], 5.0);
    assert.equal(result, null);
  });

  test('returns null when prices are equal', () => {
    const sources = [
      { price: 50000, exchange: 'mexc',    fee: 0.001 },
      { price: 50000, exchange: 'binance', fee: 0.001 }
    ];
    assert.equal(scanCEX('BTCUSDT', sources, 5.0), null);
  });

  test('returns null when net profit is zero or negative (fees eat the spread)', () => {
    // spread = 0.1%, total fees = 0.2% → net negative
    const sources = [
      { price: 50000, exchange: 'mexc',    fee: 0.001 },
      { price: 50050, exchange: 'binance', fee: 0.001 }
    ];
    assert.equal(scanCEX('BTCUSDT', sources, 5.0), null);
  });

  test('returns opportunity when net profit is positive', () => {
    // spread ≈ 1%, fees = 0.1% each → net ≈ 0.8%
    const sources = [
      { price: 50000, exchange: 'mexc',    fee: 0.0005 },
      { price: 50600, exchange: 'binance', fee: 0.0005 }
    ];
    const opp = scanCEX('BTCUSDT', sources, 5.0);
    assert.notEqual(opp, null);
    assert.equal(opp.strategy,     'cex');
    assert.equal(opp.symbol,       'BTCUSDT');
    assert.equal(opp.buyExchange,  'mexc');
    assert.equal(opp.sellExchange, 'binance');
    assert.ok(opp.netPct > 0, 'netPct should be positive');
    assert.equal(opp.isPerp, false);
  });

  test('picks the pair with the highest net profit from multiple sources', () => {
    const sources = [
      { price: 50000, exchange: 'mexc',    fee: 0.0005 },
      { price: 50600, exchange: 'binance', fee: 0.0005 },
      { price: 51000, exchange: 'kucoin',  fee: 0.001  }
    ];
    const opp = scanCEX('BTCUSDT', sources, 5.0);
    assert.notEqual(opp, null);
    assert.equal(opp.buyExchange, 'mexc');
    assert.equal(opp.sellExchange, 'kucoin');
  });

  test('returns null when spread exceeds maxSpreadPct guard', () => {
    // 10% spread but guard is 5%
    const sources = [
      { price: 50000, exchange: 'mexc',    fee: 0.0005 },
      { price: 55001, exchange: 'binance', fee: 0.0005 }
    ];
    assert.equal(scanCEX('BTCUSDT', sources, 5.0), null);
  });

  test('returns null when safetyFactor is below 40%', () => {
    // spread = 0.3%, total fees = 0.2% → net = 0.1%, safety = 0.1/0.3 ≈ 33% < 40%
    const sources = [
      { price: 10000, exchange: 'mexc',    fee: 0.001 },
      { price: 10030, exchange: 'binance', fee: 0.001 }
    ];
    assert.equal(scanCEX('SOLUSDT', sources, 5.0), null);
  });

  test('direction string is formatted as BUY_EXCHANGE→SELL_EXCHANGE in uppercase', () => {
    const sources = [
      { price: 100, exchange: 'mexc',    fee: 0.0005 },
      { price: 102, exchange: 'binance', fee: 0.0005 }
    ];
    const opp = scanCEX('XRPUSDT', sources, 5.0);
    assert.notEqual(opp, null);
    assert.equal(opp.direction, 'MEXC→BINANCE');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// scanPerps
// ─────────────────────────────────────────────────────────────────────────────

describe('scanPerps', () => {
  test('returns null when perpSource is null', () => {
    const spots = [{ price: 50000, exchange: 'mexc', fee: 0.0005 }];
    assert.equal(scanPerps('BTCUSDT', spots, null, 5.0), null);
  });

  test('returns null when spotSources is empty', () => {
    const perp = { price: 50200, exchange: 'mexc_perp', fee: 0.0002 };
    assert.equal(scanPerps('BTCUSDT', [], perp, 5.0), null);
  });

  test('returns opportunity when perp price > spot price and net profit positive', () => {
    const spots = [{ price: 50000, exchange: 'mexc', fee: 0.0005 }];
    const perp  = { price: 50700, exchange: 'mexc_perp', fee: 0.0002 };
    const opp = scanPerps('BTCUSDT', spots, perp, 5.0);
    assert.notEqual(opp, null);
    assert.equal(opp.strategy,    'perps');
    assert.equal(opp.symbol,      'BTCUSDT');
    assert.equal(opp.isPerp,      true);
    assert.ok(opp.netPct > 0);
    assert.equal(opp.buyExchange,  'mexc');
    assert.equal(opp.sellExchange, 'mexc_perp');
  });

  test('returns opportunity in the opposite direction when spot > perp', () => {
    const spots = [{ price: 51000, exchange: 'mexc', fee: 0.0005 }];
    const perp  = { price: 50000, exchange: 'mexc_perp', fee: 0.0002 };
    const opp = scanPerps('BTCUSDT', spots, perp, 5.0);
    assert.notEqual(opp, null);
    assert.equal(opp.buyExchange,  'mexc_perp');
    assert.equal(opp.sellExchange, 'mexc');
  });

  test('returns null when combined spread exceeds maxSpreadPct', () => {
    const spots = [{ price: 50000, exchange: 'mexc', fee: 0.0005 }];
    const perp  = { price: 53001, exchange: 'mexc_perp', fee: 0.0002 }; // >5%
    assert.equal(scanPerps('BTCUSDT', spots, perp, 5.0), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calculateAdaptiveLeverage
// ─────────────────────────────────────────────────────────────────────────────

describe('calculateAdaptiveLeverage', () => {
  test('returns at least 2 (minimum lever)', () => {
    const lev = calculateAdaptiveLeverage(100, 0.01, 1000);
    assert.ok(lev >= 2, `expected >= 2, got ${lev}`);
  });

  test('never exceeds 20 (maximum lever, reduced from 50)', () => {
    // Even with very large equity the cap should be 20
    const lev = calculateAdaptiveLeverage(1_000_000, 10, 1000);
    assert.ok(lev <= 20, `expected <= 20, got ${lev}`);
  });

  test('increases with equity growth', () => {
    const levSmall = calculateAdaptiveLeverage(1000,  0.1, 1000);
    const levLarge = calculateAdaptiveLeverage(10000, 0.1, 1000);
    assert.ok(levLarge >= levSmall, 'leverage should not decrease as equity grows');
  });

  test('returns integer', () => {
    const lev = calculateAdaptiveLeverage(2000, 0.05, 1000);
    assert.equal(lev, Math.round(lev));
  });

  test('scales with profit margin', () => {
    const levLow  = calculateAdaptiveLeverage(1000, 0.01, 1000);
    const levHigh = calculateAdaptiveLeverage(1000, 0.20, 1000);
    assert.ok(levHigh >= levLow, 'higher margin should produce higher or equal leverage');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calculatePositionSize
// ─────────────────────────────────────────────────────────────────────────────

describe('calculatePositionSize', () => {
  test('returns a positive number', () => {
    const size = calculatePositionSize(1000, 0.55, 2.0);
    assert.ok(size > 0, `expected > 0, got ${size}`);
  });

  test('never exceeds 20% of equity', () => {
    // Run for a range of equity values
    for (const equity of [500, 1000, 5000, 20000]) {
      const size = calculatePositionSize(equity, 0.6, 2.5);
      assert.ok(
        size <= equity * 0.20 + 0.01, // small floating-point tolerance
        `size ${size.toFixed(2)} exceeds 20% of equity ${equity}`
      );
    }
  });

  test('returns 0 or positive when winRate <= 0.5 (Kelly gives 0)', () => {
    const size = calculatePositionSize(1000, 0.45, 2.0);
    assert.ok(size >= 0);
  });

  test('grows with equity (compounding)', () => {
    const sizeSmall = calculatePositionSize(1000, 0.55, 2.0);
    const sizeLarge = calculatePositionSize(5000, 0.55, 2.0);
    assert.ok(sizeLarge > sizeSmall, 'position size should grow with equity');
  });

  test('uses logistic growth — does not grow unboundedly', () => {
    const size100k = calculatePositionSize(100_000, 0.55, 2.0);
    // Should be capped at 20% of equity = $20,000
    assert.ok(size100k <= 20_000 + 0.01, `expected <= $20,000, got $${size100k.toFixed(2)}`);
  });
});
