# Proxy Gateway (Node)

> **Variable reference**: for how the Worker consumes this gateway, see [`docs/env-reference.md`](../docs/env-reference.md) (section 5).

This gateway is compatible with the app's expected format:

- `GET /proxy?target=<https-url>`
- optional header: `X-Gateway-Token`

It forwards requests through a real upstream proxy (for example Proxy001) using a forward-proxy connection and returns the target response.

## 1) Install

```bash
cd proxy-gateway
npm install
```

## 2) Configure

Set environment variables:

- `UPSTREAM_PROXY_URL` (required), example:
  - `http://USER:PASS@us.proxy001.com:7878`
- `GATEWAY_AUTH_TOKEN` (optional but recommended)
- `PORT` (optional, default `8788`)
- `ALLOWED_HOSTS` (optional CSV override)

## 3) Run

```bash
npm start
```

Health check:

```bash
curl http://127.0.0.1:8788/health
```

Proxy test:

```bash
curl "http://127.0.0.1:8788/proxy?target=https://ipinfo.io" \
  -H "X-Gateway-Token: <TOKEN_IF_SET>"
```

## 4) Wire into UltimateArbitrageHFT

Set GitHub repository secrets:

- `EXTERNAL_PROXY_URL` = `https://<your-host>/proxy`
- `EXTERNAL_PROXY_PROVIDER` = `bright_data` (or any non-`none` value)
- `EXTERNAL_PROXY_USERNAME` = `enabled`
- `EXTERNAL_PROXY_PASSWORD` = `enabled`
- `PROXY_MODE` = `required` (recommended for strict routing)

Then run deployment workflow.

Notes:

- `EXTERNAL_PROXY_PROVIDER/USERNAME/PASSWORD` are used by current runtime as activation flags. Their values can be placeholders when `EXTERNAL_PROXY_URL` is set.
- Keep this gateway outside Cloudflare Workers if your goal is non-Cloudflare egress behavior.
