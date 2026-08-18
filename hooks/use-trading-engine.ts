"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type {
  ArbOpportunity,
  Execution,
  Strategy,
  AgentDecision,
  EquityPoint,
  Venue,
} from "@/lib/types"
import {
  initialVenues,
  initialStrategies,
  initialEquity,
  makeOpportunity,
  makeExecution,
  makeDecision,
  nextEquity,
} from "@/lib/market"

export interface EngineState {
  running: boolean
  agentAuto: boolean
  aggressiveness: number
  maxExposure: number
  venues: Venue[]
  strategies: Strategy[]
  opportunities: ArbOpportunity[]
  executions: Execution[]
  decisions: AgentDecision[]
  equity: EquityPoint[]
}

export function useTradingEngine() {
  const [running, setRunning] = useState(true)
  const [agentAuto, setAgentAuto] = useState(true)
  const [aggressiveness, setAggressiveness] = useState(65)
  const [maxExposure, setMaxExposure] = useState(2_000_000)
  const [venues, setVenues] = useState<Venue[]>([])
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [opportunities, setOpportunities] = useState<ArbOpportunity[]>([])
  const [executions, setExecutions] = useState<Execution[]>([])
  const [decisions, setDecisions] = useState<AgentDecision[]>([])
  const [equity, setEquity] = useState<EquityPoint[]>([])

  // Seed all data on the client only, to avoid SSR/CSR hydration mismatch
  // (the mock engine uses Math.random / Date.now).
  useEffect(() => {
    setVenues(initialVenues())
    setStrategies(initialStrategies())
    setOpportunities(Array.from({ length: 6 }, makeOpportunity))
    setExecutions(Array.from({ length: 12 }, () => makeExecution()))
    setDecisions(Array.from({ length: 8 }, makeDecision))
    setEquity(initialEquity())
  }, [])

  const runningRef = useRef(running)
  const aggRef = useRef(aggressiveness)
  runningRef.current = running
  aggRef.current = aggressiveness

  // fast tick — executions + opportunities
  useEffect(() => {
    const id = setInterval(() => {
      if (!runningRef.current) return
      const agg = aggRef.current / 100

      setExecutions((prev) => {
        const count = 1 + Math.floor(Math.random() * (1 + agg * 3))
        const fresh = Array.from({ length: count }, () => makeExecution())
        return [...fresh, ...prev].slice(0, 40)
      })

      setOpportunities((prev) => {
        const next = prev.map((o) => {
          const r = Math.random()
          if (o.status === "detected" && r < 0.35 + agg * 0.4)
            return { ...o, status: "executing" as const }
          if (o.status === "executing")
            return { ...o, status: (Math.random() < 0.8 ? "filled" : "missed") as ArbOpportunity["status"] }
          return o
        })
        const kept = next.filter((o) => o.status === "detected" || o.status === "executing")
        const add = Array.from({ length: Math.max(0, 6 - kept.length) }, makeOpportunity)
        return [...kept, ...add].slice(0, 8)
      })

      setStrategies((prev) =>
        prev.map((s) =>
          s.enabled
            ? {
                ...s,
                pnlUsd: s.pnlUsd + (Math.random() - 0.4) * 400 * (0.5 + agg),
                trades: s.trades + Math.floor(Math.random() * 6),
              }
            : s,
        ),
      )
    }, 1400)
    return () => clearInterval(id)
  }, [])

  // slow tick — equity, venues, decisions
  useEffect(() => {
    const id = setInterval(() => {
      if (!runningRef.current) return
      setEquity((prev) => nextEquity(prev))
      setVenues((prev) =>
        prev.map((v) => ({
          ...v,
          latencyNs: Math.max(90, Math.round(v.latencyNs + (Math.random() - 0.5) * 120)),
        })),
      )
    }, 3000)
    return () => clearInterval(id)
  }, [])

  // agent decisions (only when auto on)
  useEffect(() => {
    const id = setInterval(() => {
      if (!runningRef.current || !agentAuto) return
      setDecisions((prev) => [makeDecision(), ...prev].slice(0, 30))
    }, 2600)
    return () => clearInterval(id)
  }, [agentAuto])

  const toggleStrategy = useCallback((id: string) => {
    setStrategies((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
    )
  }, [])

  const killSwitch = useCallback(() => {
    setRunning(false)
    setAgentAuto(false)
    setStrategies((prev) => prev.map((s) => ({ ...s, enabled: false })))
    setDecisions((prev) =>
      [
        {
          id: Math.random().toString(36).slice(2),
          ts: Date.now(),
          level: "risk" as const,
          message: "KILL SWITCH engaged — all strategies halted, open orders cancelled",
        },
        ...prev,
      ].slice(0, 30),
    )
  }, [])

  return {
    state: {
      running,
      agentAuto,
      aggressiveness,
      maxExposure,
      venues,
      strategies,
      opportunities,
      executions,
      decisions,
      equity,
    } as EngineState,
    actions: {
      setRunning,
      setAgentAuto,
      setAggressiveness,
      setMaxExposure,
      toggleStrategy,
      killSwitch,
    },
  }
}
