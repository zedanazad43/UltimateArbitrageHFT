# HFT Bot Testing & Trading Guide

## Unit Tests Status ✓

All unit tests pass successfully:
- `internal/db` — Database integration (44s)
- `internal/executor` — Exchange order placement (15s)  
- `internal/feeds` — WebSocket price feeds (12s)
- `internal/notify` — Telegram alerts (19s)
- `internal/risk` — Position sizing & Kelly (14s)
- `internal/strategies/cex` — CEX spatial arb (6s)
- `internal/strategies/dex` — DEX cross-chain (6s)
- `internal/strategies/funding` — Funding rate harvest (22s)
- `internal/strategies/perps` — Perps vs spot (8s)

**Run tests:**
```bash
cd hft
go test ./... -v
```

**Run tests with database integration (requires TEST_DB_DSN):**
```bash
TEST_DB_DSN="postgres://user:pass@localhost:5432/hft" go test ./... -v
```

---

## 1. Paper Trading Mode (Safe for Dev/Testing)

### Prerequisites
- Go 1.25+
- Valid exchange API keys (at least one of MEXC, Binance, or Bybit)
- Optional: PostgreSQL for trade logging

### Setup

```bash
cd hft
cp .env.example .env
```

Edit `.env`:
```bash
# Exchange credentials (use real keys for price feeds, no trades placed)
MEXC_API_KEY=your_key
MEXC_API_SECRET=your_secret

# Safety defaults
PAPER_TRADING=true          # ← Paper mode = no real orders
TRADING_ENABLED=false       # ← Master kill switch
INITIAL_CAPITAL_USD=10000   # Simulated capital
MAX_DAILY_LOSS_USD=100      # Stop after losing $100/day
MIN_NET_PROFIT_PCT=0.05     # Skip trades < 0.05% profit

# Optional: Telegram alerts
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

### Run Paper Trading

```bash
source .env
go run ./cmd/hft

# Or with binary
./hft-engine
```

### Verify It Works

In another terminal:
```bash
# Check health
curl http://localhost:8080/api/health

# Get current best opportunity
curl -H "Authorization: Bearer ${HFT_ENGINE_SECRET}" \
  http://localhost:8080/api/scan | jq .

# Prometheus metrics
curl http://localhost:9090/metrics | grep hft_
```

---

## 2. Live Trading Mode (Real Money)

### Prerequisites

All from Paper Trading, PLUS:

- **Funded exchange accounts** (BTC/ETH for DEX trades)
- **Private wallet key** with ETH for gas
- **RPC endpoints:**
  - Ethereum: `wss://eth-mainnet.g.alchemy.com/v2/YOUR_KEY` (via Alchemy)
  - Arbitrum: `https://arb1.arbitrum.io/rpc`
  - Flashbots: `https://rpc.flashbots.net` (for MEV protection)
- **Telegram alerts configured** (highly recommended)

### Configuration

Edit `.env`:
```bash
# ── CEX API (choose at least one) ──────────────────────────
MEXC_API_KEY=xxx
MEXC_API_SECRET=xxx
# OR
BINANCE_API_KEY=xxx
BINANCE_API_SECRET=xxx
# OR
BYBIT_API_KEY=xxx
BYBIT_API_SECRET=xxx

# ── On-chain (DEX arbitrage) ──────────────────────────────
WALLET_PRIVATE_KEY=xxx          # Hex, no 0x prefix
ETH_RPC_URL=https://rpc.flashbots.net
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc
FLASHBOTS_RELAY_URL=https://relay.flashbots.net
FLASHBOTS_SIGNING_KEY=xxx       # Separate key for relay

# ── API keys ──────────────────────────────────────────────
ALCHEMY_API_KEY=xxx
ZEROX_API_KEY=xxx

# ── PostgreSQL (for trade history) ───────────────────────
POSTGRES_DSN=postgres://user:pass@localhost:5432/hft?sslmode=disable

# ── Telegram alerts (CRITICAL) ────────────────────────────
TELEGRAM_BOT_TOKEN=xxx
TELEGRAM_CHAT_ID=xxx

# ── LIVE TRADING SETTINGS ────────────────────────────────
PAPER_TRADING=false         # ← LIVE MODE
TRADING_ENABLED=true        # ← ENABLE ORDERS (was false)
INITIAL_CAPITAL_USD=5000    # Start with $5k notional
MAX_DAILY_LOSS_USD=500      # Stop if down $500/day
MIN_SECONDS_BETWEEN_TX=30   # Rate limit (30s between trades)
MAX_SPREAD_PCT=5.0          # Skip if spread > 5%
MIN_NET_PROFIT_PCT=0.10     # Only trade 0.10%+ profit
SCAN_INTERVAL_MS=500        # Refresh prices every 500ms
```

### Safety Checklist Before Going Live

- [ ] Test API keys with small order size in paper mode
- [ ] Verify Telegram bot sends messages
- [ ] Check daily loss cap is set to reasonable amount
- [ ] Confirm `MIN_NET_PROFIT_PCT` is > 0.05 (avoids trash trades)
- [ ] Verify exchange balance > `MAX_DAILY_LOSS_USD` × 3
- [ ] Dry-run with minimal `INITIAL_CAPITAL_USD` ($100)
- [ ] Review all logs: `go run ./cmd/hft 2>&1 | tee live.log`
- [ ] Monitor metrics: `curl http://localhost:9090/metrics | grep hft_`

### Run Live Trading

```bash
export $(cat .env | grep -v '^#' | xargs)
./hft-engine

# Monitor in separate terminal
watch -n 1 'curl http://localhost:9090/metrics | grep hft_trades_total'
```

### In-Flight Monitoring

**Metrics (Prometheus):**
```bash
curl http://localhost:9090/metrics | grep -E "hft_trades_total|hft_trade_net_profit_pct"
```

**Live trades:**
```bash
curl -H "Authorization: Bearer ${HFT_ENGINE_SECRET}" \
  http://localhost:8080/api/health | jq '.{daily_pnl, daily_trades, equity_usd}'
```

**Stop trading immediately:**
```bash
# Kill the process
pkill -f hft-engine

# Or set loss cap to 0 (via config if supported)
```

---

## 3. Production Deployment

### Option A: Railway.app (Recommended)

```bash
railway login
railway link
railway up --detach
railway domain              # Gets your URL
```

Then update Cloudflare Worker:
```bash
# Edit wrangler.toml
HFT_ENGINE_URL = "https://your-railway-app.railway.app"
npx wrangler deploy
```

### Option B: Docker (any VPS)

```bash
docker build -f Dockerfile -t hft-engine .
docker run -d \
  --env-file .env \
  -p 8080:8080 \
  -p 9090:9090 \
  hft-engine
```

### Option C: Kubernetes

Deploy with resources:
```yaml
resources:
  limits:
    cpu: 1000m
    memory: 512Mi
  requests:
    cpu: 250m
    memory: 256Mi
```

---

## 4. Real Trading Test Scenario

### Phase 1: Dry-run (Paper Trading, 24 hours)

```bash
# .env configuration
PAPER_TRADING=true
TRADING_ENABLED=false
SCAN_INTERVAL_MS=500
```

**Goal:** Verify price feeds, strategies detect opportunities, no crashes.

**Checklist:**
- [ ] Bot starts without errors
- [ ] Price feeds populate within 2–5 seconds
- [ ] Metrics appear: `hft_scan_latency_ms`, `hft_trades_total`
- [ ] No memory leaks (check RSS after 24h)
- [ ] All 4 strategies (CEX, DEX, Perps, Funding) run each cycle

### Phase 2: Spot-only Paper Trades (48 hours)

```bash
# .env configuration
PAPER_TRADING=true
TRADING_ENABLED=true    # ← NOW enabled (still no real orders)
INITIAL_CAPITAL_USD=10000
MIN_NET_PROFIT_PCT=0.10
TELEGRAM_BOT_TOKEN=xxx  # Get alerts
```

**Goal:** Verify trade execution logic, sizing, and alerts work.

**Checklist:**
- [ ] Bot logs paper trades: `strategy=CEX symbol=BTCUSDT netPct=0.15% mode=paper`
- [ ] Equity tracks correctly (profit/loss calculations)
- [ ] Telegram alerts fire for each trade
- [ ] Database logs trades (if configured)
- [ ] No rejected orders due to insufficient balance

### Phase 3: Live Trading with Minimal Capital (1 week)

```bash
# .env configuration
PAPER_TRADING=false         # ← REAL ORDERS
TRADING_ENABLED=true
INITIAL_CAPITAL_USD=100     # Start tiny
MAX_DAILY_LOSS_USD=10       # Tight loss cap
MIN_NET_PROFIT_PCT=0.15     # Only best opportunities
```

**Goal:** Verify live order execution, exchanges, fees, and settlement.

**Hourly manual checks:**
- [ ] `curl /api/health` — equity increasing or stable
- [ ] Exchange order history — orders settled
- [ ] Telegram alerts — timely, accurate
- [ ] No API errors in logs

### Phase 4: Scale Up (Production)

```bash
# .env configuration
INITIAL_CAPITAL_USD=5000
MAX_DAILY_LOSS_USD=500
MIN_NET_PROFIT_PCT=0.10     # Loosen slightly for volume
```

**Deployment:**
1. Deploy to Railway/Docker
2. Verify all endpoints work
3. Run smoke tests
4. Enable Telegram alerts to your ops channel
5. Set up monitoring dashboard (Prometheus + Grafana)

---

## Troubleshooting

### "Circuit breaker OPEN for exchange"
Exchange API failed 3+ times. Check:
- API keys are valid
- Exchange is not under maintenance
- Rate limits not exceeded

### "Daily loss cap reached"
Bot stopped to protect capital. Check:
- `MAX_DAILY_LOSS_USD` is reasonable
- Strategies are filtering bad trades (low `MIN_NET_PROFIT_PCT`?)
- Market volatility (spreads > `MAX_SPREAD_PCT`?)

### "Insufficient balance for order"
Exchange account underfunded. Check:
- MEXC/Binance/Bybit balance
- Pending orders not blocking capital
- Position sizing is within budget

### "No opportunities found"
Price spreads too tight. Check:
- Are price feeds connected? (`/api/scan` should not be null)
- Is `MIN_NET_PROFIT_PCT` too high?
- Are exchanges in maintenance?

### "Gas too high, skipping DEX trade"
On-chain gas exceeded `MAX_GAS_COST_PCT` of profit. Check:
- Use Arbitrum instead of Ethereum (10–20× cheaper)
- Increase `MAX_GAS_COST_PCT` to 0.50
- Batch trades during low-gas hours

---

## Metrics & Monitoring

### Prometheus Metrics (port :9090)

```
hft_trades_total{strategy="cex",mode="live"}       — Total trades executed
hft_trade_net_profit_pct{strategy="cex"}           — Distribution of trade P&L
hft_scan_latency_ms                                — Time per scan cycle
```

### Example Grafana Dashboard

```
Row 1: Trade Volume
  - hft_trades_total by strategy, last 24h
  
Row 2: Profitability
  - hft_trade_net_profit_pct quantiles (p50, p95)
  
Row 3: Performance
  - hft_scan_latency_ms p99 (should be <100ms)
  
Row 4: Health
  - Uptime (scrape success rate)
  - Exchange circuit breaker status
```

---

## Git Commits Log

All changes committed and ready for CI/CD:
```
git log --oneline | head -10
```

Deploy via:
```bash
git push origin main
# CI/CD pipeline:
# 1. Lint + Format (npm)
# 2. Security Audit (npm)
# 3. Unit Tests (go test ./...)
# 4. Build (wrangler deploy --dry-run)
# 5. Deploy Staging (wrangler deploy --env staging)
# 6. Deploy Production (with approval gate + smoke tests)
```
