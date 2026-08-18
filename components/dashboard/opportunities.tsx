"use client"

import { ArrowRight } from "lucide-react"
import { usd, ns, pct } from "@/lib/format"
import type { ArbOpportunity } from "@/lib/types"

const statusStyle: Record<ArbOpportunity["status"], string> = {
  detected: "bg-warning/15 text-warning",
  executing: "bg-primary/15 text-primary animate-pulse",
  filled: "bg-primary/15 text-primary",
  missed: "bg-destructive/15 text-destructive",
}

export function Opportunities({ data }: { data: ArbOpportunity[] }) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Live Arbitrage Opportunities</h2>
        <span className="font-mono text-[11px] text-muted-foreground">
          {data.length} in book
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2 font-medium">Pair</th>
              <th className="px-2 py-2 font-medium">Route</th>
              <th className="px-2 py-2 text-right font-medium">Spread</th>
              <th className="px-2 py-2 text-right font-medium">Est. Profit</th>
              <th className="px-2 py-2 text-right font-medium">Conf.</th>
              <th className="px-2 py-2 text-right font-medium">Latency</th>
              <th className="px-4 py-2 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.map((o) => (
              <tr key={o.id} className="border-b border-border/50 last:border-0">
                <td className="px-4 py-2 font-mono font-medium">{o.pair}</td>
                <td className="px-2 py-2">
                  <span className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                    {o.buyVenue}
                    <ArrowRight className="size-3 text-primary" />
                    {o.sellVenue}
                  </span>
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-primary">
                  {o.spreadBps.toFixed(1)}bps
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums">
                  {usd(o.estProfitUsd)}
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {pct(o.confidence, 0)}
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {ns(o.latencyNs)}
                </td>
                <td className="px-4 py-2 text-right">
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${statusStyle[o.status]}`}
                  >
                    {o.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
