#!/usr/bin/env node
// scripts/check-connection.js
//
// Pre-live connectivity check for the Nexus Arbitrage Hub.
//
// Validates that your MEXC API credentials are correctly configured and that the
// HMAC signing logic works before you switch the bot to Live mode.
//
// Usage (requires Node.js 18+):
//   MEXC_API_KEY=<key> MEXC_API_SECRET=<secret> node scripts/check-connection.js
//
// All checks are READ-ONLY (GET requests only). No orders are placed.

const apiKey    = process.env.MEXC_API_KEY;
const apiSecret = process.env.MEXC_API_SECRET;

const GREEN  = '\x1b[32m✔\x1b[0m';
const RED    = '\x1b[31m✘\x1b[0m';
const YELLOW = '\x1b[33m⚠\x1b[0m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

function pass(label)         { console.log(`  ${GREEN} ${label}`); }
function fail(label, reason) { console.log(`  ${RED} ${label}${reason ? ': ' + reason : ''}`); }
function warn(label)         { console.log(`  ${YELLOW} ${label}`); }

// ── HMAC-SHA256 ───────────────────────────────────────────────────────────────
async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Checks ────────────────────────────────────────────────────────────────────

async function checkEnvVars() {
  console.log(`\n${BOLD}1. Environment variables${RESET}`);
  let ok = true;
  if (apiKey) {
    pass(`MEXC_API_KEY is set (${apiKey.slice(0, 4)}${'*'.repeat(Math.max(0, apiKey.length - 4))})`);
  } else {
    fail('MEXC_API_KEY is NOT set');
    ok = false;
  }
  if (apiSecret) {
    pass(`MEXC_API_SECRET is set (${'*'.repeat(apiSecret.length)})`);
  } else {
    fail('MEXC_API_SECRET is NOT set');
    ok = false;
  }
  return ok;
}

async function checkHmacSigning() {
  console.log(`\n${BOLD}2. HMAC-SHA256 signing (known test vector)${RESET}`);
  // RFC 4231 test vector: HMAC-SHA256(key="key", data="The quick brown fox...")
  const expected = 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8';
  const actual   = await hmacHex('key', 'The quick brown fox jumps over the lazy dog');
  if (actual === expected) {
    pass('HMAC-SHA256 implementation produces correct digest');
    return true;
  } else {
    fail('HMAC-SHA256 digest mismatch', `got ${actual}`);
    return false;
  }
}

async function checkMEXCPublicEndpoint() {
  console.log(`\n${BOLD}3. MEXC public API reachability${RESET}`);
  try {
    const resp = await fetch('https://api.mexc.com/api/v3/ping');
    const data = await resp.json();
    if (resp.ok && JSON.stringify(data) === '{}') {
      pass('MEXC spot REST API is reachable (ping OK)');
      return true;
    } else {
      fail('MEXC spot ping returned unexpected response', JSON.stringify(data));
      return false;
    }
  } catch (e) {
    fail('Could not reach MEXC spot API', e.message);
    return false;
  }
}

async function checkMEXCFuturesPublicEndpoint() {
  console.log(`\n${BOLD}4. MEXC futures API reachability${RESET}`);
  try {
    const resp = await fetch('https://contract.mexc.com/api/v1/contract/ping');
    const data = await resp.json();
    if (resp.ok && data.success === true) {
      pass('MEXC futures REST API is reachable (ping OK)');
      return true;
    } else {
      fail('MEXC futures ping returned unexpected response', JSON.stringify(data));
      return false;
    }
  } catch (e) {
    fail('Could not reach MEXC futures API', e.message);
    return false;
  }
}

async function checkAccountBalance() {
  console.log(`\n${BOLD}5. Authenticated balance check (MEXC spot)${RESET}`);
  if (!apiKey || !apiSecret) {
    warn('Skipped — API credentials not set');
    return false;
  }
  try {
    const timestamp = Date.now().toString();
    const query     = `timestamp=${timestamp}`;
    const signature = await hmacHex(apiSecret, query);

    const resp = await fetch(
      `https://api.mexc.com/api/v3/account?${query}&signature=${signature}`,
      { headers: { 'X-MEXC-APIKEY': apiKey } }
    );
    const data = await resp.json();

    if (data.code) {
      fail('API returned error', `code ${data.code}: ${data.msg}`);
      console.log(`     ${YELLOW} Hint: ensure your API key has "Spot Read" (account) permission`);
      return false;
    }

    const balances = (data.balances || []).filter(b => parseFloat(b.free) > 0);
    const usdt = data.balances?.find(b => b.asset === 'USDT');
    const usdtFree = parseFloat(usdt?.free || '0');

    pass(`Account read succeeded — ${balances.length} non-zero asset(s)`);
    console.log(`     USDT balance: $${usdtFree.toFixed(2)} free`);

    if (usdtFree < 10) {
      warn('USDT balance is less than $10 — consider depositing before going live');
    }
    return true;
  } catch (e) {
    fail('Balance check threw', e.message);
    return false;
  }
}

async function checkApiKeyPermissions() {
  console.log(`\n${BOLD}6. API key permission hints${RESET}`);
  warn('Cannot auto-verify key permissions from this script.');
  console.log('     Please confirm the following manually in your MEXC API management page:');
  console.log('       ✔  Spot Trading  (READ + TRADE)');
  console.log('       ✔  Futures       (READ + TRADE)');
  console.log('       ✘  Withdrawal    (must NOT be enabled)');
  console.log('       ✔  IP whitelist  (optional but recommended)');
  return true;
}

// ── Summary ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`${BOLD}═══════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  Nexus Arbitrage Hub — Pre-live Connectivity Check${RESET}`);
  console.log(`${BOLD}═══════════════════════════════════════════════════${RESET}`);

  const results = await Promise.allSettled([
    checkEnvVars(),
    checkHmacSigning(),
    checkMEXCPublicEndpoint(),
    checkMEXCFuturesPublicEndpoint(),
    checkAccountBalance(),
    checkApiKeyPermissions()
  ]);

  const values   = results.map(r => r.status === 'fulfilled' ? r.value : false);
  const passed   = values.filter(Boolean).length;
  const critical = values.slice(0, 4); // env + hmac + public endpoints
  const allCriticalPass = critical.every(Boolean);

  console.log(`\n${BOLD}═══════════════════════════════════════════════════${RESET}`);
  console.log(`Results: ${passed}/${values.length} checks passed`);

  if (allCriticalPass && values[4]) {
    console.log(`\n${GREEN} ${BOLD}All checks passed. You can switch to live trading:${RESET}`);
    console.log('  POST /mode/live   (header: x-admin-token: <ADMIN_TOKEN>)');
    console.log('\n  Recommended settings before first live trade:');
    console.log('    max_daily_loss_usd: 10');
    console.log('    min_seconds_between_trades: 60');
  } else if (allCriticalPass) {
    console.log(`\n${YELLOW} Core network checks passed, but authenticated balance check failed.`);
    console.log('  Fix your MEXC API key/secret before going live.');
  } else {
    console.log(`\n${RED} ${BOLD}Critical checks failed. Do NOT go live until they pass.${RESET}`);
  }
  console.log('');

  process.exit(allCriticalPass && values[4] ? 0 : 1);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
