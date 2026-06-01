#!/usr/bin/env node

import dotenv from 'dotenv';

dotenv.config({ path: '.dev.vars', override: false });

const args = process.argv.slice(2);

function getArg(name, fallback = '') {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  return args[idx + 1] || fallback;
}

const baseUrl = getArg('--base', process.env.API_BASE || 'https://api.ecostamp.net');
const token = getArg('--token', process.env.WORKFLOW_ADMIN_TOKEN || process.env.ADMIN_TOKEN || '');
const samples = Number.parseInt(getArg('--samples', '20'), 10);
const intervalMs = Number.parseInt(getArg('--interval-ms', '30000'), 10);

if (!token) {
  console.error('Missing admin token. Use --token or set WORKFLOW_ADMIN_TOKEN/ADMIN_TOKEN.');
  process.exit(1);
}

if (!Number.isFinite(samples) || samples < 1) {
  console.error('Invalid --samples value.');
  process.exit(1);
}

if (!Number.isFinite(intervalMs) || intervalMs < 1000) {
  console.error('Invalid --interval-ms value (must be >= 1000).');
  process.exit(1);
}

const headers = { 'x-admin-token': token };

function sleep(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

async function fetchJson(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  const text = await response.text();
  try {
    return { status: response.status, json: JSON.parse(text) };
  } catch {
    return { status: response.status, json: null };
  }
}

function isStrictPass(safety, readiness) {
  const authFailures = Number(readiness?.exchangeAuthFailures ?? 0);
  return (
    safety?.spotOnlyLock === true &&
    safety?.spotOnlyLockForced === true &&
    safety?.strategyFlags?.perps === false &&
    safety?.strategyFlags?.funding === false &&
    safety?.executionMode === 'spot-only' &&
    readiness?.readyForLive === true &&
    authFailures === 0
  );
}

async function main() {
  const startedAt = new Date().toISOString();
  const rows = [];

  console.log(`SPOT_LOCK_MONITOR_START ${startedAt}`);

  for (let i = 1; i <= samples; i++) {
    const ts = new Date().toISOString();
    let row;

    try {
      const [safetyResp, readinessResp] = await Promise.all([
        fetchJson('/api/safety-state'),
        fetchJson('/api/readiness'),
      ]);

      const safety = safetyResp.json || {};
      const readiness = readinessResp.json || {};

      row = {
        i,
        ts,
        ok: safetyResp.status === 200 && readinessResp.status === 200,
        lock: safety.spotOnlyLock,
        forced: safety.spotOnlyLockForced,
        perps: safety?.strategyFlags?.perps,
        funding: safety?.strategyFlags?.funding,
        mode: safety.executionMode,
        readyForLive: readiness.readyForLive,
        authFailures: Number(readiness.exchangeAuthFailures ?? 0),
      };
      row.strictPass = row.ok && isStrictPass(safety, readiness);
    } catch (error) {
      row = {
        i,
        ts,
        ok: false,
        strictPass: false,
        error: String(error?.message || error),
      };
    }

    rows.push(row);
    console.log(`SAMPLE ${JSON.stringify(row)}`);

    if (i < samples) {
      await sleep(intervalMs);
    }
  }

  const failed = rows.filter((r) => !r.strictPass);
  const summary = {
    startedAt,
    endedAt: new Date().toISOString(),
    sampleCount: rows.length,
    strictFailures: failed.length,
    strictStable: failed.length === 0,
    first: rows[0],
    last: rows[rows.length - 1],
  };

  console.log(`SPOT_LOCK_MONITOR_SUMMARY ${JSON.stringify(summary)}`);
  console.log(`SPOT_LOCK_MONITOR_END ${new Date().toISOString()}`);

  if (!summary.strictStable) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`SPOT_LOCK_MONITOR_FATAL ${String(error?.message || error)}`);
  process.exit(1);
});
