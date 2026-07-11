# Dependency / Manifest Audit

## Root Node project
- `package.json`:
  - Type: module; main `index.js`
  - Deploy/test scripts reference `wrangler@4.86.0` / `^4.87.0`
  - Large test surface declared; CI uses Node 24
- Risk:
  - Deploy and lockfile versions may drift; `npm ci` requires lockfile fidelity
  - Some test targets in `test:all` may not exist in `tests/`

## Go engine
- `hft/go.mod`:
  - Module path: `github.com/zedanazad43/UltimateArbitrageHFT/hft`
  - Go 1.25.0 with heavy deps: geth, pgx, prometheus, zk-related transitive deps
  - Compiled artifacts present: `hft`, `hft.exe`, `hft-engine`
- Risk:
  - Go 1.25 may not be widely available on minimal runners
  - Large transitive dependency surface; rebuild times/size
  - `hft/cmd/hft` notes/docs present; confirm actual binary entrypoint matches Docker CMD

## Python backend
- `backend/requirements.txt`:
  - FastAPI + motor + PyJWT + bcrypt + httpx
  - Simple install profile
- Risk:
  - Not containerized in repo manifests
  - Likely requires local Mongo + env vars

## Frontend
- `frontend/package.json`, build outputs exist
- Risk:
  - Ensure build is reproducible and not checked into source control if not needed

## Subprojects
- `proxy-gateway/`, `nexus/`, `dex-executor/`
  - Each has own `package.json` / `wrangler.toml`
- Risk:
  - Shared dependency versions not aligned with root
  - Duplicate setup scripts across these folders

## Recommendation
1. Standardize Node engine and `wrangler` version across all `package.json` files.
2. Validate `tests/` file list against `test:all` script.
3. Add `test:all:ci` script that skips missing files instead of failing.
