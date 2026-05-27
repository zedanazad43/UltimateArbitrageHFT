# Quick Reference: BitMart + Proxy Configuration

## Environment Variables (.env or Cloudflare Secrets)

### BitMart Exchange Credentials (Required)
```
BITMART_API_KEY=your_api_key
BITMART_API_SECRET=your_api_secret
BITMART_MEMO=your_memo_code
BITMART_USE_EXTERNAL_PROXY=false  # Set to true to route through external proxy
```

### External Proxy Configuration (Optional)

**Disable external proxy:**
```
EXTERNAL_PROXY_PROVIDER=none
```

**Enable Bright Data:**
```
EXTERNAL_PROXY_PROVIDER=bright_data
EXTERNAL_PROXY_USERNAME=your_username
EXTERNAL_PROXY_PASSWORD=your_password
```

**Enable Oxylabs:**
```
EXTERNAL_PROXY_PROVIDER=oxylabs
EXTERNAL_PROXY_USERNAME=your_username
EXTERNAL_PROXY_PASSWORD=your_password
```

**Enable SmartProxy:**
```
EXTERNAL_PROXY_PROVIDER=smartproxy
EXTERNAL_PROXY_USERNAME=your_username
EXTERNAL_PROXY_PASSWORD=your_password
```

### Local Proxy Pool Configuration (Fallback)

```
PROXY_MODE=auto           # auto = use if available, off = disabled, required = must have
PROXY_LIST='[{"url":"http://proxy1:8080"},{"url":"http://proxy2:8080"}]'
DIRECT_EXCHANGES=bybit,gateio,kraken,coinbase
```

---

## API Commands

### Check BitMart Circuit Breaker & Rate Limits
```bash
curl https://ultimatearbitragehft.zedanazad43.workers.dev/api/bitmart/stats \
  -H "x-admin-token: YOUR_ADMIN_TOKEN" | jq
```

### Reset BitMart Circuit Breaker
```bash
curl -X POST https://ultimatearbitragehft.zedanazad43.workers.dev/api/bitmart/reset-circuit-breaker \
  -H "x-admin-token: YOUR_ADMIN_TOKEN"
```

### Check Execution Health
```bash
curl https://ultimatearbitragehft.zedanazad43.workers.dev/api/execution-health \
  -H "x-admin-token: YOUR_ADMIN_TOKEN" | jq
```

### Check Proxy Stats
```bash
curl https://ultimatearbitragehft.zedanazad43.workers.dev/api/proxy-stats \
  -H "x-admin-token: YOUR_ADMIN_TOKEN" | jq
```

---

## Frontend Monitoring

### Control Panel Dashboard
Open: `https://ultimatearbitragehft.zedanazad43.workers.dev/control-panel`

Features:
- Real-time API endpoint health (refreshes every 30 sec)
- BitMart circuit breaker status
- Proxy configuration overview
- Strategy execution mode & balance
- Auto-executor statistics
- One-click buttons: Start/Stop, Paper Mode, Reset CB

---

## Troubleshooting

| Issue | Symptom | Fix |
|-------|---------|-----|
| Circuit Breaker Open | `Circuit breaker OPEN` | Wait 60s or reset via `/api/bitmart/reset-circuit-breaker` |
| Rate Limited | `Rate limited (429)` | Automatic retry with backoff (built-in) |
| External Proxy Down | `Health check failed` | Automatic fallback to local pool after 3 failures |
| No Proxy Available | `Proxy mode is required but no proxies configured` | Set `PROXY_MODE=auto` or configure `PROXY_LIST` |
| BitMart Credentials Invalid | `BITMART_API_KEY is not configured` | Verify `BITMART_API_KEY`, `BITMART_API_SECRET`, `BITMART_MEMO` |

---

## Production Deployment

1. **Set credentials:**
   ```bash
   wrangler secret put BITMART_API_KEY
   wrangler secret put BITMART_API_SECRET
   wrangler secret put BITMART_MEMO
   wrangler secret put ADMIN_TOKEN
   ```

2. **Configure proxy (optional):**
   ```bash
   wrangler secret put EXTERNAL_PROXY_PROVIDER      # bright_data, oxylabs, smartproxy, none
   wrangler secret put EXTERNAL_PROXY_USERNAME
   wrangler secret put EXTERNAL_PROXY_PASSWORD
   ```

3. **Configure fallback pool:**
   ```bash
   wrangler secret put PROXY_MODE                   # auto or required
   wrangler secret put PROXY_LIST                   # JSON array
   wrangler secret put DIRECT_EXCHANGES             # CSV list
   ```

4. **Test endpoints:**
   ```bash
   WORKFLOW_ADMIN_TOKEN='YOUR_ADMIN_TOKEN' node scripts/verify-production-endpoints.js
   ```

5. **Monitor:**
   - Dashboard: `https://ultimatearbitragehft.zedanazad43.workers.dev/dashboard`
   - Control Panel: `https://ultimatearbitragehft.zedanazad43.workers.dev/control-panel`

---

## Performance Tips

- **Use external proxy for**: Rate-limited exchanges, geo-restricted content
- **Disable external proxy for**: Low-latency critical paths, local network testing
- **Set `PROXY_MODE=required`** to ensure always-on protection
- **Monitor `/api/bitmart/stats`** for early warning signs
- **Review logs** in Cloudflare Workers dashboard for error patterns

---

**Last Updated:** May 17, 2026  
**Version:** 2.0.0
