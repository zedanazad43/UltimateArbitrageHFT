#!/usr/bin/env node
// Post-deploy production endpoint smoke test (CI step in .github/workflows/deploy.yml).
//
// Contract (env):
//   BASE_URL                    override workers.dev base (default: ultimatearbitragehft.<account-subdomain>.workers.dev)
//   CUSTOM_BASE_URL             override custom-domain base (default: https://api.ecostamp.net)
//   EXPECTED_WORKER_NAME        worker name reported by /api/version (default: ultimatearbitragehft)
//   WORKFLOW_ADMIN_TOKEN / ADMIN_TOKEN  token sent as x-admin-token
//   REQUIRE_READY_FOR_LIVE      "true" -> /api/readiness must report readyForLive=true (default: false)
//   SKIP_CUSTOM_DOMAIN_CHECK    "true" -> only probe workers.dev, do not fail on custom domain (default: false)

const DEFAULT_BASE_URL = 'https://ultimatearbitragehft.zedanazad43.workers.dev';
const DEFAULT_CUSTOM_URL = 'https://api.ecostamp.net';

const baseUrl = process.env.BASE_URL || DEFAULT_BASE_URL;
const customBaseUrl = process.env.CUSTOM_BASE_URL || DEFAULT_CUSTOM_URL;
const expectedWorkerName = process.env.EXPECTED_WORKER_NAME || 'ultimatearbitragehft';
const requireReadyForLive = String(process.env.REQUIRE_READY_FOR_LIVE || 'false').toLowerCase() === 'true';
const skipCustomDomainCheck = String(process.env.SKIP_CUSTOM_DOMAIN_CHECK || 'false').toLowerCase() === 'true';
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

async function checkHost(host, label) {
  const headers = { 'x-admin-token': adminToken };
  const version = await fetchJson(joinUrl(host, '/api/version'));
  const readiness = await fetchJson(joinUrl(host, '/api/readiness'), headers);
  const status = await fetchJson(joinUrl(host, '/api/status'), headers);

  console.log(`[${label}] /api/version   -> ${version.status}`);
  console.log(`[${label}] /api/readiness -> ${readiness.status}`);
  console.log(`[${label}] /api/status    -> ${status.status}`);

  ensure(version.status === 200, `${label}: /api/version failed (${version.status})`);
  ensure(version.json?.worker === expectedWorkerName, `${label}: worker mismatch, expected ${expectedWorkerName}`);
  ensure(readiness.status === 200, `${label}: /api/readiness failed (${readiness.status})`);
  ensure(status.status === 200, `${label}: /api/status failed (${status.status})`);

  if (requireReadyForLive) {
    ensure(readiness.json?.readyForLive === true, `${label}: readyForLive is not true`);
  }

  return { readyForLive: readiness.json?.readyForLive === true };
}

async function main() {
  const primary = await checkHost(baseUrl, 'workers.dev(primary)');
  let customReady = null;

  if (!skipCustomDomainCheck) {
    try {
      const custom = await checkHost(customBaseUrl, 'custom-domain');
      customReady = custom.readyForLive;
    } catch (err) {
      if (requireReadyForLive) throw err;
      console.warn(`WARN: custom-domain check failed (non-blocking): ${err.message || err}`);
    }
  }

  console.log(`SUMMARY baseReady=${primary.readyForLive} customReady=${customReady ?? 'skipped'}`);
  console.log('Production endpoint smoke test passed.');
}

main().catch((err) => {
  console.error(`FAIL: ${err.message || err}`);
  process.exit(1);
});
