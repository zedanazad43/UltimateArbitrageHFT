[![Deploy Worker](https://github.com/zedanazad43/UltimateArbitrageHFT/actions/workflows/deploy-worker.yml/badge.svg)] [![Deploy Pages](https://github.com/zedanazad43/UltimateArbitrageHFT/actions/workflows/deploy-pages.yml/badge.svg)]

# 🚀 Rocket HFT - Ultimate Arbitrage Bot

Next-gen arbitrage engine for Cloudflare Workers. Ultra-low latency, AI-driven, multi-exchange.

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
