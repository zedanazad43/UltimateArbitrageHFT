#!/usr/bin/env node
// Cloudflare Tunnel Setup Helper for Geographic Routing

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log(`
╔════════════════════════════════════════════════════════════════════╗
║   🔐 CLOUDFLARE TUNNEL SETUP - GEOGRAPHIC ROUTING                 ║
║                                                                    ║
║   This script guides you through creating 3 regional tunnels      ║
║   for US, EU, and Asia-Pacific geo-bypass                         ║
╚════════════════════════════════════════════════════════════════════╝
`);

console.log(`
📋 PREREQUISITES:
  ✓ Cloudflare account (free or paid)
  ✓ cloudflared CLI installed
  ✓ Admin access to your Cloudflare domain

🔗 INSTALLATION:
  macOS:   brew install cloudflare/cloudflare/cloudflared
  Linux:   https://developers.cloudflare.com/cloudflare-one/setup/
  Windows: https://github.com/cloudflare/cloudflared/releases/

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 1: Create Tunnels
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Run these commands in your terminal:

  cloudflared tunnel login

  # Create US bypass tunnel
  cloudflared tunnel create us-bypass
  → Output will show: Tunnel credentials written to ~/.cloudflared/<UUID>.json
  → UUID is CF_TUNNEL_US_BYPASS_ID

  # Create EU routing tunnel
  cloudflared tunnel create eu-routing

  # Create Asia-Pacific tunnel
  cloudflared tunnel create asia-bypass

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 2: Get Tunnel URLs
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

After creating tunnels, Cloudflare automatically generates URLs:

  Format: https://<tunnel-name>.<random-subdomain>.tunnel.example.com

Go to: https://dash.cloudflare.com/
  → Navigate to: Zero Trust > Access > Tunnels
  → Copy each tunnel's public hostname

OR list via CLI:
  cloudflared tunnel list

Example output:
  us-bypass      UUID-1234  https://us-bypass-abc123.tunnel.example.com
  eu-routing     UUID-5678  https://eu-routing-def456.tunnel.example.com
  asia-bypass    UUID-9012  https://asia-bypass-ghi789.tunnel.example.com

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 3: Configure Tunnel Routing
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create ~/.cloudflared/config.yml with ingress rules:

  tunnel: us-bypass
  credentials-file: ~/.cloudflared/<UUID>.json
  ingress:
    - hostname: us-bypass-*.tunnel.example.com
      service: http://127.0.0.1:3000
    - service: http_status:404

  tunnel: eu-routing
  credentials-file: ~/.cloudflared/<UUID>.json
  ingress:
    - hostname: eu-routing-*.tunnel.example.com
      service: http://127.0.0.1:3001
    - service: http_status:404

  tunnel: asia-bypass
  credentials-file: ~/.cloudflared/<UUID>.json
  ingress:
    - hostname: asia-bypass-*.tunnel.example.com
      service: http://127.0.0.1:3002
    - service: http_status:404

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 4: Start Tunnels
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  # Start each tunnel
  cloudflared tunnel run us-bypass
  cloudflared tunnel run eu-routing
  cloudflared tunnel run asia-bypass

  # Or run in background
  nohup cloudflared tunnel run us-bypass > /tmp/us-bypass.log 2>&1 &
  nohup cloudflared tunnel run eu-routing > /tmp/eu-routing.log 2>&1 &
  nohup cloudflared tunnel run asia-bypass > /tmp/asia-bypass.log 2>&1 &

  # Verify tunnels are running
  curl https://us-bypass-abc123.tunnel.example.com/health
  curl https://eu-routing-def456.tunnel.example.com/health
  curl https://asia-bypass-ghi789.tunnel.example.com/health

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 5: Update .env.local
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Edit .env.local and add your tunnel URLs:

  CF_TUNNEL_US_BYPASS_URL=https://us-bypass-abc123.tunnel.example.com
  CF_TUNNEL_EU_URL=https://eu-routing-def456.tunnel.example.com
  CF_TUNNEL_ASIA_URL=https://asia-bypass-ghi789.tunnel.example.com

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 6: Deploy to Cloudflare Workers
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  npm run secret:all      # Upload to Cloudflare
  npm run deploy          # Deploy Worker
  npm run tail            # Monitor logs

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TESTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  # Check tunnel health
  curl https://ultimatearbitragehft.zedanazad43.workers.dev/geo-bypass/tunnel-health

  # Check full status
  curl https://ultimatearbitragehft.zedanazad43.workers.dev/geo-bypass/report

  # Test US routing (should show us-bypass in response)
  curl -H "CF-IPCountry: US" https://ultimatearbitragehft.zedanazad43.workers.dev/geo-bypass/report

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ADVANCED: Route Through Multiple Services
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For high-availability, route through different upstream proxies:

  tunnel: us-bypass
  ingress:
    - hostname: us-bypass-*.tunnel.example.com
      service: http://bright-data-proxy.local:8080
    - service: http_status:404

  tunnel: eu-routing
  ingress:
    - hostname: eu-routing-*.tunnel.example.com
      service: http://eu-proxy.local:8080
    - service: http_status:404

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TROUBLESHOOTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

❌ "Failed to authenticate"
  → Run: cloudflared tunnel login
  → Authorize at the URL shown

❌ "Tunnel not found"
  → Run: cloudflared tunnel list
  → Verify tunnel name matches config.yml

❌ "Connection refused on localhost:3000"
  → Make sure your upstream service is running
  → Or configure to route to a remote proxy

❌ "403 Forbidden"
  → Check Cloudflare Zero Trust policies
  → Dashboard > Zero Trust > Access > Applications

✅ Check Tunnel Status:
  https://dash.cloudflare.com/ → Zero Trust → Tunnels
  Should show "HEALTHY" with "Connected X mins ago"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 EXAMPLE: Complete Setup Sequence
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# 1. Login
cloudflared tunnel login

# 2. Create tunnels
cloudflared tunnel create us-bypass
cloudflared tunnel create eu-routing
cloudflared tunnel create asia-bypass

# 3. List to get URLs
cloudflared tunnel list

# 4. Edit .env.local
nano .env.local

# 5. Deploy
npm run secret:all
npm run deploy

# 6. Test
curl https://ultimatearbitragehft.zedanazad43.workers.dev/geo-bypass/tunnel-health

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📚 DOCUMENTATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  https://developers.cloudflare.com/cloudflare-one/
  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
  https://developers.cloudflare.com/cloudflare-one/setup/

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

console.log(`
✨ READY TO CONFIGURE?

Follow the steps above to:
  1. Create 3 tunnels (us-bypass, eu-routing, asia-bypass)
  2. Get tunnel URLs
  3. Update .env.local
  4. Deploy

Once tunnels are running and URLs are configured, your system will:
  ✅ Automatically detect US IP → Route through us-bypass
  ✅ EU users → Route through eu-routing
  ✅ Asia users → Route through asia-bypass
  ✅ All others → Direct connection

`);
