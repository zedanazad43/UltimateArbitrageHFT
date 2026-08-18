"use client"

import { ns } from "@/lib/format"
import type { Venue } from "@/lib/types"

const statusColor: Record<Venue["status"], string> = {
  online: "bg-primary",
  degraded: "bg-warning",
  offline: "bg-destructive",
}

export function Venues({ data }: { data: Venue[] }) {
  const maxLatency = Math.max(...data.map((v) => v.latencyNs), 1)
  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Venue Connectivity</h2>
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-around gap-1 p-4">
        {data.map((v) => (
          <div key={v.name} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2">
                <span className={`size-2 rounded-full ${statusColor[v.status]}`} />
                <span className="font-medium">{v.name}</span>
              </span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {ns(v.latencyNs)}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-background">
              <div
                className={`h-full rounded-full transition-all duration-500 ${statusColor[v.status]}`}
                style={{ width: `${100 - (v.latencyNs / maxLatency) * 80}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
