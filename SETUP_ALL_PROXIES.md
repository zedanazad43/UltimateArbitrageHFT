# Complete Setup Guide: All 3 Proxy Solutions

**Status**: 🚀 Ready to Execute  
**Estimated Time**: 15-20 minutes  
**Difficulty**: Beginner-friendly (step-by-step)

---

## 📋 OVERVIEW

You're about to configure 3 proxy solutions that will:

1. **Bypass US geo-blocking** completely
2. **Rotate traffic** across providers for redundancy
3. **Load-balance** by geography (US/EU/Asia)
4. **Auto-failover** if one provider goes down

---

## 🎯 QUICK START (TL;DR)

```bash
# 1. Interactive setup for all 3 proxies
npm run setup:all

# 2. Deploy to production
npm run secret:all && npm run deploy

# 3. Verify everything works
npm run verify:infra
```

---

## 📖 DETAILED STEP-BY-STEP

### STEP 1: Get Bright Data Credentials (5 min)

**What it does**: Primary proxy for US geo-bypass

**Process**:

1. Go to: <https://brightdata.com/proxy-types/datacenter>
2. Click "Sign Up" or "Login"
3. Navigate to: Account Settings > Proxies > My Credentials
4. Find or create a username/password
5. Copy both values

**Example**:

```
BRIGHT_DATA_USER = alice_trading_bot
BRIGHT_DATA_PASSWORD = bd_pass_xyz123
```

**Note**: If you don't have a Bright Data account, sign up takes 2 minutes. Free tier gives you enough to test.

---

### STEP 2: Setup Cloudflare Tunnel (10 min)

**What it does**: Geographic routing for US/EU/Asia with FREE tier

**Prerequisites**:

- Cloudflare account (free or paid)
- `cloudflared` CLI (install: <https://developers.cloudflare.com/cloudflare-one/setup/>)

**Process**:

```bash
# 1. Authenticate
cloudflared tunnel login
# Opens browser to authorize, confirm

# 2. Create 3 regional tunnels
cloudflared tunnel create us-bypass
cloudflared tunnel create eu-routing
cloudflared tunnel create asia-bypass

# 3. Get tunnel URLs
cloudflared tunnel list
# Output shows: NAME | UUID | URL
```

**Copy the URLs**:

```
CF_TUNNEL_US_BYPASS_URL = https://us-bypass-a1b2c3d4.tunnel.example.com
CF_TUNNEL_EU_URL = https://eu-routing-e5f6g7h8.tunnel.example.com
CF_TUNNEL_ASIA_URL = https://asia-bypass-i9j0k1l2.tunnel.example.com
```

**Keeping tunnels running** (pick one):

Option A - Run in background (Linux/Mac):

```bash
nohup cloudflared tunnel run us-bypass > /tmp/us-bypass.log 2>&1 &
nohup cloudflared tunnel run eu-routing > /tmp/eu-routing.log 2>&1 &
nohup cloudflared tunnel run asia-bypass > /tmp/asia-bypass.log 2>&1 &
```

Option B - Run in terminal tabs (keep windows open):

```bash
# Terminal 1
cloudflared tunnel run us-bypass

# Terminal 2
cloudflared tunnel run eu-routing

# Terminal 3
cloudflared tunnel run asia-bypass
```

Option C - Systemd service (Linux):

```bash
sudo cloudflared service install
sudo systemctl restart cloudflared
```

---

### STEP 3: Get Oxylabs Credentials (5 min)

**What it does**: Secondary backup proxy for redundancy

**Process**:

1. Go to: <https://oxylabs.io/products/proxy-browser>
2. Click "Sign Up" or "Login"
3. Navigate to dashboard > API
4. Find or create credentials
5. Copy username/password

**Example**:

```
OXYLABS_USER = trading_bot_v2
OXYLABS_PASSWORD = oxylabs_pass_abc789
```

---

## 🔧 STEP 4: Run Interactive Setup

```bash
npm run setup:all
```

This will:

1. Ask for Bright Data username/password
2. Ask for 3 Cloudflare Tunnel URLs
3. Ask for Oxylabs username/password
4. Update `.env.local` automatically
5. Show deployment options

**What you'll see**:

```
╔══════════════════════════════════════════════════════════════════════╗
║  🚀 COMPLETE GEO-BYPASS PROXY SETUP                                 ║
...
1️⃣  BRIGHT DATA PROXY SETUP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Ready to enter Bright Data credentials? (yes/no): yes
Enter BRIGHT_DATA_USER: alice_trading_bot
Enter BRIGHT_DATA_PASSWORD: bd_pass_xyz123
✅ Bright Data configured

2️⃣  CLOUDFLARE TUNNEL SETUP (Geographic Routing)
...
```

---

## 🚀 STEP 5: Deploy to Cloudflare

```bash
# Step 5a: Upload secrets to Cloudflare Workers
npm run secret:all

# Step 5b: Deploy the Worker
npm run deploy

# Step 5c: Run database migrations
npm run db:migrate
```

**What happens**:

- Secrets uploaded to Cloudflare KV
- Worker deployed with new code
- Post-deploy smoke tests run automatically
- Telegram alert sent on success/failure

**Expected output**:

```
✅ Deployment complete
   Worker  : ultimatearbitragehft
   Mode    : unchanged
   Monitor : Telegram bot or Worker dashboard
```

---

## ✅ STEP 6: Verify Everything Works

```bash
# Check infrastructure
npm run verify:infra

# Check proxy status
curl https://ultimatearbitragehft.zedanazad43.workers.dev/geo-bypass/proxy-status

# Check tunnel health
curl https://ultimatearbitragehft.zedanazad43.workers.dev/geo-bypass/tunnel-health

# Full diagnostics
curl https://ultimatearbitragehft.zedanazad43.workers.dev/geo-bypass/report
```

**Expected responses**:

```json
// /geo-bypass/proxy-status
{
  "proxyManager": {
    "rotationIndex": 0,
    "providers": ["brightdata", "oxylabs"]
  },
  "configured": {
    "brightData": true,
    "oxylabs": true
  }
}

// /geo-bypass/tunnel-health
{
  "us_bypass": { "online": true, "latencyMs": 45 },
  "eu_routing": { "online": true, "latencyMs": 52 },
  "asia_bypass": { "online": true, "latencyMs": 38 }
}

// /geo-bypass/report
{
  "userCountry": "US",
  "diagnosis": "✅ No geo-blocking detected OR 🌍 Geo-blocking detected: US region detected",
  "infrastructure": { ... }
}
```

---

## 🆘 TROUBLESHOOTING

### "Bright Data credentials not working"

→ Verify credentials at: <https://brightdata.com/account/settings> (My Credentials section)
→ Try resetting password

### "Cloudflare Tunnel shows offline"

→ Check `cloudflared` process is running: `ps aux | grep cloudflared`
→ Restart: `cloudflared tunnel run us-bypass`
→ Check Cloudflare dashboard: <https://dash.cloudflare.com/> > Zero Trust > Tunnels

### "429 Rate Limit still showing"

→ Proxies may not be fully deployed yet (wait 2-3 minutes)
→ Check: `curl https://ultimatearbitragehft.zedanazad43.workers.dev/geo-bypass/proxy-status`
→ Verify all 3 show `true` in "configured"

### "Deploy failed"

→ Check logs: `npm run tail`
→ Verify GitHub secrets are set: <https://github.com/zedanazad43/UltimateArbitrageHFT/settings/secrets/actions>
→ Run manual deploy: `npm run deploy`

### "Tunnels not connecting"

→ Ensure cloudflared daemon is still running
→ Check ingress rules in cloudflared config
→ Restart cloudflared

---

## 📊 WHAT'S HAPPENING BEHIND THE SCENES

**System Architecture After Setup**:

```
┌─────────────────────────────────────────────────────────────────┐
│  Cloudflare Worker (ultimatearbitragehft.workers.dev)           │
│                                                                 │
│  incoming request (CF-IPCountry: US)                           │
│           ↓                                                     │
│  ┌─ Strategy Analyzer ─┐                                       │
│  │ Detect: US detected │                                       │
│  └─────────┬───────────┘                                       │
│            ↓                                                    │
│  ┌─ Proxy Router ──────────────────────────────────┐          │
│  │ 1. Try Bright Data (primary)                    │          │
│  │ 2. Fallback to Cloudflare Tunnel (us-bypass)   │          │
│  │ 3. Fallback to Oxylabs (secondary)              │          │
│  └─────────────┬────────────────────────────────────┘          │
│               ↓                                                │
│      Route to Railway (HFT Engine)                            │
│               ↓                                                │
│      ✅ Opportunity detected & executed                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎉 SUCCESS INDICATORS

After deployment, you should see:

✅ All 3 proxies showing "configured": true
✅ Tunnel health shows "online": true for all regions
✅ No more 429 rate limit errors
✅ Trading opportunities detected again
✅ Geo-bypass report shows recommendations
✅ Live trades executing from non-US locations

---

## 📞 SUPPORT RESOURCES

- **Bright Data**: <https://support.brightdata.com>
- **Cloudflare**: <https://support.cloudflare.com>  
- **Oxylabs**: <https://support.oxylabs.io>
- **System logs**: `npm run tail`
- **Health check**: `npm run monitor:critical`

---

## ⏱️ TIMELINE

| Step | Time | Status |
|------|------|--------|
| Get credentials | 15 min | Your turn |
| Run setup:all | 2 min | Automated |
| npm run secret:all | 1 min | Automated |
| npm run deploy | 5 min | Automated + tests |
| Verify | 2 min | Your turn |
| **Total** | **~25 min** | |

---

## 🚀 Ready?

```bash
npm run setup:all
```

Then follow the prompts. The system will guide you through every step!

**Your next action**: Run `npm run setup:all` and provide the credentials when prompted.
