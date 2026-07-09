# Convergence / Archive Proposal

## Active candidates
- Root `src/`, `index.js`, `wrangler.toml` → keep; canonical Worker
- `hft/` → keep; canonical Go engine
- `backend/` → keep or retire if unused by local Docker
- `frontend/` → keep if serving dashboard UI
- `proxy-gateway/`, `dex-executor/`, `ip-locator/`, `nexus/` → keep if used; else archive

## Likely archival
- `ArbitrageBot/`, `UltimateArbitrageBot/`, `MegaArbitrageBot/`
  - Multiple overlapping implementations with backups; converge tests/config into root
- `UltimateArbitrageHFT/` nested git directory
  - Appears to be duplicate checkout; remove nested `.git` or folder
- `test_reports/` bulk XML/JSON older iterations
  - Archive to `.archive/test_reports/` unless needed for compliance

## Governance
- Define canonical service map in `docs/service-map.md`
- Freeze additions to legacy bot folders; migrate active logic into root `src/`
- Add directory ownership note in `CODEOWNERS`
