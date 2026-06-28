# UltimateArbitrageHFT — Control Center Web App (PRD)

## Original Problem Statement
"Continue Ultimatearbitragehft Bot web App build"

## User Choices
- Scope: Monitor + Control Center
- Stack: FastAPI + React + MongoDB; talks to Cloudflare Worker (`https://ecostamp.net`) via HTTPX
- Exchanges: All major (Binance, KuCoin, MEXC, Bybit, OKX, Coinbase, Bitget)
- Symbols: BTC, ETH, SOL, XRP, BNB, ADA, DOGE, AVAX, LINK, MATIC (vs USDT)
- Data: Mock with graceful fallback; will use real worker data when the Cloudflare domain routing is fixed
- Auth: Admin JWT login

## Architecture
- **Backend** (`/app/backend/`)
  - `server.py` — FastAPI app: auth, bot control, market, trades, pnl, wallet, logs, telegram, **exchange-keys vault**, **worker health proxy**
  - `worker_client.py` — async HTTPX adapter (2s connect/4s total timeout, Bearer auth), returns `None` on any failure so callers fall back to mock
  - `crypto_util.py` — Fernet (AES-128-CBC + HMAC-SHA256) `encrypt/decrypt/mask`
  - Background tasks: `background_tick()` (mock engine), `worker_probe_loop()` (refreshes reachability every 20s)
  - Mongo collections: `users`, `exchange_keys` (encrypted), `trades` (persistent history), `engine_logs`
- **Frontend** (`/app/frontend/src/`)
  - Pages: Dashboard, Spreads, Trades, Wallet, Config, **API Keys**, Logs, Telegram
  - Header status pill shows `worker · live | worker · 403 | worker · off`
  - Design: dark "Performance Pro" — `#050505` + `#00E676` neon-green primary, Unbounded/IBM Plex Sans/JetBrains Mono

## Implemented
- **2026-06-28 (iter 1)**: Full MVP — auth, dashboard, spreads, trades, wallet, config, logs, telegram. 19/19 + 23/23 tests passed.
- **2026-06-28 (iter 2)**: HTTPX Cloudflare-Worker adapter w/ graceful mock fallback; MongoDB persistence for trades + engine logs (with `/trades/history` & `/logs/history` endpoints); encrypted per-exchange API-key vault (Fernet) with add/replace/delete + masked display + passphrase support for KuCoin/OKX/Coinbase. Header worker indicator. **17/17 backend + full frontend e2e passed**.

## Auth Credentials
See `/app/memory/test_credentials.md` — `admin@arbhft.io` / `Admin@123`.

## Current State
- Worker bridge configured for `https://ecostamp.net` but Cloudflare returns 403 (error 1014: CNAME Cross-User Banned). System gracefully serves mock data and shows `worker · 403` pill in header. **The moment DNS/Routes are fixed for that domain in your Cloudflare account, real data flows automatically with no code change.**

## Backlog
- **P0**: Once Worker is reachable, map exact endpoint names (`/status`, `/spreads`, `/opportunities`, `/control/start|stop|restart`, `/control/mode`, `/balances`, `/config`) to whatever the Worker actually exposes (we may need to rename a few).
- **P1**: PnL candlestick chart on Dashboard (recharts is installed)
- **P1**: Switch to FastAPI `lifespan` and properly cancel background tasks on shutdown; close worker httpx client
- **P1**: Move secrets/Mongo URL to a secure vault (currently env-stored)
- **P2**: WebSocket push from backend (sub-second updates)
- **P2**: Strategy presets (Conservative/Balanced/Aggressive)
- **P2**: Multi-user roles (admin/viewer)
- **P2**: Modularise `server.py` into routers (auth/bot/market/keys/telegram)

## Next Actions
- Fix Cloudflare DNS for `ecostamp.net` so the Worker actually serves traffic; then confirm endpoint names match the adapter map (or share the routes and we'll align).
