# UltimateArbitrageHFT

Deployed Cloudflare Worker: `ultimatearbitragehft`
Live URL: <https://ultimatearbitragehft.zedanazad43.workers.dev>

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
| `OKX_API_KEY` + `OKX_API_SECRET` + `OKX_PASSPHRASE` | OKX keys (optional) |
| `KUCOIN_API_KEY` + `KUCOIN_SECRET_KEY` + `KUCOIN_PASSPHRASE` | KuCoin keys (optional) |
| `BITGET_API_KEY` + `BITGET_SECRET_KEY` + `BITGET_API_PASSPHRASE` | Bitget keys (optional) |
| `BITMART_API_KEY` + `BITMART_SECRET_KEY` + `BITMART_MEMO` | Bitmart keys (optional) |

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

intentional ci failure
