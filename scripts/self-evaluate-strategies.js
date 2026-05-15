#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { notify } from '../src/bots/notifier.js';
import { evaluateStrategyBreakdown, summarizeEvaluation } from '../src/self-evaluation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.SELF_EVAL_BASE_URL || 'https://ultimatearbitragehft.zedanazad43.workers.dev';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const DAYS = Number(process.env.SELF_EVAL_DAYS || 7);
const OUTPUT = path.join(__dirname, '../strategy-evaluation.json');

async function fetchBacktest() {
  const to = Date.now();
  const from = to - DAYS * 24 * 60 * 60 * 1000;
  const response = await fetch(`${BASE_URL}/api/backtest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ADMIN_TOKEN ? { 'x-admin-token': ADMIN_TOKEN } : {}),
    },
    body: JSON.stringify({
      from_ms: from,
      to_ms: to,
      run_monte_carlo: false,
      run_param_sweep: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Backtest request failed (${response.status}): ${text}`);
  }

  return response.json();
}

async function main() {
  const backtest = await fetchBacktest();
  const evaluation = evaluateStrategyBreakdown(backtest.strategy_breakdown || {});
  const artifact = {
    period_days: DAYS,
    trade_count: backtest.trade_count || 0,
    return_pct: Number(backtest.return_pct || 0),
    generated_at: new Date().toISOString(),
    evaluation,
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(artifact, null, 2));

  const summary = summarizeEvaluation(evaluation);
  console.log(summary);

  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    await notify(process.env, {}, `${summary}\nPeriod: ${DAYS}d\nReturn: ${artifact.return_pct.toFixed(2)}%`);
  }
}

main().catch((error) => {
  console.error(`Self-evaluation failed: ${error.message}`);
  process.exitCode = 1;
});