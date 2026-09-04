# Environment Variable Reference

> **Single source of truth** for every configuration variable in UltimateArbitrageHFT.
> Each variable is listed once, with its owner, how it is set, and whether it is required or optional.

---

## Quick-start guides

| Environment | Setup file | Purpose |
|---|---|---|
| Cloudflare Worker (production) | `wrangler.toml` + `wrangler secret put` | Live/paper trading |
| Cloudflare Worker (local dev) | `.dev.vars` (copy from `.dev.vars.example`) | Local `wrangler dev` |
| Go HFT engine | `.env` in `hft/` (copy from `hft/.env.example`) | Standalone Go engine |
| Local AI | `.env.local` (copy from `.env.local.example`) | CodeGeeX / local LLM |
| Proxy gateway | env vars on the host (see `proxy-gateway/README.md`) | Node.js proxy service |

---

## 1 — Cloudflare Worker: plain vars (`wrangler.toml [vars]`)

These are **non-secret** configuration values. They live in `wrangler.toml` under `[vars]`
and are exposed as properties on the `env` object inside the Worker.

### 1.1 Temporal Cloud

| Variable | Default | Description |
|---|---|---|
| `TEMPORAL_NAMESPACE` | `default` | Temporal Cloud namespace |
| `TEMPORAL_ADDRESS` | `""` | gRPC endpoint, e.g. `default.abc.tmprl.cloud:7233`. Leave blank for local dev server. |
| `TEMPORAL_WORKER_URL` | deployed Worker URL | URL the Temporal worker calls back to |

### 1.2 Go HFT engine connection

| Variable | Default | Description |
|---|---|---|
| `HFT_ENGINE_URL` | `""` | Base URL of the running Go engine, e.g. `https://hft-engine.<acct>.workers.dev`. Leave blank to disable. |

### 1.3 Ecosystem integrations (remote execution endpoints)

All `*_EXECUTE_URL` and `*_STATUS_URL` vars are optional. Leave blank to disable that integration.

| Variable | Description |
|---|---|
| `HUMMINGBOT_EXECUTE_URL` | |
| `HUMMINGBOT_STATUS_URL` | |
| `FREQTRADE_EXECUTE_URL` | |
| `FREQTRADE_STATUS_URL` | |
| `CREWAI_EXECUTE_URL` | |
| `CREWAI_STATUS_URL` | |
| `AUTOGPT_EXECUTE_URL` | |
| `AUTOGPT_STATUS_URL` | |
| `EXECUTIVE_LOCAL_ADAPTERS` | `"true"` — enable built-in local adapter stubs |

### 1.4 Proxy routing

| Variable | Canonical name | Alias accepted | Default | Description |
|---|---|---|---|---|
| `PROXY_MODE` | `PROXY_MODE` | — | `auto` | `auto` / `off` / `required` |
| `PROXY_FALLBACK_URL` | `PROXY_FALLBACK_URL` | `PROXY_URL` | `""` | Primary internal proxy gateway URL |
| `PROXY_FALLBACK_AUTH_HEADER` | `PROXY_FALLBACK_AUTH_HEADER` | `PROXY_AUTH_HEADER` | `""` | `Header-Name: value` auth for the gateway |
| `DIRECT_EXCHANGES` | `DIRECT_EXCHANGES` | — | `""` | CSV of exchanges that bypass proxy in `auto` mode |

> **Note**: `PROXY_URL` and `PROXY_AUTH_HEADER` are legacy aliases; prefer the `PROXY_FALLBACK_*` names.

### 1.5 External proxy (Bright Data / Oxylabs)

| Variable | Canonical name | Alias accepted | Description |
|---|---|---|---|
| `EXTERNAL_PROXY_FALLBACK_URL` | canonical | `EXTERNAL_PROXY_URL`, `EXTERNAL_PROXY_GATEWAY_URL` | Gateway URL to reach a paid proxy provider |
| `EXTERNAL_PROXY_FALLBACK_PROVIDER` | canonical | `EXTERNAL_PROXY_PROVIDER` | Provider name: `bright_data`, `oxylabs`, `smartproxy`, or `none` |
| `EXTERNAL_PROXY_FALLBACK_AUTH_HEADER` | canonical | `EXTERNAL_PROXY_AUTH_HEADER` | `Header-Name: value` auth for the external gateway |

### 1.6 Exchange execution

| Variable | Default | Description |
|---|---|---|
| `EXECUTION_EXCHANGES_ALLOWLIST` | `"mexc,bitget"` | CSV — only these exchanges may place live orders |

### 1.7 DEX / on-chain

| Variable | Default | Description |
|---|---|---|
| `DEX_MULTI_CHAIN_ENABLED` | `"true"` | Enable multi-chain DEX scanning |
| `DEX_CHAINS` | `"ethereum,polygon,arbitrum,optimism,bsc"` | Active chains for DEX scanning |
| `CLOUDFLARE_GATEWAY_ETH` | `""` | Cloudflare HTTP gateway for Ethereum (leave blank to use direct RPC) |
| `CLOUDFLARE_GATEWAY_ARB` | `""` | Cloudflare HTTP gateway for Arbitrum |
| `CLOUDFLARE_GATEWAY_BSC` | `""` | Cloudflare HTTP gateway for BSC |
| `CLOUDFLARE_GATEWAY_IPFS` | `""` | Cloudflare HTTP gateway for IPFS |
| `ALCHEMY_API_KEY` | `""` | Alchemy API key — enables Alchemy RPC fallback |
| `ALCHEMY_EVM_WALLET` | `""` | Alchemy managed EVM wallet address |
| `ALCHEMY_SOLANA_WALLET` | `""` | Alchemy managed Solana wallet address |
| `ONEINCH_API_KEY` | `""` | 1inch API key for DEX quotes |
| `ONEINCH_API` | `""` | 1inch API base URL override |

### 1.8 AI / LLM

| Variable | Default | Description |
|---|---|---|
| `LLM_MODEL` | `@cf/meta/llama-3.1-8b-instruct` | Workers AI model ID |
| `AI_GATEWAY_URL` | `""` | Full AI Gateway URL (overrides account-based URL) |
| `AI_GATEWAY_ID` | `""` | AI Gateway ID (auto-builds URL from account ID) |
| `AI_FILTER_ENABLED` | `"true"` | Enable AI-powered opportunity filtering |
| `AI_FILTER_MIN_CONFIDENCE` | `"0.7"` | Minimum AI confidence score to pass filter |

### 1.9 Strategy and risk

| Variable | Default | Description |
|---|---|---|
| `STRATEGY_MODE` | `multi_exchange` | `multi_exchange` or `mexc_only` |
| `SPOT_ONLY_LOCK_FORCE` | `"false"` | Lock system to spot-only mode at env level |
| `MANUAL_RISK_LOCK_FORCE` | `"false"` | Freeze risk settings at env level |
| `SKIP_BALANCE_CHECK` | `"true"` | Skip account balance pre-check (useful when WAF blocks the endpoint) |
| `AGGRESSIVE_SCAN_MODE` | `"on"` | Enable aggressive scan profile |
| `CEX_MIN_SAFETY_FACTOR` | `"0.10"` | Minimum safety factor for CEX spreads |
| `PERPS_MIN_SAFETY_FACTOR` | `"0.10"` | Minimum safety factor for perps spreads |
| `CEX_SLIPPAGE_MULTIPLIER` | `"0.5"` | Fraction of modelled slippage to apply |
| `EXPOSURE_BOOST_MULTIPLIER` | `"1.50"` | Global exposure scaler |
| `VENUE_READY_PRIORITY_MULTIPLIER` | `"1.45"` | Priority boost for ready venues |
| `MAX_DAILY_LOSS_USD` | `"25"` | Maximum daily loss cap (USD) |
| `LIVE_EXECUTION_MIN_BALANCE_USD` | `"0"` | Minimum balance required to execute live trades |

### 1.10 Forced aggressive execution overrides

Set `AGGRESSIVE_EXECUTION_FORCE=on` to apply the forced runtime profile (ignores KV state).

| Variable | Default | Description |
|---|---|---|
| `AGGRESSIVE_EXECUTION_FORCE` | `"off"` | `on` enables forced profile below |
| `AGGRESSIVE_FORCED_POSITION_SIZE_USD` | `"15"` | Forced position size (USD) |
| `AGGRESSIVE_FORCED_MAX_LIVE_TRADES_PER_SCAN` | `"10"` | Max live trades per scan |
| `AGGRESSIVE_FORCED_SCALP_MIN_NET_PCT` | `"0.05"` | Minimum net profit % for scalps |
| `AGGRESSIVE_FORCED_MIN_SECONDS_BETWEEN_TRADES` | `"10"` | Minimum seconds between consecutive trades |
| `AGGRESSIVE_FORCED_SUPPORTED_SYMBOLS` | (see wrangler.toml) | CSV — restricts forced profile to these symbols |

### 1.11 Backtesting

| Variable | Default | Description |
|---|---|---|
| `BACKTEST_AUTO_ENABLED` | `"true"` | Enable automatic periodic backtesting |
| `BACKTEST_AUTO_INTERVAL_HOURS` | `"24"` | Interval between auto-backtest runs |

---

## 2 — Cloudflare Worker: secrets (`wrangler secret put <KEY>`)

Secrets are **never** committed to source control. Upload with `wrangler secret put` or the
bulk-upload script (`scripts/upload-secrets.ps1`).

### 2.1 Admin & security

| Secret | Required | Description |
|---|---|---|
| `ADMIN_TOKEN` | ✅ Yes | Protects `/start`, `/stop`, `/scan`, admin API routes |
| `ALLOWED_IPS` | Optional | CSV of IPs allowed to call admin routes |
| `WORKFLOW_ADMIN_TOKEN` | Optional | Separate admin token for Temporal workflow management |
| `TELEGRAM_WEBHOOK_SECRET` | Optional | Webhook secret for Telegram bot |

### 2.2 Telegram notifications

| Secret | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Optional | Bot token for Telegram alerts |
| `TELEGRAM_CHAT_ID` | Optional | Chat/channel ID to send alerts to |

### 2.3 Exchange API credentials

Only configure the exchanges you trade. Bybit and Gate.io are **data-only** (German regulatory restrictions) — their execution secrets are not needed.

| Secret | Exchange | Notes |
|---|---|---|
| `MEXC_API_KEY`, `MEXC_API_SECRET` | MEXC | Primary execution exchange |
| `MEXC_API_KEY_2`, `MEXC_API_SECRET_2` | MEXC (backup) | Optional secondary key |
| `BINANCE_API_KEY`, `BINANCE_API_SECRET` | Binance | |
| `KUCOIN_API_KEY`, `KUCOIN_SECRET_KEY`, `KUCOIN_PASSPHRASE` | KuCoin | |
| `BITGET_API_KEY`, `BITGET_SECRET_KEY`, `BITGET_API_PASSPHRASE` | Bitget | Requires proxy routing (Worker egress WAF) |
| `BITMART_API_KEY`, `BITMART_SECRET_KEY`, `BITMART_MEMO` | Bitmart | |
| `HTX_API_KEY`, `HTX_API_SECRET` | HTX (Huobi) | |
| `BYBIT_API_KEY`, `BYBIT_API_SECRET` | Bybit | Data-only — no execution |
| `GATEIO_API_KEY`, `GATEIO_API_SECRET` | Gate.io | Data-only — no execution |

### 2.4 HFT engine

| Secret | Description |
|---|---|
| `HFT_ENGINE_SECRET` | ****** matching `HFT_ENGINE_SECRET` on the Go engine container. Must be set in GitHub repo secrets — deploy workflows upload it to BOTH the main worker and the `hft-engine` container worker. Until set, the engine fails closed (scan/execute return 401) and the worker reports `executionReady=false`. |

### 2.5 Temporal Cloud

| Secret | Description |
|---|---|
| `TEMPORAL_API_KEY` | Temporal Cloud API key |

### 2.6 DEX / on-chain

| Secret | Description |
|---|---|
| `DEX_EXECUTOR_URL` | Remote DEX executor endpoint URL |
| `DEX_EXECUTOR_TOKEN` | Auth token for DEX executor |

### 2.7 Proxy routing (secret variants)

| Secret | Description |
|---|---|
| `PROXY_LIST` | JSON array of proxy objects: `[{"url":"...","type":"http","priority":0,"region":"eu"}]` |
| `EXTERNAL_PROXY_FALLBACK_USERNAME` | Username for paid proxy provider auth |
| `EXTERNAL_PROXY_FALLBACK_PASSWORD` | Password for paid proxy provider auth |

### 2.8 Free data providers (optional)

| Secret | Description |
|---|---|
| `ALPHA_VANTAGE_API_KEY` | |
| `TWELVE_DATA_API_KEY` | |

### 2.9 Broker adapters (optional)

| Secret | Description |
|---|---|
| `BROKER_ALPACA_API_KEY`, `BROKER_ALPACA_API_SECRET` | Alpaca brokerage |
| `BROKER_IBKR_ACCOUNT_ID`, `BROKER_IBKR_GATEWAY_URL` | Interactive Brokers |
| `BROKER_TRADIER_API_TOKEN`, `BROKER_TRADIER_ACCOUNT_ID` | Tradier |

---

## 3 — Go HFT engine (`hft/.env`, based on `hft/.env.example`)

The Go engine reads all configuration from OS environment variables. For local development,
copy `hft/.env.example` to `hft/.env` and fill in values. For production (Railway / Docker),
inject as container environment variables.

### 3.1 Exchange credentials

Same key names as the Worker secrets (section 2.3). The engine uses whichever exchanges you
configure for its own price feeds and execution.

### 3.2 EVM / on-chain

| Variable | Default | Description |
|---|---|---|
| `WALLET_PRIVATE_KEY` | — | Hex private key (no `0x` prefix) for on-chain signing |
| `ETH_RPC_URL` | `https://rpc.flashbots.net` | Ethereum RPC (falls back from Cloudflare gateway) |
| `ARBITRUM_RPC_URL` | `https://arb1.arbitrum.io/rpc` | Arbitrum One RPC |
| `BSC_RPC_URL` | `https://bsc-dataseed.binance.org/rpc` | BSC RPC |
| `FLASHBOTS_RELAY_URL` | `https://relay.flashbots.net` | Flashbots relay |
| `FLASHBOTS_SIGNING_KEY` | — | Separate key for signing Flashbots bundle requests |
| `ALCHEMY_API_KEY` | — | Alchemy API key — enables Alchemy RPC fallback |
| `ZEROX_API_KEY` | — | 0x Protocol API key for DEX quotes |

The engine applies the same RPC preference chain as the Worker: **Cloudflare gateway → Alchemy → direct RPC**.
Set `CLOUDFLARE_GATEWAY_ETH/ARB/BSC/IPFS` to enable the Cloudflare tier.

### 3.3 Database

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_DSN` | `******localhost:5432/hft?sslmode=disable` | Full PostgreSQL connection string |

### 3.4 Telegram

Same `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` as the Worker (section 2.2).

### 3.5 Trading parameters

| Variable | Default | Description |
|---|---|---|
| `PAPER_TRADING` | `false` | `true` = no real orders placed |
| `TRADING_ENABLED` | `true` | Master enable/disable switch |
| `INITIAL_CAPITAL_USD` | `1000` | Starting capital |
| `MAX_DAILY_LOSS_USD` | `25` | Daily loss cap |
| `MIN_SECONDS_BETWEEN_TX` | `30` | Minimum gap between on-chain transactions |
| `MAX_PER_TRADE_LOSS_PCT` | `0.02` | Maximum loss per trade (fraction) |
| `MAX_SPREAD_PCT` | `5.0` | Maximum spread to consider as an opportunity |
| `WIN_RATE` | `0.55` | Expected win rate for Kelly sizing |
| `RISK_REWARD_RATIO` | `2.0` | Expected reward / risk ratio |

### 3.6 Engine tuning

| Variable | Default | Description |
|---|---|---|
| `SCAN_INTERVAL_MS` | `500` | Price book evaluation interval |
| `MAX_GAS_COST_PCT` | `0.30` | Skip DEX trade if gas > this fraction of profit |
| `MIN_NET_PROFIT_PCT` | `0.05` | Minimum net profit to execute a trade |
| `METRICS_ADDR` | `:9090` | Prometheus metrics listen address |
| `API_ADDR` | `:8080` | Engine REST API listen address |
| `HFT_ENGINE_SECRET` | `""` | Auth token clients must send (matches Worker secret). On the deployed container, `ENGINE_REQUIRE_AUTH=true` fails closed when blank (401 on scan/execute) — trading stays disabled until a secret is configured. |

---

## 4 — Local AI development (`.env.local`, based on `.env.local.example`)

Used when running `npm run dev:local-ai` or `npm run ai:local:all`.
This file is **not** loaded by the Cloudflare Worker runtime — it configures the local
CodeGeeX server process and the `wrangler dev` invocation.

| Variable | Default | Description |
|---|---|---|
| `AI_BACKEND` | `cloudflare` | `local` to use CodeGeeX server; `cloudflare` for Workers AI |
| `LOCAL_AI_ENDPOINT` | `http://localhost:8000` | CodeGeeX server base URL |
| `LOCAL_AI_TIMEOUT_MS` | `15000` | Timeout for local AI requests (CPU inference can be slow) |

---

## 5 — Proxy gateway (`proxy-gateway/`)

The Node.js proxy gateway (`proxy-gateway/`) is a separate service that forwards requests
through an upstream commercial proxy. It is **not** a Cloudflare Worker.

Set these as environment variables on the host where you run `npm start` in `proxy-gateway/`:

| Variable | Required | Description |
|---|---|---|
| `UPSTREAM_PROXY_URL` | ✅ Yes | e.g. `******us.proxy001.com:7878` |
| `GATEWAY_AUTH_TOKEN` | Recommended | Token clients must send in `X-Gateway-Token` header |
| `PORT` | Optional | HTTP listen port (default `8788`) |
| `ALLOWED_HOSTS` | Optional | CSV override of allowed target hostnames |

Wire this gateway into the Worker by setting:
- `EXTERNAL_PROXY_FALLBACK_URL` = `https://<your-gateway-host>/proxy` (Worker secret or var)
- `EXTERNAL_PROXY_FALLBACK_PROVIDER` = `bright_data` (or another non-`none` value)
- `EXTERNAL_PROXY_FALLBACK_USERNAME` = `enabled` (Worker secret)
- `EXTERNAL_PROXY_FALLBACK_PASSWORD` = `enabled` (Worker secret)

---

## 6 — Variable alias map

Some variables have legacy aliases that the runtime still accepts. The canonical names are shown below.
Always use canonical names in new deployments.

| Canonical name | Legacy alias(es) | Owner |
|---|---|---|
| `PROXY_FALLBACK_URL` | `PROXY_URL` | Worker proxy pool |
| `PROXY_FALLBACK_AUTH_HEADER` | `PROXY_AUTH_HEADER` | Worker proxy pool |
| `EXTERNAL_PROXY_FALLBACK_URL` | `EXTERNAL_PROXY_URL`, `EXTERNAL_PROXY_GATEWAY_URL` | Worker external proxy |
| `EXTERNAL_PROXY_FALLBACK_PROVIDER` | `EXTERNAL_PROXY_PROVIDER` | Worker external proxy |
| `EXTERNAL_PROXY_FALLBACK_USERNAME` | `EXTERNAL_PROXY_USERNAME` | Worker external proxy |
| `EXTERNAL_PROXY_FALLBACK_PASSWORD` | `EXTERNAL_PROXY_PASSWORD` | Worker external proxy |
| `EXTERNAL_PROXY_FALLBACK_AUTH_HEADER` | `EXTERNAL_PROXY_AUTH_HEADER` | Worker external proxy |

---

## 7 — Minimum required variables

### Paper trading (no real orders)
| Variable | Value |
|---|---|
| `ADMIN_TOKEN` | any strong random token |

### Live CEX trading
Everything above, plus at least one exchange credential pair:
- `MEXC_API_KEY` + `MEXC_API_SECRET`, **or**
- `BINANCE_API_KEY` + `BINANCE_API_SECRET`

### Live DEX trading (Go engine)
All CEX requirements above, plus:
- `HFT_ENGINE_URL` + `HFT_ENGINE_SECRET`
- `WALLET_PRIVATE_KEY` (on the engine side)

---

## 8 — Migration notes

| Change | Action required |
|---|---|
| `PROXY_URL` renamed → `PROXY_FALLBACK_URL` | Both names still work. Use `PROXY_FALLBACK_URL` going forward. |
| `EXTERNAL_PROXY_URL` renamed → `EXTERNAL_PROXY_FALLBACK_URL` | Both names still work. Use the canonical name. |
| `wrangler.toml.backup` removed | Stale backup of old wrangler.toml. All content is in `wrangler.toml`. |

---

## 9 — Multi-Agent Cooperation Stack

These variables wire together Hermes, OmniRoute, Merlin, Manus, and Cloudflare Workers AI.
Set them as **wrangler secrets** for the Worker, or as local `.env` / system env vars for Hermes/Omni.

### 9.1 OpenRouter / OmniRoute

| Variable | Required | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | ✅ Yes | API key from https://openrouter.ai → free tier available |
| `OPENROUTER_BASE_URL` | Optional | Override base URL (default: `https://openrouter.ai/api/v1`) |
| `OPENROUTER_DEFAULT_MODEL` | Optional | Default model (default: `openrouter/auto`) |

### 9.2 Hermes Agent

| Variable | Required | Description |
|---|---|---|
| `HERMES_API_KEY` | ✅ Yes | Hermes API key from Nous Research portal |
| `HERMES_MODEL` | Optional | Model override (default: `openrouter/auto`) |
| `HERMES_BASE_URL` | Optional | Override endpoint (default: `https://hermes-agent.nousresearch.com/v1`) |

### 9.3 Merlin AI

| Variable | Required | Description |
|---|---|---|
| `MERLIN_API_KEY` | ✅ Yes | Merlin API key from https://merlin.foyer.work |

### 9.4 Manus Agent

| Variable | Required | Description |
|---|---|---|
| `MANUS_API_KEY` | Optional | API key for Manus automation agent |
| `MANUS_ENDPOINT` | Optional | Override endpoint (default: `http://127.0.0.1:8788/api/manus`) |

### 9.5 Cloudflare Workers AI Gateway

| Variable | Required | Description |
|---|---|---|
| `CLOUDFLARE_AI_GATEWAY_URL` | ✅ Yes | AI Gateway URL from Cloudflare dashboard → AI Gateway |
| `CLOUDFLARE_API_TOKEN` | ✅ Yes | CF API token with Workers AI permission |
| `WORKER_AUTH_TOKEN` | Recommended | ****** to authenticate calls to `hero-super-agent` |
| `DEFAULT_CF_MODEL` | Optional | Default Workers AI model (default: `@cf/meta/llama-3.1-8b-instruct`) |

### 9.6 Alias map for multi-agent stack

| Canonical name | Notes |
|---|---|
| `OPENROUTER_API_KEY` | Used by both Hermes config and OmniRoute |
| `CLOUDFLARE_AI_GATEWAY_URL` | Must include full URL with account ID |
