# UltimateArbitrageHFT — Control Center Web App (PRD)

## Original Problem Statement
"Continue Ultimatearbitragehft Bot web App build"

## User Choices
- Scope: Monitor + Control Center
- Stack: FastAPI + React + MongoDB
- Exchanges: All (Binance, KuCoin, MEXC, Bybit, OKX, Coinbase, Bitget)
- Symbols: BTC, ETH, SOL, XRP, BNB, ADA, DOGE, AVAX, LINK, MATIC (against USDT)
- Data: MOCK + Cloudflare Worker bridge w/ graceful fallback
- Auth: JWT (cookie-only, no localStorage) + CSRF double-submit + multi-user roles
- Worker URL: `https://ecostamp.net` (Cloudflare 1014/403 — mock fallback active)

## Architecture
- **Backend (FastAPI)** `/app/backend/`
  - `server.py` — all routes, FastAPI lifespan (startup/shutdown w/ task cancellation, `worker_client.aclose()`, runtime-state hydration)
  - `worker_client.py` — HTTPX adapter w/ `aclose()`
  - `crypto_util.py` — Fernet (AES-128 + HMAC-SHA256) encrypt/decrypt/mask
  - **Mongo collections**: `users` (`role: admin|viewer`), `trades`, `engine_logs`, `exchange_keys`, `alert_rules`, `alert_events`, `runtime_state`
  - **Background tasks**: `background_tick` (price scan + alert evaluator every 2s), `worker_probe_loop` (20s), `state_persistence_loop` (15s snapshot of bot_state/config/pnl/telegram → `db.runtime_state`)
  - **Security**: CSRF double-submit middleware, role-based `require_admin` dependency, per-key trade-permission enforcement before LIVE mode, encrypted-at-rest secrets

- **Frontend (React 18 + Tailwind + Framer Motion + lucide-react + recharts)** `/app/frontend/src/`
  - Pages: Dashboard (with PnL chart), Spreads, Trades, Wallet, **API Keys** (encrypted vault, permissions editor, connectivity Test button), **Bot Config** (Strategy Presets + Risk/Symbols/Exchanges), Logs, Telegram, **Alerts** (rule engine + event history), **Users**, **Share** (public, no auth)
  - Cookie-only JWT + CSRF auto-attached interceptor; viewer role hides admin nav and disables controls

## Implemented Phases
1. **MVP** — auth + 7 core pages (iteration_1: 19/19+23/23 ✅)
2. **Worker bridge + Mongo persistence + encrypted key vault** (iteration_2: 17/17 + e2e ✅)
3. **Code-quality fixes**: no localStorage, env-driven creds, console.error in catch blocks (iteration_3: 17/17 + regression ✅)
4. **CSRF + roles + permission enforcement + PnL chart + Public share + lifespan** (iteration_4: 17/17 + e2e ✅)
5. **Alert rules engine + Strategy presets + Exchange-key connectivity test + Runtime-state persistence** (iteration_5: **30/30** backend pytest + e2e ✅ after one frontend follow-up)

## Backlog
- **P2** Split `server.py` into per-feature routers (~1240 lines now)
- **P2** Persist `_alert_last_fired` to Mongo so post-restart cooldowns survive (prevent alert storm)
- **P2** Token revocation list (invalidate JWT on password/role change)
- **P2** WebSocket push for sub-second updates
- **P3** Real Cloudflare Worker integration (requires user to fix `ecostamp.net` DNS/route binding + provide `ADMIN_TOKEN`)
- **P3** Real Telegram delivery (requires user's bot_token + chat_id; mocked endpoint already in place)

## Test Reports
- `/app/test_reports/iteration_{1,2,3,4,5}.json`
- `/app/backend/tests/test_iteration{2,4,5}.py` (rerunnable pytest suites)
