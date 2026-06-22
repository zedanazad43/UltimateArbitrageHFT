#!/usr/bin/env node
// Pre-setup checklist and credential gathering

console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  ✅ PRE-SETUP CHECKLIST                                             ║
║                                                                      ║
║  Before running setup, gather these credentials:                    ║
╚══════════════════════════════════════════════════════════════════════╝

1️⃣  BRIGHT DATA PROXY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   📍 Go to: https://brightdata.com/proxy-types/datacenter

   ✓ Sign up or log in
   ✓ Navigate: Account Settings > Proxies > My Credentials
   ✓ Copy: username & password

   You'll need:
      BRIGHT_DATA_USER = ?
      BRIGHT_DATA_PASSWORD = ?

   ⏱️  Time: ~2 minutes


2️⃣  CLOUDFLARE TUNNEL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   📍 Prerequisites:
      • Cloudflare account (free or paid)
      • cloudflared CLI installed

   🔧 Installation:
      macOS:   brew install cloudflare/cloudflare/cloudflared
      Linux:   https://developers.cloudflare.com/cloudflare-one/setup/
      Windows: https://github.com/cloudflare/cloudflared/releases/

   📋 Commands to run:
      cloudflared tunnel login
      cloudflared tunnel create us-bypass
      cloudflared tunnel create eu-routing
      cloudflared tunnel create asia-bypass
      cloudflared tunnel list

   ✓ Copy the 3 tunnel URLs from the output

   You'll need:
      CF_TUNNEL_US_BYPASS_URL = https://us-bypass-xxx.tunnel.example.com
      CF_TUNNEL_EU_URL = https://eu-routing-xxx.tunnel.example.com
      CF_TUNNEL_ASIA_URL = https://asia-bypass-xxx.tunnel.example.com

   ✓ Keep tunnels running:
      nohup cloudflared tunnel run us-bypass > /tmp/us-bypass.log 2>&1 &
      nohup cloudflared tunnel run eu-routing > /tmp/eu-routing.log 2>&1 &
      nohup cloudflared tunnel run asia-bypass > /tmp/asia-bypass.log 2>&1 &

   ⏱️  Time: ~8-10 minutes


3️⃣  OXYLABS PROXY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   📍 Go to: https://oxylabs.io/products/proxy-browser

   ✓ Sign up or log in
   ✓ Navigate: Dashboard > API / Account Settings
   ✓ Create or find credentials
   ✓ Copy: username & password

   You'll need:
      OXYLABS_USER = ?
      OXYLABS_PASSWORD = ?

   ⏱️  Time: ~2 minutes


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 CHECKLIST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before proceeding, confirm you have:

  □ Bright Data username & password
  □ Cloudflare account + cloudflared installed
  □ 3 Cloudflare Tunnels created & running
  □ 3 Tunnel URLs ready
  □ Oxylabs username & password

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 NEXT COMMAND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Once you have all credentials ready, run:

  npm run setup:all

This will:
  1. Prompt for each credential
  2. Update .env.local
  3. Show deployment options

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✨ This is a one-time setup. After this, your system will be protected
   from geo-blocking forever!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
