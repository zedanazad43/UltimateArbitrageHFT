# Security / Secrets Audit

## Local secret stores
- Hermes credential store: `C:\Users\azadz\AppData\Local\hermes\.env`
  - Access from Hermes tools is gated; do not read directly.
- Repo secret config:
  - `docs/env-reference.md`: single source of truth for vars/secrets
  - Scripts: `scripts/upload-secrets.ps1`, `scripts/setup-and-secrets.ps1`
  - Examples: `ArbitrageBot/ultimate-arbitrage-hft/.dev.vars.example`, `hero-super-agent/hero-agent/.env.example`, `dex-executor/.dev.vars.example`

## Commit hygiene
- Do not commit `.env`, `.dev.vars`, `*.pem`, `*.key`.
- CI uses GitHub Secrets and `wrangler secret put` / bulk upload.
- `deploy.yml` writes secrets to `/tmp/cf_secrets.json` with `0o600`; acceptable CI pattern.

## Identified issues / follow-ups
- Tracked plaintext secret files that should be removed:
  - `api_keys.txt`
  - `.env.docker`
  - `.env.dhi`
- PowerShell profile noise reported by user shows API key token being executed as command; that means key material is not reliably loaded through supported paths.
- Fix approach:
  - Store OpenRouter/exchange keys in Hermes `.env` or repo `.dev.vars` / `.env` files
  - Remove any raw shell exports from profile/ad-hoc startup
- Remaining action required outside this repo:
  - Rotate the exposed server/token material previously referenced in `api_keys.txt`
  - Audit third-party provider dashboards for the same token
