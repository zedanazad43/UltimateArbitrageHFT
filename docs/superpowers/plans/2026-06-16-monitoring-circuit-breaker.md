# 24/7 Monitoring + Circuit Breaker — Design Doc

> **Status:** Approved 2026-06-16
> **Goal:** Continuous health monitoring with automatic trading halt on anomalies

## Current State
- No continuous monitoring — manual checks only
- src/risk.js exists but isn't continuously active
- scripts/monitor-performance.js does spot checks only

## Design

### Architecture
`
Cron (every 60s) ──> monitor.js ──> health checks (all exchanges, DB, KV, R2)
                          │
                          ├─ OK → log + update metrics
                          └─ FAIL → increment failure counter
                                     │
                                     └─ 3 consecutive fails → CIRCUIT BREAKER TRIP
                                           ├─ Set trading_enabled=false
                                           ├─ Send Telegram URGENT alert
                                           ├─ Log to admin_events
                                           └─ Require manual /api/admin/reset to re-enable
`

### Monitoring Checks
1. Exchange connectivity (all configured exchanges)
2. D1 database (SELECT 1)
3. KV store (read/write test)
4. R2 bucket (list operation)
5. HFT engine health (if configured)
6. Daily PnL limit check
7. Consecutive loss streak detection

### Circuit Breaker States
- **CLOSED** (normal) — all checks pass
- **OPEN** (tripped) — trading disabled, requires admin reset
- **HALF_OPEN** — admin has reset, monitoring before full re-enable

### Files
- Create: src/monitor-live.js — continuous health monitor
- Create: src/circuit-breaker.js — breaker state machine
- Modify: index.js — register /api/monitor/status endpoint + wire cron handler
- Modify: src/risk.js — add daily loss limit enforcement
