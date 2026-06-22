#!/usr/bin/env node
// Complete Setup Wizard for All 3 Proxy Solutions
// Bright Data + Cloudflare Tunnel + Oxylabs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envLocalPath = path.join(__dirname, '..', '.env.local');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function setupAllProxies() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  🚀 COMPLETE GEO-BYPASS PROXY SETUP                                 ║
║                                                                      ║
║  Configure all 3 proxy solutions:                                   ║
║    1️⃣  Bright Data (Primary US Proxy)                               ║
║    2️⃣  Cloudflare Tunnel (Geographic Routing)                       ║
║    3️⃣  Oxylabs (Secondary Failover)                                 ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  const credentials = {};

  // ─────────────────────────────────────────────────────────────────────────
  // SETUP 1: BRIGHT DATA
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1️⃣  BRIGHT DATA PROXY SETUP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This is your primary US geo-bypass solution.

📋 STEPS:
  1. Open: https://brightdata.com/proxy-types/datacenter
  2. Sign up or log in
  3. Create credentials or find existing ones
  4. Copy username and password
  5. Paste them below

💡 Tip: Use "zone" type proxies for best HFT performance
   They provide dedicated rotating IPs
`);

  const brightDataSetup = await question('Ready to enter Bright Data credentials? (yes/no): ');

  if (brightDataSetup.toLowerCase() === 'yes' || brightDataSetup.toLowerCase() === 'y') {
    credentials.BRIGHT_DATA_USER = await question(
      '  Enter BRIGHT_DATA_USER: '
    );
    credentials.BRIGHT_DATA_PASSWORD = await question(
      '  Enter BRIGHT_DATA_PASSWORD: '
    );

    if (credentials.BRIGHT_DATA_USER && credentials.BRIGHT_DATA_PASSWORD) {
      console.log(`  ✅ Bright Data configured\n`);
    } else {
      console.log(`  ⚠️  Skipped Bright Data\n`);
      delete credentials.BRIGHT_DATA_USER;
      delete credentials.BRIGHT_DATA_PASSWORD;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SETUP 2: CLOUDFLARE TUNNEL
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2️⃣  CLOUDFLARE TUNNEL SETUP (Geographic Routing)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This provides geographic routing: US, EU, and Asia-Pacific regions.
FREE tier gives 50GB/month data!

📋 STEPS:
  1. Install cloudflared: https://developers.cloudflare.com/cloudflare-one/setup/
  2. Run: cloudflared tunnel login
  3. Create 3 tunnels:
     cloudflared tunnel create us-bypass
     cloudflared tunnel create eu-routing
     cloudflared tunnel create asia-bypass
  4. Get tunnel URLs from Cloudflare dashboard:
     https://dash.cloudflare.com/ > Zero Trust > Tunnels
     Copy the "Public hostname" for each tunnel
  5. Paste the URLs below

💡 Format: https://us-bypass-abc123.tunnel.example.com
`);

  const cloudflareSetup = await question('Ready to enter Cloudflare Tunnel URLs? (yes/no): ');

  if (cloudflareSetup.toLowerCase() === 'yes' || cloudflareSetup.toLowerCase() === 'y') {
    credentials.CF_TUNNEL_US_BYPASS_URL = await question(
      '  Enter CF_TUNNEL_US_BYPASS_URL: '
    );
    credentials.CF_TUNNEL_EU_URL = await question(
      '  Enter CF_TUNNEL_EU_URL: '
    );
    credentials.CF_TUNNEL_ASIA_URL = await question(
      '  Enter CF_TUNNEL_ASIA_URL: '
    );

    if (
      credentials.CF_TUNNEL_US_BYPASS_URL &&
      credentials.CF_TUNNEL_EU_URL &&
      credentials.CF_TUNNEL_ASIA_URL
    ) {
      console.log(`  ✅ Cloudflare Tunnel configured\n`);
    } else {
      console.log(`  ⚠️  Skipped Cloudflare Tunnel\n`);
      delete credentials.CF_TUNNEL_US_BYPASS_URL;
      delete credentials.CF_TUNNEL_EU_URL;
      delete credentials.CF_TUNNEL_ASIA_URL;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SETUP 3: OXYLABS
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3️⃣  OXYLABS PROXY SETUP (Secondary Failover)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This is your backup proxy if Bright Data fails.
Provides automatic rotation and geo-targeting.

📋 STEPS:
  1. Open: https://oxylabs.io/products/proxy-browser
  2. Sign up or log in
  3. Create credentials in dashboard
  4. Copy username and password
  5. Paste them below

💡 Tip: For HFT, use residential proxies for best acceptance rates
`);

  const oxylabsSetup = await question('Ready to enter Oxylabs credentials? (yes/no): ');

  if (oxylabsSetup.toLowerCase() === 'yes' || oxylabsSetup.toLowerCase() === 'y') {
    credentials.OXYLABS_USER = await question(
      '  Enter OXYLABS_USER: '
    );
    credentials.OXYLABS_PASSWORD = await question(
      '  Enter OXYLABS_PASSWORD: '
    );

    if (credentials.OXYLABS_USER && credentials.OXYLABS_PASSWORD) {
      console.log(`  ✅ Oxylabs configured\n`);
    } else {
      console.log(`  ⚠️  Skipped Oxylabs\n`);
      delete credentials.OXYLABS_USER;
      delete credentials.OXYLABS_PASSWORD;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 CONFIGURATION SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Bright Data:
  ${credentials.BRIGHT_DATA_USER ? '✅ Configured' : '⏳ Skipped'}

Cloudflare Tunnel:
  ${credentials.CF_TUNNEL_US_BYPASS_URL ? '✅ Configured' : '⏳ Skipped'}

Oxylabs:
  ${credentials.OXYLABS_USER ? '✅ Configured' : '⏳ Skipped'}

`);

  const configuredCount = Object.keys(credentials).length;
  if (configuredCount === 0) {
    console.log(`❌ No proxies configured. Exiting.\n`);
    rl.close();
    process.exit(0);
  }

  console.log(`  ${configuredCount} proxy solution(s) configured ✅\n`);

  // ─────────────────────────────────────────────────────────────────────────
  // UPDATE .ENV.LOCAL
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 UPDATING .env.local
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  const envContent = fs.readFileSync(envLocalPath, 'utf8');
  let updatedEnv = envContent;

  // Update each credential
  Object.entries(credentials).forEach(([key, value]) => {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    updatedEnv = updatedEnv.replace(regex, `${key}=${value}`);
  });

  fs.writeFileSync(envLocalPath, updatedEnv, 'utf8');
  console.log(`✅ .env.local updated\n`);

  // ─────────────────────────────────────────────────────────────────────────
  // DEPLOYMENT
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 READY TO DEPLOY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The configuration is ready. Now you need to:

  1. Upload secrets to Cloudflare:
     npm run secret:all

  2. Deploy the Worker:
     npm run deploy

  3. Verify deployment:
     npm run verify:infra

  4. Test endpoints:
     curl https://ultimatearbitragehft.zedanazad43.workers.dev/geo-bypass/report

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Ready to deploy? (yes/no):
`);

  const readyToDeploy = await question('');

  if (readyToDeploy.toLowerCase() === 'yes' || readyToDeploy.toLowerCase() === 'y') {
    console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  NEXT STEPS                                                          ║
╚══════════════════════════════════════════════════════════════════════╝

Run these commands in order:

  npm run secret:all
  npm run deploy
  npm run verify:infra

Then test with:

  curl https://ultimatearbitragehft.zedanazad43.workers.dev/geo-bypass/proxy-status
  curl https://ultimatearbitragehft.zedanazad43.workers.dev/geo-bypass/tunnel-health
  curl https://ultimatearbitragehft.zedanazad43.workers.dev/geo-bypass/report

🎉 Your system will be protected from US geo-blocking!
`);
  }

  rl.close();
}

setupAllProxies().catch(console.error);
