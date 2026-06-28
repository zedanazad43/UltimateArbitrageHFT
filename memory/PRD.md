# UltimateArbitrageHFT — Control Center Web App (PRD)

## Original Problem Statement
"Continue Ultimatearbitragehft Bot web App build" + iterative expansion via "execute all of it" + "GO"

## User Choices
- Stack: FastAPI + React + MongoDB + Cloudflare Worker bridge (mock fallback)
- Auth: JWT cookie-only + CSRF double-submit + multi-user roles + JWT revocation
- Worker URL: `https://ecostamp.net` (Cloudflare 1014/403 — mock fallback active)

## Architecture
- **Backend** `/app/backend/`
  - `server.py` (~1400 lines), `worker_client.py`, `crypto_util.py`
  - **Mongo**: `users` (`role`, `token_version`), `trades`, `engine_logs`, `exchange_keys`, `alert_rules` (`last_fired_at`), `alert_events`, `runtime_state`, `ab_lanes`, **`audit_log`**
  - **Background tasks** (FastAPI lifespan, cancelled cleanly on shutdown): `background_tick` (2s; price scan + alert eval + A/B simulator), `worker_probe_loop` (20s), `state_persistence_loop` (15s snapshot)
  - **Security**: CSRF double-submit, role-based deps, per-key trade-permission enforcement, encrypted-at-rest keys, **JWT revocation via `token_version`** (bumped on password / role change), **audit log** captures actor + action + details (login success/fail, bot.*, ab.*, user.update)
  - Restart-safe alert cooldown: `last_fired_at` persisted on rules; hydrated on startup (timezone-aware coerce)

- **Frontend** `/app/frontend/src/` — React 18 + Tailwind + Framer Motion + lucide-react + recharts
  - Cookie-only JWT, CSRF auto-attached interceptor
  - Pages: Dashboard (PnL chart), Spreads, Trades, Wallet, API Keys (vault + permissions editor + connectivity test), Bot Config (presets + risk), **A/B Test**, Alerts, Users, **Audit Log**, Logs, Telegram, Share (public)
  - Admin-gated nav + disabled controls for viewer role

- **Cloudflare Worker** `/app/ArbitrageBots/ultimate-arbitrage-hft/index.js` (~960 lines)
  - **OPTIMIZED**: `scanAndExecute` now parallelizes the symbol loop via `Promise.allSettled` — total scan latency = slowest (symbol × source) pair, not the sum. Expected ~15× lower decision latency.
  - Added `fetchWithTimeout` (350ms AbortSignal) so one slow exchange can't stall a cycle.
  - Removed pointless Durable-Object round-trip from `getPrice` (~30-80ms saved per MEXC call).
  - `MAX_TRADES_PER_SCAN` config knob — pick top-N opportunities per cycle (default 1).
  - Tighter `cf: { cacheTtl: 1 }` (was 2) for fresher data.

## Implemented Phases
1. **MVP** — auth + 7 core pages (iter_1: 19/19 + 23/23 ✅)
2. **Worker bridge + Mongo persistence + encrypted key vault** (iter_2: 17/17 + e2e ✅)
3. **Code-quality hardening**: no localStorage, env-driven creds, no silent catches (iter_3: 17/17 ✅)
4. **CSRF + roles + permission enforcement + PnL chart + Public share + lifespan** (iter_4: 17/17 + e2e ✅)
5. **Alert engine + Strategy presets + Exchange-key test + Runtime persistence** (iter_5: 30/30 + e2e ✅)
6. **Worker speed-up + JWT revocation + Audit log + Persisted alert cooldowns + Strategy A/B mode** (iter_6: 40/40 backend + e2e ✅)

## Backlog (P2/P3)
- **P2** Modularize `server.py` into per-feature routers (1400 lines now)
- **P2** `to_utc()` helper across the codebase (timezone-coerce pattern flagged in iter_6 RCA)
- **P2** Audit `_audit()` should `add_log` on its own exception path (currently silent)
- **P2** WebSocket push (deferred — risky in this preview env)
- **P3** Real Cloudflare Worker integration — requires user to fix `ecostamp.net` DNS/route binding + provide `WORKER_ADMIN_TOKEN`
- **P3** Real Telegram delivery — requires bot_token + chat_id

## Git Sync
- Repo: `zedanazad43/UltimateArbitrageHFT` on branch `copilot/activate-control-center-and-telegram-bot`
- ⚠️ User exposed two GitHub PATs in chat — must rotate immediately at https://github.com/settings/tokens
- Push: use **"Save to GitHub"** button in the chat input. Recommend a new branch `ai/speed-and-features`.

## Test Reports
- `/app/test_reports/iteration_{1..6}.json`
- `/app/backend/tests/test_iteration{2,4,5,6}.py` (rerunnable suites)
