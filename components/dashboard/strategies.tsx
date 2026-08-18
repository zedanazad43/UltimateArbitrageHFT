"use client"

import { Switch } from "@/components/ui/switch"
import { usd, num, pct } from "@/lib/format"
import type { Strategy } from "@/lib/types"

export function Strategies({
  data,
  onToggle,
}: {
  data: Strategy[]
  onToggle: (id: string) => void
}) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Strategy Book</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {data.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3 last:border-0"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{s.name}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
                <span>{num(s.trades)} fills</span>
                <span>win {pct(s.winRate, 0)}</span>
                <span>SR {s.sharpe.toFixed(1)}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`w-20 text-right font-mono text-sm tabular-nums ${
                  s.pnlUsd >= 0 ? "text-primary" : "text-destructive"
                }`}
              >
                {usd(s.pnlUsd, { sign: true, compact: true })}
              </span>
              <Switch
                checked={s.enabled}
                onCheckedChange={() => onToggle(s.id)}
                aria-label={`Toggle ${s.name}`}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
