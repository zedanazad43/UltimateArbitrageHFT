#!/usr/bin/env node

import dotenv from 'dotenv';

dotenv.config({ path: '.dev.vars', override: false });

const args = process.argv.slice(2);

function getArg(name, fallback = '') {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] || fallback;
}

const baseUrl = getArg('--base', process.env.API_BASE || 'https://api.ecostamp.net');
const token = getArg('--token', process.env.WORKFLOW_ADMIN_TOKEN || process.env.ADMIN_TOKEN || '');

if (!token) {
  console.error('FAIL: ADMIN_TOKEN or WORKFLOW_ADMIN_TOKEN is required');
  process.exit(1);
}

async function call(path, init = {}) {
  const headers = new globalThis.Headers(init.headers || {});
  headers.set('x-admin-token', token);
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
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

async function main() {
  const lock = await call('/strategy/spot-lock/enable', { method: 'POST' });
  if (!lock.ok) {
    fail(`/strategy/spot-lock/enable failed (${lock.status}): ${lock.text}`);
  }

  const configAttempt = await call('/config', {
    method: 'POST',
    body: JSON.stringify({ strategy_flags: { perps: true, funding: true } }),
  });
  if (!configAttempt.ok) {
    fail(`/config attempt failed (${configAttempt.status}): ${configAttempt.text}`);
  }

  const safety = await call('/api/safety-state');
  if (!safety.ok) {
    fail(`/api/safety-state failed (${safety.status}): ${safety.text}`);
  }

  const flags = safety.json?.strategyFlags || {};
  const lockEnabled = safety.json?.spotOnlyLock === true;
  const perpsDisabled = flags.perps === false;
  const fundingDisabled = flags.funding === false;

  if (!lockEnabled) fail('spotOnlyLock is false after lock enforcement');
  if (!perpsDisabled) fail('perps flag was re-enabled through /config while lock is active');
  if (!fundingDisabled) fail('funding flag was re-enabled through /config while lock is active');

  console.log('PASS: lock blocks /config bypass');
  console.log(JSON.stringify({
    baseUrl,
    spotOnlyLock: safety.json?.spotOnlyLock,
    perps: flags.perps,
    funding: flags.funding,
    executionMode: safety.json?.executionMode,
    readyForLive: safety.json?.readyForLive,
  }, null, 2));
}

main().catch((err) => {
  fail(err?.message || String(err));
});
