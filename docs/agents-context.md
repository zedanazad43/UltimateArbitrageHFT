# UltimateArbitrageHFT — Standard Workflow Prompt

## Context
Repo: zedanazad43/UltimateArbitrageHFT
Stack: Cloudflare Worker (index.js), Go HFT engine (hft/), Hero agent (hero-agent/), Railway + Fly.io deploy, Node.js 24, Docker (3 services: 8787/8788/8789)

## Task
Continue hardening + shipping the UltimateArbitrageHFT arbitrage bot. This session already: (1) fixed the permanent proxy — `gw.ecostamp.net` → cloudflared tunnel `0acfa7ee-...` → local `proxy-gateway.cjs` :8080, with `PROXY_URL_1=https://gw.ecostamp.net` so all exchanges (MEXC/HTX/Bitget) read live; (2) set up self-healing 24/7 via `tools/start-proxy-stack.bat` + Windows Task `UAHFT-ProxyStack` (ONLOGON); (3) fixed a critical auth bypass in `index.js` (removed `c.env.ADMIN_TOKEN &&` guard on /dashboard /control-panel — now `if (!isAuthorized(...)) return redirect('/login')`); (4) applied backend perf in `src/exchange.js` (Bitget hosts parallel via Promise.any, balance fetch throws → null not silent 0, exchange-list cache); (5) added `/api/scan` alias (was 404); (6) separated Node-only WS files from the Worker bundle; (7) committed+pushed `17842d5`. PENDING: apply frontend patches from audit, wire proxy01 as upstream, resolve PRs #285/#276/#275, add Bybit/Gateio, harden kill-switch for Paper→Live. Do NOT enable Live trading without explicit approval. Secrets are in local files (`.new_admin_token`, `.gateway_token`, `.cf_api_token`, `.exchange_keys`) — never paste them. Work outside OneDrive (`C:\Users\azadz\UAHFT`) because OneDrive sync times out writes.

## Instructions (follow in order, wait for my approval at each gate)

### Phase 1 — Scope & Inspect
- Identify affected files (repo only, use grep/glob/view, parallelize reads)
- Check latest CI run: list_workflow_runs → get_job_logs for any failures
- Summarize root cause in 3 bullet points max

### Phase 2 — Plan (STOP — wait for my approval)
- List files to change, order of changes, dependencies, edge cases
- Flag any out-of-repo dependencies (Cloudflare secrets, Railway/Fly env vars, Docker)
- No code yet — plan only

### Phase 3 — Implement (after approval only)
- Make minimal, surgical changes only
- Do NOT touch unrelated files or tests
- After each file: lint/test if a script exists (npm run lint / go vet)

### Phase 4 — Review
- Run code_review tool before finalizing
- Address any HIGH signal feedback

### Phase 5 — Deploy Check
- Confirm package-lock.json is up to date if deps changed (npm install --package-lock-only)
- Confirm wrangler deploy is NOT triggered accidentally (npm run build deploys — avoid unless intended)
- Summarize what was changed and any manual steps needed (env vars, secrets, Railway redeploy, etc.)

## Constraints
- Prefer free models/agents
- Batch all independent tool calls in parallel
- Keep responses concise; one sentence per changed file outside of code blocks
- Do NOT run node index.js — it is a Cloudflare Worker module, not a Node server.  Replace [DESCRIBE YOUR TASK HERE] with your actual request each time.
Hermes will stop after Phase 2 and wait for your go-ahead before touching any code.
