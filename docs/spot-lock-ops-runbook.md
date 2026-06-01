# Spot Lock Operations Runbook

## Scope
This runbook defines operations targets and response steps for spot-only safety lock protection.

## SLOs
- `stateFailures = 0` on all scheduled spot-lock monitor runs.
- `networkFailures <= 1%` of monitor samples measured daily.
- `readyForLive = true` in daily snapshot unless planned maintenance is active.

## Monitoring Pipelines
- 15-minute monitor workflow: `.github/workflows/spot-lock-monitor.yml`
- Daily report workflow: `.github/workflows/spot-lock-daily-report.yml`

## Alert Policy
- Critical alert:
  - Trigger: `stateFailures > 0`
  - Action: fail workflow + Telegram critical message
- Warning alert:
  - Trigger: `stateFailures = 0` and `networkFailures > 0`
  - Action: Telegram warning message only

## Incident Response

### A) Single state failure
1. Open latest workflow logs and artifact `spot-lock-summary.json`.
2. Validate current live state:
   - `npm run smoke:safety-lock`
   - `npm run smoke:lock-block`
3. If both pass, mark as transient and continue monitoring.

### B) Repeated state failures (2+ runs)
1. Execute full guard suite:
   - `npm run smoke:all-guards`
2. Check latest deployment workflow and recent config-write operations.
3. Re-enforce lock manually:
   - `npm run smoke:safety-lock -- --enforce-lock`
4. Escalate as production incident and pause risky config changes until stable.

### C) Elevated network failures
1. Confirm whether failures are custom-domain edge challenges or transient fetch issues.
2. Re-run monitor with retries:
   - `npm run monitor:spot-lock -- --samples 10 --interval-ms 10000 --fetch-retries 2 --retry-delay-ms 1000`
3. If state remains stable and only network failures persist, keep service active and track trend.

## Daily Ops Checklist
1. Verify daily report artifact exists.
2. Check 24h run counts and failure deltas.
3. Confirm `readyForLive` is true.
4. Open an ops ticket if SLO thresholds were exceeded.
