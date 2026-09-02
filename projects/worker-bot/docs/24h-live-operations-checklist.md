# 24h Live Operations Checklist

This checklist is for a controlled 24-hour live run on the current production profile.

## Preconditions (T-10 minutes)

Run all three commands and proceed only if all are `PASS`.

```bash
npm run smoke:all-guards
npm run smoke:core-flags -- --samples 8 --interval-ms 5000
npm run monitor:exec:quick
```

If any command fails:

- Do not continue live expansion.
- Trigger the stop sequence in [Emergency Auto-Stop](#emergency-auto-stop).

## 24h Monitoring Schedule

### Window A: Hour 0-2 (Intensive)

- Every 10 minutes:

```bash
npm run smoke:safety-lock
node scripts/diagnose-exchange-readiness.js
```

- Every 30 minutes:

```bash
npm run monitor:exec:quick
```

### Window B: Hour 2-6 (Stabilization)

- Every 15 minutes:

```bash
npm run smoke:safety-lock
node scripts/diagnose-exchange-readiness.js
```

- Every 60 minutes:

```bash
npm run monitor:exec:quick
```

### Window C: Hour 6-24 (Standard)

- Every 30 minutes:

```bash
npm run smoke:safety-lock
node scripts/diagnose-exchange-readiness.js
```

- Every 2 hours:

```bash
npm run smoke:core-flags -- --samples 8 --interval-ms 5000
```

- Every 4 hours:

```bash
npm run smoke:all-guards
```

## Alert Classification

### Warning

Treat as warning when any one of these appears once:

- `exchangeAuthFailures > 0` in a single snapshot.
- A transient network/API failure in one cycle.
- `executeAll.success_count < executeAll.total` in one quick monitor run.
- A circuit breaker opens and auto-recovers in the same observation window.

Operator response:

- Keep live mode active.
- Increase monitoring frequency to Window A cadence for 60 minutes.
- If warning repeats twice consecutively, escalate to critical.

### Critical

Treat as critical if any one of these occurs:

- `readyForLive = false`.
- `spotOnlyLock = false`.
- `strategy_flags.perps = true` or `strategy_flags.funding = true`.
- Core drift: any of `cex`, `dex`, `triangular`, `statistical` flips to `false`.
- Protected endpoints fail in two consecutive checks.
- `monitor:exec:quick` has failures in two consecutive runs.

Financial critical threshold (operational):

- If daily live PnL reaches `-12 USDT` or lower, execute stop sequence.

## Emergency Auto-Stop

Use this sequence immediately on any critical event.

### Step 1: Stop live execution

```bash
curl -X POST https://api.ecostamp.net/stop -H "x-admin-token: YOUR_ADMIN_TOKEN"
```

### Step 2: Force paper mode

```bash
curl -X POST https://api.ecostamp.net/mode/paper -H "x-admin-token: YOUR_ADMIN_TOKEN"
```

### Step 3: Re-enable spot-only lock

```bash
curl -X POST https://api.ecostamp.net/strategy/spot-lock/enable -H "x-admin-token: YOUR_ADMIN_TOKEN"
```

### Step 4: Confirm lock state

```bash
curl -s https://api.ecostamp.net/api/safety-state -H "x-admin-token: YOUR_ADMIN_TOKEN"
curl -s https://api.ecostamp.net/api/status -H "x-admin-token: YOUR_ADMIN_TOKEN"
```

Expected post-stop state:

- `trading_enabled = false`
- `paper_trading = true`
- `spot_only_lock = true`
- `strategy_flags.perps = false`
- `strategy_flags.funding = false`

## Recovery Gate (Before returning to live)

Do not return to live until all are true:

1. `npm run smoke:all-guards` passes.
2. `node scripts/diagnose-exchange-readiness.js` reports no blocking exchange errors.
3. `npm run smoke:core-flags -- --samples 8 --interval-ms 5000` passes.
4. Two consecutive monitoring cycles are fully green.

## End-of-Run Decision (After 24h)

### Promote

Promote to next stage only if:

- No critical incidents in 24h.
- No repeated warning pattern (same warning repeating 2+ times back-to-back).
- All guard suites remain green in scheduled checkpoints.

### Extend

Extend another controlled 24h if:

- There was one critical incident with successful containment.
- Warning noise is elevated but not critical.

### Rollback

Rollback to paper-only if:

- Two or more critical incidents occur in the same 24h window.
- Core flags continue drifting despite guard enforcement.

## Automated Critical Monitor

Use the monitor below to automate 24h checks, Telegram critical alerts, and optional auto-stop sequence.

### Full 24h auto-stop mode

```bash
npm run monitor:critical
```

Default behavior:

- Runs 288 samples at 5-minute intervals.
- Evaluates critical conditions each cycle.
- Sends Telegram alert on critical (if configured).
- Executes auto-stop sequence on critical:
	- `POST /stop`
	- `POST /mode/paper`
	- `POST /strategy/spot-lock/enable`

### Dry-run mode (no auto-stop)

```bash
npm run monitor:critical:dry
```

### Custom run example

```bash
node scripts/monitor-live-critical.js \
	--samples 24 \
	--interval-ms 300000 \
	--max-daily-loss-usd 12 \
	--auto-stop true
```

### Output artifacts

The script writes runtime artifacts into `logs/`:

- `monitor-live-critical-<timestamp>.jsonl`
- `monitor-live-critical-<timestamp>.summary.json`

Exit codes:

- `0`: no critical triggered during the run
- `2`: critical triggered and monitoring stopped early
- `1`: fatal runtime error
