# 🚀 Fresh-Start Deployment Guide — Ultimate Arbitrage HFT

Follow these steps **in order** whenever you are deploying from a clean Cloudflare account
(i.e. after deleting all workers and pages).

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 20 | https://nodejs.org |
| Wrangler | v4 (bundled) | `npm install` inside repo |

---

## Step 1 — Clone the repository

```bash
git clone https://github.com/zedanazad43/UltimateArbitrageHFT.git
cd UltimateArbitrageHFT
npm install
```

---

## Step 2 — Authenticate Wrangler

```bash
npx wrangler login
```

Note your **Account ID** from the Cloudflare dashboard (Workers & Pages → Overview → right sidebar).

---

## Step 3 — Create Cloudflare resources

Run each command once and **copy the generated IDs** — you will need them in Step 4.

```bash
# KV namespace (stores bot state)
npx wrangler kv namespace create "BOT_STATE"
# → outputs:  id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# D1 database (trades & analytics)
npx wrangler d1 create ultimate-arbitrage-db
# → outputs:  database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# R2 bucket (CSV trade log archives)
npx wrangler r2 bucket create ultimate-arbitrage-logs

# Queue (async trade-log pipeline)
npx wrangler queues create ultimate-arbitrage-queue
```

---

## Step 4 — Update wrangler.toml

Open `wrangler.toml` and replace the placeholder IDs with the ones you got in Step 3:

```toml
account_id = "YOUR_ACCOUNT_ID"          # line 5

[[kv_namespaces]]
binding = "BOT_STATE"
id = "YOUR_KV_NAMESPACE_ID"             # line 11

[[d1_databases]]
binding = "DB"
database_name = "ultimate-arbitrage-db"
database_id = "YOUR_D1_DATABASE_ID"     # line 16
```

Commit the updated `wrangler.toml`:

```bash
git add wrangler.toml
git commit -m "config: update Cloudflare resource IDs for fresh deployment"
git push
```

---

## Step 5 — Apply the D1 schema

```bash
npx wrangler d1 execute ultimate-arbitrage-db --file=./migrations/schema.sql --remote
```

---

## Step 6 — Upload secrets

Copy `.dev.vars.example` to a temporary file, fill in real values, then upload:

```bash
# Bulk-upload via a JSON file (never commit this file)
npx wrangler secret bulk /path/to/your/secrets.json
```

The expected keys are listed in `.dev.vars.example`.  The **minimum** required set to
have a working bot in paper-trading mode:

| Secret | Purpose |
|--------|---------|
| `ADMIN_TOKEN` | Protects `/start`, `/stop`, `/scan` admin routes |
| `TELEGRAM_BOT_TOKEN` | Telegram alert notifications (optional) |
| `TELEGRAM_CHAT_ID` | Telegram chat / channel ID (optional) |

Exchange API keys (`MEXC_API_KEY`, etc.) are only required for **live** trading.

---

## Step 7 — Deploy the Worker

```bash
npm run deploy
# or:  npx wrangler deploy
```

The Worker will be available at:
`https://ultimate-arbitrage-hft.<your-subdomain>.workers.dev`

---

## Step 8 — Enable trading via GitHub Actions (optional)

To deploy **and** activate live trading in one step, trigger the
**Deploy & Real Trade** workflow from the GitHub Actions tab:

1. Go to your repository → **Actions** → **Deploy & Real Trade**
2. Click **Run workflow**

This workflow:
- Verifies Cloudflare credentials
- Applies the D1 migration
- Deploys the Worker
- Uploads secrets from GitHub repository secrets
- Enables live trading in KV

Required **GitHub repository secrets** (Settings → Secrets → Actions):

```
CLOUDFLARE_API_TOKEN      # needs Workers:Edit, D1:Edit, KV:Edit, R2:Edit
CLOUDFLARE_ACCOUNT_ID
ADMIN_TOKEN
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
MEXC_API_KEY              # only needed for live trading
MEXC_API_SECRET           # only needed for live trading
# ... other exchange keys as needed
```

---

## Architecture overview

```
index.js                  ← Cloudflare Worker entry point (Hono router + cron)
src/
  orchestrator.js         ← Scan-and-execute decision engine
  prices.js               ← Price feeds (MEXC, Binance, KuCoin, OKX, Bitget, Bitmart, 0x, Alchemy)
  exchange.js             ← Order placement (MEXC spot + futures, multi-exchange)
  db.js                   ← D1 helpers + Analytics Engine
  risk.js                 ← Kelly sizing + adaptive leverage
  dashboard.js            ← Web dashboard HTML
  strategies/
    cex.js                ← CEX spatial arbitrage
    dex.js                ← DEX cross-chain arbitrage (Ethereum ↔ BSC)
    perps.js              ← Perpetuals vs spot arbitrage
migrations/
  schema.sql              ← Canonical D1 schema (idempotent, safe to re-run)
.github/workflows/
  deploy.yml              ← Manual deploy + live-trading activation
  static.yml              ← GitHub Pages (public/ landing page)
```

---

## Monitoring

- **Dashboard**: `https://ultimate-arbitrage-hft.<subdomain>.workers.dev/`
- **Status API**: `/api/status`
- **Trades API**: `/api/trades`
- **Cron logs**: Cloudflare dashboard → Workers → ultimate-arbitrage-hft → Logs
- **Telegram**: Configure `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` for alerts
