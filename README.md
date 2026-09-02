# 🚀 SuperBot — Ultimate Arbitrage HFT Monorepo

One control plane over **three isolated trading projects**, plus an optional
**freqtrade / backtrader / OpenBB quant lab**.

| Project | Path | Stack | Purpose |
|---|---|---|---|
| Worker Bot | [`projects/worker-bot`](projects/worker-bot) | Node 22 · Hono · Cloudflare Workers | arbitrage scanning, execution, Telegram, admin API |
| Go Engine | [`projects/go-engine`](projects/go-engine) | Go 1.25 | sub-ms HFT engine: WS feeds, MEV-protected execution, Kelly sizing |
| Dashboard | [`projects/dashboard`](projects/dashboard) | React 18 · Vite · Recharts | control center UI |
| Control Plane | [`superbot/`](superbot) | Node (zero deps) | orchestration + cross-exchange data adapter |

Full architecture: **[SUPERBOT.md](SUPERBOT.md)**

## Quick start

```bash
# 1. Worker bot (Cloudflare Worker)
npm ci --prefix projects/worker-bot
npm run worker:test          # 422 tests
npm run worker:dev           # wrangler dev

# 2. Go engine
cd projects/go-engine && go run ./cmd/hft

# 3. Dashboard
npm run dashboard:build

# 4. SuperBot control plane
node superbot/cli.mjs status
node superbot/cli.mjs scan BTC/USDT        # live cross-exchange spread scan
node superbot/cli.mjs build                # build all three projects
```

## External quant stack (optional)

```bash
cd superbot/python-lab
sh ./setup.sh                              # isolated venv: freqtrade, backtrader, OpenBB
node ../../superbot/cli.mjs backtest backtrader
```

## Trading safety

- `trading_enabled = false` by default — paper mode first
- daily loss caps, position clamps ($1–$500), risk profiles, kill switches
- Phase 0 shadow → Phase 1 measurement → Phase 2 micro capital → live only
  via readiness indicator

## Deploy

| Target | Command |
|---|---|
| Worker | `npm run worker:deploy` (or GitHub Action on `projects/worker-bot/**` changes) |
| Dashboard | GitHub Action → Cloudflare Pages on `projects/dashboard/**` changes |
| Go engine | `cd projects/go-engine && docker build -f Dockerfile.dhi .` |

## License

MIT
