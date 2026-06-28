# UltimateArbitrageHFT — Control Center Web App (PRD)

## Original Problem Statement
"Continue Ultimatearbitragehft Bot web App build"

## User Choices
- Scope: Monitor + Control Center
- Stack: FastAPI + React + MongoDB
- Exchanges: All (Binance, KuCoin, MEXC, Bybit, OKX, Coinbase, Bitget)
- Symbols: BTC, ETH, SOL, XRP, BNB, ADA, DOGE, AVAX, LINK, MATIC (against USDT)
- Data: MOCK first, real Cloudflare Worker integration with graceful fallback
- Auth: JWT admin login + multi-user roles + CSRF protection
- Worker URL: `https://ecostamp.net` (Cloudflare 1014/403 — fallback to mock active)

## Architecture
- **Backend (FastAPI)** `/app/backend/`
  - `server.py` — all routes, FastAPI **lifespan** context (clean startup/shutdown, task cancellation, `worker_client.aclose()`)
  - `worker_client.py` — HTTPX adapter, auto-fallback to mock, `aclose()` for shutdown
  - `crypto_util.py` — Fernet (AES-128 + HMAC-SHA256) encrypt/decrypt/mask
  - Mongo collections: `users` (with `role: admin|viewer`), `trades`, `engine_logs`, `exchange_keys`
  - Background tasks: `background_tick()` (price/trade/log gen every 2s) and `worker_probe_loop()` (20s)
  - **CSRF middleware** — double-submit pattern: non-httpOnly `csrf_token` cookie + `X-CSRF-Token` header check on all state-changing `/api/*` calls. Pure-bearer (no cookies) CLI requests bypass automatically.
  - **Multi-user**: `admin` and `viewer` roles. `require_admin` dependency on all write/admin endpoints.
  - **Per-key permissions enforcement**: switching to LIVE mode or starting the bot in LIVE mode requires at least one enabled exchange with a stored API key that has `trade` permission. Returns 409 otherwise.
  - **Public stats endpoint** `/api/public/stats` — no auth, no CSRF; safe to share publicly.
- **Frontend (React 18 + Tailwind + Framer Motion + lucide-react + react-icons + recharts)** `/app/frontend/src/`
  - **Auth**: cookie-only (httpOnly + Secure `access_token`); NO localStorage. CSRF token auto-attached via axios interceptor (reads `csrf_token` cookie, sets `X-CSRF-Token` header).
  - **Pages**: Dashboard (with **PnL historical chart** 6h/24h/72h/168h), Spreads, Trades, Wallet, API Keys (encrypted vault + per-key permission badges & editor), Bot Config, Logs, Telegram, **Users** (admin-only), **Share** (public, no auth).
  - **Layout**: worker connectivity badge, feed source indicator, **admin-gated sidebar items**, role pill in operator card, Open Public Share link.
  - Viewer role: controls/buttons disabled at HTML level + sidebar items hidden.

## Implemented (Dates)
- **2026-06-28 MVP** — 19/19 backend + 23/23 frontend (iteration_1)
- **2026-06-28 Phase 2** — Worker bridge + Mongo persistence + encrypted key vault — 17/17 + full e2e (iteration_2)
- **2026-06-28 Code review fixes** — XSS-hardened (no localStorage), env-driven test creds, console.error in catch blocks — 17/17 + full regression (iteration_3)
- **2026-06-28 Phase 3** — CSRF, multi-user roles, per-key trade-permission enforcement, PnL chart, public share page, FastAPI lifespan + graceful worker shutdown — 17/17 backend + full frontend (iteration_4)

## Backlog (P1/P2)
- **P1** Wire Cloudflare Worker once `ecostamp.net` DNS/route binding is fixed and a real `WORKER_ADMIN_TOKEN` is provided
- **P1** Live exchange connectivity test endpoint (call exchange `/account` via worker) — show real-time green/red on API Keys cards
- **P2** Split `server.py` into per-feature routers (auth, bot, market, users, keys, public)
- **P2** Token revocation list (invalidate JWT on password change / role change)
- **P2** WebSocket push for sub-second updates
- **P2** Strategy presets (Conservative / Balanced / Aggressive)
- **P2** Hoist `bot_state` / `pnl_state` to Mongo for multi-node scale-out

## Next Actions
- Fix `ecostamp.net` Cloudflare routing to make worker reachable and supply `WORKER_ADMIN_TOKEN` — backend auto-switches to live data.

## Test Reports
- `/app/test_reports/iteration_{1,2,3,4}.json`
- `/app/backend/tests/test_iteration{2,4}.py` (regression suites; rerunnable + self-cleaning)
