"use client"

import { useTradingEngine } from "@/hooks/use-trading-engine"
import { TopBar } from "@/components/dashboard/top-bar"
import { KpiCards } from "@/components/dashboard/kpi-cards"
import { EquityChart } from "@/components/dashboard/equity-chart"
import { AgentPanel } from "@/components/dashboard/agent-panel"
import { Opportunities } from "@/components/dashboard/opportunities"
import { ExecutionFeed } from "@/components/dashboard/execution-feed"
import { Strategies } from "@/components/dashboard/strategies"
import { Venues } from "@/components/dashboard/venues"

export default function Page() {
  const { state, actions } = useTradingEngine()

  return (
    <main className="flex min-h-screen flex-col">
      <TopBar
        running={state.running}
        venues={state.venues}
        onToggleRun={actions.setRunning}
        onKill={actions.killSwitch}
      />

      <div className="flex flex-1 flex-col gap-3 p-3 lg:p-4">
        <KpiCards state={state} />

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="h-[320px] lg:col-span-2">
            <EquityChart data={state.equity} />
          </div>
          <div className="h-[320px]">
            <Venues data={state.venues} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="h-[440px] lg:col-span-1">
            <AgentPanel
              auto={state.agentAuto}
              aggressiveness={state.aggressiveness}
              maxExposure={state.maxExposure}
              decisions={state.decisions}
              onAuto={actions.setAgentAuto}
              onAggressiveness={actions.setAggressiveness}
              onMaxExposure={actions.setMaxExposure}
            />
          </div>
          <div className="h-[440px] lg:col-span-2">
            <Opportunities data={state.opportunities} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="h-[380px]">
            <Strategies data={state.strategies} onToggle={actions.toggleStrategy} />
          </div>
          <div className="h-[380px]">
            <ExecutionFeed data={state.executions} />
          </div>
        </div>
      </div>

      <footer className="border-t border-border px-5 py-3 text-center font-mono text-[11px] text-muted-foreground">
        QUANTUMHFT — simulated market data for demonstration · not financial advice
      </footer>
    </main>
  )
}
