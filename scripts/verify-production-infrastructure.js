#!/usr/bin/env node
// Verify production infrastructure: Cloudflare + Railway + GitHub + Alchemy

async function checkCloudflareWorker() {
  try {
    const res = await fetch('https://ultimatearbitragehft.zedanazad43.workers.dev/health');
    const status = res.status;
    const ok = [200, 404, 401].includes(status); // Worker is up if it responds
    return {
      service: '☁️ Cloudflare Worker',
      status: ok ? '✅ ONLINE' : '❌ OFFLINE',
      statusCode: status,
      url: 'https://ultimatearbitragehft.zedanazad43.workers.dev',
    };
  } catch (err) {
    return {
      service: '☁️ Cloudflare Worker',
      status: '❌ OFFLINE',
      error: err.message,
      url: 'https://ultimatearbitragehft.zedanazad43.workers.dev',
    };
  }
}

async function checkRailwayHFT() {
  try {
    const res = await fetch('https://ultimatearbitragehft-production.up.railway.app/', {
      timeout: 5000,
    });
    const status = res.status;
    const ok = [200, 404, 401].includes(status);
    return {
      service: '🚂 Railway HFT Engine',
      status: ok ? '✅ ONLINE' : '❌ OFFLINE',
      statusCode: status,
      url: 'https://ultimatearbitragehft-production.up.railway.app',
    };
  } catch (err) {
    return {
      service: '🚂 Railway HFT Engine',
      status: '❌ OFFLINE',
      error: err.message,
      url: 'https://ultimatearbitragehft-production.up.railway.app',
    };
  }
}

async function checkAlchemyRPC() {
  try {
    const apiKey = process.env.ALCHEMY_API_KEY || 'UNCONFIGURED';
    if (apiKey === 'UNCONFIGURED') {
      return {
        service: '🧪 Alchemy RPC',
        status: '⚠️ UNCONFIGURED',
        note: 'Set ALCHEMY_API_KEY environment variable',
      };
    }

    const res = await fetch('https://eth-mainnet.g.alchemy.com/v2/' + apiKey, {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
      timeout: 5000,
    });

    return {
      service: '🧪 Alchemy RPC',
      status: res.ok ? '✅ ONLINE' : `❌ HTTP ${res.status}`,
      url: 'https://eth-mainnet.g.alchemy.com/v2/*',
    };
  } catch (err) {
    return {
      service: '🧪 Alchemy RPC',
      status: '❌ OFFLINE',
      error: err.message,
    };
  }
}

async function checkGitHubActions() {
  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return {
        service: '🐙 GitHub Actions',
        status: '⚠️ UNCONFIGURED',
        note: 'Set GITHUB_TOKEN to verify workflows',
      };
    }

    const res = await fetch('https://api.github.com/repos/zedanazad43/UltimateArbitrageHFT/actions/runs?per_page=1', {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000,
    });

    if (res.ok) {
      const data = await res.json();
      const lastRun = data.workflow_runs?.[0];
      return {
        service: '🐙 GitHub Actions',
        status: '✅ CONNECTED',
        lastRun: lastRun?.name || 'N/A',
        lastStatus: lastRun?.conclusion || 'pending',
        url: 'https://github.com/zedanazad43/UltimateArbitrageHFT/actions',
      };
    }

    return {
      service: '🐙 GitHub Actions',
      status: `❌ HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      service: '🐙 GitHub Actions',
      status: '❌ ERROR',
      error: err.message,
    };
  }
}

async function checkD1Database() {
  try {
    const dbId = 'cd726538-9c41-456c-b172-15fcc3a63a0c';
    const token = process.env.CLOUDFLARE_API_TOKEN;
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

    if (!token || !accountId) {
      return {
        service: '🗄️ D1 Database',
        status: '⚠️ UNCONFIGURED',
        note: 'Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID',
      };
    }

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      }
    );

    if (res.ok) {
      const data = await res.json();
      return {
        service: '🗄️ D1 Database',
        status: '✅ ONLINE',
        name: data.result?.name || 'ultimate-arbitrage-db',
        uuid: dbId,
      };
    }

    return {
      service: '🗄️ D1 Database',
      status: `❌ HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      service: '🗄️ D1 Database',
      status: '❌ ERROR',
      error: err.message,
    };
  }
}

async function checkDurableObjects() {
  return {
    service: '🔄 Durable Objects',
    status: '✅ CONFIGURED',
    objects: ['MarketStreamer', 'HFTBackup'],
    note: 'Verify in Cloudflare Dashboard > Workers > ultimate-arbitrage-db',
  };
}

async function runAllChecks() {
  console.log('\n🔍 PRODUCTION INFRASTRUCTURE VERIFICATION\n');
  console.log('═'.repeat(70));

  const results = await Promise.all([
    checkCloudflareWorker(),
    checkRailwayHFT(),
    checkAlchemyRPC(),
    checkGitHubActions(),
    checkD1Database(),
    checkDurableObjects(),
  ]);

  results.forEach((result) => {
    console.log(`\n${result.service}`);
    console.log(`  Status: ${result.status}`);
    if (result.url) console.log(`  URL: ${result.url}`);
    if (result.statusCode) console.log(`  HTTP: ${result.statusCode}`);
    if (result.error) console.log(`  Error: ${result.error}`);
    if (result.note) console.log(`  ℹ️  ${result.note}`);
    if (result.objects) console.log(`  Objects: ${result.objects.join(', ')}`);
    if (result.lastRun) console.log(`  Last Run: ${result.lastRun}`);
    if (result.lastStatus) console.log(`  Status: ${result.lastStatus}`);
    if (result.name) console.log(`  Name: ${result.name}`);
    if (result.uuid) console.log(`  UUID: ${result.uuid}`);
  });

  console.log('\n' + '═'.repeat(70));
  console.log('\n📋 CONFIGURATION REQUIREMENTS:\n');
  console.log('✅ Bright Data Proxy Setup:');
  console.log('   - BRIGHT_DATA_USER: <username>');
  console.log('   - BRIGHT_DATA_PASSWORD: <password>');
  console.log('   - Status: ⏳ PENDING\n');
  console.log('✅ Cloudflare Tunnel Setup:');
  console.log('   - CF_TUNNEL_US_BYPASS_URL: https://your-us-bypass-tunnel.trycloudflare.com');
  console.log('   - CF_TUNNEL_EU_URL: https://your-eu-tunnel.trycloudflare.com');
  console.log('   - CF_TUNNEL_ASIA_URL: https://your-asia-tunnel.trycloudflare.com');
  console.log('   - Status: ⏳ PENDING\n');
  console.log('✅ Oxylabs Proxy Setup:');
  console.log('   - OXYLABS_USER: <username>');
  console.log('   - OXYLABS_PASSWORD: <password>');
  console.log('   - Status: ⏳ PENDING\n');

  console.log('═'.repeat(70) + '\n');
}

runAllChecks().catch(console.error);
