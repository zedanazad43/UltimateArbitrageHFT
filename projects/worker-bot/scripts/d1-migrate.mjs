#!/usr/bin/env node
// scripts/d1-migrate.mjs
// Applies migrations/schema.sql to the remote D1 database, repairing legacy
// schema drift first so CREATE INDEX / INSERT statements never fail on
// tables created by older migrations (e.g. backup_positions created before
// the `status` column existed).
//
// Strategy (idempotent, data-preserving):
//   1. PRAGMA table_info() each known legacy table via wrangler.
//   2. If the table's PRIMARY KEY column is missing, the table is unusable by
//      current code (it is a derived resilience cache) — drop it and let the
//      canonical schema recreate it.
//   3. Otherwise ALTER TABLE ADD COLUMN for each missing nullable column.
//   4. Execute migrations/schema.sql (all statements are IF NOT EXISTS /
//      INSERT OR IGNORE, safe to run on every deploy).
//
// Requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in the environment
// (CI injects them from GitHub secrets).

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REMOTE = process.env.D1_TARGET !== 'local'; // override with D1_TARGET=local for testing

// Column contract for tables that older migrations may have created with a
// narrower set of columns. All added columns must be nullable (SQLite's
// ADD COLUMN cannot add NOT NULL / PRIMARY KEY without a default).
const LEGACY_TABLES = {
  backup_positions: {
    primary: 'id',
    columns: {
      id: 'TEXT', strategy: 'TEXT', symbol: 'TEXT', buy_exchange: 'TEXT',
      sell_exchange: 'TEXT', entry_price: 'REAL', current_price: 'REAL',
      size_usd: 'REAL', pnl: 'REAL', status: 'TEXT',
      created_at: 'INTEGER', updated_at: 'INTEGER'
    }
  },
  backup_prices: {
    primary: 'symbol',
    columns: {
      symbol: 'TEXT', exchange: 'TEXT', price: 'REAL', timestamp: 'INTEGER'
    }
  },
  backup_opportunities: {
    primary: 'id',
    columns: {
      id: 'TEXT', strategy: 'TEXT', symbol: 'TEXT', spread_pct: 'REAL',
      net_pct: 'REAL', size_usd: 'REAL', confidence: 'REAL',
      recorded_at: 'INTEGER', status: 'TEXT'
    }
  }
};

function wrangler(args) {
  return execFileSync(
    'npx',
    ['--yes', 'wrangler@4', 'd1', 'execute', 'ultimate-arbitrage-db', ...args],
    { cwd: workerRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
}

function tableColumns(table) {
  const flag = REMOTE ? '--remote' : '--local';
  const out = wrangler([flag, '--json', '--command', `PRAGMA table_info(${table})`]);
  const parsed = JSON.parse(out);
  const rows = parsed?.[0]?.results ?? [];
  return new Set(rows.map(r => r.name));
}

function runRepairs() {
  const flag = REMOTE ? '--remote' : '--local';
  let repairs = 0;
  for (const [table, contract] of Object.entries(LEGACY_TABLES)) {
    let existing;
    try {
      existing = tableColumns(table);
    } catch (err) {
      // Table likely does not exist yet (fresh database) — schema.sql will
      // create it. Only a missing-PRAGMA error mentioning SQLITE_ERROR on the
      // table itself is fatal.
      if (String(err.stderr || err.message).includes('no such table')) continue;
      console.warn(`⚠️  Could not inspect ${table}: ${String(err.stderr || err.message).trim().slice(0, 200)}`);
      continue;
    }
    if (!existing.has(contract.primary)) {
      console.log(`🔄 ${table}: missing PRIMARY KEY column "${contract.primary}" — dropping stale table (derived cache) for recreate`);
      try { wrangler([flag, '--command', `DROP TABLE IF EXISTS ${table}`]); } catch {}
      repairs += 1;
      continue;
    }
    for (const [col, type] of Object.entries(contract.columns)) {
      if (existing.has(col)) continue;
      console.log(`➕ ${table}: adding missing column ${col} ${type}`);
      try {
        wrangler([flag, '--command', `ALTER TABLE ${table} ADD COLUMN ${col} ${type}`]);
        repairs += 1;
      } catch (err) {
        // Column may have appeared between the PRAGMA and the ALTER — fine.
        if (!String(err.stderr || err.message).includes('duplicate column')) throw err;
        console.log(`   ${table}.${col} already exists — skipping`);
      }
    }
  }
  return repairs;
}

function applyCanonicalSchema() {
  const flag = REMOTE ? '--remote' : '--local';
  console.log(`📦 Applying ${REMOTE ? 'remote' : 'local'} schema: migrations/schema.sql`);
  wrangler([flag, '--file=./migrations/schema.sql']);
}

const repairs = runRepairs();
applyCanonicalSchema();
console.log(repairs ? `✅ D1 migrations applied (${repairs} schema repair(s))` : '✅ D1 migrations applied — schema already current');