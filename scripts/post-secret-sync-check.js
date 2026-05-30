#!/usr/bin/env node

// Post secret-sync verifier:
// - Treat custom domain as production primary.
// - Report workers.dev readiness as diagnostic unless explicitly required.

const DEFAULT_BASE_URL = 'https://ultimatearbitragehft.zedanazad43.workers.dev';
const DEFAULT_CUSTOM_URL = 'https://api.ecostamp.net';

const baseUrl = process.env.BASE_URL || DEFAULT_BASE_URL;
const customBaseUrl = process.env.CUSTOM_BASE_URL || DEFAULT_CUSTOM_URL;
const expectedWorkerName = process.env.EXPECTED_WORKER_NAME || 'ultimatearbitragehft';
const strictBaseReadiness = String(process.env.REQUIRE_BASE_READY_FOR_LIVE || 'false').toLowerCase() === 'true';
const adminToken = process.env.WORKFLOW_ADMIN_TOKEN || process.env.ADMIN_TOKEN || '';

if (!adminToken) {
  console.error('ERROR: WORKFLOW_ADMIN_TOKEN or ADMIN_TOKEN is required.');
  process.exit(1);
}

function joinUrl(url, path) {
  return `${String(url).replace(/\/$/, '')}${path}`;
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

function ensure(cond, message) {
  if (!cond) throw new Error(message);
}

async function checkHost(host, label, requireGreen) {
  const headers = { 'x-admin-token': adminToken };
  const version = await fetchJson(joinUrl(host, '/api/version'));
  const readiness = await fetchJson(joinUrl(host, '/api/readiness'), headers);
  const status = await fetchJson(joinUrl(host, '/api/status'), headers);
  const platforms = await fetchJson(joinUrl(host, '/api/platforms'), headers);

  console.log(`[${label}] /api/version   -> ${version.status}`);
  console.log(`[${label}] /api/readiness -> ${readiness.status}`);
  console.log(`[${label}] /api/status    -> ${status.status}`);
  console.log(`[${label}] /api/platforms -> ${platforms.status}`);

  ensure(version.status === 200, `${label}: /api/version failed`);
  ensure(version.json?.worker === expectedWorkerName, `${label}: worker mismatch`);
  ensure(readiness.status === 200, `${label}: /api/readiness failed`);
  ensure(status.status === 200, `${label}: /api/status failed`);
  ensure(platforms.status === 200, `${label}: /api/platforms failed`);

  if (requireGreen) {
    ensure(readiness.json?.readyForLive === true, `${label}: readyForLive is not true`);
  }

  return {
    readyForLive: readiness.json?.readyForLive === true,
    exchangeAuthFailures: readiness.json?.checks?.exchangeAuthFailures ?? null,
    configuredExchangeCount: readiness.json?.checks?.configuredExchangeCount ?? null,
  };
}

async function main() {
  const custom = await checkHost(customBaseUrl, 'custom-domain(primary)', true);

  try {
    const base = await checkHost(baseUrl, 'workers.dev(diagnostic)', strictBaseReadiness);
    console.log(`SUMMARY baseReady=${base.readyForLive} customReady=${custom.readyForLive}`);
  } catch (err) {
    if (strictBaseReadiness) throw err;
    console.warn(`WARN: workers.dev diagnostic failed (non-blocking): ${err.message || err}`);
    console.log(`SUMMARY baseReady=unknown customReady=${custom.readyForLive}`);
  }

  console.log('Post secret-sync checks passed (custom-domain primary).');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
