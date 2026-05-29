/**
 * Test exchange API credentials by making authenticated calls
 * Usage: WORKER_URL=https://ultimatearbitragehft.zedanazad43.workers.dev ADMIN_TOKEN=xxx node scripts/test-credentials.cjs
 */
const https = require('https');
const workerUrl = process.env.WORKER_URL || 'https://ultimatearbitragehft.zedanazad43.workers.dev';
const adminToken = process.env.ADMIN_TOKEN || process.env.WORKFLOW_ADMIN_TOKEN || '';

if (!adminToken) {
  console.error('ERROR: Set ADMIN_TOKEN env variable');
  process.exit(1);
}

async function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: {
        'Cookie': `admin_session=${adminToken}`,
        'x-admin-token': adminToken,
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
        ...opts.headers,
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

async function main() {
  console.log('\n🔍 Testing exchange credentials...\n');

  // 1. Check /api/balances
  const bal = await fetchJson(`${workerUrl}/api/balances`);
  if (bal.status === 401) {
    console.error('❌ Authentication failed. Check your ADMIN_TOKEN.');
    process.exit(1);
  }

  const exchanges = (bal.body?.data || []);
  console.log('Exchange Credentials Status:');
  console.log('─'.repeat(60));
  
  for (const ex of exchanges) {
    const icon = ex.error ? '❌' : ex.configured ? '✅' : '⚠️';
    const status = ex.error 
      ? `ERROR: ${String(ex.error).slice(0, 80)}`
      : ex.configured 
        ? `Balance: $${Number(ex.balance || 0).toFixed(2)} USDT`
        : `Not configured (missing: ${(ex.missing_keys || []).join(', ')})`;
    console.log(`${icon} ${String(ex.exchange || '').toUpperCase().padEnd(12)} ${status}`);
  }

  // 2. Check circuit breaker
  const cb = await fetchJson(`${workerUrl}/api/status`);
  if (cb.body?.circuitBreaker) {
    console.log('\n⚡ Circuit Breaker Status:');
    for (const [ex, info] of Object.entries(cb.body.circuitBreaker)) {
      if (info.failures > 0) {
        console.log(`  ${ex}: ${info.failures} failures, open=${info.open}`);
      }
    }
  }

  // 3. Show last scan
  const status = cb.body;
  console.log(`\n📊 System Status:`);
  console.log(`  Mode: ${status?.paper_trading !== false ? '📄 Paper' : '🔴 Live'}`);
  console.log(`  Trading: ${status?.trading_enabled ? '✅ Enabled' : '❌ Disabled'}`);
  console.log(`  Equity: $${(status?.equity_usd || 0).toFixed(2)}`);
  console.log(`  Daily trades: ${status?.daily_trades || 0}`);
  console.log(`  Daily PnL: $${(status?.daily_pnl_usd || 0).toFixed(4)}`);
}

main().catch(e => { console.error(e); process.exit(1); });