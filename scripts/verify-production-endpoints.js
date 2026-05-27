#!/usr/bin/env node

// Cross-platform production smoke verifier (Windows + Linux).

const DEFAULT_BASE_URL = 'https://ultimatearbitragehft.zedanazad43.workers.dev';
const DEFAULT_CUSTOM_URL = 'https://api.ecostamp.net';

const baseUrl = process.argv[2] || process.env.BASE_URL || DEFAULT_BASE_URL;
const customBaseUrl = process.env.CUSTOM_BASE_URL ?? DEFAULT_CUSTOM_URL;
const expectedWorkerName = process.env.EXPECTED_WORKER_NAME || 'ultimatearbitragehft';
const requireReadyForLive = String(process.env.REQUIRE_READY_FOR_LIVE || 'true').toLowerCase() === 'true';
const skipCustomDomainCheck = String(process.env.SKIP_CUSTOM_DOMAIN_CHECK || 'false').toLowerCase() === 'true';
const adminToken = process.env.WORKFLOW_ADMIN_TOKEN || process.env.ADMIN_TOKEN || '';

if (!adminToken) {
  console.error('ERROR: WORKFLOW_ADMIN_TOKEN or ADMIN_TOKEN is required.');
  process.exit(1);
}

function joinUrl(url, path) {
  return `${String(url).replace(/\/$/, '')}${path}`;
}

async function fetchText(url, headers = {}) {
  const resp = await fetch(url, { headers });
  const text = await resp.text();
  return { status: resp.status, text };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function checkIdentityAndReadiness(url, label) {
  const version = await fetchText(joinUrl(url, '/api/version'));
  const readiness = await fetchText(joinUrl(url, '/api/readiness'), { 'x-admin-token': adminToken });

  console.log(`  [${label}] /api/version   -> ${version.status}`);
  console.log(`  [${label}] /api/readiness -> ${readiness.status}`);

  assert(version.status === 200, `ERROR: ${label} /api/version check failed`);
  assert(readiness.status === 200, `ERROR: ${label} /api/readiness check failed`);

  const versionJson = tryJson(version.text);
  assert(versionJson?.worker === expectedWorkerName, `ERROR: ${label} is not serving expected worker ${expectedWorkerName}`);

  const readinessJson = tryJson(readiness.text);
  if (requireReadyForLive) {
    assert(readinessJson?.readyForLive === true, `ERROR: ${label} readiness is not green (readyForLive=true required)`);
  }
}

async function checkCorePublic(url) {
  console.log(`Checking public endpoints on ${url}`);
  const health = await fetchText(joinUrl(url, '/health'));
  const version = await fetchText(joinUrl(url, '/api/version'));
  const dashboard = await fetchText(joinUrl(url, '/dashboard'));

  console.log(`  /health      -> ${health.status}`);
  console.log(`  /api/version -> ${version.status}`);
  console.log(`  /dashboard   -> ${dashboard.status}`);

  assert(health.status === 200, 'ERROR: /health check failed');
  assert(version.status === 200, 'ERROR: /api/version check failed');
  assert([200, 302].includes(dashboard.status), `ERROR: /dashboard expected 200 or 302, got ${dashboard.status}`);

  if (dashboard.status === 200) {
    const isLoginOrSetupPage =
      dashboard.text.includes('action="/login"') ||
      dashboard.text.includes('تسجيل الدخول') ||
      dashboard.text.includes('ADMIN_TOKEN');
    if (!isLoginOrSetupPage) {
      assert(dashboard.text.includes('id="platformsGrid"'), 'ERROR: dashboard missing platformsGrid marker');
      assert(dashboard.text.includes('id="platformModal"'), 'ERROR: dashboard missing platformModal marker');
    }
  }
}

async function checkProtected(url) {
  console.log('Checking protected endpoints with admin token');
  const headers = { 'x-admin-token': adminToken };

  const endpoints = [
    ['/api/performance', 200],
    ['/api/analytics?capital=10000', 200],
    ['/api/health', 200],
    ['/api/platforms', 200],
    ['/api/execution-health', 200],
    ['/api/balances', 200],
    ['/api/status', 200],
    ['/api/proxy-stats', 200],
    ['/api/bitmart/stats', 200],
  ];

  for (const [path, expectedStatus] of endpoints) {
    const out = await fetchText(joinUrl(url, path), headers);
    console.log(`  ${path.padEnd(22)} -> ${out.status}`);
    assert(out.status === expectedStatus, `ERROR: ${path} returned ${out.status}`);
  }
}

async function main() {
  await checkCorePublic(baseUrl);

  console.log('Checking worker identity + readiness gates');
  await checkIdentityAndReadiness(baseUrl, 'workers.dev/base');
  if (!skipCustomDomainCheck && String(customBaseUrl).trim()) {
    await checkIdentityAndReadiness(customBaseUrl, 'custom-domain');
  }

  await checkProtected(baseUrl);
  console.log('All production endpoint checks passed');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
