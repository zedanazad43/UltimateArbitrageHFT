import type {
  ArbOpportunity,
  Execution,
  Strategy,
  AgentDecision,
  EquityPoint,
  Venue,
  Side,
} from "./types"

const PAIRS = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT", "ARB/USDT"]
const VENUE_NAMES = ["Binance", "Coinbase", "OKX", "Bybit", "Kraken", "Deribit"]
const STRATEGY_NAMES = [
  "Cross-Venue Arb",
  "Triangular Arb",
  "Statistical Pairs",
  "Latency Sniper",
  "Market Making",
]

let seed = 42
function rand() {
  // deterministic-ish PRNG so first paint is stable, then drifts live
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]
}
function range(min: number, max: number) {
  return min + rand() * (max - min)
}

export function makeId() {
  return Math.random().toString(36).slice(2, 10)
}

export function initialVenues(): Venue[] {
  return VENUE_NAMES.map((name, i) => ({
    name,
    latencyNs: Math.round(range(180, 920)),
    status: i === 4 ? "degraded" : "online",
  }))
}

export function initialStrategies(): Strategy[] {
  return STRATEGY_NAMES.map((name, i) => ({
    id: makeId(),
    name,
    enabled: i < 4,
    pnlUsd: range(-4200, 38000),
    trades: Math.round(range(1200, 48000)),
    winRate: range(0.58, 0.94),
    sharpe: range(1.4, 4.8),
    exposureUsd: range(50000, 900000),
  }))
}

export function makeOpportunity(): ArbOpportunity {
  const buyVenue = pick(VENUE_NAMES)
  let sellVenue = pick(VENUE_NAMES)
  while (sellVenue === buyVenue) sellVenue = pick(VENUE_NAMES)
  const spreadBps = range(0.4, 14)
  return {
    id: makeId(),
    pair: pick(PAIRS),
    buyVenue,
    sellVenue,
    spreadBps,
    estProfitUsd: spreadBps * range(40, 320),
    latencyNs: Math.round(range(120, 1400)),
    confidence: range(0.62, 0.99),
    status: "detected",
  }
}

export function makeExecution(strategyName?: string): Execution {
  const side: Side = rand() > 0.5 ? "buy" : "sell"
  const win = rand() > 0.28
  return {
    id: makeId(),
    ts: Date.now(),
    pair: pick(PAIRS),
    side,
    venue: pick(VENUE_NAMES),
    qty: Number(range(0.05, 12).toFixed(3)),
    price: range(80, 68000),
    pnlUsd: win ? range(2, 640) : -range(1, 210),
    latencyNs: Math.round(range(90, 780)),
    strategy: strategyName ?? pick(STRATEGY_NAMES),
  }
}

const DECISION_TEMPLATES: { level: AgentDecision["level"]; msg: () => string }[] = [
  { level: "action", msg: () => `Executed arb ${pick(PAIRS)} via ${pick(VENUE_NAMES)}→${pick(VENUE_NAMES)}` },
  { level: "info", msg: () => `Rebalanced inventory on ${pick(VENUE_NAMES)}` },
  { level: "risk", msg: () => `Reduced exposure on ${pick(PAIRS)} — volatility spike detected` },
  { level: "action", msg: () => `Increased order size on ${pick(STRATEGY_NAMES)} (edge > threshold)` },
  { level: "warning", msg: () => `Widened quotes — ${pick(VENUE_NAMES)} latency degraded` },
  { level: "info", msg: () => `Model retrained on 4.2M ticks — inference ${Math.round(range(40, 210))}ns` },
  { level: "action", msg: () => `Cancelled stale orders on ${pick(VENUE_NAMES)}` },
]

export function makeDecision(): AgentDecision {
  const t = pick(DECISION_TEMPLATES)
  return { id: makeId(), ts: Date.now(), level: t.level, message: t.msg() }
}

export function initialEquity(): EquityPoint[] {
  const pts: EquityPoint[] = []
  let equity = 1_000_000
  const now = Date.now()
  for (let i = 60; i >= 0; i--) {
    const pnl = range(-3200, 5200)
    equity += pnl
    pts.push({
      t: new Date(now - i * 60_000).toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
      }),
      equity: Math.round(equity),
      pnl: Math.round(pnl),
    })
  }
  return pts
}

export function nextEquity(prev: EquityPoint[]): EquityPoint[] {
  const last = prev[prev.length - 1]
  const pnl = range(-3200, 5400)
  const point: EquityPoint = {
    t: new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    }),
    equity: Math.round(last.equity + pnl),
    pnl: Math.round(pnl),
  }
  return [...prev.slice(1), point]
}
