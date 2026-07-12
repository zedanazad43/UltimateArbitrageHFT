#!/usr/bin/env node
// Configure Bright Data + Cloudflare Tunnel + Oxylabs for geo-bypass

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');

const configs = {
  brightData: {
    title: '🌍 BRIGHT DATA PROXY (Primary US Bypass)',
    vars: {
      BRIGHT_DATA_USER: 'Bright Data username',
      BRIGHT_DATA_PASSWORD: 'Bright Data password',
    },
    docs: 'https://brightdata.com/proxy-types/datacenter',
    example: `
# Bright Data Setup:
BRIGHT_DATA_USER=your-bright-data-username
BRIGHT_DATA_PASSWORD=your-bright-data-password
# Proxy URL format: http://USER:PASSWORD@proxy.provider.com:PORT
    `,
  },
  cloudFlareTunnel: {
    title: '🔐 CLOUDFLARE TUNNEL (Geographic Routing)',
    vars: {
      CF_TUNNEL_US_BYPASS_URL: 'US bypass tunnel URL (trycloudflare.com)',
      CF_TUNNEL_EU_URL: 'EU routing tunnel URL',
      CF_TUNNEL_ASIA_URL: 'Asia-Pacific tunnel URL',
    },
    docs: 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/',
    example: `
# Cloudflare Tunnel Setup Commands:
cloudflared tunnel create us-bypass
cloudflared tunnel create eu-routing
cloudflared tunnel create asia-bypass

# Then update with tunnel URLs:
CF_TUNNEL_US_BYPASS_URL=https://us-bypass.tunnel.example.com
CF_TUNNEL_EU_URL=https://eu.tunnel.example.com
CF_TUNNEL_ASIA_URL=https://asia.tunnel.example.com
    `,
  },
  oxylabs: {
    title: '⚡ OXYLABS PROXY (Secondary Failover)',
    vars: {
      OXYLABS_USER: 'Oxylabs username',
      OXYLABS_PASSWORD: 'Oxylabs password',
    },
    docs: 'https://oxylabs.io/products/proxy-browser',
    example: `
# Oxylabs Setup:
OXYLABS_USER=your-oxylabs-username
OXYLABS_PASSWORD=your-oxylabs-password
# Proxy URL format: http://USER:PASSWORD@proxy.oxylabs.io:PORT
    `,
  },
};

function printConfigGuide() {
  console.log('\n' + '═'.repeat(80));
  console.log('🔧 GEO-BYPASS PROXY CONFIGURATION GUIDE');
  console.log('═'.repeat(80) + '\n');

  Object.entries(configs).forEach(([_key, config]) => {
    console.log(`\n${config.title}`);
    console.log('-'.repeat(80));

    console.log('\n📋 Required Environment Variables:');
    Object.entries(config.vars).forEach(([varName, description]) => {
      console.log(`   • ${varName}: ${description}`);
    });

    console.log(`\n📖 Documentation: ${config.docs}`);
    console.log(`\n📝 Setup Instructions:${config.example}`);
  });

  console.log('\n' + '═'.repeat(80));
  console.log('🚀 NEXT STEPS');
  console.log('═'.repeat(80) + '\n');

  console.log('1. Get credentials from each provider:');
  console.log('   ✓ Bright Data: https://brightdata.com/proxy-types/datacenter');
  console.log('   ✓ Cloudflare: https://developers.cloudflare.com/cloudflare-one/');
  console.log('   ✓ Oxylabs: https://oxylabs.io/products/proxy-browser\n');

  console.log('2. Create .env.local with your credentials:');
  console.log('   touch .env.local');
  console.log('   nano .env.local  # or your preferred editor\n');

  console.log('3. Upload secrets to Cloudflare:');
  console.log('   npm run secret:all\n');

  console.log('4. Verify proxy endpoints are accessible:');
  console.log('   curl https://ultimatearbitragehft.zedanazad43.workers.dev/geo-bypass/proxy-status\n');

  console.log('5. Test geo-bypass:');
  console.log('   curl https://ultimatearbitragehft.zedanazad43.workers.dev/geo-bypass/report\n');

  console.log('\n' + '═'.repeat(80));
  console.log('📊 WRANGLER.TOML SECRETS (GitHub Actions will upload these)');
  console.log('═'.repeat(80) + '\n');

  const secretsTemplate = `
# Add to GitHub Secrets (Settings > Secrets and variables > Actions)
BRIGHT_DATA_USER=<your-username>
BRIGHT_DATA_PASSWORD=<your-password>
CF_TUNNEL_US_BYPASS_URL=<your-tunnel-url>
CF_TUNNEL_EU_URL=<your-tunnel-url>
CF_TUNNEL_ASIA_URL=<your-tunnel-url>
OXYLABS_USER=<your-username>
OXYLABS_PASSWORD=<your-password>
  `;

  console.log(secretsTemplate);

  console.log('═'.repeat(80) + '\n');

  console.log('✅ System endpoints for testing:\n');
  console.log('   GET /geo-bypass/diagnose - diagnose opportunity drought');
  console.log('   GET /geo-bypass/proxy-status - check proxy rotation');
  console.log('   GET /geo-bypass/tunnel-health - check tunnel connectivity');
  console.log('   GET /geo-bypass/report - comprehensive geo-bypass report');
  console.log('   POST /geo-bypass/spotlock-recover - trigger auto-recovery\n');

  console.log('═'.repeat(80) + '\n');
}

function createEnvTemplate() {
  const template = `# GEO-BYPASS PROXY CONFIGURATION
# Created: ${new Date().toISOString()}

# ── Bright Data (Primary US Proxy) ──────────────────────────────
BRIGHT_DATA_USER=
BRIGHT_DATA_PASSWORD=

# ── Cloudflare Tunnel (Geographic Routing) ─────────────────────
CF_TUNNEL_US_BYPASS_URL=
CF_TUNNEL_EU_URL=
CF_TUNNEL_ASIA_URL=

# ── Oxylabs (Secondary Failover) ────────────────────────────────
OXYLABS_USER=
OXYLABS_PASSWORD=

# ── Optional: Alchemy RPC ──────────────────────────────────────
ALCHEMY_API_KEY=

# ── Optional: GitHub Token for CI/CD verification ──────────────
GITHUB_TOKEN=
`;

  fs.writeFileSync(envPath, template, 'utf8');
  console.log(`\n✅ Created .env.local template at: ${envPath}`);
  console.log('   Edit this file with your credentials, then run: npm run secret:all\n');
}

function updateDeployWorkflow() {
  const deployYaml = path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml');
  let content = fs.readFileSync(deployYaml, 'utf8');

  // Add proxy secrets if not already present
  const proxySecrets = [
    'BRIGHT_DATA_USER',
    'BRIGHT_DATA_PASSWORD',
    'CF_TUNNEL_US_BYPASS_URL',
    'CF_TUNNEL_EU_URL',
    'CF_TUNNEL_ASIA_URL',
    'OXYLABS_USER',
    'OXYLABS_PASSWORD',
  ];

  const secretsSection = proxySecrets
    .map((secret) => `          ${secret}: \${{ secrets.${secret} }}`)
    .join('\n');

  if (!content.includes('BRIGHT_DATA_USER')) {
    // Find the env section and add proxy secrets
    const envIndex = content.lastIndexOf('EXTERNAL_PROXY_AUTH_HEADER:');
    if (envIndex > -1) {
      const lineEnd = content.indexOf('\n', envIndex);
      content = content.slice(0, lineEnd + 1) + secretsSection + '\n' + content.slice(lineEnd + 1);
      fs.writeFileSync(deployYaml, content, 'utf8');
      console.log(`\n✅ Updated GitHub Actions workflow with proxy secrets\n`);
    }
  }
}

// Main execution
printConfigGuide();
createEnvTemplate();
updateDeployWorkflow();

console.log('📌 DEPLOYMENT CHECKLIST:\n');
console.log('□ Step 1: Configure .env.local with proxy credentials');
console.log('□ Step 2: Add GitHub Secrets for each proxy provider');
console.log('□ Step 3: Run "npm run secret:all" to upload to Cloudflare');
console.log('□ Step 4: Deploy worker: "npm run deploy"');
console.log('□ Step 5: Test endpoints: curl https://ultimatearbitragehft.zedanazad43.workers.dev/geo-bypass/report');
console.log('\n✨ Once configured, all 3 proxy solutions will be active!\n');
