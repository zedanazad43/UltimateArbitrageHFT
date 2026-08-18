"use client"

import { Activity, Power, Zap } from "lucide-react"
import { ns } from "@/lib/format"
import type { Venue } from "@/lib/types"

interface Props {
  running: boolean
  venues: Venue[]
  onToggleRun: (v: boolean) => void
  onKill: () => void
}

export function TopBar({ running, venues, onToggleRun, onKill }: Props) {
  const avgLatency =
    venues.reduce((a, v) => a + v.latencyNs, 0) / Math.max(1, venues.length)
  const online = venues.filter((v) => v.status === "online").length

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-card/50 px-5 py-3">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Zap className="size-5" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-sm font-semibold leading-tight tracking-tight">
            QUANTUM<span className="text-primary">HFT</span>
          </h1>
          <p className="font-mono text-[11px] text-muted-foreground">
            Nanosecond Arbitrage Terminal
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 font-mono text-xs">
        <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5">
          <Activity className="size-3.5 text-primary" />
          <span className="text-muted-foreground">tick latency</span>
          <span className="tabular-nums text-foreground">{ns(avgLatency)}</span>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5">
          <span
            className={`size-2 rounded-full ${online > 0 ? "bg-primary animate-pulse" : "bg-destructive"}`}
          />
          <span className="text-muted-foreground">venues</span>
          <span className="tabular-nums text-foreground">
            {online}/{venues.length}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onToggleRun(!running)}
          className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
            running
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border bg-background text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className={`size-2 rounded-full ${running ? "bg-primary animate-pulse" : "bg-muted-foreground"}`} />
          {running ? "LIVE" : "PAUSED"}
        </button>
        <button
          onClick={onKill}
          className="flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/20"
        >
          <Power className="size-3.5" />
          KILL
        </button>
      </div>
    </header>
  )
}
