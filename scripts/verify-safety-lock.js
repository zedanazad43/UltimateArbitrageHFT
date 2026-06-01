#!/usr/bin/env node

import dotenv from 'dotenv';

dotenv.config({ path: '.dev.vars', override: false });

const args = process.argv.slice(2);

function getArg(name, fallback = '') {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] || fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

const baseUrl = getArg('--base', process.env.API_BASE || 'https://api.ecostamp.net');
const adminToken = getArg('--token', process.env.WORKFLOW_ADMIN_TOKEN || process.env.ADMIN_TOKEN || '');
const enforceLock = hasFlag('--enforce-lock');

if (!adminToken) {
  console.error('Missing admin token. Pass --token or set ADMIN_TOKEN/WORKFLOW_ADMIN_TOKEN.');
  process.exit(1);
}

async function api(path, init = {}) {
  const headers = new globalThis.Headers(init.headers || {});
  headers.set('x-admin-token', adminToken);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(baseUrl + path, {
    ...init,
    headers,
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {}

  return { ok: res.ok, status: res.status, text, json };
}

function fail(message) {
  console.error('FAIL:', message);
  process.exit(1);
}

async function main() {
  if (enforceLock) {
    const lockResp = await api('/strategy/spot-lock/enable', { method: 'POST' });
    if (!lockResp.ok) {
      fail(`/strategy/spot-lock/enable failed (${lockResp.status}): ${lockResp.text}`);
    }
  }

  const [safetyResp, statusResp, perpsResp] = await Promise.all([
    api('/api/safety-state'),
    api('/api/status'),
    api('/api/perps'),
  ]);

  if (!safetyResp.ok) fail(`/api/safety-state failed (${safetyResp.status}): ${safetyResp.text}`);
  if (!statusResp.ok) fail(`/api/status failed (${statusResp.status}): ${statusResp.text}`);
  if (!perpsResp.ok) fail(`/api/perps failed (${perpsResp.status}): ${perpsResp.text}`);

  const safety = safetyResp.json || {};
  const status = statusResp.json || {};
  const perps = perpsResp.json || {};

  const lock = safety.spotOnlyLock === true;
  const perpsFlag = safety?.strategyFlags?.perps !== false;
  const fundingFlag = safety?.strategyFlags?.funding !== false;

  if (lock && perpsFlag) fail('spot_only_lock=true but strategy_flags.perps is not forced off');
  if (lock && fundingFlag) fail('spot_only_lock=true but strategy_flags.funding is not forced off');
  if (lock && perps.perpsEnabled !== false) fail('spot_only_lock=true but /api/perps reports enabled');
  if (lock && status?.strategy_flags?.perps !== false) fail('spot_only_lock=true but /api/status strategy_flags.perps is not false');
  if (lock && status?.strategy_flags?.funding !== false) fail('spot_only_lock=true but /api/status strategy_flags.funding is not false');

  const mode = String(safety.executionMode || '').toLowerCase();
  if (lock && mode !== 'spot-only' && mode !== 'blocked') {
    fail(`unexpected executionMode while lock is on: ${safety.executionMode}`);
  }

  const summary = {
    baseUrl,
    lock,
    executionMode: safety.executionMode,
    readyForLive: safety.readyForLive,
    perpsEnabled: safety.perpsEnabled,
    fundingEnabled: safety?.strategyFlags?.funding !== false,
    lastConfigChangeTs: safety.lastConfigChangeTs,
  };

  console.log('PASS: safety lock checks');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  fail(error?.message || String(error));
});
