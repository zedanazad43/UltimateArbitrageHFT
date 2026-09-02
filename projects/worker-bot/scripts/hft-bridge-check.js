#!/usr/bin/env node
// Worker ↔ Go HFT engine bridge self-check.
//
// Verifies the full handshake without placing any order:
//   1. Engine /api/health   — engine reachable, reports paper/trading state
//   2. Engine /api/scan     — bearer auth accepted, price book returns an opportunity shape
//   3. Worker /api/dex      — worker reports executionReady given its env config
//
// Env:
//   HFT_ENGINE_URL      base URL of the engine (required)
//   HFT_ENGINE_SECRET   bearer token matching the engine (required when engine auth is on)
//   WORKER_BASE_URL     worker base to probe /api/dex (optional)
//   WORKFLOW_ADMIN_TOKEN / ADMIN_TOKEN  worker admin token (required with WORKER_BASE_URL)
//
// Exit 0 = bridge healthy; exit 1 = at least one check failed.

import dotenv from 'dotenv';

dotenv.config({ path: '.dev.vars', override: false });

const engineUrl = (process.env.HFT_ENGINE_URL || '').replace(/\/$/, '');
const engineSecret = process.env.HFT_ENGINE_SECRET || '';
const workerUrl = (process.env.WORKER_BASE_URL || '').replace(/\/$/, '');
const adminToken = process.env.WORKFLOW_ADMIN_TOKEN || process.env.ADMIN_TOKEN || '';

let failures = 0;

function fail(msg) {
  failures += 1;
  console.error(`  ❌ ${msg}`);
}

function pass(msg) {
  console.log(`  ✅ ${msg}`);
}

async function fetchJson(url, headers = {}) {
  const resp = await fetch(url, { headers });
  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: resp.status, json, text };
}

// ── 1. Engine health (no auth) ────────────────────────────────────────────────
async function checkEngineHealth() {
  console.log('\n[1/3] Engine /api/health');
  if (!engineUrl) {
    fail('HFT_ENGINE_URL is not set');
    return;
  }
  if (!engineUrl.startsWith('https://') && !engineUrl.includes('localhost') && !engineUrl.includes('127.0.0.1')) {
    fail('HFT_ENGINE_URL must use https:// outside local dev');
    return;
  }
  const res = await fetchJson(`${engineUrl}/api/health`);
  if (res.status !== 200 || !res.json) {
    fail(`/api/health -> HTTP ${res.status}`);
    return;
  }
  pass(`engine up: paper=${res.json.paper} trading=${res.json.trading} equity=$${res.json.equity_usd}`);
}

// ── 2. Engine scan (bearer auth) ──────────────────────────────────────────────
async function checkEngineScan() {
  console.log('\n[2/3] Engine /api/scan (auth)');
  if (!engineUrl) return;
  const headers = engineSecret ? { Authorization: `Bearer ${engineSecret}` } : {};
  const res = await fetchJson(`${engineUrl}/api/scan`, headers);
  if (res.status === 401) {
    fail('auth rejected — check HFT_ENGINE_SECRET matches the engine');
    return;
  }
  if (res.status !== 200 || !res.json) {
    fail(`/api/scan -> HTTP ${res.status}`);
    return;
  }
  const opp = res.json.opportunity || res.json;
  const hasShape = opp && typeof opp.Symbol === 'string' && typeof opp.BuyPrice === 'number';
  if (!hasShape) {
    fail('scan response missing opportunity fields (Symbol/BuyPrice)');
    return;
  }
  pass(`scan ok: ${opp.Symbol} ${opp.BuyExchange}→${opp.SellExchange} gross=${opp.GrossPct}%`);
}

// ── 3. Worker DEX readiness ───────────────────────────────────────────────────
async function checkWorkerDex() {
  console.log('\n[3/3] Worker /api/dex');
  if (!workerUrl) {
    console.log('  ⏭️  WORKER_BASE_URL not set — skipping worker probe');
    return;
  }
  if (!adminToken) {
    fail('WORKER_BASE_URL set but WORKFLOW_ADMIN_TOKEN/ADMIN_TOKEN missing');
    return;
  }
  const res = await fetchJson(`${workerUrl}/api/dex`, { 'x-admin-token': adminToken });
  if (res.status !== 200 || !res.json) {
    fail(`/api/dex -> HTTP ${res.status}`);
    return;
  }
  if (res.json.executionReady === true) {
    pass('worker reports executionReady=true');
  } else {
    const reason = res.json.reason || res.json.message || 'HFT_ENGINE_URL/HFT_ENGINE_SECRET not configured on worker';
    fail(`executionReady=false — ${reason}`);
  }
}

await checkEngineHealth();
await checkEngineScan();
await checkWorkerDex();

console.log(`\n${failures === 0 ? '✅ Bridge self-check passed' : `❌ ${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
