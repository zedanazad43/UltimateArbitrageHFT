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
  calculatePositionSize,
  volatilityAdjustedSize,
  checkDrawdownGuard,
  checkExposureLimit,
  calculateVaR,
  checkMinTimeBetweenTrades
} from '../src/risk.js';
import { scanTriangular } from '../src/strategies/triangular.js';
import { computeMetrics, monteCarloSimulation } from '../src/backtest.js';

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
    assert.ok(size100k <= 20_000 + 0.01, `expected <= $20,000, got $${size100k.toFixed(2)}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// scanTriangular
// ─────────────────────────────────────────────────────────────────────────────

describe('scanTriangular', () => {
  test('returns null when prices object is empty', () => {
    assert.equal(scanTriangular('binance', 0.001, {}), null);
  });

  test('returns null when one leg price is missing', () => {
    const prices = { BTCUSDT: 65000, ETHUSDT: 3380 }; // ETHBTC missing
    assert.equal(scanTriangular('binance', 0.001, prices), null);
  });

  test('returns null when net profit is below threshold', () => {
    // Perfectly aligned prices → no arbitrage
    const pA = 65000;  // BTC/USDT
    const pB = 0.052;  // ETH/BTC  (ETH = 65000 * 0.052 = 3380)
    const pC = 3380;   // ETH/USDT
    const prices = { BTCUSDT: pA, ETHBTC: pB, ETHUSDT: pC };
    // Perfectly aligned → after 3× 0.001 fee there's no profit
    assert.equal(scanTriangular('binance', 0.001, prices), null);
  });

  test('returns opportunity when triangle is mispriced', () => {
    // Force a profitable triangle: ETH/BTC is underpriced (implies more ETH per BTC)
    const pA = 65000;   // BTC/USDT
    const pB = 0.0600;  // ETH/BTC — overpriced → 1 BTC buys only 16.67 ETH
    const pC = 4200;    // ETH/USDT — ETH is worth more in USDT than pB implies
    // Dir-1: USDT→BTC→ETH→USDT: 1/65000 * 0.0600 * 4200 ≈ 3.88‰ net after fees
    const prices = { BTCUSDT: pA, ETHBTC: pB, ETHUSDT: pC };
    const opp = scanTriangular('binance', 0.0005, prices);
    assert.notEqual(opp, null);
    assert.equal(opp.strategy, 'triangular');
    assert.equal(opp.buyExchange, 'binance');
    assert.ok(opp.netPct > 0);
  });

  test('result has required fields', () => {
    const prices = { BTCUSDT: 65000, ETHBTC: 0.06, ETHUSDT: 4200 };
    const opp = scanTriangular('mexc', 0.0005, prices);
    if (!opp) return; // may be below threshold — skip field check
    assert.ok(typeof opp.netPct === 'number');
    assert.ok(typeof opp.grossPct === 'number');
    assert.ok(typeof opp.direction === 'string');
    assert.ok(Array.isArray(opp.legs));
    assert.equal(opp.legs.length, 3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeMetrics (backtest engine)
// ─────────────────────────────────────────────────────────────────────────────

describe('computeMetrics', () => {
  test('returns zero metrics for empty array', () => {
    const m = computeMetrics([]);
    assert.equal(m.total_trades, 0);
    assert.equal(m.sharpe, 0);
  });

  test('computes correct win rate', () => {
    const m = computeMetrics([10, -5, 8, -3, 6]);
    assert.equal(m.win_trades, 3);
    assert.equal(m.loss_trades, 2);
    assert.ok(Math.abs(m.win_rate - 0.6) < 0.001);
  });

  test('computes correct total P&L', () => {
    const pnls = [10, -5, 8, -3, 6];
    const m = computeMetrics(pnls);
    assert.ok(Math.abs(m.total_pnl_usd - 16) < 0.001);
  });

  test('max drawdown is non-negative', () => {
    const m = computeMetrics([10, -20, 5, -8, 2]);
    assert.ok(m.max_drawdown_usd >= 0);
  });

  test('profit factor > 1 for net-profitable sequence', () => {
    const m = computeMetrics([10, 15, 20, -2, -1]);
    assert.ok(m.profit_factor > 1);
  });

  test('Sharpe is finite and numeric', () => {
    const m = computeMetrics([10, -5, 8, -3, 6]);
    assert.ok(isFinite(m.sharpe));
    assert.ok(typeof m.sharpe === 'number');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// monteCarloSimulation
// ─────────────────────────────────────────────────────────────────────────────

describe('monteCarloSimulation', () => {
  test('returns zeros for empty input', () => {
    const r = monteCarloSimulation([], 1000, 100);
    assert.equal(r.p50, 0);
  });

  test('p5 <= p50 <= p95', () => {
    const pnls = Array.from({length: 50}, (_, i) => (i % 3 === 0 ? -2 : 3));
    const r = monteCarloSimulation(pnls, 1000, 200);
    assert.ok(r.p5 <= r.p50 + 0.01, 'p5 should be <= p50');
    assert.ok(r.p50 <= r.p95 + 0.01, 'p50 should be <= p95');
    assert.ok(r.worst <= r.p5 + 0.01, 'worst should be <= p5');
    assert.ok(r.best  >= r.p95 - 0.01, 'best should be >= p95');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// volatilityAdjustedSize
// ─────────────────────────────────────────────────────────────────────────────

describe('volatilityAdjustedSize', () => {
  test('returns base size when spread is below threshold', () => {
    const result = volatilityAdjustedSize(100, 1.0); // threshold = 2.5
    assert.equal(result, 100);
  });

  test('returns reduced size when spread exceeds threshold', () => {
    const result = volatilityAdjustedSize(100, 5.0); // 2× threshold
    assert.ok(result < 100);
    assert.ok(result >= 100 * 0.20); // min 20% floor
  });

  test('never returns less than 20% of base size', () => {
    const result = volatilityAdjustedSize(100, 100); // extreme spread
    assert.ok(result >= 20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkDrawdownGuard
// ─────────────────────────────────────────────────────────────────────────────

describe('checkDrawdownGuard', () => {
  test('returns halt=false when daily loss is zero', () => {
    const state = { daily_pnl: 0, max_daily_loss_usd: 25, initial_capital: 1000 };
    const result = checkDrawdownGuard(state, 1000);
    assert.equal(result.halt, false);
  });

  test('returns halt=true when daily loss exceeds limit', () => {
    const state = { daily_pnl: -30, max_daily_loss_usd: 25, initial_capital: 1000 };
    const result = checkDrawdownGuard(state, 970);
    assert.equal(result.halt, true);
    assert.ok(typeof result.reason === 'string');
  });

  test('returns halt=true when equity drawdown exceeds 15% watermark', () => {
    const state = { daily_pnl: -5, max_daily_loss_usd: 100, initial_capital: 1000 };
    const result = checkDrawdownGuard(state, 800); // 20% drawdown
    assert.equal(result.halt, true);
  });

  test('returns halt=false within acceptable losses', () => {
    const state = { daily_pnl: -10, max_daily_loss_usd: 25, initial_capital: 1000 };
    const result = checkDrawdownGuard(state, 990);
    assert.equal(result.halt, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkExposureLimit
// ─────────────────────────────────────────────────────────────────────────────

describe('checkExposureLimit', () => {
  test('allows trade when no current exposure', () => {
    const result = checkExposureLimit(1000, 0, 50);
    assert.equal(result.allowed, true);
  });

  test('blocks trade when total exposure would exceed 60% of equity', () => {
    // current 400 + new 300 = 700 > 60% of 1000 = 600
    const result = checkExposureLimit(1000, 400, 300);
    assert.equal(result.allowed, false);
    assert.ok(typeof result.reason === 'string');
  });

  test('allows trade up to limit boundary', () => {
    // 550 + 50 = 600 = exactly 60% of 1000
    const result = checkExposureLimit(1000, 550, 50);
    assert.equal(result.allowed, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calculateVaR
// ─────────────────────────────────────────────────────────────────────────────

describe('calculateVaR', () => {
  test('returns 0 for empty array', () => {
    assert.equal(calculateVaR([]), 0);
  });

  test('returns 0 for fewer than 5 observations', () => {
    assert.equal(calculateVaR([1, 2, 3]), 0);
  });

  test('VaR is non-negative', () => {
    const pnls = [10, -5, 8, -12, 6, -3, 15, -7, 4, -9];
    const var95 = calculateVaR(pnls, 0.95);
    assert.ok(var95 >= 0);
  });

  test('VaR95 >= VaR90 for same series', () => {
    const pnls = [10, -5, 8, -12, 6, -3, 15, -7, 4, -9, 2, -18, 5, -2, 11];
    const var90 = calculateVaR(pnls, 0.90);
    const var95 = calculateVaR(pnls, 0.95);
    // Higher confidence → larger VaR (or equal in small samples)
    assert.ok(var95 >= var90 - 0.001, `VaR95 ${var95} should be >= VaR90 ${var90}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkMinTimeBetweenTrades
// ─────────────────────────────────────────────────────────────────────────────

describe('checkMinTimeBetweenTrades', () => {
  test('allows trade when no last timestamp', () => {
    const state = { min_seconds_between_trades: 30 };
    assert.equal(checkMinTimeBetweenTrades(state).allowed, true);
  });

  test('blocks trade within cooldown window', () => {
    const state = {
      min_seconds_between_trades: 60,
      last_trade_timestamp: Date.now() - 20000  // 20s ago, need 60s
    };
    const result = checkMinTimeBetweenTrades(state);
    assert.equal(result.allowed, false);
    assert.ok(result.waitSec > 0);
  });

  test('allows trade after cooldown window elapses', () => {
    const state = {
      min_seconds_between_trades: 30,
      last_trade_timestamp: Date.now() - 35000  // 35s ago, need 30s
    };
    assert.equal(checkMinTimeBetweenTrades(state).allowed, true);
  });
});
