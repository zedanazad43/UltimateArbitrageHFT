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
const fetchRetries = Number.parseInt(getArg('--fetch-retries', '2'), 10);
const retryDelayMs = Number.parseInt(getArg('--retry-delay-ms', '1500'), 10);

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

if (!Number.isFinite(fetchRetries) || fetchRetries < 0) {
  console.error('Invalid --fetch-retries value (must be >= 0).');
  process.exit(1);
}

if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
  console.error('Invalid --retry-delay-ms value (must be >= 0).');
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

async function fetchJsonWithRetry(path) {
  let lastError = null;

  for (let attempt = 1; attempt <= fetchRetries + 1; attempt++) {
    try {
      const result = await fetchJson(path);
      return { ...result, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt <= fetchRetries) {
        await sleep(retryDelayMs);
      }
    }
  }

  throw lastError;
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
        fetchJsonWithRetry('/api/safety-state'),
        fetchJsonWithRetry('/api/readiness'),
      ]);

      const safety = safetyResp.json || {};
      const readiness = readinessResp.json || {};
      const safetyOk = safetyResp.status === 200;
      const readinessOk = readinessResp.status === 200;
      const networkOk = safetyOk && readinessOk;

      // accessFailure: HTTP response received but status != 200 (WAF block, 503, etc.)
      // This is an infrastructure/access issue, NOT a state failure.
      const accessFailure = !networkOk;

      row = {
        i,
        ts,
        ok: networkOk,
        networkOk,
        accessFailure,
        safetyStatus: safetyResp.status,
        readinessStatus: readinessResp.status,
        lock: safety.spotOnlyLock,
        forced: safety.spotOnlyLockForced,
        perps: safety?.strategyFlags?.perps,
        funding: safety?.strategyFlags?.funding,
        mode: safety.executionMode,
        readyForLive: readiness.readyForLive,
        authFailures: Number(readiness.exchangeAuthFailures ?? 0),
        attempts: {
          safetyState: safetyResp.attempts,
          readiness: readinessResp.attempts,
        },
      };

      // networkFailure is false in both branches: a response was received.
      row.networkFailure = false;

      if (accessFailure) {
        // Non-200 from server: classify as access failure, not state failure.
        row.statePass = false;
        row.strictPass = false;
        row.failureCategory = 'access';
      } else {
        const statePass = isStrictPass(safety, readiness);
        row.statePass = statePass;
        row.strictPass = statePass;
        row.failureCategory = statePass ? 'none' : 'state';
      }
    } catch (error) {
      row = {
        i,
        ts,
        ok: false,
        networkOk: false,
        accessFailure: false,
        statePass: false,
        strictPass: false,
        networkFailure: true,
        failureCategory: 'network',
        error: String(error?.message || error),
      };
    }

    rows.push(row);
    console.log(`SAMPLE ${JSON.stringify(row)}`);

    if (i < samples) {
      await sleep(intervalMs);
    }
  }

  const networkFailures = rows.filter((r) => r.networkFailure === true);
  const accessFailures = rows.filter((r) => r.accessFailure === true);
  const stateFailures = rows.filter((r) => r.failureCategory === 'state');
  const summary = {
    startedAt,
    endedAt: new Date().toISOString(),
    sampleCount: rows.length,
    strictFailures: networkFailures.length + accessFailures.length + stateFailures.length,
    networkFailures: networkFailures.length,
    accessFailures: accessFailures.length,
    stateFailures: stateFailures.length,
    strictStable: networkFailures.length + accessFailures.length + stateFailures.length === 0,
    stateStable: stateFailures.length === 0,
    networkStable: networkFailures.length === 0,
    accessStable: accessFailures.length === 0,
    first: rows[0],
    last: rows[rows.length - 1],
  };

  console.log(`SPOT_LOCK_MONITOR_SUMMARY ${JSON.stringify(summary)}`);
  console.log(`SPOT_LOCK_MONITOR_END ${new Date().toISOString()}`);

  if (!summary.stateStable) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`SPOT_LOCK_MONITOR_FATAL ${String(error?.message || error)}`);
  process.exit(1);
});
