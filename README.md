# ArbitrageBot

A collection of crypto arbitrage bots spanning Cloudflare Workers, Python, and unified JS/Python approaches.

## Sub-projects

| Directory | Runtime | Description |
|-----------|---------|-------------|
| [`UltimateArbitrageBot`](./UltimateArbitrageBot) | Cloudflare Workers (JS) | Full-featured HFT arbitrage worker with KV state, D1 trade history, Tail Worker alerts, Telegram integration, and AI confidence scoring |
| [`CloudflareArbitrageBot`](./CloudflareArbitrageBot) | Cloudflare Workers (JS) | Lightweight CF worker arbitrage bot |
| [`MegaArbitrageBot`](./MegaArbitrageBot) | Python | Multi-exchange Python bot (MEXC, Binance, Hyperliquid, Polymarket, on-chain via web3) |
| [`UnifiedArbitrageBot`](./UnifiedArbitrageBot) | JS + Python | Unified orchestrator combining JS and Python strategies |

---

## UltimateArbitrageBot (recommended)

The most complete implementation. Runs on [Cloudflare Workers](https://workers.cloudflare.com/) — no server required.

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- A Telegram bot token + chat ID for alerts (optional but recommended)

### Setup

```bash
cd UltimateArbitrageBot
npm install
npx wrangler login           # authenticate with Cloudflare
```

Create local secrets file (gitignored):

```bash
# UltimateArbitrageBot/.dev.vars
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
ADMIN_TOKEN=your_admin_token
```

### Deploy

```bash
npm run cf:set-admin-token          # generate + upload ADMIN_TOKEN secret
npm run cf:set-main-telegram        # upload Telegram secrets for main worker
npm run cf:set-tail-telegram        # upload Telegram secrets for tail worker
npm run deploy                      # deploy to Cloudflare Workers
npm run telegram:set-webhook        # register Telegram webhook
```

### Operate

```bash
npm run bot:health     # check deployed worker health
npm run bot:start      # enable trading
npm run bot:scan       # trigger a manual scan
npm run bot:stop       # disable trading
npm run bot:dashboard  # view dashboard HTML
```

### Test locally

```bash
npm run dev            # start local dev server
npm run test:powershell  # run PowerShell helper-script tests (requires pwsh)
```

---

## MegaArbitrageBot

Python bot supporting CEX (MEXC, Binance via ccxt) and on-chain (Hyperliquid, Polymarket, Metamask) strategies.

### Prerequisites

- Python ≥ 3.10
- pip

### Setup

```bash
cd MegaArbitrageBot
pip install -r requirements.txt
```

Copy and fill in your credentials (gitignored):

```bash
cp keys/api_keys.md keys/api_keys.txt   # then edit with real API keys
```

Key mapping inside `keys/api_keys.txt`:

- `MEXC`, `BINANCE`, `OKX`, `BITGET`, `HYPERLIQUID`, `POLYMARKET` → `API_KEY` + `API_SECRET`
- `BITMART` → `ACCESS_KEY` + `PRIVATE_KEY`
- `PRIMEXBT` → `CLIENT_ID` (optional metadata: `NAME`, `EMAIL`)
- `METAMASK` → `ADDRESS` (optional: `PRIVATE_KEY`)

Set environment variables before running:

```bash
export METAMASK_PRIVATE_KEY="0xYOUR_PRIVATE_KEY"
export METAMASK_ADDRESS="0xYOUR_WALLET_ADDRESS"
export TELEGRAM_BOT_TOKEN="your_bot_token"
export TELEGRAM_CHAT_ID="your_chat_id"
export ENABLE_REAL_TRADING="true"       # requires valid MEXC + BINANCE keys in keys/api_keys.txt
```

### Run

```bash
python final_ultimate_bot.py        # full multi-strategy bot
# or
python main_bot_with_telegram.py    # simpler bot with Telegram alerts
```

---

## CloudflareArbitrageBot

Minimal Cloudflare Worker arbitrage bot.

```bash
cd CloudflareArbitrageBot
npx wrangler login
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler deploy
```

---

## UnifiedArbitrageBot

Combined JS + Python orchestrator.

```bash
cd UnifiedArbitrageBot
pip install -r requirements.txt
# edit index.js or main.py to set your exchange credentials via environment variables
python main.py
```

---

## Security

**Never commit real credentials.** All secrets belong in:

- `UltimateArbitrageBot/.dev.vars` (Cloudflare Workers local dev)
- `MegaArbitrageBot/keys/api_keys.txt` (Python bot)
- Environment variables or `wrangler secret put` for production

Both files are listed in `.gitignore` and will not be committed.
