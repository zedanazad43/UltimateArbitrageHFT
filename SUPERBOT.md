# 🤖 SuperBot — Unified Control Plane

SuperBot is one brain over **three isolated projects** plus an **external quant stack**.
Each project keeps its own lockfile, toolchain, tests, and deploy target — the
control plane only orchestrates them.

```
superbot-monorepo/
├── projects/
│   ├── worker-bot/      ← Cloudflare Worker (the original UAHFT engine)
│   │   ├── index.js         Hono app: scans, admin API, Telegram, WebSocket
│   │   ├── src/             strategies, orchestrator, exchanges, risk, DB
│   │   ├── tests/           422 node --test cases
│   │   ├── scripts/         ops tooling (smoke, monitors, R2 upload…)
│   │   └── wrangler.toml    KV · D1 · DO · Queues · R2 · AI bindings
│   ├── go-engine/       ← Go HFT engine (from the old agents/ tree)
│   │   ├── cmd/hft/         goroutine supervisor entrypoint
│   │   ├── internal/        feeds, strategies, executor, risk, db, notify
│   │   ├── api/             service definitions
│   │   └── go.mod           Go 1.25, Flashbots + WS feeds
│   └── dashboard/       ← React + Vite control center (old frontend/)
│       └── src/             control panel, charts, session login
└── superbot/            ← control plane (this directory)
    ├── cli.mjs              entrypoint: status · test · build · run · scan · deploy
    ├── orchestrator.mjs     process supervisor, project boundary enforcement
    ├── ccxt-adapter.mjs     8-exchange public-data adapter (ccxt semantics, zero deps)
    └── python-lab/          isolated venv: freqtrade · backtrader · nautilus · OpenBB
        ├── setup.sh         one-shot venv creation
        ├── requirements.txt pinned external stack
        └── lab.py           status + backtest entrypoint (JSON on stdout)
```

## Why three isolated projects?

| Project | Runtime | Deploy target | Why separate |
|---|---|---|---|
| `worker-bot` | Node 22 / Workers | Cloudflare Workers + Pages | 10ms CPU budget, edge latency, bindings |
| `go-engine` | Go 1.25 | Docker / VPS / Railway | sub-ms hot loops can't live in a Worker |
| `dashboard` | React 18 / Vite | Cloudflare Pages | static assets, independent release cadence |

Each has its own package manifest, lockfile, and test command. Nothing at the
root is imported by the projects — the dependency arrow points one way:
**root → projects**, never projects → root.

## The control plane

```bash
node superbot/cli.mjs status        # what's alive, what's missing
node superbot/cli.mjs test          # worker-bot (node --test) + go-engine (go test)
node superbot/cli.mjs build         # go build + vite build + wrangler dry-run
node superbot/cli.mjs run worker    # wrangler dev
node superbot/cli.mjs run engine    # go run ./cmd/hft
node superbot/cli.mjs scan ETH/USDT # live cross-exchange spread scan
node superbot/cli.mjs backtest backtrader
node superbot/cli.mjs deploy        # wrangler deploy (needs CF credentials)
```

Or via npm from the repo root:

```bash
npm run superbot:smoke   # status --json
npm run worker:test      # the 422-test suite
npm run dashboard:build  # vite production build
npm run verify:all       # lint + tests + go vet + dashboard build
```

## External quant stack (freqtrade · backtrader · nautilus · OpenBB)

Installed into an **isolated venv** — never into the Node or Go projects:

```bash
cd superbot/python-lab
sh ./setup.sh                  # creates .venv, installs the external quant stack
.venv/bin/python lab.py status # verify versions
```

Then from the control plane:

```bash
node superbot/cli.mjs backtest backtrader   # runs the SMA-crossover sample now
node superbot/cli.mjs backtest nautilus     # runs the NautilusTrader engine sample
node superbot/cli.mjs backtest freqtrade    # prints the exact freqtrade setup steps
node superbot/cli.mjs backtest openbb       # OpenBB data-provider guidance
```

- **freqtrade** — execution-grade crypto bot: `create-userdir` → `new-config` →
  drop strategies into `user_data/strategies/` → `freqtrade backtesting`.
- **backtrader** — the sample in `lab.py` runs end-to-end with synthetic data
  and prints the final portfolio value as a JSON result.
- **nautilus_trader** — institutional-grade event-driven backtester + live
  engine; the `nautilus` sample builds a `BacktestEngine`, feeds a synthetic
  quote tick, and runs the engine end-to-end.
- **OpenBB** — research/data workspace; connect providers via OpenBB Hub.

## How the "merge" works

The three projects stay isolated; SuperBot merges them at runtime through
adapters, not by sharing code:

1. **Data plane** — `ccxt-adapter.mjs` normalizes prices from 8 exchanges
   (Binance, KuCoin, MEXC, HTX, Bitget, Gate.io, Kraken, Coinbase) with
   per-venue graceful failure and best-arb computation.
2. **Execution plane** — `worker-bot` remains the order-execution brain
   (signed REST, risk locks, kill switches); `go-engine` covers MEV-protected
   and latency-critical paths when deployed with its Docker stack.
3. **Research plane** — `python-lab` backtests strategies against historical
   data before anything is promoted into `worker-bot` strategy flags.
4. **UX plane** — `dashboard` renders worker state; `superbot/cli.mjs` is the
   operator's terminal view of the same state.

## Git history note

All moves used `git mv`, so file history is preserved. The old `agents/`
directory split as follows: Go engine → `projects/go-engine`, Hermes agent
system + vendored skill docs → `superbot/agents/`, engine docs →
`projects/go-engine/docs/`.
