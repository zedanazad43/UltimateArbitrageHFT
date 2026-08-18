"use client"

import { usd, ns } from "@/lib/format"
import type { Execution } from "@/lib/types"

export function ExecutionFeed({ data }: { data: Execution[] }) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Execution Tape</h2>
        <span className="font-mono text-[11px] text-muted-foreground">last {data.length} fills</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto font-mono text-xs">
        {data.map((e) => (
          <div
            key={e.id}
            className="flex items-center justify-between border-b border-border/40 px-4 py-1.5 last:border-0"
          >
            <div className="flex items-center gap-2">
              <span
                className={`w-8 shrink-0 text-[10px] font-semibold uppercase ${
                  e.side === "buy" ? "text-primary" : "text-destructive"
                }`}
              >
                {e.side}
              </span>
              <span className="w-16 shrink-0 text-foreground">{e.pair}</span>
              <span className="hidden w-16 shrink-0 text-muted-foreground sm:inline">
                {e.venue}
              </span>
            </div>
            <div className="flex items-center gap-3 tabular-nums">
              <span className="text-muted-foreground">{ns(e.latencyNs)}</span>
              <span className={`w-16 text-right ${e.pnlUsd >= 0 ? "text-primary" : "text-destructive"}`}>
                {usd(e.pnlUsd, { sign: true })}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
