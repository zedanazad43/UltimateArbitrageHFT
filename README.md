# UltimateArbitrageHFT

Deployed Cloudflare Worker: `arbitrage-bot`
Live URL: <https://arbitrage-bot.zedanazad43.workers.dev>

---

## Prerequisites — do these ONCE before first deploy

### 1. Cloudflare API Token

The deploy workflow authenticates to Cloudflare via the `CLOUDFLARE_API_TOKEN` GitHub secret.

**Create / fix the token** (Cloudflare dashboard → My Profile → API Tokens):
- Click **Create Token** (or edit an existing one)
- Required permissions: **Workers Scripts: Edit**, **D1: Edit**, **KV Storage: Edit**, **Account: Read**
- ⚠️ **Remove any "Client IP Address Filtering" restriction** — GitHub Actions runners use dynamic IPs and will be blocked otherwise (error code 9109)

### 2. GitHub Secrets

Add these in your repo → Settings → Secrets and variables → Actions → **New repository secret**:

| Secret name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token (see above) |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID (from wrangler.toml or dashboard) |
| `ADMIN_TOKEN` | Any strong random string — used to authorize `/start`, `/stop`, etc. |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token (optional — for alerts) |
| `TELEGRAM_CHAT_ID` | Telegram chat/group ID (optional) |
| `MEXC_API_KEY` + `MEXC_API_SECRET` | MEXC exchange keys (needed for live execution) |
| `BINANCE_API_KEY` + `BINANCE_API_SECRET` | Binance keys (optional) |
| `OKX_API_KEY` + `OKX_API_SECRET` + `OKX_PASSPHRASE` | OKX keys (optional) |
| `KUCOIN_API_KEY` + `KUCOIN_SECRET_KEY` + `KUCOIN_PASSPHRASE` | KuCoin keys (optional) |
| `BITGET_API_KEY` + `BITGET_SECRET_KEY` + `BITGET_API_PASSPHRASE` | Bitget keys (optional) |
| `BITMART_API_KEY` + `BITMART_SECRET_KEY` + `BITMART_MEMO` | Bitmart keys (optional) |

---

## Deploy (publish for real trading)

```
# From GitHub Actions tab → "Deploy & Real Trade" → Run workflow
```

The workflow will:
1. Verify Cloudflare credentials (fails fast with a clear error if token is wrong)
2. Apply the D1 database migration
3. Deploy the Cloudflare Worker
4. Upload all exchange secrets to the Worker
5. Enable live trading mode in KV

---

## Local development

```bash
npm install
npm test          # unit tests (must all PASS)
npm run dev       # local wrangler dev
```

## Monitoring

- **Telegram**: send `/status` or `/scan` to your bot
- **Dashboard**: <https://arbitrage-bot.zedanazad43.workers.dev>
- **Logs**: `npm run tail` or Cloudflare dashboard → Workers → arbitrage-bot → Logs

## Security

Secrets (`api_keys.txt`, `.env`) **must not** be committed — see `.gitignore`.
`ADMIN_TOKEN` must be set before the worker will accept admin commands.
