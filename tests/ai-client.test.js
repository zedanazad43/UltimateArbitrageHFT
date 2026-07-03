// tests/ai-client.test.js — Unit tests for src/ai-client.js
// Run with: node --test tests/ai-client.test.js
// Uses only Node.js built-in test runner (node:test) — no extra dependencies.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { filterOpportunityWithAI } from '../src/ai-client.js';

// ── Test data helpers ─────────────────────────────────────────────────────────

function opp(strategy, symbol, netPct, grossPct = netPct * 1.25, safetyFactor = 0.8) {
  return {
    strategy, symbol,
    buyExchange: 'mexc', sellExchange: 'binance',
    buyPrice: 100, sellPrice: 100 * (1 + grossPct / 100),
    grossPct, netPct, safetyFactor,
    direction: `MEXC→BINANCE`,
    isPerp: false,
  };
}

// ── filterOpportunityWithAI ───────────────────────────────────────────────────

describe('filterOpportunityWithAI', () => {
  test('returns null for an empty opportunity list', async () => {
    const result = await filterOpportunityWithAI({}, []);
    assert.equal(result, null);
  });

  test('returns null for a null/undefined list', async () => {
    assert.equal(await filterOpportunityWithAI({}, null),      null);
    assert.equal(await filterOpportunityWithAI({}, undefined), null);
  });

  test('returns the single opportunity when only one is provided (no AI call needed)', async () => {
    const single = opp('cex', 'BTCUSDT', 0.5);
    const result = await filterOpportunityWithAI({}, [single]);
    assert.deepEqual(result, single);
  });

  test('returns the highest netPct opportunity when AIWORKER is not configured', async () => {
    const low  = opp('cex',  'BTCUSDT', 0.3);
    const high = opp('perps', 'ETHUSDT', 1.2);
    const mid  = opp('cex',  'SOLUSDT', 0.7);

    const result = await filterOpportunityWithAI({}, [low, high, mid]);
    assert.deepEqual(result, high);
  });

  test('falls back to highest netPct when AIWORKER.run throws', async () => {
    const low  = opp('cex',  'BTCUSDT', 0.3);
    const high = opp('perps', 'ETHUSDT', 1.1);

    const env = {
      AIWORKER: {
        run: async () => { throw new Error('model overloaded'); },
      },
    };

    const result = await filterOpportunityWithAI(env, [low, high]);
    assert.deepEqual(result, high);
  });

  test('falls back to highest netPct when AI returns an unparseable response', async () => {
    const low  = opp('cex',  'BTCUSDT', 0.3);
    const high = opp('perps', 'ETHUSDT', 1.1);

    const env = {
      AIWORKER: { run: async () => ({ response: 'sure, I think #2 is good!' }) },
    };

    // 'sure, I...' cannot be parsed as parseInt → fallback
    const result = await filterOpportunityWithAI(env, [low, high]);
    assert.deepEqual(result, high);
  });

  test('returns the AI-selected opportunity when model returns a valid index', async () => {
    // high has the highest netPct but a low safety factor (risky DEX trade)
    // medium has lower netPct but a high safety factor (reliable CEX trade)
    // The AI returns "2" (1-based) → selects the 2nd item after sorting by netPct desc
    const highProfit = opp('dex',  'ETHUSDT', 2.0, 2.5, 0.5);   // 0-based index 0 after sort
    const reliable   = opp('cex',  'BTCUSDT', 1.0, 1.25, 0.95); // 0-based index 1 — AI picks this
    const low        = opp('perps', 'SOLUSDT', 0.5);              // 0-based index 2

    const env = {
      // AI returns "2" (1-based) — selects the second-ranked (BTC CEX) over the top-ranked (ETH DEX)
      AIWORKER: { run: async () => ({ response: '2' }) },
    };

    const result = await filterOpportunityWithAI(env, [highProfit, reliable, low]);
    // After sorting by netPct desc: [highProfit(2.0), reliable(1.0), low(0.5)]
    // AI picks 1-based index 2 → 0-based index 1 → reliable (BTCUSDT CEX)
    assert.equal(result.strategy, 'cex');
    assert.equal(result.symbol,   'BTCUSDT');
  });

  test('falls back to highest netPct when AI returns index 0 (out of range)', async () => {
    const a = opp('cex', 'BTCUSDT', 1.0);
    const b = opp('cex', 'ETHUSDT', 0.5);

    const env = { AIWORKER: { run: async () => ({ response: '0' }) } };
    const result = await filterOpportunityWithAI(env, [a, b]);
    assert.deepEqual(result, a);
  });

  test('falls back to highest netPct when AI returns index > candidates length', async () => {
    const a = opp('cex', 'BTCUSDT', 1.0);
    const b = opp('cex', 'ETHUSDT', 0.5);

    const env = { AIWORKER: { run: async () => ({ response: '99' }) } };
    const result = await filterOpportunityWithAI(env, [a, b]);
    assert.deepEqual(result, a);
  });

  test('handles AIWORKER returning response in .text field instead of .response', async () => {
    const highProfit = opp('dex',  'ETHUSDT', 2.0, 2.5, 0.4); // 0-based index 0 after sort
    const reliable   = opp('cex',  'BTCUSDT', 1.0);            // 0-based index 1

    const env = {
      AIWORKER: { run: async () => ({ text: '2' }) }, // .text instead of .response
    };

    // AI picks 1-based index 2 → 0-based index 1 → reliable (BTCUSDT)
    const result = await filterOpportunityWithAI(env, [highProfit, reliable]);
    assert.equal(result.symbol, 'BTCUSDT');
  });

  test('considers at most 5 candidates even when more opportunities are provided', async () => {
    // If more than 5 opportunities are passed, only the top 5 by netPct are sent
    // to the AI. Index 6 should not be selectable.
    const opps = [
      opp('cex', 'BTC', 6.0), opp('cex', 'ETH', 5.0),
      opp('cex', 'SOL', 4.0), opp('cex', 'BNB', 3.0),
      opp('cex', 'XRP', 2.0), opp('cex', 'ADA', 1.0), // 6th — must NOT be selectable
    ];

    // AI tries to pick index 6 (beyond MAX_CANDIDATES) → fallback to highest netPct
    const env = { AIWORKER: { run: async () => ({ response: '6' }) } };
    const result = await filterOpportunityWithAI(env, opps);
    // Fallback: highest netPct (BTC)
    assert.equal(result.symbol,  'BTC');
    assert.equal(result.netPct,  6.0);
  });
});
