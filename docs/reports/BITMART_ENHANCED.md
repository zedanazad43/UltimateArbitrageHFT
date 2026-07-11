# BitMart Enhanced + External Proxy Infrastructure

**Date**: May 17, 2026  
**Version**: 2.0.0  
**Status**: Production Ready

---

## Overview

This document describes the complete BitMart exchange enhancement and external proxy server integration that powers the UltimateArbitrageHFT bot with enterprise-grade reliability, security, and performance.

### Key Features

1. **BitMart Circuit Breaker** — Automatically stops requests when service is unavailable
2. **Adaptive Rate Limiting** — Tracks per-second limits and throttles intelligently
3. **External Proxy Support** — Integrates Bright Data, Oxylabs, SmartProxy
4. **Automatic Fallback** — Falls back to local proxy pool if external provider fails
5. **Health Monitoring** — Periodic health checks with 1-minute caching
6. **Control Panel** — Real-time monitoring dashboard at `/control-panel`
7. **API Endpoints** — Full REST API for proxy stats, BitMart status, circuit breaker reset

---

## Architecture

### Components

#### 1. ExternalProxyManager (`src/infra/external-proxy.js`)

Manages connections to premium proxy providers with built-in health checks and fallback.

**Supported Providers:**
- `bright_data` — Bright Data (formerly Luminati) with username/password auth
- `oxylabs` — Oxylabs residential proxies
- `smartproxy` — SmartProxy with rotating IPs
- `none` — No external proxy (uses local pool only)

**Health Check:**
- Runs every 60 seconds (configurable)
- Detects provider unavailability and activates fallback
- Resets healthy state after successful request
- Opens circuit after 3 consecutive failures

**Configuration:**

```bash
# .env or Cloudflare Worker Secrets

# External proxy provider
EXTERNAL_PROXY_PROVIDER=bright_data  # or oxylabs, smartproxy, none

# Provider credentials
EXTERNAL_PROXY_USERNAME=your_username
EXTERNAL_PROXY_PASSWORD=your_password

# Local proxy pool (fallback)
PROXY_MODE=auto              # off, auto, required
PROXY_LIST='[{"url":"http://proxy1:8080"},...]'
DIRECT_EXCHANGES=bybit,gateio,kraken,coinbase
```

#### 2. BitmartEnhanced (`src/infra/bitmart-enhanced.js`)

Provides resilient BitMart order placement and balance fetching with multiple safeguards.

**Features:**
- **5 Retry Attempts** — Exponential backoff with jitter
- **Circuit Breaker** — Opens after 5 consecutive failures; resets after 60 seconds
- **Rate Limit Tracking** — Enforces 10 req/sec limit with adaptive throttling
- **Error Classification** — Handles 429 (rate limit), 40001 (balance), 40005 (restricted)
- **External Proxy Integration** — Can route through external provider
- **Comprehensive Logging** — Tracks all failures and retries

**API Methods:**

```javascript
import { getBitmartEnhanced, resetBitmartCircuitBreaker } from './src/infra/bitmart-enhanced.js';

const bitmart = getBitmartEnhanced(env);

// Get wallet balance
const balance = await bitmart.getBalance('USDT');
// Returns: { free: 100.5, locked: 10.0 }

// Place market order
const order = await bitmart.placeMarketOrder('BTC_USDT', 'BUY', 0.01, 500);
// Returns: { orderId: '12345', symbol: 'BTC_USDT', side: 'BUY', ... }

// Get stats (circuit breaker, rate limit state)
const stats = bitmart.getStats();
// Returns: { circuitBreakerOpen, circuitBreakerFailures, rateLimitRequests, ... }

// Reset circuit breaker (only after investigation)
resetBitmartCircuitBreaker();
```

**Circuit Breaker States:**

```
CLOSED (Normal) ─→ OPEN (Rate Limited / Failed)
                     ↓
                     [60-second cooldown]
                     ↓
                   RESET ─→ CLOSED
```

#### 3. ProxyPool (`src/infra/proxy-pool.js`)

Local proxy pool with three routing modes (unchanged from previous version).

**Modes:**
- `off` — No proxy; direct connections only
- `auto` — Uses proxy if available; falls back to direct if none configured
- `required` — Throws error if no proxy available

**Usage:**

```javascript
import { getGlobalProxyPool } from './src/infra/proxy-pool.js';

const pool = getGlobalProxyPool(env);

// Route through proxy if configured
const response = await pool.fetchWithProxy(url, { headers }, timeout);

// Check if exchange should be proxied
if (pool.shouldProxy('binance')) {
  // Route through proxy
}
```

---

## Configuration Guide

### Local Development

```bash
# No external proxy, local pool in auto mode
PROXY_MODE=auto
PROXY_LIST='[]'  # Empty pool; will use direct connections

# BitMart credentials
BITMART_API_KEY=your_key
BITMART_API_SECRET=your_secret
BITMART_MEMO=your_memo

# No external proxy
EXTERNAL_PROXY_PROVIDER=none
```

### Production with External Proxy (Bright Data)

```bash
# Enable external proxy
EXTERNAL_PROXY_PROVIDER=bright_data
EXTERNAL_PROXY_USERNAME=your_bright_data_username
EXTERNAL_PROXY_PASSWORD=your_bright_data_password

# BitMart can use external proxy
BITMART_USE_EXTERNAL_PROXY=true

# Local pool as fallback
PROXY_MODE=auto
PROXY_LIST='[{"url":"http://localhost:8080"}]'
DIRECT_EXCHANGES=bybit,gateio,kraken,coinbase
```

### Production with Multiple Fallbacks

```bash
# Primary: External proxy
EXTERNAL_PROXY_PROVIDER=oxylabs
EXTERNAL_PROXY_USERNAME=oxylabs_user
EXTERNAL_PROXY_PASSWORD=oxylabs_pass

# Secondary: Local proxy pool (for when external is down)
PROXY_MODE=required
PROXY_LIST='[
  {"url":"http://proxy1.local:8080"},
  {"url":"http://proxy2.local:8080"},
  {"url":"http://proxy3.local:8080"}
]'

# BitMart will first try external, then fall back to local pool
BITMART_USE_EXTERNAL_PROXY=true
```

---

## API Endpoints

### Public (No Auth)

```
GET /health
GET /
GET /control-panel (frontend monitoring dashboard)
```

### Protected (Requires ADMIN_TOKEN)

#### /api/proxy-stats
**Purpose:** Get proxy routing statistics and auto-executor health

**Response:**
```json
{
  "success": true,
  "proxyRouting": {
    "mode": "auto",
    "usingProxy": true,
    "availableProxies": 3
  },
  "strategyHealth": { ... },
  "executorPaperMode": true,
  "openPositions": 2
}
```

#### /api/bitmart/stats
**Purpose:** Get BitMart circuit breaker and rate limit state

**Response:**
```json
{
  "success": true,
  "data": {
    "circuitBreakerOpen": false,
    "circuitBreakerFailures": 0,
    "rateLimitRequests": 4,
    "rateLimitMaxPerWindow": 10,
    "externalProxyEnabled": true,
    "externalProxyStats": {
      "provider": "bright_data",
      "enabled": true,
      "healthy": true,
      "failureCount": 0
    }
  }
}
```

#### /api/bitmart/reset-circuit-breaker
**Purpose:** Manually reset BitMart circuit breaker (use after investigation)

**Method:** POST

**Response:**
```json
{
  "success": true,
  "message": "BitMart circuit breaker reset"
}
```

#### /api/execution-health
**Purpose:** Get strategy execution status and auto-executor stats

**Response:**
```json
{
  "success": true,
  "paperMode": true,
  "strategies": ["cex", "perps", "funding", "triangular", "dex", "statistical"],
  "portfolioBalance": 10000.00,
  "openPositions": 2
}
```

---

## Control Panel

**URL:** `https://ultimatearbitragehft.zedanazad43.workers.dev/control-panel`

### Features

- **📡 API Endpoints** — Real-time status of all 5 core endpoints
- **💳 BitMart Exchange** — Circuit breaker status, rate limits, external proxy info
- **🌐 Proxy Configuration** — Local pool mode, available proxies, external provider
- **⚡ Strategy Execution** — Paper/live mode, active strategies, portfolio balance
- **🤖 Auto Executor** — Paper mode toggle, position limits, strategy cooldown
- **📡 Frontend Check** — Verify browser-to-API connectivity

### Monitoring Alerts

The dashboard automatically:
- Refreshes endpoint health every 30 seconds
- Color-codes status (🟢 OK, 🟡 Warning, 🔴 Error)
- Provides action buttons (Start/Stop, Reset Circuit Breaker, etc.)
- Shows pulsing indicators for warning states

---

## Troubleshooting

### BitMart Circuit Breaker Open

**Symptom:**
```
Error: [BitMart] Circuit breaker OPEN. Service temporarily unavailable.
```

**Cause:** 5+ consecutive failed requests to BitMart API

**Solution:**
1. Check network connectivity: `curl https://api-cloud.bitmart.com/spot/v1/wallet`
2. Verify API credentials (BITMART_API_KEY, BITMART_API_SECRET, BITMART_MEMO)
3. Check if BitMart service is up: `https://status.bitmart.com`
4. Wait 60 seconds for automatic reset, OR manually reset via:
   ```bash
   curl -X POST https://ultimatearbitragehft.zedanazad43.workers.dev/api/bitmart/reset-circuit-breaker \
     -H "x-admin-token: YOUR_ADMIN_TOKEN"
   ```

### Rate Limited (429 / 50006)

**Symptom:**
```
Rate limited (429), retry in 1234ms
```

**Cause:** Exceeded 10 req/sec limit

**Solution:**
- Built-in: BitmartEnhanced automatically retries with exponential backoff
- Manual: Reduce trading frequency or increase strategy cooldown
- Check actual rate: View via `/api/bitmart/stats` → `rateLimitRequests`

### External Proxy Unhealthy

**Symptom:**
```
[external-proxy] Health check failed: ...
[external-proxy] Marked bright_data as unhealthy (3 failures)
```

**Cause:** External proxy provider is down or credentials are invalid

**Solution:**
1. Verify credentials: `EXTERNAL_PROXY_USERNAME`, `EXTERNAL_PROXY_PASSWORD`
2. Test proxy directly:
   ```bash
   curl -x http://user:pass@proxy.server:port https://www.binance.com
   ```
3. Check provider status page (Bright Data, Oxylabs, SmartProxy)
4. Falls back to local proxy pool automatically after 3 failures
5. Will retry health check after 60 seconds

### Fallback to Local Proxy Pool

**Expected behavior:** If external proxy fails 3+ times, BitmartEnhanced automatically falls back to local proxy pool

**Verify:** 
```bash
curl https://ultimatearbitragehft.zedanazad43.workers.dev/api/bitmart/stats \
  -H "x-admin-token: YOUR_TOKEN" | jq .data.externalProxyStats
```

---

## Performance Metrics

### Latency

- **BitMart API** (with local proxy): ~200-500ms
- **BitMart API** (with external proxy): ~500-1500ms
- **Health Check** (external proxy): ~2000-5000ms

### Throughput

- **Rate Limit**: 10 requests/second (BitMart enforced)
- **Retry Backoff**: 500ms base, exponential growth, max 30s
- **Circuit Breaker Reset**: 60 seconds

### Reliability

- **Circuit Breaker Threshold**: 5 consecutive failures
- **Health Check Interval**: 60 seconds
- **External Proxy Fallback**: Automatic after 3 failures
- **Retry Attempts**: 5 per request

---

## Testing

### Unit Tests

```bash
# Test proxy pool functionality
npm run test -- tests/proxy-pool.test.js

# Test auto-executor (uses proxy pool internally)
npm run test -- tests/auto-executor.test.js

# Run all tests
npm run test:all
```

### Integration Tests

```bash
# Verify production endpoints (requires ADMIN_TOKEN)
export ADMIN_TOKEN='your_token'
bash scripts/verify-production-endpoints.sh https://ultimatearbitragehft.zedanazad43.workers.dev
```

### Manual Testing

```bash
# Check BitMart stats
curl https://ultimatearbitragehft.zedanazad43.workers.dev/api/bitmart/stats \
  -H "x-admin-token: YOUR_TOKEN" | jq

# Reset circuit breaker
curl -X POST https://ultimatearbitragehft.zedanazad43.workers.dev/api/bitmart/reset-circuit-breaker \
  -H "x-admin-token: YOUR_TOKEN"

# Check execution health
curl https://ultimatearbitragehft.zedanazad43.workers.dev/api/execution-health \
  -H "x-admin-token: YOUR_TOKEN" | jq
```

---

## Production Deployment Checklist

- [ ] **Credentials Configured**
  - [ ] BITMART_API_KEY set
  - [ ] BITMART_API_SECRET set
  - [ ] BITMART_MEMO set
  - [ ] ADMIN_TOKEN set

- [ ] **External Proxy (Optional)**
  - [ ] EXTERNAL_PROXY_PROVIDER selected (bright_data / oxylabs / smartproxy / none)
  - [ ] EXTERNAL_PROXY_USERNAME configured
  - [ ] EXTERNAL_PROXY_PASSWORD configured

- [ ] **Local Proxy Pool (Fallback)**
  - [ ] PROXY_MODE set (auto / required)
  - [ ] PROXY_LIST JSON formatted (if using)
  - [ ] DIRECT_EXCHANGES listed

- [ ] **Verification**
  - [ ] Run `npm run test:all` → 391 tests pass
  - [ ] Run endpoint verification script
  - [ ] Check control panel: `/control-panel`
  - [ ] Verify `/api/bitmart/stats` returns success
  - [ ] Test circuit breaker reset endpoint

- [ ] **Monitoring**
  - [ ] Telegram bot configured for alerts
  - [ ] Dashboard accessible at `/dashboard`
  - [ ] Control panel accessible at `/control-panel`
  - [ ] Auto-refresh checks running (30-second interval)

---

## Version History

### v2.0.0 (May 17, 2026)
- ✅ Added ExternalProxyManager with Bright Data, Oxylabs, SmartProxy support
- ✅ Added BitmartEnhanced with circuit breaker and adaptive rate limiting
- ✅ Added control panel frontend with real-time monitoring
- ✅ Added /api/bitmart/stats, /api/bitmart/reset-circuit-breaker endpoints
- ✅ Added /api/execution-health endpoint
- ✅ Updated verify-production-endpoints.sh with BitMart checks
- ✅ All 391 tests passing

---

## Support

For issues, feature requests, or questions:
- GitHub: [zedanazad43/UltimateArbitrageHFT](https://github.com/zedanazad43/UltimateArbitrageHFT)
- Issues: [Create an issue](https://github.com/zedanazad43/UltimateArbitrageHFT/issues)

---

**Last Updated:** May 17, 2026  
**Maintainer:** zedanazad43  
**License:** MIT
