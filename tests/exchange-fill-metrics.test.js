import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractFillMetrics } from '../src/exchange.js';

describe('extractFillMetrics', () => {
  test('parses Binance-style order fills', () => {
    const metrics = extractFillMetrics({
      executedQty: '2',
      cummulativeQuoteQty: '200',
      fills: [
        { price: '99', qty: '1' },
        { price: '101', qty: '1' }
      ]
    });
    assert.notEqual(metrics, null);
    assert.equal(metrics.executedQty, 2);
    assert.equal(metrics.quoteQty, 200);
    assert.equal(metrics.avgPrice, 100);
  });

  test('parses nested exchange payloads with avgPrice + filled size', () => {
    const metrics = extractFillMetrics({
      data: {
        filledSize: '1.5',
        avgPrice: '250.5'
      }
    });
    assert.notEqual(metrics, null);
    assert.equal(metrics.executedQty, 1.5);
    assert.equal(metrics.quoteQty, 375.75);
    assert.equal(metrics.avgPrice, 250.5);
  });

  test('returns null when required fill fields are unavailable', () => {
    const metrics = extractFillMetrics({ data: { orderId: 'abc123' } });
    assert.equal(metrics, null);
  });
});
