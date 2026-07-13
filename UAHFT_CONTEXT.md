# AGENTS_CONTEXT.md — UltimateArbitrageHFT
Repo: zedanazad43/UltimateArbitrageHFT
العربية: هذا الملف سياق مشترك لكل الوكلاء (Hermes + Copilot + غيره) للعمل على المشروع سوا.

## Stack / البنية
- Cloudflare Worker: index.js (~4517 سطر, Hono) — نقطة الدخول.
- src/exchange.js: استدعاء المنصات + الأرصدة عبر البروكسي.
- src/infra/proxy-pool.js + external-proxy.js: إدارة البروكسي.
- Go HFT engine: hft/ — تسعير سريع.
- Hero agent: hero-agent/ — منسّق.
- Frontend: frontend/src/ (React). Backend deploy: Cloudflare Pages.
- Node 24, Docker (8787/8788/8789 محلي).
English: Shared context so Hermes + Copilot can collaborate on the same repo.

## What was DONE (verified live)
1. PERMANENT PROXY 24/7: gw.ecostamp.net -> cloudflared tunnel 0acfa7ee -> gateway :8080.
   - Config: cloudflared-eu.yml (ingress hostname set). Task Scheduler "UAHFT-ProxyStack" (ONLOGON)
     + self-healing loop (tools/start-proxy-stack.bat, restarts every 45s).
   - gw.ecostamp.net returns "proxy-gateway ok".
2. PROXY_URL_1 = https://gw.ecostamp.net (Worker secret, replaced dead serveo).
3. ALL EXCHANGES READ: MEXC 15.13, HTX 25.85, Bitget 48.5+BTC, Binance/Bitmart/Bybit/KuCoin real 0.
4. /api/scan aliased (shared scanHandler) -> 200. Deployed 197ef3d6 -> 1e7d48ef.
5. SECURITY FIX (critical): removed `c.env.ADMIN_TOKEN &&` guard in index.js (849,1184,1188,1193,1198)
   so dashboard requires auth even when ADMIN_TOKEN unset. Verified applied.
6. BACKEND PERF (src/exchange.js): Bitget hosts parallel via Promise.any (line 976);
   failure -> balance:null (line 1739) not silent 0; enabled-exchanges cached.
7. Worker deployed: 1e7d48ef. crons=["* * * * *"] -> scans every minute, PAPER mode.
8. Git: committed 17842d5 + pushed to main.
9. Hermes: concurrency=10, 187 skills active (incl git-guardrails-and-precommit).

## Open issues
- OneDrive working dir SLOW (use non-OneDrive clone for edits).
- Network (Vodafone DS-Lite) intermittently blocks intl egress (Cloudflare DNS, GitHub, HF).
- proxy01 (PROXY001_API_KEY + IPv6 2a09:bac5:2a91:2496::3a5:59) NOT wired as upstream yet.
- CLOUDFLARE_API_TOKEN plaintext in .exchange_keys (12-13) — move to .cf_api_token.
- /opportunities still 404 (only /api/scan aliased).
- PRs #285/#276/#275 unmerged (GitHub API unreachable here).
- Frontend audit done (deleg_47edaf80) but patches NOT applied.

## Conventions (see AGENTS.md — Advisor Mode)
- Plan before non-trivial code; wait approval before Phase 3.
- Prefer free models. Batch reads. Concise.
- Do NOT run `node index.js` (Worker module).
- Secrets NEVER in chat/git — local files only (.cf_api_token, .gateway_token, .exchange_keys, .new_admin_token, .hf_api_key, .openai_key).
- MSYS mangles `//` in Windows commands -> wrap in .bat.
