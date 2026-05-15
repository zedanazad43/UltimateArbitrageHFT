import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateStrategyBreakdown,
  formatEvaluationTelegramReport,
  scoreStrategyMetrics,
  summarizeEvaluation,
} from '../src/self-evaluation.js';

describe('self evaluation scoring', () => {
  test('returns bounded score for populated metrics', () => {
    const score = scoreStrategyMetrics({
      total_trades: 24,
      win_rate: 0.62,
      sharpe: 1.4,
      profit_factor: 1.8,
      max_drawdown_pct: 6,
      total_pnl_usd: 180,
    });

    assert.ok(score >= 0 && score <= 100);
  });

  test('ranks strategies from strongest to weakest', () => {
    const evaluation = evaluateStrategyBreakdown({
      cex: {
        total_trades: 30,
        win_rate: 0.66,
        sharpe: 1.8,
        profit_factor: 2,
        max_drawdown_pct: 4,
        total_pnl_usd: 220,
      },
      dex: {
        total_trades: 12,
        win_rate: 0.45,
        sharpe: 0.2,
        profit_factor: 0.9,
        max_drawdown_pct: 18,
        total_pnl_usd: -40,
      },
    });

    assert.equal(evaluation.rankings[0].strategy, 'cex');
    assert.equal(evaluation.rankings.at(-1).strategy, 'dex');
    assert.ok(evaluation.recommendations.some((entry) => entry.startsWith('scale cex')));
    assert.ok(evaluation.recommendations.some((entry) => entry.startsWith('de-risk dex')));
  });

  test('summarizes leader and recommendations', () => {
    const summary = summarizeEvaluation(evaluateStrategyBreakdown({
      perps: {
        total_trades: 10,
        win_rate: 0.7,
        sharpe: 1.3,
        profit_factor: 1.7,
        max_drawdown_pct: 5,
        total_pnl_usd: 90,
      },
    }));

    assert.match(summary, /Leader: perps/);
    assert.match(summary, /scale perps|observe perps/);
  });

  test('formats a Telegram-ready weekly evaluation report', () => {
    const artifact = {
      period_days: 7,
      trade_count: 42,
      return_pct: 12.345,
      evaluation: evaluateStrategyBreakdown({
        triangular: {
          total_trades: 20,
          win_rate: 0.68,
          sharpe: 1.5,
          profit_factor: 1.9,
          max_drawdown_pct: 4,
          total_pnl_usd: 140,
        },
        dex: {
          total_trades: 8,
          win_rate: 0.41,
          sharpe: 0.1,
          profit_factor: 0.8,
          max_drawdown_pct: 17,
          total_pnl_usd: -20,
        },
      }),
    };

    const report = formatEvaluationTelegramReport(artifact);
    assert.match(report, /weekly self-evaluation/i);
    assert.match(report, /Period: 7d/);
    assert.match(report, /Trades: 42/);
    assert.match(report, /Return: 12.35%/);
    assert.match(report, /Leader: triangular/);
    assert.match(report, /Recommendations:/);
  });
});