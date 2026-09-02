# Test / Gap Summary

## Declared test commands
- `npm test`: `node --test tests/unit.test.js`
- `npm run test:all`: long list including:
  - unit, exchange.integration, prices, exchange-multi, notifier, dex, hft-client, ai-client, db-schema-init, security-auth, dashboard-api-wiring, platforms-api, self-evaluation, proxy-pool, auto-executor, bot-memory, orchestrator.atomic, safety-lock
- Scripts also include monitors and smoke verifications

## Likely gaps
- Some test filenames in `test:all` may not exist in `tests/`
- `backend/tests/*.py` are not invoked from root `package.json`
- Bug:
  - `package.json` line 27/38 references `tests/exchange.integration.test.js`, but file list shows `exchange-multi.test.js` and `dashboard-api-wiring.test.js`
  - Need exact filename audit

## Safety review
- `security-auth.test.js`, `safety-lock.test.js`: present in `tests/`
- `scripts/secret-scan.js`, `scripts/security-audit.js`: present
- Run order:
  1. `npm run check:static`
  2. `npm run scan:secrets`
  3. `npm run test:all`
  4. `npm run smoke:all-guards`

## Action
1. Audit exact filenames in `tests/` against `test:all`.
2. Fix script references and add missing coverage stubs only if intentionally absent.
