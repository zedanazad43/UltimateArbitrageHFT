# Windows Local Ops

## Prereqs
- Docker Desktop or WSL2 backend
- Git Bash or PowerShell 5.1+
- Node.js 24+
- Go 1.25+
- Python 3.11+ with `uv` or `pip`

## Environment setup
- Paper mode: copy `.dev.vars.example` → `.dev.vars`
- Live mode: run `scripts/setup-and-secrets.ps1` or `scripts/upload-secrets.ps1`
- OpenRouter/LLM: store key in Hermes `.env` or Windows user env; avoid PowerShell inline raw exports

## Local stack
- Hardened: `docker compose -f docker-compose.dhi.yml up -d`
- Simple: `docker compose up -d` after fixing Dockerfile mapping
- Health:
  - Worker: `http://localhost:8787/health`
  - Hero agent: `http://localhost:8788/health`
  - Go engine: `http://localhost:8080/api/health`
  - Metrics: `http://localhost:9090/metrics`

## One-time admin
- Run `fix-nat.bat` as Administrator for firewall/NAT/host aliases

## Common scripts
| Script | Purpose |
|---|---|
| `scripts/run-smoke.ps1` | Smoke tests paper/live |
| `scripts/monitor-live-critical.js` | Live monitoring |
| `scripts/verify-production-endpoints.js` | Post-deploy endpoint check |
| `scripts/backup-database.ps1` | DB backup |

## PowerShell profile fix
- Do not export secrets as bare tokens in `$PROFILE`
- Use `$env:NAME = 'value'` in profile, or load from `.env` via helper script
- Confirm no stray API key strings exist in startup scripts
