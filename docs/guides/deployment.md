# DEPLOYMENT GUIDE - UltimateArbitrageHFT
## Production Deployment Checklist & Instructions

---

## 🚀 PRE-DEPLOYMENT VERIFICATION (DO THIS FIRST)

### 1. Run Full Test Suite
```bash
npm run verify:prod
```
This command runs:
- ✅ ESLint (code quality)
- ✅ All unit tests (77 tests)
- ✅ Dry-run build check
- ✅ Security validation
- ✅ Secret verification

**Expected Output**: All tests PASS ✅

---

## 🔐 CLOUDFLARE SETUP

### Step 1: Verify Cloudflare Login
```bash
npx wrangler login
```

### Step 2: Verify Resource IDs (wrangler.toml)
```bash
# Confirm these exist in wrangler.toml:
cat wrangler.toml | grep -E "account_id|binding|database_id"
```

**Expected**:
- account_id: 652e53f35781522e2745784cc4425d9d ✅
- KV BOT_STATE: ac954cedbedd48f8aa4452975e5fc2a1 ✅
- D1 database: cd726538-9c41-456c-b172-15fcc3a63a0c ✅

### Step 3: Create GitHub Secrets (if deploying via CI/CD)
In your GitHub repo → Settings → Secrets and variables → Actions:

| Secret | Value |
|--------|-------|
| `CLOUDFLARE_API_TOKEN` | From Cloudflare dashboard → My Profile → API Tokens |
| `CLOUDFLARE_ACCOUNT_ID` | 652e53f35781522e2745784cc4425d9d |
| `ADMIN_TOKEN` | Generate strong random string: `openssl rand -base64 32` |
| `TELEGRAM_BOT_TOKEN` | (Optional) From @BotFather |
| `TELEGRAM_CHAT_ID` | (Optional) Your Telegram chat/group ID |
| `MEXC_API_KEY` | Your MEXC exchange key |
| `MEXC_API_SECRET` | Your MEXC exchange secret |
| `BINANCE_API_KEY` | (Optional) |
| `BINANCE_API_SECRET` | (Optional) |
| `OKX_API_KEY` | (Optional) |
| `OKX_API_SECRET` | (Optional) |
| `OKX_PASSPHRASE` | (Optional) |
| `KUCOIN_API_KEY` | (Optional) |
| `KUCOIN_SECRET_KEY` | (Optional) |
| `KUCOIN_PASSPHRASE` | (Optional) |

### Step 4: Verify Cloudflare API Token Permissions
**Required Permissions**:
- ✅ Workers Scripts: Edit
- ✅ D1: Edit
- ✅ KV Storage: Edit
- ✅ Account: Read

**Important**: Remove any "Client IP Address Filtering" restrictions from the token (GitHub Actions runners use dynamic IPs).

---

## 🗄️ DATABASE MIGRATION

### Apply D1 Schema to Production
```bash
# BEFORE FIRST DEPLOY, run this:
npm run db:migrate

# Expected output:
# Executing Migration: 0001_create_trades.sql
# Successfully applied all migrations
```

---

## 🔑 DEPLOY SECRETS TO CLOUDFLARE

### Option A: Manual Secrets Upload
```bash
# Set each secret individually
npx wrangler secret put ADMIN_TOKEN
# Then enter your secret when prompted

npx wrangler secret put MEXC_API_KEY
npx wrangler secret put MEXC_API_SECRET
# ... repeat for other exchanges
```

### Option B: Automated Secrets Upload Script
```bash
npm run secret:all

# Or test with dry-run first:
npm run secret:dry
```

---

## 📦 DEPLOYMENT

### Option A: Manual Deployment (Recommended for First Deploy)
```bash
# Build and deploy to Cloudflare
npm run deploy

# Expected output:
# ✓ Uploaded ultimate-arbitrage-hft to Cloudflare
# ✓ Live at: https://ultimatearbitragehft.zedanazad43.workers.dev
```

### Option B: GitHub Actions (CI/CD Deployment)
1. Push to `main` branch
2. GitHub Actions workflow triggers automatically
3. Runs: lint → test → deploy
4. Monitor progress in GitHub Actions tab

### Option C: GitHub Actions Manual Trigger
Go to GitHub repo → Actions → "Deploy Worker" → Run workflow

---

## ✅ POST-DEPLOYMENT VERIFICATION

### 1. Check Worker is Live
```bash
curl https://ultimatearbitragehft.zedanazad43.workers.dev/health
# Expected: 200 OK with status data
```

### 2. Test API Endpoints
```bash
# Get dashboard (requires admin token)
curl -H "x-admin-token: YOUR_ADMIN_TOKEN" \
  https://ultimatearbitragehft.zedanazad43.workers.dev/dashboard

# List exchanges
curl -H "x-admin-token: YOUR_ADMIN_TOKEN" \
  https://ultimatearbitragehft.zedanazad43.workers.dev/exchanges
```

### 3. Monitor Logs
```bash
# Stream live logs from Cloudflare
npm run tail

# Or view in Cloudflare UI:
# https://dash.cloudflare.com → Workers & Pages → ultimatearbitragehft → Logs
```

### 4. Check Metrics
- **Dashboard**: https://ultimatearbitragehft.zedanazad43.workers.dev/dashboard
- **Recent Trades**: Check DB queries in Cloudflare UI
- **P&L Tracking**: View in dashboard analytics

---

## 🧪 FIRST TRADE TEST

### Step 1: Enable Paper Trading Mode
```bash
curl -X POST \
  -H "x-admin-token: YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"paper_trading": true}' \
  https://ultimatearbitragehft.zedanazad43.workers.dev/config
```

### Step 2: Enable CEX Strategy
```bash
curl -X POST \
  -H "x-admin-token: YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"strategy_flags": {"cex": true, "dex": false, "perps": false}}' \
  https://ultimatearbitragehft.zedanazad43.workers.dev/config
```

### Step 3: Start Bot
```bash
curl -X POST \
  -H "x-admin-token: YOUR_ADMIN_TOKEN" \
  https://ultimatearbitragehft.zedanazad43.workers.dev/start

# Expected: 200 OK, bot starts scanning
```

### Step 4: Monitor Dashboard
1. Open: https://ultimatearbitragehft.zedanazad43.workers.dev/dashboard
2. Look for:
   - ✅ Trading: Enabled
   - ✅ Mode: PAPER (yellow)
   - ✅ Last Scan: Recent timestamp
   - ✅ Recent Trades: Showing simulated trades
   - ✅ P&L: Positive growth (in paper mode)

### Step 5: Stop Bot (for verification)
```bash
curl -X POST \
  -H "x-admin-token: YOUR_ADMIN_TOKEN" \
  https://ultimatearbitragehft.zedanazad43.workers.dev/stop
```

---

## 🔴 SWITCHING TO LIVE TRADING

### ⚠️ CRITICAL SAFETY CHECKS
1. ✅ Paper trading tested successfully
2. ✅ All strategies validated in paper mode
3. ✅ Max daily loss limit set appropriately
4. ✅ Exchange API keys verified
5. ✅ Telegram alerts configured (optional but recommended)
6. ✅ Sufficient account balance on exchanges
7. ✅ Risk parameters reviewed and approved

### Live Mode Activation
```bash
# ENABLE LIVE TRADING (IRREVERSIBLE)
curl -X POST \
  -H "x-admin-token: YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"paper_trading": false, "trading_enabled": false}' \
  https://ultimatearbitragehft.zedanazad43.workers.dev/config

# Then explicitly start live trading
curl -X POST \
  -H "x-admin-token: YOUR_ADMIN_TOKEN" \
  https://ultimatearbitragehft.zedanazad43.workers.dev/start
```

### Monitor Live Trading
- **Dashboard**: Check real-time P&L
- **Logs**: `npm run tail` for execution details
- **Alerts**: Telegram notifications on new trades
- **Max Loss Guard**: Bot auto-stops at daily loss limit

---

## 🛠️ TROUBLESHOOTING

### Worker Won't Deploy
```bash
# Check for validation errors
npm run verify:prod

# Check Cloudflare account access
npx wrangler whoami

# Validate wrangler.toml
npx wrangler deploy --dry-run
```

### Database Migrations Failed
```bash
# Check D1 status
npx wrangler d1 info ultimate-arbitrage-db --remote

# Re-apply schema
npm run db:migrate

# View D1 logs
npx wrangler d1 execute ultimate-arbitrage-db --remote --command "SELECT * FROM trades LIMIT 1;"
```

### Secrets Not Found
```bash
# List all secrets
npx wrangler secret list

# Re-upload a secret
npx wrangler secret put ADMIN_TOKEN

# Verify secret is set
npx wrangler secret list | grep ADMIN_TOKEN
```

### API Returns 403 Unauthorized
- Check: Admin token is correct
- Check: Header name is exactly `x-admin-token` (lowercase)
- Check: No extra spaces in token value

### Exchange API Errors
- Verify API keys in Cloudflare secrets (not in code!)
- Check exchange rate limits (may need API key upgrade)
- Ensure IP is not rate-limited by exchange
- Check exchange status page for outages

---

## 📊 MONITORING & MAINTENANCE

### Daily Health Checks
```bash
# Check worker status
curl https://ultimatearbitragehft.zedanazad43.workers.dev/health

# Check recent trades
curl -H "x-admin-token: YOUR_ADMIN_TOKEN" \
  https://ultimatearbitragehft.zedanazad43.workers.dev/trades?limit=10

# Export trades (CSV)
curl -H "x-admin-token: YOUR_ADMIN_TOKEN" \
  https://ultimatearbitragehft.zedanazad43.workers.dev/export/trades.csv > trades.csv
```

### Weekly Backup
```bash
# Backup database
npm run backup

# Or backup with full history
npm run backup:full
```

### Monthly Audit
```bash
# Security audit
npm run audit:security

# Performance review
npm run monitor
```

---

## 🔄 ROLLING BACK TO PREVIOUS VERSION

```bash
# Get previous worker version from Git
git log --oneline -5

# Revert to specific commit
git checkout <commit-hash>

# Re-deploy previous version
npm run deploy
```

---

## 📈 SCALING FOR HIGHER VOLUME

### Increase Rate Limits
Edit `index.js` and adjust:
- `max_live_trades_per_scan`: 3 → 5-10
- `MIN_SECONDS_BETWEEN_TRADES`: 30 → 5-10
- `MAX_SPREAD_PCT`: 5.0 → 2.0-3.0

### Add More Exchanges
Add API keys for additional exchanges:
- Bitmart
- Gate.io
- Bybit
- Huobi

### Enable DEX Trading
```bash
curl -X POST \
  -H "x-admin-token: YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"strategy_flags": {"dex": true}}' \
  https://ultimatearbitragehft.zedanazad43.workers.dev/config
```

### Enable Perps Funding
```bash
curl -X POST \
  -H "x-admin-token: YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"strategy_flags": {"perps": true, "funding": true}}' \
  https://ultimatearbitragehft.zedanazad43.workers.dev/config
```

---

## 💰 COST ESTIMATION

### Cloudflare Pricing (Monthly)
- **Workers**: $5/month (unlimited requests within limits)
- **D1 Database**: $0.75/million read, $1.50/million write (see docs)
- **KV Storage**: $0.50/million reads, $5/million writes
- **R2 Storage**: $0.015/GB/month (for trade logs)
- **Analytics Engine**: $0.50/million data points

### Typical Monthly Cost
- Low activity (< 100 trades/day): ~$5-10
- Medium activity (100-1000 trades/day): ~$20-50
- High activity (1000+ trades/day): ~$50-200

### Ways to Reduce Costs
1. Use paper trading mode for testing
2. Increase `MIN_SECONDS_BETWEEN_TRADES` to reduce write frequency
3. Archive old trades to R2 (cheaper storage)
4. Filter unnecessary data in analytics

---

## ✨ SUCCESS CRITERIA

Your deployment is successful when:
1. ✅ `npm run verify:prod` returns all PASS
2. ✅ `npm run deploy` completes without errors
3. ✅ Dashboard loads at: https://ultimatearbitragehft.zedanazad43.workers.dev
4. ✅ Paper trading shows transactions in dashboard
5. ✅ Recent trades appear in database
6. ✅ Telegram alerts work (if configured)
7. ✅ Live trading executes orders successfully
8. ✅ P&L tracking updates in real-time

---

## 📞 QUICK REFERENCE

| Command | Purpose |
|---------|---------|
| `npm run dev` | Local development |
| `npm run verify:prod` | Pre-deployment check |
| `npm run deploy` | Deploy to production |
| `npm run tail` | Stream production logs |
| `npm run test:all` | Run full test suite |
| `npm run db:migrate` | Apply D1 schema |
| `npm run secret:all` | Upload all secrets |
| `npm run monitor` | Performance monitoring |
| `npm run audit:security` | Security audit |

---

**Last Updated**: May 15, 2026  
**Version**: 2.0.0  
**Status**: Production Ready ✅
