[![Deploy Worker](https://github.com/zedanazad43/UltimateArbitrageHFT/actions/workflows/deploy-worker.yml/badge.svg)] [![Deploy Pages](https://github.com/zedanazad43/UltimateArbitrageHFT/actions/workflows/deploy-pages.yml/badge.svg)]

# 🚀 Rocket HFT - Ultimate Arbitrage Bot

Next-gen arbitrage engine for Cloudflare Workers. Ultra-low latency, AI-driven, multi-exchange.

## Hermes brain / repo-time orchestrator

Hermes is the single brain over this repo:
- sync + conflict resolution across local and GitHub environments
- time-versioning: each release carries RTT, jitter, and readiness fingerprint
- CI/CD rewrites for temporal-hardening tests
- auto-docs: README, Changelog, and time-architecture updates
- deploy doctrine: tests first, dry-run mandatory, local wrangler, OAuth-only deploy
- Windows caveat: `CLOUDFLARE_API_TOKEN` overrides wrangler OAuth; always `unset CLOUDFLARE_API_TOKEN && ./node_modules/.bin/wrangler deploy`

## MCP + VSCode integration
- GitHub Copilot MCP: `https://api.githubcopilot.com/mcp/` with Bearer auth
- Cloudflare MCP servers wired in VSCode settings
- Hermes provider: OpenRouter
- Gateway: cron/webhook runtime

## Trading safety
- `trading_enabled = false`
- Phase 0: shadow + evening reports
- Phase 1: zero orders, measure real time
- Phase 2: micro capital
- Phase 3: conditional live trading via readiness indicator

## Features
- **Real-time arbitrage scanning** across MEXC, HTX, Bitget, Binance, Bitmart, KuCoin, Coinbase
- **Rocket HFT Dashboard** - Modern, dark UI with live spreads and exchange health
- **Secure proxy layer** - Token-guarded routes, admin timestamp anti-replay, rate limiting
- **AI fallback** - OpenRouter team (DeepSeek, Kimi, Qwen) + GitHub Models fallback
- **GitHub-native coordination** - Manus integration via Issues/PRs

## Architecture
- **Worker**: `index.js` (Hono, 4586 lines)
- **Frontend**: React dashboard with Rocket HFT UI
- **Database**: SQLite schema + in-memory cache for opportunities
- **Proxy**: Local gateway + serveo tunnel for geo-blocked exchanges

## Quick Start
```bash
npm install
npm test
npm run dev
```

## Deploy
```bash
# Pages (via GitHub Actions)
git push origin main

# Worker
bash deploy-worker.sh
```

## Security
- Proxy token guard on all public endpoints
- Admin timestamp validation (anti-replay)
- IP allowlist + security headers
- Memory rate-limit fallback

## Team
- **Hermes** - Primary orchestrator
- **Manus** - GitHub-connected agent
- **OpenRouter** - AI team (DeepSeek, Kimi, Qwen)
- **GitHub Models** - Free fallback (gpt-4o-mini)

## License
MIT
