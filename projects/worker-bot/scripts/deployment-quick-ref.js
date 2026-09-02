#!/usr/bin/env node
// Quick Reference: Geo-Bypass Production Deployment Commands

console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  🚀 QUICK REFERENCE: GEO-BYPASS DEPLOYMENT                          ║
║                                                                      ║
║  All commands you need to deploy 3 proxy solutions                  ║
╚══════════════════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📚 SETUP GUIDES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Show configuration guide:
  npm run setup:proxy

Show Cloudflare Tunnel setup:
  npm run setup:tunnel

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔧 STEP 1: CONFIGURE CREDENTIALS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Edit .env.local with your credentials:

  BRIGHT_DATA_USER=your-username
  BRIGHT_DATA_PASSWORD=your-password

  CF_TUNNEL_US_BYPASS_URL=https://us-bypass-xxx.tunnel.example.com
  CF_TUNNEL_EU_URL=https://eu-routing-xxx.tunnel.example.com
  CF_TUNNEL_ASIA_URL=https://asia-bypass-xxx.tunnel.example.com

  OXYLABS_USER=your-username
  OXYLABS_PASSWORD=your-password

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ STEP 2: AUTOMATED DEPLOYMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Deploy everything automatically:
  npm run deploy:geo-bypass

This will:
  ✅ Upload secrets to Cloudflare
  ✅ Deploy Worker
  ✅ Run migrations
  ✅ Execute smoke tests

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 VERIFY DEPLOYMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Check infrastructure health:
  npm run verify:infra

Check proxy status:
  curl https://ultimatearbitragehft.zedanazad43.workers.dev/geo-bypass/proxy-status

Check tunnel health:
  curl https://ultimatearbitragehft.zedanazad43.workers.dev/geo-bypass/tunnel-health

Full diagnostics:
  curl https://ultimatearbitragehft.zedanazad43.workers.dev/geo-bypass/report

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 MONITORING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

View live logs:
  npm run tail

Monitor critical health:
  npm run monitor:critical

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 MANUAL DEPLOYMENT (if needed)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 1: Upload secrets
  npm run secret:all

Step 2: Deploy worker
  npm run deploy

Step 3: Run migrations
  npm run db:migrate

Step 4: Verify deployment
  npm run smoke:prod

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 GIT DEPLOYMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Push to GitHub (auto-deploy via GitHub Actions):
  git add .
  git commit -m "feat: configure geo-bypass proxy solutions"
  git push origin main

Monitor GitHub Actions:
  https://github.com/zedanazad43/UltimateArbitrageHFT/actions

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🆘 TROUBLESHOOTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Secret upload failed?
  Check GitHub Secrets are set (not .env.local):
  Settings > Secrets and variables > Actions

Tunnel not connecting?
  1. Check cloudflared is running: cloudflared tunnel list
  2. Verify tunnel URLs in .env.local
  3. Check Cloudflare dashboard: Zero Trust > Tunnels

Deployment rollback:
  git revert HEAD
  git push origin main

View deployment logs:
  npm run tail

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📎 USEFUL LINKS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Worker Dashboard:
  https://dash.cloudflare.com/

Tunnel Dashboard:
  https://dash.cloudflare.com/ > Zero Trust > Tunnels

GitHub Actions:
  https://github.com/zedanazad43/UltimateArbitrageHFT/actions

Railway Dashboard:
  https://railway.app/

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✨ SUCCESS INDICATORS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

When deployment is complete, you should see:

  ✅ "Deployment complete" message
  ✅ All 3 proxy solutions showing "configured"
  ✅ GET /geo-bypass/proxy-status returns proxy stats
  ✅ GET /geo-bypass/tunnel-health shows healthy tunnels
  ✅ No more "429 Rate Limit" errors from US
  ✅ Trading opportunities detected again

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
