# Service Map

## Canonical active services
- Cloudflare Worker: `index.js`, `src/*`, `wrangler.toml`
  - Local dev: `wrangler dev` / `wrangler dev --local`
  - Prod deploy: `.github/workflows/deploy.yml` → `npx wrangler@4 deploy`
  - Ports: Cloudflare edge routes; local dev binds localhost by default
- Go HFT engine: `hft/`
  - Standalone Go service using module `github.com/zedanazad43/UltimateArbitrageHFT/hft`
  - Exposes REST on `:8080`, metrics on `:9090`
  - Docker: `hft/Dockerfile`; Fly.io uses this file (`fly.toml`)
  - Local compose: `docker-compose.dhi.yml` as `hft-engine`
- Python backend: `backend/server.py`
  - FastAPI + Motor/Mongo; separate auth/admin layer
  - Not wired into `docker-compose.yml`; likely standalone deployment
- Frontend: `frontend/`
  - CRA build; deploy via Cloudflare Pages / upload to R2 (`npm run upload:frontend`)
- Proxy / extras: `proxy-gateway/`, `dex-executor/`, `ip-locator/`, `nexus/`
  - Separate Node/worker targets with own `package.json` / `wrangler.toml`
  - Not part of root compose; optional runtime components

## Local Docker stacks
- `docker-compose.yml`
  - Services: `ultimate-arbitrage-hft`, `hero-super-agent`, `stampbook` (nginx)
  - Ports: 8787/8788/8789
- `docker-compose.dhi.yml`
  - Services: `worker`, `hft-engine`, `postgres`
  - Ports: 8787/9090/5432

## Observations
- Root `docker-compose.yml` references `Dockerfile`; only `Dockerfile.dhi` exists.
- `backend/server.py` lacks container wiring in repo compose.
- `hero-super-agent` is its own contained service but also has nested git metadata.
