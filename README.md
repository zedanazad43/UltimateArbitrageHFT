# UltimateArbitrageHFT

Deployed Cloudflare Worker: `ultimatearbitragehft`
Live URL: <https://ultimatearbitragehft.zedanazad43.workers.dev>

---

## Agent Instruction Sources (Local + Cloud)

This repository enforces Advisor Mode instructions for local and cloud agents from these files:

- `.github/copilot-instructions.md` (GitHub Copilot in this repo)
- `AGENTS.md` (repository-wide cloud/automation agent guidance)
- `.cloudflare/agent-instructions.md` (Cloudflare-side agent guidance)

For local/global VS Code Copilot sessions across all projects, user-level instructions are also configured at:

- `~/.copilot/instructions/advisor-mode.instructions.md`

---

## Canonical Project Layout

Repository structure is normalized around two canonical roots:

- `arbitragebot/` — all arbitrage-related projects and variants
- `hero-super-agent/` — hero service stack (`hero-agent` runtime)

Compatibility aliases may still exist at legacy top-level paths (for scripts or
older docs), but new changes should target canonical paths only.

Authoritative maps:

- `REPO_ORG_INDEX.md`
- `arbitragebot/INDEX.json`
- `hero-super-agent/INDEX.json`

---

## Environment Setup

> **Canonical variable reference**: [`docs/env-reference.md`](docs/env-reference.md)
> covers every variable for all four runtime surfaces (Cloudflare Worker, Go HFT engine,
> local AI dev, proxy gateway) with canonical names, legacy aliases, owner, and required/optional status.

---

## Prerequisites — do these ONCE before first deploy

### 1. Cloudflare API Token

The deploy workflow authenticates to Cloudflare via the `CLOUDFLARE_API_TOKEN` GitHub secret.

**Create / fix the token** (Cloudflare dashboard → My Profile → API Tokens):
- Click **Create Token** (or edit an existing one)
- Required permissions: **Workers Scripts: Edit**, **D1: Edit**, **KV Storage: Edit**, **Account: Read**
- ⚠️ **Remove any "Client IP Address Filtering" restriction** — GitHub Actions runners use dynamic IPs and will be blocked otherwise (error code 9109)

### 2. GitHub Secrets

Add these in your repo → Settings → Secrets and variables → Actions → **New repository secret**:

| Secret name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token (see above) |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID (from wrangler.toml or dashboard) |
| `ADMIN_TOKEN` | Any strong random string — used to authorize `/start`, `/stop`, etc. |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token (optional — for alerts) |
| `TELEGRAM_CHAT_ID` | Telegram chat/group ID (optional) |
| `MEXC_API_KEY` + `MEXC_API_SECRET` | MEXC exchange keys (needed for live execution) |
| `BINANCE_API_KEY` + `BINANCE_API_SECRET` | Binance keys (optional) |
| `KUCOIN_API_KEY` + `KUCOIN_SECRET_KEY` + `KUCOIN_PASSPHRASE` | KuCoin keys (optional) |
| `BITGET_API_KEY` + `BITGET_SECRET_KEY` + `BITGET_API_PASSPHRASE` | Bitget keys (optional) |
| `BITMART_API_KEY` + `BITMART_SECRET_KEY` + `BITMART_MEMO` | Bitmart keys (optional) |
| `AI_GATEWAY_TOKEN` | Optional bearer token for AI gateway auth |
| `ALLOWED_IPS` | Optional admin IP allowlist (comma-separated) for hardening protected endpoints |

### Proxy Routing Profiles (Production)

Configure these Worker vars to control how exchange requests are routed:

| Variable | Description |
|---|---|
| `PROXY_MODE` | `auto` (default), `off`, or `required` |
| `DIRECT_EXCHANGES` | Optional comma-separated list of exchanges that bypass proxy in `auto` mode |

Recommended server profiles:

- No proxy / direct servers:
	- `PROXY_MODE=off`
	- `DIRECT_EXCHANGES=`
- Mixed mode (proxy where needed):
	- `PROXY_MODE=auto`
	- `DIRECT_EXCHANGES=bitmart,mexc` (example)
- Strict proxy-compliance mode:
	- `PROXY_MODE=required`
	- `DIRECT_EXCHANGES=`

Set non-secret vars in `wrangler.toml` under `[vars]` and redeploy.

For copy/paste production profiles and rollout steps, see [docs/production-profiles.md](docs/production-profiles.md).

---

## Deploy (manual production publish)

```
# From GitHub Actions tab → "Deploy Worker (Manual)" → Run workflow
```

The workflow will:
1. Verify Cloudflare credentials (fails fast with a clear error if token is wrong)
2. Run the full test suite
3. Deploy the Cloudflare Worker
4. Upload all exchange secrets to the Worker

## LLM Model + AI Gateway Setup

The Worker AI endpoints now support both direct Workers AI and optional gateway routing:

- POST /api/ai
- POST /api/ai-analysis
- GET /api/ai/health

1. Configure model in wrangler vars
	- LLM_MODEL="@cf/meta/llama-3.1-8b-instruct"

2. Configure gateway (optional)
	- Set AI_GATEWAY_URL to your gateway URL (base or chat-completions URL), or
	- Set AI_GATEWAY_ID and keep CLOUDFLARE_ACCOUNT_ID set

3. Upload gateway token (if your gateway requires bearer auth)

```powershell
npx wrangler secret put AI_GATEWAY_TOKEN
```

4. Deploy

```powershell
npm run deploy
```

5. Verify

```powershell
curl -H "x-admin-token: <ADMIN_TOKEN>" https://<your-worker-domain>/api/ai/health
```

---

## Exchange Connectivity Troubleshooting

### Bitget WAF/Network Blocking

If Bitget returns WAF blocks or network errors, you need a static IP exit point:

```bash
# Run the automated fix guide
bash scripts/fix-bitget-access.sh
```

**Quick fix options:**
1. **VPS with static IP** (Recommended): Set up a $5/month VPS with Squid proxy
2. **Premium proxy service**: Use Bright Data, Oxylabs, or Smartproxy
3. **Cloudflare Zero Trust**: Enterprise-grade static egress

### Binance API Key Issues

If Binance returns "Invalid API-key" or format errors:

```bash
# Run the automated fix guide
bash scripts/fix-binance-keys.sh
```

**Quick fix steps:**
1. Create new API keys at [Binance API Management](https://www.binance.com/en/my/settings/api-management)
2. Update GitHub secrets: `BINANCE_API_KEY`, `BINANCE_API_SECRET`
3. Update Cloudflare secrets: `npx wrangler secret put BINANCE_API_KEY`
4. Test: `npm run diagnose:exchanges`

---

## Cloudflare deployment troubleshooting

If the **Deploy Worker** workflow fails during `wrangler deploy`, use this checklist:

1. Confirm `CLOUDFLARE_API_TOKEN` uses **Account > Workers Scripts > Edit** permission.
2. Remove any **Client IP Address Filtering** from that token (GitHub Actions runners use dynamic IPs).
3. If logs include `entitlements.not_available` / `code: 10007`, open Cloudflare dashboard and enable the required Workers entitlements/subscription for the account.
4. Update repository secret `CLOUDFLARE_API_TOKEN` if you rotated the token, then rerun the workflow.

---

## Cloudflare deployment troubleshooting

If the **Deploy Worker** workflow fails during `wrangler deploy`, use this checklist:

1. Confirm `CLOUDFLARE_API_TOKEN` uses **Account > Workers Scripts > Edit** permission.
2. Remove any **Client IP Address Filtering** from that token (GitHub Actions runners use dynamic IPs).
3. If logs include `entitlements.not_available` / `code: 10007`, open Cloudflare dashboard and enable the required Workers entitlements/subscription for the account.
4. Update repository secret `CLOUDFLARE_API_TOKEN` if you rotated the token, then rerun the workflow.

---

## HFT Tools Configuration & CI Automation

The Go HFT engine maintains an automated tools configuration report (`hft/# Tools Configuration.md`) that tracks the build environment (Go version, tools, environment variables).

**Refresh the report locally:**
```bash
cd hft && bash scripts/generate-tools-configuration.sh
```

**Or run from VS Code:** Tasks > `hft: generate tools configuration`

**CI guard:** The workflow `hft tools configuration check` automatically verifies on every push/PR that the config file is up to date with the current environment. Commits fail if the file is stale.

See [hft/README.md](hft/README.md) for details.

Live trading mode is no longer auto-enabled by this workflow; switch mode explicitly via authenticated admin controls.

---

## Local development

> **Windows users**: make sure `wrangler dev` is **stopped** before running `git pull`.
> The dev server locks SQLite files inside `.wrangler/` and Git cannot update them
> while those files are open.

```powershell
# 1. Install dependencies
npm install

# 2. Create your local secrets file (gitignored — never committed)
Copy-Item .dev.vars.example .dev.vars
#    Open .dev.vars and set at minimum:  ADMIN_TOKEN=any-local-secret

# 3. Apply the D1 schema to the local Miniflare database
npm run db:migrate:local

# 4. Run unit tests (optional but recommended)
npm test

# 5. Start the local dev server
npm run dev
#    Dashboard: http://127.0.0.1:8787
#    Add  -H "x-admin-token: <your ADMIN_TOKEN>"  to curl calls that need auth
```

Or use the all-in-one shortcut (steps 1–3 above combined):

```powershell
npm run setup:local
# then:  npm run dev
```

### One-command automation (PowerShell)

Run the end-to-end automation script for setup, validation, paper smoke test, and safe rollback:

```powershell
pwsh -NoProfile -File ./scripts/automation-smoke.ps1 -StartLocalDev
```

Run against production URL (optional deploy + optional live smoke with explicit safety switch):

```powershell
pwsh -NoProfile -File ./scripts/automation-smoke.ps1 `
  -BaseUrl "https://ultimatearbitragehft.zedanazad43.workers.dev" `
  -AdminToken "<ADMIN_TOKEN>" `
  -DeployProduction `
  -RunLiveSmoke `
  -AllowLiveOrder
```

> Live smoke is blocked on local URLs by default; use `-AllowLocalLiveOrder` only if you explicitly want that behavior.

### HFT Go quick verification

Use these commands after any Go dependency or engine changes:

```bash
cd hft
go mod verify
go test ./...
```

### Local LLM gateway (CodeGeeX via Ollama)

Use these commands for a fully local AI workflow:

```bash
# 1) Start local gateway (OpenAI-compatible API on 127.0.0.1:8000)
npm run ai:gateway:start

# 2) Check gateway health
npm run ai:gateway:health

# 3) Validate IDE/app integration against local model
npm run test:ide:local

# 4) Run Worker dev mode with local AI backend
npm run dev:local-ai
```

Default behavior remains unchanged: `npm run dev` uses the current default AI backend settings.

### Local Hummingbot (Docker)

Run Hummingbot alongside the Worker in three terminals:

```powershell
# Terminal 1 — start Hummingbot container (Gateway API on port 8080)
docker run -it -p 8080:8080 -v hummingbot_data:/root/hummingbot hummingbot/hummingbot:latest

# Terminal 2 — trigger strategy execution via the connector script
npm run hummingbot:start

# Terminal 3 — watch live connector activity (connector.log is in the repo root)
Get-Content connector.log -Wait
```

All activity is appended to **`connector.log`** in the repo root.

Configure the Hummingbot API endpoint and optional auth token in `.dev.vars`:

```ini
HUMMINGBOT_EXECUTE_URL=http://localhost:8080/api/v1/start
HUMMINGBOT_API_TOKEN=          # leave empty if Hummingbot auth is disabled
HUMMINGBOT_STATUS_URL=http://localhost:8080/api/v1/status
```

The defaults match a standard Hummingbot Gateway Docker image (`-p 8080:8080`).
Adjust the port and path if your image differs.

## Monitoring

- **Telegram**: send `/status` or `/scan` to your bot
- **Dashboard**: <https://ultimatearbitragehft.zedanazad43.workers.dev>
- **Logs**: `npm run tail` or Cloudflare dashboard → Workers → ultimatearbitragehft → Logs

## Developer hooks and release flow

### Enable local pre-commit hooks

```bash
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit scripts/pre-commit-check.sh
```

The pre-commit hook runs:
- `npm run lint`
- `go vet ./...` in `hft`
- `go test ./...` in `hft`

### Tag-based release

Workflow: `.github/workflows/release-tags.yml`

When you push a tag like `v2.1.0`, the workflow builds:
- `dist/hft-linux-amd64`
- `dist/checksums.txt`

and publishes them to a GitHub Release automatically.

### Telegram alerts for failed workflows

Workflow: `.github/workflows/telegram-workflow-failures.yml`

It sends a Telegram alert when one of these workflows fails:
- `Node.js CI`
- `Deploy Worker`
- `Deploy static content to Pages`
- `Production Monitoring and Operations`

It uses repository secrets:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

### Production operations commands

- `npm run monitor` → probes `/health` and `/dashboard`, calculates latency/error-rate SLOs, writes `metrics.json`
- `npm run backup` → exports D1 to SQL and snapshots critical config files
- `npm run backup:full` → full backup mode (includes key trading tables)
- `npm run check:secrets` → scans repository for likely hardcoded secrets
- `npm run audit:security` → secrets scan + `npm audit` vulnerability gate
- `npm run validate:production` → lint + tests + secrets + build dry-run + monitor

### Scheduled automation

- Workflow: `.github/workflows/monitor-production.yml`
- Every 10 minutes: production monitor + metrics artifact upload
- Daily 02:00 UTC: backup job + backup artifact upload
- On monitor failure: opens/updates a GitHub issue with label `production-alert`
- Optional external alerts: pass `ops_alert_webhook` input when running workflow manually

## Ecosystem integrations (2026)

The project now includes a built-in integration catalog and recommendation API for:

- **ccxt** (⭐42k) Unified API for 100+ crypto exchanges — MIT license
- **Hummingbot** (⭐18k) Professional arbitrage framework — Apache-2.0
- **Superalgos** (⭐5.5k) Visual algo-trading platform — Apache-2.0
- **Freqtrade + FreqAI** (AI/ML-driven strategy stack) — GPL-3.0
- **Triangular Arbitrage Bots** (⭐1.4k) Python triangular arbitrage — MIT
- **Solana Arbitrage Bot** (⭐1.1k) High-speed Rust DEX arbitrage on Solana — MIT
- **Crypto Arbitrage** (⭐840) Cross-exchange + triangular arbitrage — MIT
- **AI CryptoTrader** (⭐100+) Ensemble ML trading — Apache-2.0
- **Botvana** (⭐250) High-performance Rust HFT framework — AGPL-3.0
- **Harvest** (⭐150) Simple algo-trading framework — MIT
- **OpenCode** and **Aider** (coding-agent support)
- **CrewAI** and **AutoGPT** (multi-agent orchestration patterns)

API endpoints:

- `GET /api/ecosystem` → full catalog of 17+ trusted open-source projects
- `GET /api/ecosystem/recommendation?goal=quick_start|ai_learning|coding_support|multi_agent_ops`
- `GET /api/security/api-keys` → secure exchange API-key checklist
- `GET /api/integrations/executive/status` → live status of all integrations (admin auth required)
- `POST /api/integrations/executive/execute` with `{ "integration": "hummingbot|freqtrade|crewai|autogpt|superalgos|ccxt_rest", "payload": {...} }`
- `POST /api/integrations/executive/execute-all` with `{ "defaultPayload": {...}, "payloadByIntegration": {...} }`

Required integration URLs (set in Worker vars):

- `HUMMINGBOT_EXECUTE_URL`, `HUMMINGBOT_STATUS_URL`
- `FREQTRADE_EXECUTE_URL`, `FREQTRADE_STATUS_URL`
- `CREWAI_EXECUTE_URL`, `CREWAI_STATUS_URL`
- `AUTOGPT_EXECUTE_URL`, `AUTOGPT_STATUS_URL`
- `SUPERALGOS_EXECUTE_URL`, `SUPERALGOS_STATUS_URL`
- `CCXT_REST_EXECUTE_URL`, `CCXT_REST_STATUS_URL`

Optional integration auth secrets (set with `wrangler secret put`):

- `HUMMINGBOT_API_TOKEN`, `FREQTRADE_API_TOKEN`, `CREWAI_API_TOKEN`, `AUTOGPT_API_TOKEN`
- `SUPERALGOS_API_TOKEN`, `CCXT_REST_API_TOKEN`

Latency note: run the bot and execution services in regions close to exchange infrastructure to improve arbitrage fill quality.

## Cloudflare Workers AI + Gateway Setup (LLM)

The Worker now includes built-in LLM inference via Cloudflare Workers AI with optional external gateway support for production scaling.

### Default Configuration (Workers AI)

By default, the Worker uses Cloudflare's on-device model:
- **Model**: `@cf/meta/llama-3.1-8b-instruct` (8B parameters, fast inference)
- **Provider**: Cloudflare Workers AI (no external API calls)
- **Endpoints**:
  - `GET /api/ai/health` → LLM status + model info + token usage
  - `POST /api/ai` → OpenAI Responses API compatible chat
  - `POST /api/ai-analysis` → Arbitrage opportunity analysis

### LLM API Usage

#### Health Check

```bash
curl -H "x-admin-token: <ADMIN_TOKEN>" \
  https://ultimatearbitragehft.zedanazad43.workers.dev/api/ai/health
```

Response:
```json
{
  "ok": true,
  "provider": "workers-ai",
  "model": "@cf/meta/llama-3.1-8b-instruct",
  "gatewayConfigured": false,
  "usage": { "input_tokens": 37, "output_tokens": 8, "total_tokens": 45 }
}
```

#### Chat Inference

```bash
curl -X POST -H "x-admin-token: <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "Explain cryptocurrency arbitrage",
    "instructions": "Be concise",
    "max_output_tokens": 256,
    "temperature": 0.7
  }' \
  https://ultimatearbitragehft.zedanazad43.workers.dev/api/ai
```

Response:
```json
{
  "id": "resp_...",
  "model": "@cf/meta/llama-3.1-8b-instruct",
  "provider": "workers-ai",
  "output_text": "Cryptocurrency arbitrage is the practice of buying an asset on one exchange...",
  "usage": { "input_tokens": 58, "output_tokens": 40, "total_tokens": 98 }
}
```

#### Arbitrage Analysis

```bash
curl -X POST -H "x-admin-token: <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "opportunity": {
      "symbol": "BTC/USDT",
      "strategy": "Spot Arbitrage",
      "direction": "Long",
      "buyPrice": 65000,
      "sellPrice": 65500,
      "netPct": 0.77
    }
  }' \
  https://ultimatearbitragehft.zedanazad43.workers.dev/api/ai-analysis
```

### Production Configuration (External Gateway)

For higher throughput or larger models, configure an external AI gateway:

1. **Edit `wrangler.toml`**:
   ```toml
   [vars]
   AI_GATEWAY_URL = "https://your-gateway.example.com"
   AI_GATEWAY_ID = "your-gateway-id"
   ```

2. **Set auth secret** (if gateway requires bearer token):
   ```bash
   npx wrangler secret put AI_GATEWAY_TOKEN
   # Paste your gateway bearer token when prompted
   ```

3. **Deploy**:
   ```bash
   npm run deploy
   ```

The Worker will now route all LLM requests to your external gateway with automatic fallback to Workers AI if the gateway is unavailable.

### Model Options

| Model | Speed | Size | Quality | Use Case |
|-------|-------|------|---------|----------|
| `@cf/meta/llama-3.1-8b-instruct` | ⚡ Fast | 8B | Good | Real-time analysis (default) |
| `@cf/meta/llama-3.1-70b-instruct` | Medium | 70B | Excellent | Complex strategic decisions |

To use the 70B model, update `wrangler.toml`:
```toml
LLM_MODEL = "@cf/meta/llama-3.1-70b-instruct"
```

### Monitoring & Limits

- **Rate limiting**: Worker enforces 20 req/60s per IP (configurable in Worker binding)
- **Token tracking**: Each response includes `input_tokens`, `output_tokens`, `total_tokens`
- **Cost estimate**: Cloudflare Workers AI is included in the Worker subscription; external gateways bill separately

## Ecosystem integrations (2026)

The project now includes a built-in integration catalog and recommendation API for:

- **Hummingbot** (professional arbitrage starter)
- **Freqtrade + FreqAI** (AI/ML-driven strategy stack)
- **OpenCode** and **Aider** (coding-agent support)
- **CrewAI** and **AutoGPT** (multi-agent orchestration patterns)

API endpoints:

- `GET /api/ecosystem` → full catalog
- `GET /api/ecosystem/recommendation?goal=quick_start|ai_learning|coding_support|multi_agent_ops`
- `GET /api/security/api-keys` → secure exchange API-key checklist
- `GET /api/integrations/executive/status` → live status of Hummingbot/Freqtrade/CrewAI/AutoGPT integrations (admin auth required)
- `POST /api/integrations/executive/execute` with `{ "integration": "hummingbot|freqtrade|crewai|autogpt", "payload": {...} }`
- `POST /api/integrations/executive/execute-all` with `{ "defaultPayload": {...}, "payloadByIntegration": {...} }`

Required integration URLs (set in Worker vars):

- `HUMMINGBOT_EXECUTE_URL`, `HUMMINGBOT_STATUS_URL`
- `FREQTRADE_EXECUTE_URL`, `FREQTRADE_STATUS_URL`
- `CREWAI_EXECUTE_URL`, `CREWAI_STATUS_URL`
- `AUTOGPT_EXECUTE_URL`, `AUTOGPT_STATUS_URL`

Optional integration auth secrets (set with `wrangler secret put`):

- `HUMMINGBOT_API_TOKEN`, `FREQTRADE_API_TOKEN`, `CREWAI_API_TOKEN`, `AUTOGPT_API_TOKEN`

Latency note: run the bot and execution services in regions close to exchange infrastructure to improve arbitrage fill quality.

## Security

Secrets (`api_keys.txt`, `.env`) **must not** be committed — see `.gitignore`.
`ADMIN_TOKEN` must be set before the worker will accept admin commands.
Use `ALLOWED_IPS` in production to restrict admin route access to trusted IP ranges.
`AI_GATEWAY_TOKEN` should be rotated monthly and stored as a Cloudflare secret (never in source code).
