"use client"

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { usd } from "@/lib/format"
import type { EquityPoint } from "@/lib/types"

export function EquityChart({ data }: { data: EquityPoint[] }) {
  const first = data[0]?.equity ?? 0
  const last = data[data.length - 1]?.equity ?? 0
  const up = last >= first
  const loading = data.length === 0

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Portfolio Equity Curve</h2>
          <p className="font-mono text-[11px] text-muted-foreground">
            realtime · 60m rolling window
          </p>
        </div>
        <span
          className={`rounded-md px-2 py-1 font-mono text-xs ${
            up ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
          }`}
        >
          {usd(last - first, { sign: true, compact: true })}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
            initializing feed…
          </div>
        ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="t"
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              minTickGap={40}
            />
            <YAxis
              domain={["dataMin - 5000", "dataMax + 5000"]}
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(v) => usd(v, { compact: true })}
            />
            <Tooltip
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "var(--muted-foreground)" }}
              formatter={(v) => [usd(Number(v)), "Equity"]}
            />
            <Area
              type="monotone"
              dataKey="equity"
              stroke="var(--chart-1)"
              strokeWidth={2}
              fill="url(#eq)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
