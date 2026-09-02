import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, CardHeader, Pill } from "../components/ui/Primitives";
import { Play, Square, RotateCcw, Trophy } from "lucide-react";

const PRESETS = ["conservative", "balanced", "aggressive"];

export default function ABTest() {
  const [s, setS] = useState(null);
  const [laneA, setLaneA] = useState("conservative");
  const [laneB, setLaneB] = useState("aggressive");

  const load = async () => {
    try {
      const { data } = await api.get("/ab/status");
      setS(data);
      if (data?.lane_a?.preset) setLaneA(data.lane_a.preset);
      if (data?.lane_b?.preset) setLaneB(data.lane_b.preset);
    } catch (err) {
      console.error("ab status failed", err);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 2500);
    return () => clearInterval(id);
  }, []);

  const start = async () => {
    await api.post("/ab/start", { lane_a_preset: laneA, lane_b_preset: laneB });
    load();
  };
  const stop = async () => {
    await api.post("/ab/stop");
    load();
  };
  const reset = async () => {
    if (!window.confirm("Reset A/B counters? This wipes both lanes' PnL & trade history.")) return;
    await api.post("/ab/reset");
    load();
  };

  if (!s) return <div className="text-muted font-mono text-sm">[ loading A/B state... ]</div>;

  const a = s.lane_a || {};
  const b = s.lane_b || {};
  const leader = (a.pnl || 0) > (b.pnl || 0) ? "A" : (b.pnl || 0) > (a.pnl || 0) ? "B" : null;

  return (
    <div className="space-y-4 max-w-6xl" data-testid="abtest-page">
      <Card>
        <CardHeader
          subtitle="[ Strategy A/B · Paper-only ]"
          title="Two Lanes, Live Comparison"
          right={
            <div className="flex items-center gap-2">
              <Pill tone={s.enabled ? "success" : "neutral"} testid="ab-enabled-pill">
                {s.enabled ? "running" : "stopped"}
              </Pill>
              {s.started_at && (
                <span className="text-[11px] text-muted font-mono">
                  since {new Date(s.started_at).toLocaleTimeString()}
                </span>
              )}
            </div>
          }
        />
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <PresetPicker label="Lane A preset" value={laneA} setValue={setLaneA} testid="ab-lane-a-preset" />
          <PresetPicker label="Lane B preset" value={laneB} setValue={setLaneB} testid="ab-lane-b-preset" />
          <div className="flex gap-2">
            {!s.enabled && (
              <button
                onClick={start}
                data-testid="ab-start-button"
                className="flex-1 flex items-center justify-center gap-1.5 text-sm bg-primary text-black hover:bg-primary-hover px-4 py-2 rounded-sm"
              >
                <Play size={14} /> Start A/B
              </button>
            )}
            {s.enabled && (
              <button
                onClick={stop}
                data-testid="ab-stop-button"
                className="flex-1 flex items-center justify-center gap-1.5 text-sm border border-destructive/60 text-destructive hover:bg-destructive/10 px-4 py-2 rounded-sm"
              >
                <Square size={14} /> Stop
              </button>
            )}
            <button
              onClick={reset}
              data-testid="ab-reset-button"
              className="flex items-center gap-1.5 text-sm border border-border hover:border-white px-4 py-2 rounded-sm"
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <LaneCard letter="A" lane={a} winner={leader === "A"} testid="ab-lane-a-card" />
        <LaneCard letter="B" lane={b} winner={leader === "B"} testid="ab-lane-b-card" />
      </div>

      <Card>
        <CardHeader subtitle="[ Verdict ]" title="Performance Delta" />
        <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-4 font-mono">
          <Stat label="PnL Δ (A − B)" value={`$${((a.pnl || 0) - (b.pnl || 0)).toFixed(2)}`} positive={(a.pnl || 0) >= (b.pnl || 0)} testid="ab-delta-pnl" />
          <Stat label="Trades Δ" value={`${(a.trades || 0) - (b.trades || 0)}`} />
          <Stat label="Win-rate Δ" value={`${(((a.win_rate || 0) - (b.win_rate || 0)) * 100).toFixed(1)}%`} positive={(a.win_rate || 0) >= (b.win_rate || 0)} />
          <div className="flex flex-col">
            <div className="text-[10px] uppercase tracking-[0.22em] text-muted mb-1">Leader</div>
            <div className={`text-2xl font-semibold tracking-tight ${leader ? "text-primary" : "text-muted"} flex items-center gap-2`}>
              {leader ? <><Trophy size={20} /> Lane {leader}</> : "tie"}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function PresetPicker({ label, value, setValue, testid }) {
  return (
    <div data-testid={testid}>
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted mb-1.5">{label}</div>
      <div className="flex gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p}
            data-testid={`${testid}-${p}`}
            onClick={() => setValue(p)}
            className={`text-xs uppercase tracking-wider px-3 py-2 rounded-sm border ${
              value === p ? "border-primary text-primary bg-primary/10" : "border-border text-muted hover:text-white"
            }`}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function LaneCard({ letter, lane, winner, testid }) {
  const presetColor = {
    conservative: "text-accent",
    balanced: "text-primary",
    aggressive: "text-destructive",
  }[lane.preset] || "text-muted";
  return (
    <Card className={winner ? "glow-primary" : ""} testid={testid}>
      <div className="p-5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-sm bg-elevated border border-border flex items-center justify-center font-display text-lg font-semibold">{letter}</div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-muted">Preset</div>
              <div className={`font-display text-sm font-medium ${presetColor}`}>{lane.preset || "—"}</div>
            </div>
          </div>
          {winner && <Pill tone="success"><Trophy size={10} /> leading</Pill>}
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4">
          <Stat label="PnL" value={`$${(lane.pnl || 0).toFixed(2)}`} positive={(lane.pnl || 0) >= 0} testid={`${testid}-pnl`} />
          <Stat label="Trades" value={lane.trades || 0} />
          <Stat label="Win rate" value={`${((lane.win_rate || 0) * 100).toFixed(1)}%`} />
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value, positive, testid }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted mb-1">{label}</div>
      <div
        data-testid={testid}
        className={`text-xl font-mono font-semibold ${positive === undefined ? "" : positive ? "text-primary" : "text-destructive"}`}
      >
        {value}
      </div>
    </div>
  );
}
