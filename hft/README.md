# UltimateArbitrageHFT — Go Engine

High-frequency arbitrage engine rewritten in Go for sub-millisecond latency,
minimal gas fees, and Flashbots MEV protection.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Go HFT Engine                         │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │ Price    │  │Arb Engine│  │ Executor │             │
│  │ Feeds WS │→ │(CEX+DEX) │→ │(Flashbots│             │
│  └──────────┘  └──────────┘  │ Bundle)  │             │
│                               └──────────┘             │
│  ┌──────────────────────────────────────────┐          │
│  │  Risk Manager (Kelly sizing + gas cap)   │          │
│  └──────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────┘
         ↕                          ↕
  CEX WebSocket feeds        Ethereum / Arbitrum
  (Binance, MEXC, Bybit)     (Flashbots protect RPC)
```

## Module layout

```
hft/
├── cmd/hft/main.go                  # goroutine supervisor + entry point
├── internal/
│   ├── config/config.go             # env-var config with typed defaults
│   ├── feeds/feeds.go               # WS price book (Binance, MEXC, Bybit)
│   ├── strategies/
│   │   ├── cex/cex.go               # CEX spatial arbitrage
│   │   ├── dex/dex.go               # DEX cross-chain arb (ETH↔BSC)
│   │   ├── perps/perps.go           # perps-vs-spot arbitrage
│   │   └── funding/funding.go       # funding-rate harvest
│   ├── executor/
│   │   ├── cex.go                   # MEXC / Binance / Bybit order placement
│   │   ├── flashbots.go             # eth_sendBundle + MEV protection
│   │   └── gas.go                   # EIP-1559 gas oracle
│   ├── contracts/
│   │   ├── univ3/univ3.go           # Uniswap V3 SwapRouter02 ABI binding
│   │   └── curve/curve.go           # Curve StableSwap exchange ABI binding
│   ├── risk/risk.go                 # Kelly position sizing + adaptive leverage
│   ├── db/db.go                     # PostgreSQL trade logging (pgx/v5)
│   └── notify/notify.go             # Telegram alerts
├── .env.example                     # environment variable template
├── Dockerfile                       # multi-stage build (CGO enabled)
└── go.mod
```

## Quick start

### Prerequisites

- Go 1.24+
- PostgreSQL (optional — engine runs without it, logging disabled)
- Exchange API keys (at least one of MEXC or Binance for live trading)
- Alchemy API key (for DEX cross-chain scan)

### Run in paper-trading mode (no real orders)

```bash
cd hft
cp .env.example .env
# Edit .env: set MEXC_API_KEY + MEXC_API_SECRET (or Binance)
# PAPER_TRADING=true and TRADING_ENABLED=false are safe defaults
source .env
go run ./cmd/hft
```

### Build binary

```bash
cd hft
go build -o hft-engine ./cmd/hft
./hft-engine
```

### Docker

```bash
cd hft
docker build -t hft-engine .
docker run --env-file .env hft-engine
```

## MEV protection

Three layers are active for on-chain DEX trades:

1. **Flashbots Protect RPC** (passive): `ETH_RPC_URL=https://rpc.flashbots.net` routes
   all transactions through the Flashbots private mempool. No front-running possible.

2. **`eth_sendBundle`** (active): the executor builds atomic transaction bundles and
   submits them via `FlashbotsClient.SubmitDEXSwap`. Bundles are only included when
   profitable; they are never partially executed.

3. **Arbitrum** (structural): Arbitrum has no public mempool by design — all
   transactions go through the sequencer and are inherently MEV-safe. Set
   `ARBITRUM_RPC_URL` and use Arbitrum pools for DEX arbitrage to benefit from
   10–20× lower gas costs vs Ethereum mainnet.

## Lowest-gas DEX contracts

| Protocol | Gas (approx) | Use case |
|---|---|---|
| **Curve StableSwap** | ~60k–80k | Stablecoin legs (USDC/USDT/DAI) |
| **Uniswap V3** SwapRouter02 | ~80k–100k | Volatile pairs |
| **Balancer V2** Vault | ~75k–95k | Multi-hop routes |

Both Uniswap V3 and Curve ABI bindings are pre-generated in `internal/contracts/`.

## Configuration

All settings are read from environment variables. See `.env.example` for the
full list with defaults and documentation.

Key safety flags:
- `PAPER_TRADING=true` — simulate trades only (default)
- `TRADING_ENABLED=false` — master kill switch (default)
- `MAX_DAILY_LOSS_USD` — stops trading after hitting daily loss cap
- `MIN_SECONDS_BETWEEN_TX` — rate-limits trade execution

## Metrics

Prometheus metrics are exposed on `METRICS_ADDR` (default `:9090`):

| Metric | Description |
|---|---|
| `hft_trades_total` | Trades executed, labelled by strategy and mode |
| `hft_trade_net_profit_pct` | Net profit % histogram per strategy |
| `hft_scan_latency_ms` | Scan cycle duration histogram |

Health check: `GET /healthz`

## Deployment (co-location)

For lowest latency:
- Deploy on a VPS in **Frankfurt** (near Binance/MEXC EU servers) or **Tokyo** (Asia).
- Run a private **Geth + Prysm** Ethereum node or **Arbitrum node** locally to
  eliminate RPC round-trip latency.
- Use a bare-metal server (Hetzner AX102, OVH Advance) for predictable CPU performance.
