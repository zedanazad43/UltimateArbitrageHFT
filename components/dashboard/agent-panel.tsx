"use client"

import { Bot, Cpu } from "lucide-react"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { usd, timeAgo } from "@/lib/format"
import type { AgentDecision } from "@/lib/types"

interface Props {
  auto: boolean
  aggressiveness: number
  maxExposure: number
  decisions: AgentDecision[]
  onAuto: (v: boolean) => void
  onAggressiveness: (v: number) => void
  onMaxExposure: (v: number) => void
}

const levelStyle: Record<AgentDecision["level"], string> = {
  info: "text-muted-foreground",
  action: "text-primary",
  risk: "text-destructive",
  warning: "text-warning",
}

export function AgentPanel({
  auto,
  aggressiveness,
  maxExposure,
  decisions,
  onAuto,
  onAggressiveness,
  onMaxExposure,
}: Props) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Bot className="size-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">AI Execution Agent</h2>
            <p className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <span className={`size-1.5 rounded-full ${auto ? "bg-primary animate-pulse" : "bg-muted-foreground"}`} />
              {auto ? "autonomous" : "manual override"}
            </p>
          </div>
        </div>
        <Switch checked={auto} onCheckedChange={onAuto} aria-label="Toggle autonomous mode" />
      </div>

      <div className="flex flex-col gap-4 border-b border-border p-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Aggressiveness</span>
            <span className="font-mono tabular-nums text-foreground">{aggressiveness}%</span>
          </div>
          <Slider
            value={[aggressiveness]}
            onValueChange={(vals) => onAggressiveness(Array.isArray(vals) ? vals[0] : vals)}
            min={0}
            max={100}
            step={1}
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Max Exposure Cap</span>
            <span className="font-mono tabular-nums text-foreground">
              {usd(maxExposure, { compact: true })}
            </span>
          </div>
          <Slider
            value={[maxExposure]}
            onValueChange={(vals) => onMaxExposure(Array.isArray(vals) ? vals[0] : vals)}
            min={250_000}
            max={5_000_000}
            step={50_000}
          />
        </div>
        <div className="flex items-center gap-2 rounded-md bg-background px-3 py-2 font-mono text-[11px] text-muted-foreground">
          <Cpu className="size-3.5 text-primary" />
          model: <span className="text-foreground">qhft-transformer-v4</span> · inference{" "}
          <span className="text-foreground">~68ns</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="px-4 pb-2 pt-3">
          <h3 className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Decision Log
          </h3>
        </div>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 pb-4 font-mono text-xs">
          {decisions.map((d) => (
            <div key={d.id} className="flex gap-2 leading-relaxed">
              <span className="shrink-0 text-muted-foreground/60">{timeAgo(d.ts)}</span>
              <span className={`shrink-0 uppercase ${levelStyle[d.level]}`}>[{d.level}]</span>
              <span className="text-foreground/90">{d.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
