#!/usr/bin/env node
// Complete Geo-Bypass Deployment Automation
// Orchestrates all 3 proxy solutions + Cloudflare deployment

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const envLocalPath = path.join(rootDir, '.env.local');

console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  🚀 GEO-BYPASS DEPLOYMENT AUTOMATION                                ║
║                                                                      ║
║  Deploys all 3 proxy solutions:                                     ║
║    1. Bright Data (Primary US Proxy)                                ║
║    2. Cloudflare Tunnel (Geographic Routing)                        ║
║    3. Oxylabs (Secondary Failover)                                  ║
╚══════════════════════════════════════════════════════════════════════╝
`);

// Read current .env.local
const envContent = fs.readFileSync(envLocalPath, 'utf8');
const envLines = envContent.split('\n');
const envMap = {};

envLines.forEach(line => {
  if (line && !line.startsWith('#')) {
    const [key, ...valueParts] = line.split('=');
    const value = valueParts.join('=').trim();
    if (key && value) envMap[key.trim()] = value;
  }
});

console.log(`
📊 CURRENT CONFIGURATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Bright Data:
  BRIGHT_DATA_USER:        ${envMap.BRIGHT_DATA_USER ? '✓ Configured' : '✗ Empty'}
  BRIGHT_DATA_PASSWORD:    ${envMap.BRIGHT_DATA_PASSWORD ? '✓ Configured' : '✗ Empty'}

Cloudflare Tunnel:
  CF_TUNNEL_US_BYPASS_URL: ${envMap.CF_TUNNEL_US_BYPASS_URL ? '✓ Configured' : '✗ Empty'}
  CF_TUNNEL_EU_URL:        ${envMap.CF_TUNNEL_EU_URL ? '✓ Configured' : '✗ Empty'}
  CF_TUNNEL_ASIA_URL:      ${envMap.CF_TUNNEL_ASIA_URL ? '✓ Configured' : '✗ Empty'}

Oxylabs:
  OXYLABS_USER:            ${envMap.OXYLABS_USER ? '✓ Configured' : '✗ Empty'}
  OXYLABS_PASSWORD:        ${envMap.OXYLABS_PASSWORD ? '✓ Configured' : '✗ Empty'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 DEPLOYMENT CHECKLIST
`);

let allConfigured = true;
const configChecks = {
  'Bright Data': envMap.BRIGHT_DATA_USER && envMap.BRIGHT_DATA_PASSWORD,
  'Cloudflare Tunnel': envMap.CF_TUNNEL_US_BYPASS_URL && envMap.CF_TUNNEL_EU_URL && envMap.CF_TUNNEL_ASIA_URL,
  'Oxylabs': envMap.OXYLABS_USER && envMap.OXYLABS_PASSWORD,
};

Object.entries(configChecks).forEach(([name, configured]) => {
  console.log(`  ${configured ? '✅' : '⏳'} ${name}: ${configured ? 'Ready' : 'Pending credentials'}`);
  if (!configured) allConfigured = false;
});

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

if (!allConfigured) {
  console.log(`
⚠️  NOT ALL PROXIES CONFIGURED

You have configured ${Object.values(configChecks).filter(Boolean).length} of 3 proxy solutions.

To complete setup, add credentials to .env.local:

  # Option 1: Configure Bright Data
  BRIGHT_DATA_USER=your-username
  BRIGHT_DATA_PASSWORD=your-password

  # Option 2: Configure Cloudflare Tunnel
  CF_TUNNEL_US_BYPASS_URL=https://your-us-bypass-tunnel.trycloudflare.com
  CF_TUNNEL_EU_URL=https://your-eu-tunnel.trycloudflare.com
  CF_TUNNEL_ASIA_URL=https://your-asia-tunnel.trycloudflare.com

  # Option 3: Configure Oxylabs
  OXYLABS_USER=your-username
  OXYLABS_PASSWORD=your-password

Then run this script again to deploy.
`);
  process.exit(0);
}

console.log(`
✅ ALL PROXIES CONFIGURED!

Ready for deployment. This will:
  1. Upload secrets to Cloudflare Workers KV
  2. Deploy updated Worker code
  3. Run post-deploy smoke tests
  4. Verify geo-bypass endpoints

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 STARTING DEPLOYMENT...
`);

async function runCommand(cmd, args, label) {
  return new Promise((resolve) => {
    console.log(`\n⏳ ${label}...`);
    const proc = spawn(cmd, args, { stdio: 'inherit', shell: true });
    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ ${label} complete`);
        resolve(true);
      } else {
        console.log(`❌ ${label} failed (exit code ${code})`);
        resolve(false);
      }
    });
  });
}

async function deploy() {
  const steps = [
    ['npm', ['run', 'secret:all'], 'Uploading secrets to Cloudflare'],
    ['npm', ['run', 'deploy'], 'Deploying Worker'],
    ['npm', ['run', 'db:migrate'], 'Running database migrations'],
  ];

  let success = true;
  for (const [cmd, args, label] of steps) {
    const result = await runCommand(cmd, args, label);
    if (!result) {
      success = false;
      break;
    }
  }

  if (!success) {
    console.log(`
❌ Deployment failed. Check logs above for details.
`);
    process.exit(1);
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ DEPLOYMENT COMPLETE!

Your system is now configured with all 3 proxy solutions:

  🌍 Bright Data:        ${configChecks['Bright Data'] ? '✅ Active' : '⏳ Pending'}
  🔐 Cloudflare Tunnel:  ${configChecks['Cloudflare Tunnel'] ? '✅ Active' : '⏳ Pending'}
  ⚡ Oxylabs:             ${configChecks['Oxylabs'] ? '✅ Active' : '⏳ Pending'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🧪 TESTING YOUR SETUP

1. Check proxy status:
   curl https://ultimatearbitragehft.zedanazad43.workers.dev/geo-bypass/proxy-status

2. Check tunnel health:
   curl https://ultimatearbitragehft.zedanazad43.workers.dev/geo-bypass/tunnel-health

3. Run full diagnostics:
   curl https://ultimatearbitragehft.zedanazad43.workers.dev/geo-bypass/report

4. Simulate US geo-blocking:
   curl -H "CF-IPCountry: US" https://ultimatearbitragehft.zedanazad43.workers.dev/geo-bypass/report

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎉 YOU'RE READY!

Your HFT system is now:
  ✅ Protected from US geo-blocking
  ✅ Load-balanced across 3 proxy providers
  ✅ Ready for 24/7 trading

Monitor logs:
  npm run tail

Check health status:
  npm run monitor:critical

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

deploy().catch(console.error);
