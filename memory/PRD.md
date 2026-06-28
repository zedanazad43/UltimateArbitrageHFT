# UltimateArbitrageHFT — Control Center Web App (PRD)

## Original Problem Statement
"Continue Ultimatearbitragehft Bot web App build"

## User Choices
- Scope: Monitor + Control Center
- Stack: FastAPI + React + MongoDB
- Exchanges: All (Binance, KuCoin, MEXC, Bybit, OKX, Coinbase, Bitget)
- Symbols: BTC, ETH, SOL, XRP, BNB, ADA, DOGE, AVAX, LINK, MATIC (against USDT)
- Data: MOCK first, real Cloudflare Worker integration with graceful fallback
- Auth: Simple admin JWT login
- Worker URL: `https://ecostamp.net` (currently returns Cloudflare error 1014 / 403 — fallback to mock is active)

## Architecture
- **Backend (FastAPI)** `/app/backend/`
  - `server.py` — all routes (auth, bot, market, trades, pnl, wallet, logs, telegram, exchange-keys, worker health)
  - `worker_client.py` — HTTPX adapter, auto-fallback to mock on non-2xx/timeout
  - `crypto_util.py` — Fernet (AES-128-CBC + HMAC) encrypt/decrypt/mask helpers
  - Mongo collections: `users`, `trades`, `engine_logs`, `exchange_keys`
  - Background loops: `background_tick()` (price scan / trade gen / log persist every 2s) and worker health probe
- **Frontend (React 18 + Tailwind + Framer Motion + lucide-react + react-icons)** `/app/frontend/src/`
  - Pages: Dashboard, Spreads, Trades, Wallet, **API Keys (encrypted vault)**, Bot Config, Logs, Telegram
  - Worker connectivity badge in header (`worker · live | 403 | off`)
  - Feed source indicator on Dashboard (`feed mock | live`)

## Implemented (Dates)
- **2026-06-28 — MVP**: Auth, Dashboard (master control, PnL, opportunities, recent trades), Spreads, Trades, Wallet, Bot Config, Logs, Telegram. Tested 19/19 backend + 23/23 frontend (iteration_1).
- **2026-06-28 — Phase 2**: Cloudflare Worker HTTPX bridge with mock fallback, MongoDB persistence for trades & logs (with `/trades/history` and `/logs/history`), encrypted per-exchange API-key manager (Fernet-encrypted, masked-only output). Tested 17/17 backend + full frontend regression (iteration_2).

## Worker Integration
- Reads `WORKER_URL`, `WORKER_ADMIN_TOKEN`, `WORKER_AUTH_SCHEME` from `backend/.env`
- Tries worker endpoints first: `/spreads`, `/balances`, `/control/{start|stop|restart}`, `/control/mode`, `/config`, `/health`
- On any non-2xx, timeout, or DNS error → silently falls back to local mock generator
- Source labeling: `bot_state["source"] = "worker" | "mock"` exposed via `/api/bot/status` and `/api/market/spreads`

## Encrypted API-Key Manager
- Frontend: 7-card grid (one per exchange), Add/Replace/Remove inline forms, passphrase field auto-shown for OKX/KuCoin/Coinbase
- Backend: Fernet ciphertext stored in `db.exchange_keys`, plaintext never returned (only `api_key_masked`, `api_secret_masked`, `has_passphrase` boolean)
- Validated by Mongo direct inspection in test — no plaintext leakage

## Testing
- iteration_1: 19/19 backend + 23/23 frontend (MVP)
- iteration_2: 17/17 backend + full frontend regression (worker bridge + persistence + key vault)

## Backlog
- **P1**: Use Worker for `/control/*` writes (already wired; awaiting reachable worker)
- **P1**: Per-key permissions (`read|trade|withdraw`) UI + enforcement
- **P1**: Historical PnL chart on Dashboard (recharts is installed)
- **P2**: WebSocket push from backend for sub-second updates
- **P2**: Multi-user roles + session list
- **P2**: Public read-only "profit share" page (no auth)
- **P2**: FastAPI lifespan + task cancellation; modularise server.py into routers as it grows
- **P2**: `aclose()` worker_client on shutdown

## Next Actions
- Fix `ecostamp.net` DNS/route binding on Cloudflare so the worker becomes reachable, then set `WORKER_ADMIN_TOKEN`; backend will switch source to `worker` automatically.
