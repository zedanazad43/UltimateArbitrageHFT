# ArbitrageBot

A collection of crypto arbitrage bots spanning Cloudflare Workers, Python, and unified JS/Python approaches.

## ⚡ One-Command Activation (PowerShell 7+)

The fastest way to deploy everything and start live trading:

```powershell
# From the repo root:
cd UltimateArbitrageBot && npx wrangler login   # 1. Authenticate with Cloudflare (once)
cd ..

# 2. Full activation — deploys worker, uploads all secrets, registers Telegram
#    webhook, and starts the bot in LIVE trading mode:
.\Deploy-All.ps1

# Or use npm:
npm run deploy:all         # live trading
npm run deploy:all:paper   # paper/simulation mode
npm run deploy:all:skip-deploy  # re-configure only (worker already deployed)
```

`Deploy-All.ps1` will interactively prompt for any missing values and walk through each step. You can also pre-fill everything:

```powershell
.\Deploy-All.ps1 `
    -MexcApiKey     "mx0vg..." `
    -MexcApiSecret  "abc123..." `
    -TelegramBotToken "7654321:AAx..." `
    -TelegramChatId   "111111111" `
    -AdminToken       "your_token"
```

After completion, open: **https://ultimate-arbitrage-hft.zedanazad43.workers.dev**

---

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
- [PowerShell 7+](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell) (`pwsh`)
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
MEXC_API_KEY=your_mexc_api_key
MEXC_API_SECRET=your_mexc_api_secret
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
ADMIN_TOKEN=your_admin_token
```

### Deploy (step-by-step)

```bash
npm run cf:set-admin-token          # generate + upload ADMIN_TOKEN secret
npm run cf:set-mexc                 # upload MEXC API keys
npm run cf:set-main-telegram        # upload Telegram secrets for main worker
npm run cf:set-tail-telegram        # upload Telegram secrets for tail worker
npm run deploy                      # deploy to Cloudflare Workers
npm run telegram:set-webhook        # register Telegram webhook
npm run bot:mode:live               # switch to live trading mode
npm run bot:start                   # start the bot
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
- PowerShell ≥ 7 (`pwsh`) — for the setup/run scripts

### Setup (PowerShell — recommended)

```powershell
cd MegaArbitrageBot
pip install -r requirements.txt

# Interactive: prompts for all Telegram + Control Center values, then writes MegaArbitrageBot/.env
.\scripts\setup-telegram-control.ps1

# Or supply values directly (CI / scripted):
.\scripts\setup-telegram-control.ps1 `
  -BotToken         "7654321:AAxxxxxx" `
  -PrimaryChatId    "111111111" `
  -AdminChatIds     "111111111" `
  -ControlCenterUrl "https://ultimate-arbitrage-hft.zedanazad43.workers.dev" `
  -AdminToken       "your_admin_token"
```

From the repository root you can also use the npm convenience scripts:

```bash
npm run mega:setup    # run setup-telegram-control.ps1 (interactive)
npm run mega:run      # run-telegram-bot.ps1 (load .env + launch bot)
npm run mega:test     # test-telegram-control.ps1 (verify connectivity)
npm run mega:test:powershell  # run the Pester test suite
```

### Setup (manual / bash)

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

Set environment variables before running (or put them in `MegaArbitrageBot/.env`):

```bash
export METAMASK_PRIVATE_KEY="0xYOUR_PRIVATE_KEY"
export METAMASK_ADDRESS="0xYOUR_WALLET_ADDRESS"
export TELEGRAM_BOT_TOKEN="your_bot_token"
export TELEGRAM_CHAT_ID="your_chat_id"
export TELEGRAM_ADMIN_CHAT_IDS="your_chat_id,123456789"   # only these IDs can run commands
export TELEGRAM_NOTIFY_CHAT_IDS="your_chat_id,987654321"  # optional extra alert receivers
export CONTROL_CENTER_BASE_URL="https://ultimate-arbitrage-hft.zedanazad43.workers.dev"
export CONTROL_CENTER_ADMIN_TOKEN="your_admin_token"
export ENABLE_REAL_TRADING="true"       # requires valid MEXC + BINANCE keys in keys/api_keys.txt
```

If `TELEGRAM_ADMIN_CHAT_IDS` is empty, the bot falls back to `TELEGRAM_CHAT_ID` as the only admin.

### PowerShell scripts

| Script | Purpose |
|--------|---------|
| `scripts/setup-telegram-control.ps1` | Interactive/scripted `.env` writer for all Telegram + Control Center vars |
| `scripts/run-telegram-bot.ps1` | Load `.env`, activate venv if present, run `main_bot_with_telegram.py` |
| `scripts/test-telegram-control.ps1` | Smoke-test Telegram bot token validity + `/status` endpoint connectivity |
| `scripts/run-powershell-tests.ps1` | Run the Pester unit test suite for the helper scripts |

### Run

```powershell
# After running setup-telegram-control.ps1:
.\scripts\run-telegram-bot.ps1

# Or directly:
python main_bot_with_telegram.py    # Telegram alerts + Telegram command center proxying web control APIs
```

Telegram admin commands supported in `main_bot_with_telegram.py`:

- `/status`
- `/dashboard`
- `/start` (or `/startbot`)
- `/stop` (or `/stopbot`)
- `/scan`
- `/live`
- `/paper`
- `/help`

Live trading is never auto-enabled by default; it must be explicitly switched to `/live` by an authorized admin and then started.

Safe activation sequence for real trading:

1. `/status` (verify bot is reachable)
2. `/paper` (confirm paper mode first)
3. `/live` (switch mode intentionally)
4. `/start` (enable trading loop)
5. `/status` (confirm live + enabled state)

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
# copy live-trading config template and set real API keys
cp .env.example .env
python main.py
```

Pre-configured exchanges in `UnifiedArbitrageBot/main.py`:

- `MEXC` (enabled by default)
- `Binance` (enable with `ENABLE_BINANCE_ARBITRAGE=true`)

Set exchange API credentials in `UnifiedArbitrageBot/.env`:

- `MEXC_API_KEY`, `MEXC_SECRET_KEY`
- `BINANCE_API_KEY`, `BINANCE_SECRET_KEY`

Live-trading mode and risk controls are controlled by:

- `TEST_MODE=false`
- `ENABLE_REAL_TRADING=true`
- `MAX_POSITION_SIZE_USD`
- `MAX_DAILY_TRADES`
- `MAX_DAILY_LOSS_USD`
- `MIN_SECONDS_BETWEEN_TRADES`

For monitoring, the bot already logs:

- Executed/simulated trades and errors to stdout and `logs/bot.log`
- Periodic exchange balances (USDT) every `BALANCE_LOG_INTERVAL_SCANS` scans

Recommended rollout:

1. Start with very small capital that still satisfies exchange minimum order sizes.
   For example, set `MAX_POSITION_SIZE_USD=10` after checking each exchange's minimum order rules in their docs or test environment.
2. Run continuously on a reliable host (local tmux/screen, VPS, or cloud VM).
3. Watch `logs/bot.log` and balance snapshots for at least 24-72 hours.
4. Increase position size gradually only after stable, safe behavior.

---

## Security

**Never commit real credentials.** All secrets belong in:

- `UltimateArbitrageBot/.dev.vars` (Cloudflare Workers local dev)
- `MegaArbitrageBot/keys/api_keys.txt` (Python bot)
- Environment variables or `wrangler secret put` for production

Both files are listed in `.gitignore` and will not be committed.
