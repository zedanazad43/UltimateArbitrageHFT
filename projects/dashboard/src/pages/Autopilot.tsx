import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, CardHeader, Pill } from "../components/ui/Primitives";
import { Bot, ShieldCheck, ShieldAlert, Play, Check, X, AlertTriangle } from "lucide-react";

export default function Autopilot() {
  const [status, setStatus] = useState<any>(null);
  const [readiness, setReadiness] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const [s, r] = await Promise.all([api.get("/autopilot/status"), api.get("/safety/live-readiness")]);
      setStatus(s.data);
      setReadiness(r.data);
    } catch (err) {
      console.error("autopilot load failed", err);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const save = async (patch) => {
    setSaving(true);
    try {
      await api.put("/autopilot/config", patch);
      await load();
    } catch (err) {
      console.error("autopilot save failed", err);
    } finally {
      setSaving(false);
    }
  };

  const resume = async () => {
    await api.post("/autopilot/resume");
    load();
  };

  if (!status || !readiness) return <div className="text-muted font-mono text-sm">[ loading autopilot... ]</div>;

  return (
    <div className="space-y-4 max-w-5xl" data-testid="autopilot-page">
      {/* Master switch */}
      <Card className={status.enabled ? "glow-primary" : ""} testid="autopilot-master-card">
        <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`h-12 w-12 rounded-sm border flex items-center justify-center ${status.enabled ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-muted"}`}>
              <Bot size={22} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-muted">Autopilot</div>
              <div className="font-display text-xl tracking-tight" data-testid="autopilot-status-text">
                {status.enabled ? "ENGAGED" : "DISENGAGED"}
              </div>
              <div className="text-xs text-muted font-mono mt-1">
                {status.last_promoted_preset
                  ? <>last promoted <span className="text-primary">{status.last_promoted_preset}</span> @ {new Date(status.last_promoted_at).toLocaleString()}</>
                  : <>no promotion yet</>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              data-testid="autopilot-toggle-button"
              onClick={() => save({ enabled: !status.enabled })}
              disabled={saving}
              className={`text-sm px-4 py-2 rounded-sm transition-colors ${
                status.enabled
                  ? "border border-destructive/60 text-destructive hover:bg-destructive/10"
                  : "bg-primary text-black hover:bg-primary-hover"
              }`}
            >
              {status.enabled ? "Disengage" : "Engage Autopilot"}
            </button>
            {status.last_pause_at && (
              <button
                onClick={resume}
                data-testid="autopilot-resume-button"
                className="flex items-center gap-1.5 text-xs border border-primary/60 text-primary hover:bg-primary/10 px-3 py-2 rounded-sm"
                title="Resume bot after circuit-breaker pause"
              >
                <Play size={12} /> Resume after pause
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Config */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader subtitle="[ Periodic promotion ]" title="A/B Winner Auto-Promote" />
          <div className="p-4 space-y-4">
            <NumberField
              label="Promote every (hours)"
              value={status.promote_interval_hours}
              onSave={(v) => save({ promote_interval_hours: v })}
              min={1}
              max={168}
              testid="autopilot-promote-interval"
            />
            <NumberField
              label="Minimum winner lead (%)"
              value={status.min_winner_lead_pct}
              onSave={(v) => save({ min_winner_lead_pct: v })}
              step={0.5}
              min={0.5}
              max={100}
              testid="autopilot-min-lead"
            />
            <NumberField
              label="Minimum lane trades"
              value={status.min_lane_trades}
              onSave={(v) => save({ min_lane_trades: v })}
              min={1}
              max={500}
              testid="autopilot-min-trades"
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            subtitle="[ Circuit breaker ]"
            title="Auto-Pause on Alert Storm"
            right={
              <button
                data-testid="autopilot-breaker-toggle"
                onClick={() => save({ circuit_breaker_enabled: !status.circuit_breaker_enabled })}
                className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-sm border ${
                  status.circuit_breaker_enabled ? "border-primary text-primary bg-primary/10" : "border-border text-muted"
                }`}
              >
                {status.circuit_breaker_enabled ? "on" : "off"}
              </button>
            }
          />
          <div className="p-4 space-y-4">
            <NumberField
              label="Events threshold (in window)"
              value={status.breaker_events}
              onSave={(v) => save({ breaker_events: v })}
              min={1}
              max={50}
              testid="autopilot-breaker-events"
            />
            <NumberField
              label="Window (minutes)"
              value={status.breaker_window_minutes}
              onSave={(v) => save({ breaker_window_minutes: v })}
              min={1}
              max={720}
              testid="autopilot-breaker-window"
            />
            {status.last_pause_at && (
              <div className="text-xs font-mono text-destructive border border-destructive/30 bg-destructive/5 px-3 py-2 rounded-sm">
                Last paused: {new Date(status.last_pause_at).toLocaleString()}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Live-mode readiness */}
      <Card className={readiness.ready ? "glow-primary" : "glow-destructive"} testid="readiness-card">
        <CardHeader
          subtitle="[ Pre-flight ]"
          title="Live-Mode Safety Checklist"
          right={
            <Pill tone={readiness.ready ? "success" : "danger"} testid="readiness-pill">
              {readiness.ready ? <><ShieldCheck size={10} /> READY</> : <><ShieldAlert size={10} /> {readiness.blocking_count} BLOCKING</>}
            </Pill>
          }
        />
        <div className="p-4 space-y-2">
          {(readiness.checks || []).map((c) => (
            <div key={c.id} className="flex items-start gap-3 px-3 py-2 rounded-sm border border-border/60" data-testid={`readiness-check-${c.id}`}>
              <div className={`h-5 w-5 rounded-sm flex items-center justify-center shrink-0 ${c.ok ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive"}`}>
                {c.ok ? <Check size={12} /> : <X size={12} />}
              </div>
              <div className="text-sm">{c.label}</div>
            </div>
          ))}
        </div>
        {!readiness.ready && (
          <div className="px-4 pb-4">
            <div className="text-[11px] font-mono text-destructive flex items-start gap-2 border border-destructive/30 bg-destructive/5 px-3 py-2 rounded-sm">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>LIVE mode is blocked by the API until all prerequisites pass. This is intentional — flipping to LIVE without these checks would risk capital loss.</span>
            </div>
          </div>
        )}
      </Card>

      <div className="text-[11px] text-muted font-mono leading-relaxed px-1">
        Autopilot is a paper-tested promotion + circuit-breaker layer. It does NOT itself execute trades — it only updates the bot's active strategy preset based on observed A/B performance, and pauses the bot when alert events spike. Real-money trading still requires the LIVE-mode safety checklist to fully pass.
      </div>
    </div>
  );
}

function NumberField({ label, value, onSave, step = 1, min, max, testid }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    if (v !== value) onSave(typeof value === "number" ? Number(v) : v);
  };
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted mb-1.5">{label}</div>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        data-testid={testid}
        className="w-full bg-elevated border border-border rounded-sm px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
      />
    </div>
  );
}
