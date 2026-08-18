export type Side = "buy" | "sell"

export interface ArbOpportunity {
  id: string
  pair: string
  buyVenue: string
  sellVenue: string
  spreadBps: number
  estProfitUsd: number
  latencyNs: number
  confidence: number
  status: "detected" | "executing" | "filled" | "missed"
}

export interface Execution {
  id: string
  ts: number
  pair: string
  side: Side
  venue: string
  qty: number
  price: number
  pnlUsd: number
  latencyNs: number
  strategy: string
}

export interface Strategy {
  id: string
  name: string
  enabled: boolean
  pnlUsd: number
  trades: number
  winRate: number
  sharpe: number
  exposureUsd: number
}

export interface AgentDecision {
  id: string
  ts: number
  level: "info" | "action" | "risk" | "warning"
  message: string
}

export interface EquityPoint {
  t: string
  equity: number
  pnl: number
}

export interface Venue {
  name: string
  latencyNs: number
  status: "online" | "degraded" | "offline"
}
