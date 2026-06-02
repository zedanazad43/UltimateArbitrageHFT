#!/usr/bin/env node

import dotenv from 'dotenv';
import { setTimeout as sleepTimeout } from 'node:timers/promises';

dotenv.config({ path: '.dev.vars', override: false });

const args = process.argv.slice(2);

function getArg(name, fallback = '') {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  return args[idx + 1] || fallback;
}

const baseUrl = getArg('--base', process.env.API_BASE || 'https://api.ecostamp.net').replace(/\/$/, '');
const adminToken = getArg('--token', process.env.WORKFLOW_ADMIN_TOKEN || process.env.ADMIN_TOKEN || '');
const samples = Number.parseInt(getArg('--samples', '8'), 10);
const intervalMs = Number.parseInt(getArg('--interval-ms', '2000'), 10);

if (!adminToken) {
  console.error('Missing admin token. Pass --token or set ADMIN_TOKEN/WORKFLOW_ADMIN_TOKEN.');
  process.exit(1);
}

if (!Number.isFinite(samples) || samples < 1) {
  console.error('Invalid --samples value.');
  process.exit(1);
}

if (!Number.isFinite(intervalMs) || intervalMs < 500) {
  console.error('Invalid --interval-ms value (must be >= 500).');
  process.exit(1);
}

function sleep(ms) {
  return sleepTimeout(ms);
}

async function api(path) {
  const res = await fetch(baseUrl + path, {
    headers: {
      'x-admin-token': adminToken,
    },
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return { ok: res.ok, status: res.status, text, json };
}

function fail(message, context = null) {
  console.error('FAIL:', message);
  if (context) {
    console.error(JSON.stringify(context, null, 2));
  }
  process.exit(1);
}

function assertCoreFlags(flags, context) {
  const tri = flags?.triangular === true;
  const stat = flags?.statistical === true;
  const cex = flags?.cex === true;
  const dex = flags?.dex === true;

  if (!cex || !dex || !tri || !stat) {
    fail('core strategy flags drift detected (cex/dex/triangular/statistical must remain true)', context);
  }
}

async function main() {
  const rows = [];

  for (let i = 1; i <= samples; i++) {
    const [statusResp, dexResp] = await Promise.all([
      api('/api/status'),
      api('/api/dex'),
    ]);

    if (!statusResp.ok) {
      fail(`/api/status failed at sample ${i} (${statusResp.status})`, { text: statusResp.text });
    }
    if (!dexResp.ok) {
      fail(`/api/dex failed at sample ${i} (${dexResp.status})`, { text: dexResp.text });
    }

    const flags = statusResp.json?.strategy_flags || {};
    const row = {
      i,
      ts: new Date().toISOString(),
      flags,
      dexExecutionReady: dexResp.json?.executionReady === true,
      statusCode: statusResp.status,
      dexCode: dexResp.status,
    };

    if (row.dexExecutionReady !== true) {
      fail(`DEX execution is not ready at sample ${i}`, row);
    }

    assertCoreFlags(flags, row);
    rows.push(row);

    if (i < samples) {
      await sleep(intervalMs);
    }
  }

  console.log('PASS: core flags stability checks');
  console.log(JSON.stringify({
    baseUrl,
    sampleCount: rows.length,
    intervalMs,
    first: rows[0] || null,
    last: rows[rows.length - 1] || null,
  }, null, 2));
}

main().catch((error) => {
  fail(error?.message || String(error));
});
