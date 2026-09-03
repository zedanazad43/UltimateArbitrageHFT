import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaSQL } from '../migrations/schema.js';

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('migrations/schema.js is in sync with migrations/schema.sql', () => {
  const sql = readFileSync(path.join(workerRoot, 'migrations', 'schema.sql'), 'utf8');
  const expected = sql
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return t !== '' && !t.startsWith('--');
    })
    .map((line) => line.trim().replace(/\s{2,}/g, ' '))
    .join('\n')
    .trim();

  assert.equal(
    schemaSQL.trim(),
    expected,
    'migrations/schema.js is stale — run `npm run db:schema:sync` to regenerate it from schema.sql'
  );
});

test('canonical schema covers both core and resilience tables', () => {
  const required = [
    'trades',
    'admin_events',
    'bot_events',
    'paper_positions',
    'profits',
    'logs',
    'settings',
    'backtest_runs',
    'opportunities',
    'performance_snapshots',
    'strategy_insights',
    'opportunity_audit',
    'backup_positions',
    'backup_prices',
    'backup_opportunities',
    'hft_state_sync',
    'failover_events',
    'railway_metrics'
  ];
  for (const table of required) {
    assert.ok(
      schemaSQL.includes(`CREATE TABLE IF NOT EXISTS ${table} (`),
      `schemaSQL must define ${table}`
    );
  }
  // Settings seed rows must be part of the runtime schema too
  assert.ok(schemaSQL.includes("INSERT OR IGNORE INTO settings (key, value) VALUES ('min_spread', '0.1')"));
  assert.ok(schemaSQL.includes("INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_trade', 'false')"));
});