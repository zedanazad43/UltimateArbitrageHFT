import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, CardHeader, Pill } from "../components/ui/Primitives";
import { Plus, Trash2, X, Bell, Send, Check } from "lucide-react";

const emptyRule = {
  name: "",
  metric: "max_spread_pct",
  op: ">",
  threshold: 0.5,
  cooldown_seconds: 600,
  enabled: true,
  notes: "",
};

export default function Alerts() {
  const [rules, setRules] = useState([]);
  const [events, setEvents] = useState([]);
  const [metrics, setMetrics] = useState({ metrics: [], ops: [] });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyRule);
  const [error, setError] = useState("");
  const [fired, setFired] = useState({}); // ruleId -> ts

  const load = async () => {
    try {
      const [r, e, m] = await Promise.all([
        api.get("/alerts/rules"),
        api.get("/alerts/events?limit=50"),
        api.get("/alerts/metrics"),
      ]);
      setRules(r.data);
      setEvents(e.data);
      setMetrics(m.data);
    } catch (err) {
      console.error("alerts load failed", err);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await api.post("/alerts/rules", form);
      setForm(emptyRule);
      setAdding(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to create rule");
    }
  };

  const toggle = async (rule) => {
    await api.patch(`/alerts/rules/${rule.id}`, { enabled: !rule.enabled });
    await load();
  };

  const remove = async (rule) => {
    if (!window.confirm(`Delete rule "${rule.name}"?`)) return;
    await api.delete(`/alerts/rules/${rule.id}`);
    await load();
  };

  const test = async (rule) => {
    await api.post(`/alerts/rules/${rule.id}/test`);
    setFired((p) => ({ ...p, [rule.id]: Date.now() }));
    setTimeout(() => setFired((p) => ({ ...p, [rule.id]: null })), 2000);
    await load();
  };

  const formatVal = (v) => (typeof v === "number" ? v.toFixed(4) : v);

  return (
    <div className="space-y-4 max-w-6xl" data-testid="alerts-page">
      <Card>
        <CardHeader
          subtitle="[ Rule Engine ]"
          title="Alert Rules"
          right={
            <div className="flex items-center gap-2">
              <Pill tone="accent" testid="alerts-rules-count">{rules.length} rules</Pill>
              <button
                onClick={() => {
                  setAdding((a) => !a);
                  setError("");
                  setForm(emptyRule);
                }}
                data-testid="alerts-add-toggle"
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-sm border ${
                  adding ? "border-destructive/60 text-destructive" : "border-primary text-primary bg-primary/10"
                }`}
              >
                {adding ? <X size={12} /> : <Plus size={12} />}
                {adding ? "Cancel" : "New Rule"}
              </button>
            </div>
          }
        />

        {adding && (
          <form onSubmit={submit} className="p-4 border-b border-border/60 grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="alerts-add-form">
            <Field label="Name" full>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                placeholder="Big spread spotted"
                data-testid="alerts-name-input"
                className="w-full bg-elevated border border-border rounded-sm px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </Field>
            <Field label="Metric">
              <select
                value={form.metric}
                onChange={(e) => setForm({ ...form, metric: e.target.value })}
                data-testid="alerts-metric-select"
                className="w-full bg-elevated border border-border rounded-sm px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
              >
                {(metrics.metrics || []).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="Operator">
              <select
                value={form.op}
                onChange={(e) => setForm({ ...form, op: e.target.value })}
                data-testid="alerts-op-select"
                className="w-full bg-elevated border border-border rounded-sm px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
              >
                {(metrics.ops || []).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </Field>
            <Field label="Threshold">
              <input
                type="number"
                step="0.01"
                value={form.threshold}
                onChange={(e) => setForm({ ...form, threshold: parseFloat(e.target.value) })}
                required
                data-testid="alerts-threshold-input"
                className="w-full bg-elevated border border-border rounded-sm px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
              />
            </Field>
            <Field label="Cooldown (s)">
              <input
                type="number"
                step="10"
                min="10"
                value={form.cooldown_seconds}
                onChange={(e) => setForm({ ...form, cooldown_seconds: parseInt(e.target.value, 10) })}
                data-testid="alerts-cooldown-input"
                className="w-full bg-elevated border border-border rounded-sm px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
              />
            </Field>
            <Field label="Notes (optional)" full>
              <input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                data-testid="alerts-notes-input"
                className="w-full bg-elevated border border-border rounded-sm px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </Field>
            {error && (
              <div className="md:col-span-3 border border-destructive/50 bg-destructive/10 text-destructive text-xs px-3 py-2 rounded-sm" data-testid="alerts-error">
                {error}
              </div>
            )}
            <div className="md:col-span-3">
              <button
                type="submit"
                data-testid="alerts-save-button"
                className="text-xs bg-primary text-black hover:bg-primary-hover px-4 py-2 rounded-sm flex items-center gap-1.5"
              >
                <Bell size={12} /> Create Rule
              </button>
            </div>
          </form>
        )}

        <div className="divide-y divide-border/60">
          {rules.length === 0 && (
            <div className="px-4 py-10 text-center text-xs text-muted font-mono">[ no alert rules yet — click "New Rule" to create one ]</div>
          )}
          {rules.map((r) => (
            <div key={r.id} className="px-4 py-3 grid grid-cols-1 md:grid-cols-7 gap-3 items-center" data-testid={`alert-rule-row-${r.id}`}>
              <div className="md:col-span-2">
                <div className="text-sm font-medium">{r.name}</div>
                {r.notes && <div className="text-[11px] text-muted">{r.notes}</div>}
              </div>
              <div className="md:col-span-2 font-mono text-xs text-muted">
                <span className="text-white">{r.metric}</span>{" "}
                <span className="text-primary">{r.op}</span>{" "}
                <span className="text-white">{r.threshold}</span>
              </div>
              <div className="md:col-span-1 text-[11px] font-mono text-muted">
                cooldown {r.cooldown_seconds}s
              </div>
              <div className="md:col-span-1 flex items-center gap-1.5">
                <button
                  onClick={() => toggle(r)}
                  data-testid={`alerts-toggle-${r.id}`}
                  className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-sm border ${
                    r.enabled ? "border-primary text-primary bg-primary/10" : "border-border text-muted"
                  }`}
                >
                  {r.enabled ? "on" : "off"}
                </button>
                <button
                  onClick={() => test(r)}
                  data-testid={`alerts-test-${r.id}`}
                  className="text-xs px-2 py-1 border border-accent/40 text-accent hover:bg-accent/10 rounded-sm flex items-center gap-1"
                >
                  {fired[r.id] ? <Check size={11} /> : <Send size={11} />}
                </button>
              </div>
              <div className="md:col-span-1 flex justify-end">
                <button
                  onClick={() => remove(r)}
                  data-testid={`alerts-delete-${r.id}`}
                  className="text-xs px-2 py-1 rounded-sm border border-destructive/40 text-destructive hover:bg-destructive/10"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          subtitle="[ Last 50 ]"
          title="Recent Alert Events"
          right={<Pill tone="success" testid="alerts-events-count">{events.length} fires</Pill>}
        />
        <div className="max-h-[420px] overflow-auto divide-y divide-border/60">
          {events.length === 0 && (
            <div className="px-4 py-10 text-center text-xs text-muted font-mono">[ no alerts have fired yet ]</div>
          )}
          {events.map((e, i) => (
            <div key={`${e.ts}-${i}`} className="px-4 py-2.5 flex items-center justify-between" data-testid={`alert-event-${i}`}>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{e.rule_name}</div>
                <div className="text-[11px] text-muted font-mono">{e.msg}</div>
              </div>
              <div className="text-[11px] text-muted font-mono">
                {new Date(e.ts).toLocaleTimeString()}
                <span className="mx-2">·</span>
                <span className="text-accent">{e.channel}</span>
                <span className="mx-2">·</span>
                <span className="text-primary">{formatVal(e.value)}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Field({ label, full, children }) {
  return (
    <div className={full ? "md:col-span-3" : ""}>
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted mb-1.5">{label}</div>
      {children}
    </div>
  );
}
