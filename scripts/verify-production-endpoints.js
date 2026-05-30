#!/usr/bin/env node

// Cross-platform production smoke verifier (Windows + Linux).

const DEFAULT_BASE_URL = 'https://ultimatearbitragehft.zedanazad43.workers.dev';
const DEFAULT_CUSTOM_URL = 'https://api.ecostamp.net';

const baseUrl = process.argv[2] || process.env.BASE_URL || DEFAULT_BASE_URL;
const customBaseUrl = process.env.CUSTOM_BASE_URL ?? DEFAULT_CUSTOM_URL;
const expectedWorkerName = process.env.EXPECTED_WORKER_NAME || 'ultimatearbitragehft';
const requireReadyForLive = String(process.env.REQUIRE_READY_FOR_LIVE || 'true').toLowerCase() === 'true';
const skipCustomDomainCheck = String(process.env.SKIP_CUSTOM_DOMAIN_CHECK || 'false').toLowerCase() === 'true';
const requireBaseReadyForLive = String(process.env.REQUIRE_BASE_READY_FOR_LIVE || 'false').toLowerCase() === 'true';
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

async function checkIdentityAndReadiness(url, label, options = {}) {
  const {
    requireReadiness = true,
    readinessMustBeGreen = requireReadyForLive,
  } = options;

  const version = await fetchText(joinUrl(url, '/api/version'));
  let readiness = null;
  if (requireReadiness) {
    readiness = await fetchText(joinUrl(url, '/api/readiness'), { 'x-admin-token': adminToken });
  }

  console.log(`  [${label}] /api/version   -> ${version.status}`);
  if (requireReadiness) {
    console.log(`  [${label}] /api/readiness -> ${readiness.status}`);
  }

  assert(version.status === 200, `ERROR: ${label} /api/version check failed`);

  const versionJson = tryJson(version.text);
  assert(versionJson?.worker === expectedWorkerName, `ERROR: ${label} is not serving expected worker ${expectedWorkerName}`);

  if (requireReadiness) {
    assert(readiness.status === 200, `ERROR: ${label} /api/readiness check failed`);
    const readinessJson = tryJson(readiness.text);
    if (readinessMustBeGreen) {
      assert(readinessJson?.readyForLive === true, `ERROR: ${label} readiness is not green (readyForLive=true required)`);
    }
    return { versionJson, readinessJson };
  }

  return { versionJson, readinessJson: null };
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
  const hasCustomDomain = !skipCustomDomainCheck && String(customBaseUrl).trim();
  const primaryUrl = hasCustomDomain ? customBaseUrl : baseUrl;

  await checkCorePublic(primaryUrl);

  console.log('Checking worker identity + readiness gates');

  if (hasCustomDomain) {
    await checkIdentityAndReadiness(customBaseUrl, 'custom-domain', {
      requireReadiness: true,
      readinessMustBeGreen: requireReadyForLive,
    });

    // workers.dev may have different egress behavior; keep it diagnostic by default.
    try {
      await checkIdentityAndReadiness(baseUrl, 'workers.dev/base', {
        requireReadiness: true,
        readinessMustBeGreen: requireBaseReadyForLive,
      });
    } catch (err) {
      if (requireBaseReadyForLive) throw err;
      console.warn(`WARN: workers.dev readiness check is non-blocking: ${err.message || err}`);
    }
  } else {
    await checkIdentityAndReadiness(baseUrl, 'workers.dev/base', {
      requireReadiness: true,
      readinessMustBeGreen: requireReadyForLive,
    });
  }

  await checkProtected(primaryUrl);
  console.log('All production endpoint checks passed');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
