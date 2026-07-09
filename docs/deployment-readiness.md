# Deployment Readiness Checklist

## Cloudflare Worker
- `wrangler.toml` present with KV, D1, Durable Objects, R2, Queues, Workers AI, rate limiter
- `deploy.yml` workflow:
  - Node 24
  - `npm ci`, `npm run test:all`, retrying `wrangler deploy`
  - Bulk secret upload from GitHub Secrets
  - Post-deploy smoke test
- Gaps:
  - Smoke test script path appears to be bash (`verify-production-endpoints.sh`), but workflow step runs it without extension/check on Ubuntu, likely okay
  - Ensure `CLOUDFLARE_API_TOKEN` has Account > Workers Scripts > Edit and no IP restriction

## Fly.io
- `fly.toml` deploy target: `hft/Dockerfile`
- Health: `/api/health` on internal_port 8080
- Metrics: `:9090/metrics`
- Gaps:
  - Fly secrets not listed in `FINAL_DEPLOYMENT_SUMMARY.md`
  - Confirm Go engine is building for `linux/amd64` in that Dockerfile

## Railway
- `railway.json` Nixpacks with `start: node index.js`
- Gaps:
  - This points to root Worker code, not the hardened worker or Go engine
  - Clarify intended Railway service; likely unused or duplicate of Cloudflare

## Local Docker
- `docker-compose.yml` references missing `Dockerfile`
- `docker-compose.dhi.yml` references `Dockerfile.dhi`
- Risk:
  - `docker-compose.yml` fails unless `Dockerfile` exists or mapping is intended to be `Dockerfile.dhi`

## GitHub secrets needed
From `deploy.yml`:
- Cloudflare token/account
- Exchange API keys/secrets for MEXC, Binance, OKX, KuCoin, Coinbase, Bitget, Bitmart, HTX, Bybit, Gate.io
- Telegram bot token/chat ID
- Admin token
- HFT engine secret
- Temporal API key

## Recommendations
1. Decide local canonical stack: use `docker-compose.dhi.yml` for hardened local dev.
2. Either add `Dockerfile` or change `docker-compose.yml` to `Dockerfile.dhi`.
3. Retire Railway target unless intentionally used.
4. Add `/api/health` verification to Go Dockerfile if missing.
