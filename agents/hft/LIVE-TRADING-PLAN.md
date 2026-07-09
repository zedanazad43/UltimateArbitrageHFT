# Live Trading Real Test Plan

## Overview

This document outlines a **4-phase rollout plan** for live trading with the HFT bot, 
starting from paper trading validation through to full production with real capital.

---

## Phase 1: Paper Trading Validation (24 hours)

**Objective:** Confirm all strategies detect opportunities, execution logic works, 
and system stability is acceptable.

### Configuration
```bash
PAPER_TRADING=true           # No real orders
TRADING_ENABLED=false        # Master kill switch
INITIAL_CAPITAL_USD=10000    # Simulated capital
SCAN_INTERVAL_MS=500         # Fast scan
```

### Run
```bash
bash test-paper-trading.sh   # Automated test
# Or manually:
export PAPER_TRADING=true TRADING_ENABLED=false
./hft-engine 2>&1 | tee paper-trading-24h.log &
# Let it run 24 hours
```

### Success Criteria
- [ ] No crashes or restart required
- [ ] Bot logs show:
  - `engine: starting scan loop`
  - Price feeds populate within 2–5 seconds
  - Scan cycles complete every ~500ms
  - Zero or positive simulated daily P&L
- [ ] Memory usage stable (< 200 MB after 24h)
- [ ] Prometheus metrics populated:
  - `hft_scan_latency_ms` < 100ms (p95)
  - `hft_trades_total` > 0 (at least some opportunities detected)

### Monitoring
```bash
# In separate terminal, every 1 hour:
curl http://localhost:9090/metrics | grep -E "hft_trades_total|hft_scan_latency"

# Check logs for errors:
grep -i "error\|panic\|fatal" paper-trading-24h.log
```

### Troubleshooting
- **No opportunities detected?** Spreads may be tight; check `MAX_SPREAD_PCT=5.0`
- **High scan latency?** Network may be slow; check `SCAN_INTERVAL_MS`
- **Memory leak?** Restart bot; monitor RSS growth

---

## Phase 2: Spot Trading with Paper Mode (48 hours)

**Objective:** Verify trading execution path works without real orders.

### Configuration
```bash
PAPER_TRADING=true           # Still no real orders
TRADING_ENABLED=true         # ← NEW: enable execution path
INITIAL_CAPITAL_USD=10000
MIN_NET_PROFIT_PCT=0.10      # Only strong opportunities
TELEGRAM_BOT_TOKEN=xxx       # Get alerts
TELEGRAM_CHAT_ID=xxx
```

### Run
```bash
source .env
./hft-engine 2>&1 | tee phase2-48h.log &

# Monitor Telegram alerts:
# Should see messages like: 🎯 CEX [BTCUSDT] BUY→SELL net 0.25% size $500 mode paper
```

### Success Criteria
- [ ] Telegram alerts fire for paper trades
- [ ] Logs show:
  - `trade strategy=CEX symbol=BTCUSDT mode=paper`
  - `trade strategy=PERPS symbol=ETHUSDT mode=paper`
  - Position sizing logs (Kelly sizing applied)
- [ ] Equity tracking correct (profit/loss calculations)
- [ ] No exceptions or panics

### Manual Verification
```bash
# Spot check the logs every 6 hours:
tail -50 phase2-48h.log | grep -E "trade|error|alert"

# Verify equity growth or stability:
# (depends on market conditions)
```

---

## Phase 3: Live Spot Trading - Micro Capital (1 week)

**Objective:** Test real order execution, settlement, and exchange interactions.

### Prerequisites
- [ ] MEXC/Binance/Bybit account with $500+ balance
- [ ] Real API keys (not mock/sandbox)
- [ ] Telegram bot configured
- [ ] Spare $500 budget (worst-case daily loss cap)

### Configuration
```bash
# Update .env with REAL API keys
MEXC_API_KEY=your_real_key
MEXC_API_SECRET=your_real_secret

# Live trading, but minimal capital
PAPER_TRADING=false          # ← REAL MODE
TRADING_ENABLED=true
INITIAL_CAPITAL_USD=100      # START TINY
MAX_DAILY_LOSS_USD=10        # Tight loss cap
MIN_NET_PROFIT_PCT=0.15      # Only best trades
SCAN_INTERVAL_MS=500
```

### Deployment
```bash
# Option 1: Local (safest for first test)
source .env
./hft-engine 2>&1 | tee phase3-live-1w.log &

# Option 2: Docker (if preferred)
docker build -f Dockerfile -t hft-test .
docker run --env-file .env hft-test

# Option 3: Screen/tmux (remote)
screen -S hft -d -m bash -c 'source .env && ./hft-engine'
screen -r hft    # Attach to logs
```

### Hourly Checklist
Every 1 hour, verify:
```bash
# 1. Bot health
curl http://localhost:9090/healthz

# 2. Current P&L
curl -H "Authorization: Bearer ${HFT_ENGINE_SECRET}" \
  http://localhost:8080/api/health | jq '.{equity_usd, daily_pnl}'

# 3. Check exchange order history manually
# (MEXC dashboard / Binance app / Bybit console)

# 4. Telegram alerts (should see 1-5 per hour)

# 5. Any errors in logs?
grep -i "error\|failed" phase3-live-1w.log | tail -5
```

### Success Criteria (per day)
- [ ] All orders execute successfully (check exchange history)
- [ ] No failed orders due to balance / API issues
- [ ] Telegram alerts timely and accurate
- [ ] Daily P&L positive or break-even (not hitting loss cap)
- [ ] No more crashes than Phase 1–2 (expect <1 restart)

### Exit Criteria (stop immediately)
- [ ] Daily loss hits cap 3+ times → increase `MAX_DAILY_LOSS_USD`
- [ ] Exchange API rate-limited → add delay to `MIN_SECONDS_BETWEEN_TX`
- [ ] Persistent errors → debug and fix before continuing
- [ ] Order settlement failures → check balance, API keys, network

### Week 1 Summary
After 7 days, fill out:
```
✓ Total trades executed:     _____
✓ Successful settlement:      ___ / ___ (should be ~100%)
✓ Total P&L:                  $___
✓ Daily loss cap hit:         ___ times
✓ Restarts required:          _____
✓ Avg scan latency:           ___ ms
✓ Alerts received:            _____ (should be >100)
```

---

## Phase 4: Scale Up to Production (2 weeks observation, then ramp)

**Objective:** Run with meaningful capital, monitor 24/7, and establish operational procedures.

### Prerequisites
- [ ] Phase 3 completed successfully
- [ ] Week 1 stats show >70% win rate and positive ROI
- [ ] Operations team ready (alerts, monitoring, incident response)
- [ ] $5,000+ account balance (3× max daily loss cap)
- [ ] Deployment infrastructure ready (Railway, Docker, K8s)

### Configuration
```bash
# Increase capital, loosen filters slightly
PAPER_TRADING=false
TRADING_ENABLED=true
INITIAL_CAPITAL_USD=5000     # Real capital
MAX_DAILY_LOSS_USD=500       # Conservative loss limit
MIN_NET_PROFIT_PCT=0.10      # 10bps minimum profit
SCAN_INTERVAL_MS=500
```

### Deployment (Railway recommended)
```bash
railway login
railway link                 # Link to project
railway up --detach          # Deploy
railway env                  # View secrets
railway domain               # Get URL
```

Then set environment secrets in Railway:
- `MEXC_API_KEY`, `MEXC_API_SECRET`
- `BINANCE_API_KEY`, `BINANCE_API_SECRET`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- All others from `.env`

### Production Monitoring

**1. Prometheus + Grafana Dashboard**
```bash
# Install Prometheus scraper (if not already)
# Add job to prometheus.yml:
- job_name: 'hft-engine'
  static_configs:
    - targets: ['your-railway-app.railway.app:9090']

# Create Grafana dashboard with:
# - hft_trades_total (rate)
# - hft_trade_net_profit_pct (distribution)
# - hft_scan_latency_ms (p99)
# - Uptime (scrape success)
```

**2. Alerting Rules**
```yaml
# Alert on circuit breaker open
- alert: HFTExchangeCircuitBreakerOpen
  expr: exchange_circuit_breaker_open == 1
  for: 5m
  
# Alert on daily loss cap
- alert: HFTDailyLossCapReached
  expr: hft_daily_pnl < -500
  for: 1m

# Alert on no trades (dead bot)
- alert: HFTNoTradesIn1Hour
  expr: rate(hft_trades_total[1h]) == 0
  for: 5m
```

**3. Logs**
```bash
# Aggregate logs to ELK / CloudWatch / Stackdriver
# Search pattern: "ERROR" or "PANIC"
# Alert on 3+ errors in 5 min
```

### Ramp Schedule

**Week 1–2: Observation (5% capital)**
- Run with $250 of $5k budget
- Daily reviews
- No changes to config

**Week 3–4: Gradual Ramp (25% capital)**
- Increase to $1,250
- Monitor risk metrics
- A/B test strategies if desired

**Week 5+: Full Production (100% capital)**
- Use all $5,000 notional
- Weekly review cycle
- Quarterly strategy tuning

### Daily Operations Checklist

Every morning (before market open):
- [ ] Check bot health: `curl /api/health`
- [ ] Review yesterday's P&L
- [ ] Check Telegram for any alerts missed
- [ ] Verify all exchanges accessible

Every 4 hours:
- [ ] Scan logs for errors
- [ ] Check Prometheus metrics
- [ ] Verify no hung goroutines (memory stable)

Weekly:
- [ ] Review P&L trend
- [ ] Analyze strategy performance (by `hft_trades_total` label)
- [ ] Check for drift in spread assumptions
- [ ] Review circuit breaker events

Monthly:
- [ ] Deep dive on losing trades
- [ ] Assess strategy win rates
- [ ] Optimize `MIN_NET_PROFIT_PCT`, `MAX_SPREAD_PCT`
- [ ] Plan next month's focus

---

## Rollback Plan

If something goes wrong at any phase:

### Immediate (< 1 minute)
```bash
# Stop the bot
pkill -9 hft-engine

# Verify stopped
curl http://localhost:9090/metrics
# Should timeout or get connection refused
```

### Investigation (1–10 minutes)
```bash
# Check recent logs
tail -100 hft-engine.log | grep -E "ERROR|PANIC"

# Check exchange balances / pending orders
# (MEXC dashboard, Binance app, etc.)

# Check Telegram alerts for clues
```

### Recovery
- If **API key issue**: Update `.env`, restart
- If **exchange down**: Wait 5 min, check status page
- If **negative P&L**: Increase `MIN_NET_PROFIT_PCT`, restart
- If **software bug**: Roll back to last known-good commit

### Post-Incident
1. Log the incident (date, time, loss, cause)
2. Add fix or safeguard to prevent recurrence
3. Update monitoring/alerting if needed
4. Resume trading when confident

---

## Success Metrics (Production)

After 1 month in Phase 4, target:

| Metric | Target | Check |
|--------|--------|-------|
| Win rate | > 55% | `hft_trades_total / profitable_trades` |
| Avg profit per trade | > 0.15% | `avg(hft_trade_net_profit_pct)` |
| Daily ROI | > 0.10% | `daily_pnl / initial_capital` |
| Uptime | > 99% | `scrape_success_rate` in Prometheus |
| Scan latency (p99) | < 150ms | `hft_scan_latency_ms` histogram |
| Daily loss cap hits | < 2/month | Event log |

If all targets met → ready for long-term production.

---

## Emergency Contacts

- **Exchange status**: https://status.binance.com, https://status.mexc.com
- **Flashbots status**: https://status.flashbots.net
- **Gas tracker**: https://etherscan.io/gastracker
- **On-call rotation**: (configure for your team)

---

## Appendix: Testing Checklist

### Pre-Live Checklist
- [ ] All unit tests pass (`go test ./...`)
- [ ] Paper trading runs 24h without crash
- [ ] Paper trading P&L trends positive or stable
- [ ] Telegram alerts configured and tested
- [ ] Exchange API keys valid (test small order)
- [ ] PostgreSQL (if used) accessible
- [ ] Monitoring / alerting ready
- [ ] Incident response plan documented
- [ ] Team trained on operations

### Pre-Production Checklist
- [ ] Phase 3 (micro capital) completed 1 week successfully
- [ ] Win rate > 50%, positive cumulative P&L
- [ ] No unresolved bugs or crashes
- [ ] Documentation up-to-date
- [ ] Deployment pipeline tested
- [ ] Rollback procedure verified
- [ ] 24/7 monitoring active
- [ ] Team on-call rotation confirmed
