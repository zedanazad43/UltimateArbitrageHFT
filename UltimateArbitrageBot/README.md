# Ultimate Arbitrage Bot

Cloudflare Workers based arbitrage bot with a main worker, a tail worker for error notifications, KV state storage, D1 trade history, and scheduled scans.

## Workers

- Main worker: `ultimate-arbitrage-hft`
- Tail worker: `ultimate-arbitrage-tail`

## Main scripts

- `npm run bot:health`: query deployed worker health
- `npm run bot:status`: query deployed worker status JSON
- `npm run bot:dashboard`: fetch deployed dashboard HTML
- `npm run bot:start`: enable trading on the deployed worker
- `npm run bot:scan`: trigger a manual scan on the deployed worker
- `npm run bot:stop`: disable trading on the deployed worker
- `npm run bot:test-alert`: trigger a protected intentional failure to verify Tail Worker alerts
- `npm run dev`: local main worker development
- `npm run deploy`: deploy main worker
- `npm run cf:check`: dry-run deploy validation
- `npm run cf:set-admin-token`: generate and upload a fresh `ADMIN_TOKEN` secret
- `npm run cf:set-main-telegram`: upload Telegram secrets for the main worker
- `npm run cf:set-tail-telegram`: upload Telegram secrets for the tail worker
- `npm run telegram:test-webhook`: simulate a Telegram webhook request locally against the deployed worker
- `npm run telegram:set-webhook`: register the deployed worker as Telegram webhook receiver
- `npm run telegram:set-allowed-chats -- -ChatIds "YOUR_CHAT_ID,123456789"`: update authorized Telegram chats in `wrangler.toml`
- `npm run ai:confidence-40`: set `MIN_CONFIDENCE_SCORE=40` in `wrangler.toml` and deploy
- `npm run ai:history-20`: set `MIN_HISTORY_POINTS=20` in `wrangler.toml` and deploy
- `npm run ai:aggressive`: set `MIN_CONFIDENCE_SCORE=30` in `wrangler.toml` and deploy
- `npm run ops:validate`: run the non-destructive operational script checks end-to-end
- `npm run test:powershell`: run the local PowerShell Pester suite for helper scripts
- `npm run d1:migrate:local`: apply local D1 migrations
- `npm run d1:migrate:remote`: apply remote D1 migrations
- `npm run tail:dev`: local tail worker development
- `npm run tail:deploy`: deploy tail worker

## VS Code stable tasks

Use the `stable:` tasks in `.vscode/tasks.json` as the canonical VS Code entry points for routine operations:

- `stable: bot health`
- `stable: bot start`
- `stable: bot scan`
- `stable: bot stop`
- `stable: telegram status`
- `stable: telegram snapshot`
- `stable: telegram ops`
- `stable: telegram history`
- `stable: telegram rejected`
- `stable: deploy worker`
- `stable: test powershell`

These tasks are the preferred VS Code workflow even when equivalent `npm` scripts also exist.

## Script helpers

- The PowerShell scripts under `scripts/` now share `scripts/common.ps1` for `.dev.vars` loading, environment resolution, and config-path handling.
- `invoke-admin-action.ps1` prefers `x-admin-token` and `Authorization: Bearer <token>` for protected calls. Use `-UseQueryToken` only when a query-string token is explicitly needed.
- `set-admin-token.ps1` supports `-SkipUpload` for local validation and `-ConfigPath` for alternate Wrangler configs.
- `set-telegram-secrets.ps1` supports explicit `-BotToken` and `-ChatId` overrides plus `-SkipUpload` for non-destructive checks.
- `set-telegram-webhook.ps1` resolves `TELEGRAM_BOT_TOKEN` from argument, environment, or `.dev.vars`, and supports `-DropPendingUpdates` and optional `-SecretToken`.
- `test-telegram-webhook.ps1` resolves `TELEGRAM_CHAT_ID` from argument, environment, or `.dev.vars` and builds a fuller Telegram-like payload for command validation.
- `set-allowed-chats.ps1` normalizes duplicate chat IDs before updating `wrangler.toml`.

## Required secrets

Main worker secrets:

- `MEXC_API_KEY`
- `MEXC_API_SECRET`
- `DEX_WALLET_ADDRESS`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `ADMIN_TOKEN`

Tail worker secrets:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

## Control endpoints

- `GET /health`: health and runtime readiness
- `GET /status`: alias of `/health` for status checks and bot control integrations
- `GET /dashboard`: runtime dashboard
- `GET /start?token=...`: enable trading
- `GET /stop?token=...`: disable trading
- `GET /scan?token=...`: trigger a manual scan
- `GET /debug/fail?token=...`: trigger an intentional failure for Tail Worker alert testing
- `POST /telegram/webhook`: receive Telegram bot commands

You can also call protected endpoints with the `x-admin-token` header or `Authorization: Bearer <token>`.

## Deployment flow

1. `npm install`
2. `npm run cf:set-admin-token`
3. Upload main worker secrets using Wrangler or your dashboard
4. `npm run cf:set-tail-telegram`
5. `npm run d1:migrate:local`
6. `npm run cf:check`
7. `npm run deploy`
8. `npm run tail:deploy`

## Local validation

1. Add local secrets to `.dev.vars` when you want non-interactive script execution.
2. Run `npm run ops:validate` to verify `health`, webhook testing, secret-helper dry runs, and `ALLOWED_CHAT_IDS` normalization without mutating live secrets.
3. Run `npm run test:powershell` for deterministic helper-script tests that do not require live secret mutation.
4. Use `npm run bot:start`, `npm run bot:scan`, and `npm run bot:stop` for a manual live control cycle after deployment.

## Notes

- Trading is disabled by default until `/start` is called with a valid admin token.
- The main worker self-heals the `trades` table in D1 if the schema is missing.
- The main worker forwards logs to the tail worker through `tail_consumers`.
- Administrative actions (`start`, `stop`, `scan`) are stored in D1 under `admin_events` and shown on the dashboard.
- The tail worker also exposes a simple fetch health response and truncates oversized Telegram messages safely.
- `DEBUG_ALERTS_ENABLED` must be set to `true` before `/debug/fail` can be used in production.
- `ALLOWED_CHAT_IDS` can be set as a comma-separated list to authorize multiple Telegram chats.
- DEX arbitrage now evaluates a net edge after estimated MEXC fee, slippage, gas cost, latency, and a safety buffer instead of relying on a raw spread only.
- DEX arbitrage also confirms the signal across multiple ParaSwap samples before accepting it, using pass-count and max-drift thresholds to reject unstable quotes.
- DEX thresholds are now stricter by default and adapt per market from recent best-opportunity history, rejected candidates, and cooldown streaks.
- Perps thresholds now adapt per market as well, using recent best-opportunity history, rejected candidates, and cooldown streaks instead of one static basis threshold for every symbol, with stricter base defaults (`edge 0.28`, `confidence 69`, `expected pnl $0.45`, `stress shock 0.07`).
- Cooldown protection can now be relieved automatically when a new signal materially exceeds the configured edge, confidence, and expected-PnL thresholds instead of blindly skipping the market.
- A new `Perps` paper strategy scans a rotation-aware MEXC spot/perpetual universe, combines basis plus live `fundingRate`, and now biases toward the dynamic `pair rotation` shortlist instead of a fixed three-symbol set.
- A KV-backed market regime filter tracks short rolling price history and blocks or penalizes signals during turbulent conditions before paper execution.
- Spot scanning now builds a dynamic `pair rotation` shortlist from the tracked universe, uses it to pick actual DEX and Perps candidates, and exposes it through `/pairs` and the dashboard.
- The dashboard now shows KPI cards, a dedicated `DEX Snapshot`, a separate `Perps Snapshot`, pair rotation shortlist, mini-charts sourced from KV/D1, and forward-paper daily analytics.
- ParaSwap quote handling is normalized from the returned `priceRoute` payload, which prevents null `destAmount` failures when evaluating DEX candidates.
- Market price snapshots are now written to D1 `price_history`, so dashboard mini-charts can use a longer history than the short KV rolling window.
- `PAPER_TRADING` is enabled by default so strong signals are simulated and logged instead of placing live orders.
- Telegram commands supported through webhook are `/help`, `/status`, `/dashboard`, `/config`, `/runtime`, `/strategy`, `/perps`, `/leaderboard`, `/pairs`, `/analytics`, `/lastalert`, `/profit`, `/trades`, `/events`, `/startbot`, `/stopbot`, and `/scan` for authorized chats only. `/strategy` now reports the latest DEX snapshot only, independently from the Perps snapshot.
