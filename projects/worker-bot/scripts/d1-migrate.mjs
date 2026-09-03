#!/usr/bin/env node
// scripts/d1-migrate.mjs
// Applies migrations/schema.sql to the remote D1 database, repairing schema
// drift first so CREATE INDEX / INSERT statements never fail on tables
// created by older schema versions (e.g. `opportunities` before the
// `status` column existed).
//
// Strategy (idempotent, data-preserving where possible):
//   1. Parse every CREATE TABLE block from migrations/schema.sql to learn
//      the canonical column contract (name + type + constraints).
//   2. PRAGMA table_info() each table via wrangler.
//   3. For missing nullable columns -> ALTER TABLE ADD COLUMN (no data loss).
//   4. If a missing column is PRIMARY KEY / UNIQUE / NOT NULL without a
//      default, SQLite cannot ALTER it in place — drop the table and let the
//      canonical schema recreate it. Only derived/cache tables should ever
//      hit this path.
//   5. Execute migrations/schema.sql (all statements are IF NOT EXISTS /
//      INSERT OR IGNORE, safe to run on every deploy).
//
// Requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in the environment
// (CI injects them from GitHub secrets). Override with D1_TARGET=local to
// run against the local dev database.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REMOTE = process.env.D1_TARGET !== 'local';

const SCHEMA_PATH = path.join(workerRoot, 'migrations', 'schema.sql');
const schemaSql = readFileSync(SCHEMA_PATH, 'utf8');

// ── Parse canonical table contracts from schema.sql ──────────────────────────
// Each block: CREATE TABLE IF NOT EXISTS name ( ... );  — returns
// { name, columns: [{ name, type, primary, notNull, hasDefault }] }
function parseTables(sql) {
  const tables = [];
  const blockRe = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\)\s*;/g;
  let m;
  while ((m = blockRe.exec(sql)) !== null) {
    const [, name, body] = m;
    const columns = [];
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      if (/^(PRIMARY|FOREIGN|UNIQUE|CONSTRAINT|CHECK)\b/i.test(line)) continue;
      const firstSpace = line.indexOf(' ');
      if (firstSpace === -1) continue;
      const colName = line.slice(0, firstSpace).trim();
      const rest = line.slice(firstSpace).trim();
      if (!colName || !rest) continue;
      const upper = rest.toUpperCase();
      columns.push({
        name: colName,
        type: (rest.match(/^\w+/) || [rest.split(' ')[0]])[0],
        primary: upper.includes('PRIMARY KEY'),
        notNull: upper.includes('NOT NULL'),
        hasDefault: upper.includes('DEFAULT')
      });
    }
    tables.push({ name, columns });
  }
  return tables;
}

const TABLE_CONTRACTS = parseTables(schemaSql);

function wrangler(args) {
  return execFileSync(
    'npx',
    ['--yes', 'wrangler@4', 'd1', 'execute', 'ultimate-arbitrage-db', ...args],
    { cwd: workerRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
}

function runStatement(sql) {
  const flag = REMOTE ? '--remote' : '--local';
  try {
    wrangler([flag, '--command', sql]);
    return true;
  } catch (err) {
    return String(err.stderr || err.message);
  }
}

function tableColumns(table) {
  const flag = REMOTE ? '--remote' : '--local';
  const out = wrangler([flag, '--json', '--command', `PRAGMA table_info(${table})`]);
  const parsed = JSON.parse(out);
  const rows = parsed?.[0]?.results ?? [];
  return new Set(rows.map(r => r.name));
}

function repairTables() {
  let repairs = 0;
  for (const { name: table, columns } of TABLE_CONTRACTS) {
    let existing;
    try {
      existing = tableColumns(table);
    } catch (err) {
      if (String(err.stderr || err.message).includes('no such table')) continue; // created later by schema.sql
      console.warn(`⚠️  Could not inspect ${table}: ${String(err.stderr || err.message).trim().slice(0, 200)}`);
      continue;
    }
    const missing = columns.filter(c => !existing.has(c.name));
    if (missing.length === 0) continue;

    const needsRebuild = missing.some(c => c.primary || (c.notNull && !c.hasDefault));
    if (needsRebuild) {
      console.log(`🔄 ${table}: missing ${missing.map(c => c.name).join(', ')} — dropping stale table for recreate (un-alterable columns)`);
      runStatement(`DROP TABLE IF EXISTS ${table}`);
      repairs += 1;
      continue;
    }
    for (const col of missing) {
      const result = runStatement(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.type}`);
      if (result === true) {
        console.log(`➕ ${table}: added missing column ${col.name} ${col.type}`);
        repairs += 1;
      } else if (!result.includes('duplicate column')) {
        console.warn(`⚠️  ${table}.${col.name}: ${result.slice(0, 200)}`);
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

const repairs = repairTables();
applyCanonicalSchema();
console.log(repairs ? `✅ D1 migrations applied (${repairs} schema repair(s))` : '✅ D1 migrations applied — schema already current');