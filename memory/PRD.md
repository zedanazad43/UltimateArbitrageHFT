# UltimateArbitrageHFT — Control Center Web App (PRD)

## Original Problem Statement
"Continue Ultimatearbitragehft Bot web App build"

## User Choices (from ask_human)
- Scope: Monitor + Control Center
- Stack: FastAPI + React + MongoDB (talks to Cloudflare Worker via HTTP later)
- Exchanges: All (Binance, KuCoin, MEXC, Bybit, OKX, Coinbase, Bitget)
- Symbols: BTC, ETH, SOL, XRP, BNB, ADA, DOGE, AVAX, LINK, MATIC (against USDT)
- Data: MOCK first, then wire real Cloudflare Worker endpoints
- Auth: Simple admin JWT login

## Architecture (current)
- Backend (FastAPI / Python 3) at `/app/backend/server.py`
  - Auth: bcrypt + PyJWT; admin seeded from `.env`
  - Background mock engine: `background_tick()` generates spreads, trades, logs every ~2s
  - Routes (all `/api`): `/health`, `/auth/login|logout|me`, `/bot/status|action|mode|config`, `/market/spreads|opportunities`, `/trades`, `/pnl`, `/wallet/balances`, `/logs`, `/telegram/config|test`
- Frontend (React 18 + Tailwind + Framer Motion + lucide-react + react-icons) at `/app/frontend/src/*`
  - Pages: Dashboard, Spreads, Trades, Wallet, Bot Config, Logs, Telegram
  - Design: dark "Performance Pro" archetype — `#050505` obsidian background, `#00E676` neon-green primary, Unbounded display / IBM Plex Sans body / JetBrains Mono numbers
  - AuthContext: stores JWT in `localStorage` as Bearer fallback (also accepts httpOnly cookie)
- MongoDB: stores admin user only (mock-state lives in-process)

## Implemented (2026-06-28)
- Full auth flow (login, /me, logout) with JWT
- Live Dashboard: bot status master control (Start/Stop/Restart, Paper↔Live), PnL widgets, Arbitrage Opportunities feed, Recent Trades
- Live Spreads table across 7 exchanges × 10 symbols with min-spread filter and cell flash on change
- Trades log page with cumulative PnL pill
- Wallet page: 7 exchange balance cards with grand total
- Bot Config page: min spread, max position, slippage, cooldown, auto-restart, allowed symbols, enabled exchanges
- Live Logs viewer (terminal aesthetic, INFO/WARN/ERROR color-coded)
- Telegram alerts page: save token/chat id, toggle alerts, test alert

## Testing
- iteration_1: 19/19 backend + 23/23 frontend passing

## Backlog (P0/P1/P2)
- **P0**: Wire real Cloudflare Worker endpoints (`WORKER_URL` + `WORKER_ADMIN_TOKEN` already in `.env`); add HTTPX adapter layer that falls back to mock when worker is unreachable
- **P1**: Persist trades/logs to MongoDB for history beyond in-memory buffer; add candlestick PnL chart on Dashboard (recharts already installed)
- **P1**: Per-exchange API key manager (encrypted at rest) UI + endpoints
- **P2**: WebSocket push from backend for sub-second spread updates (currently polling every 2s)
- **P2**: Strategy presets (Conservative / Balanced / Aggressive) one-click apply
- **P2**: Multi-user roles (admin / viewer); session list

## Next Actions
- Confirm with user, then plug in real Cloudflare Worker base URL + admin token.
