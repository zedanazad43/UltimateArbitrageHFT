"use client"

import { TrendingDown, TrendingUp } from "lucide-react"
import { usd, num, pct } from "@/lib/format"
import type { EngineState } from "@/hooks/use-trading-engine"

function Kpi({
  label,
  value,
  delta,
  positive,
}: {
  label: string
  value: string
  delta?: string
  positive?: boolean
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
      <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-xl font-semibold tabular-nums tracking-tight">{value}</span>
      {delta && (
        <span
          className={`flex items-center gap-1 font-mono text-xs ${
            positive ? "text-primary" : "text-destructive"
          }`}
        >
          {positive ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
          {delta}
        </span>
      )}
    </div>
  )
}

export function KpiCards({ state }: { state: EngineState }) {
  const totalPnl = state.strategies.reduce((a, s) => a + s.pnlUsd, 0)
  const dayPnl = state.equity.reduce((a, p) => a + p.pnl, 0)
  const exposure = state.strategies
    .filter((s) => s.enabled)
    .reduce((a, s) => a + s.exposureUsd, 0)
  const trades = state.strategies.reduce((a, s) => a + s.trades, 0)
  const weightedWin =
    state.strategies.reduce((a, s) => a + s.winRate * s.trades, 0) / Math.max(1, trades)
  const latest = state.equity[state.equity.length - 1]

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
      <Kpi
        label="Portfolio Equity"
        value={usd(latest?.equity ?? 0, { compact: true })}
        delta={usd(dayPnl, { sign: true, compact: true })}
        positive={dayPnl >= 0}
      />
      <Kpi
        label="Realized PnL"
        value={usd(totalPnl, { sign: true, compact: true })}
        delta="session"
        positive={totalPnl >= 0}
      />
      <Kpi label="Active Exposure" value={usd(exposure, { compact: true })} />
      <Kpi label="Total Fills" value={num(trades)} />
      <Kpi
        label="Win Rate"
        value={pct(weightedWin)}
        delta="30d avg"
        positive={weightedWin >= 0.5}
      />
      <Kpi
        label="Open Opps"
        value={num(state.opportunities.filter((o) => o.status !== "filled").length)}
      />
    </div>
  )
}
