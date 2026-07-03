# Production Profiles Runbook

This runbook gives copy/paste configuration profiles for operating the bot in production.

## Prerequisites

- Worker deployed and reachable.
- Required exchange secrets already uploaded.
- `ADMIN_TOKEN` configured.

Useful command prefixes:

```bash
# Set non-secret Worker vars
npx wrangler deploy

# Set secrets (repeat per secret)
printf '%s' 'your-value' | npx wrangler secret put SECRET_NAME
```

## Profile 1: Direct Only (No Proxy)

Use this when your servers can call exchanges directly and you do not want proxy routing.

### Vars

```toml
PROXY_MODE = "off"
DIRECT_EXCHANGES = ""
```

### Security hardening

```bash
printf '%s' '203.0.113.10,198.51.100.20' | npx wrangler secret put ALLOWED_IPS
```

### Notes

- All exchange requests go direct.
- Best latency when your host IPs are accepted by exchange APIs.

## Profile 2: Mixed Routing (Recommended Default)

Use this when some exchanges perform better direct and others need proxy support.

### Vars

```toml
PROXY_MODE = "auto"
DIRECT_EXCHANGES = "bitmart,mexc"
```

### Security hardening

```bash
printf '%s' '203.0.113.10,198.51.100.20' | npx wrangler secret put ALLOWED_IPS
```

### Notes

- Exchanges in `DIRECT_EXCHANGES` bypass proxy.
- Other exchanges use proxy when configured; fallback to direct on failure.

## Profile 3: Strict Proxy Compliance

Use this when policy requires all traffic through proxy.

### Vars

```toml
PROXY_MODE = "required"
DIRECT_EXCHANGES = ""
```

### Required secrets/vars

- At least one proxy endpoint configured (`PROXY_URL` or `PROXY_LIST`).
- Optional residential proxy values if used.

### Notes

- Requests fail if proxy is unavailable.
- Use this mode only when proxy infrastructure is stable.

## Exchange Secret Matrix

Set only the exchanges you actually trade.

- MEXC: `MEXC_API_KEY`, `MEXC_API_SECRET`
- Binance: `BINANCE_API_KEY`, `BINANCE_API_SECRET`
- KuCoin: `KUCOIN_API_KEY`, `KUCOIN_SECRET_KEY`, `KUCOIN_PASSPHRASE`
- Bitget: `BITGET_API_KEY`, `BITGET_SECRET_KEY`, `BITGET_API_PASSPHRASE`
- Bitmart: `BITMART_API_KEY`, `BITMART_SECRET_KEY`, `BITMART_MEMO`
- HTX: `HTX_API_KEY`, `HTX_API_SECRET`

## One-Shot Profile Switch

Use the `scripts/switch-profile.sh` helper or the npm aliases below.
The script updates `wrangler.toml`, uploads any provided secrets, deploys, and runs a health check — all in one step.

### npm shortcuts

```bash
# Switch to direct (no proxy)
npm run profile:direct

# Switch to mixed routing
npm run profile:mixed

# Switch to strict proxy
npm run profile:strict

# Dry-run any profile (prints commands without executing)
npm run profile:dry -- direct
npm run profile:dry -- mixed
npm run profile:dry -- strict
```

### With optional secrets

Pass `--allowed-ips` and/or `--proxy-list` directly via bash:

```bash
# Direct + IP allowlist
bash scripts/switch-profile.sh direct \
  --allowed-ips "203.0.113.10,198.51.100.20"

# Mixed + IP allowlist
bash scripts/switch-profile.sh mixed \
  --allowed-ips "203.0.113.10,198.51.100.20"

# Strict proxy + proxy list + IP allowlist
bash scripts/switch-profile.sh strict \
  --proxy-list "http://proxy1.example.com:3128,http://proxy2.example.com:3128" \
  --allowed-ips "203.0.113.10,198.51.100.20"
```

### Manual apply (step by step)

1. Update vars in `wrangler.toml` for your selected profile.
2. Upload/rotate secrets with `wrangler secret put`.
3. Deploy:

```bash
npx wrangler deploy
```

4. Verify:

```bash
curl -sS https://ultimatearbitragehft.zedanazad43.workers.dev/health
curl -sS -H 'x-admin-token: YOUR_ADMIN_TOKEN' https://ultimatearbitragehft.zedanazad43.workers.dev/api/status
```

## Post-Deploy Checks

- `proxyRouting.mode` in runtime stats matches expected profile.
- Admin endpoints reject unauthorized IPs when `ALLOWED_IPS` is set.
- Exchange scan cycles complete without repeated backoff escalation.
- No new auth or transport errors in logs.

## Rollback

If execution quality degrades after routing changes:

1. Revert to the last known-good `PROXY_MODE` and `DIRECT_EXCHANGES`.
2. Redeploy Worker.
3. Re-run health and status checks.
4. Keep paper mode enabled until spread quality normalizes.
