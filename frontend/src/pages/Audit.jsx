import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, CardHeader, Pill } from "../components/ui/Primitives";

const ACTION_TONE = {
  "auth.login": "success",
  "auth.login_failed": "danger",
  "bot.start": "success",
  "bot.stop": "warn",
  "bot.restart": "accent",
  "bot.mode": "accent",
  "ab.start": "success",
  "ab.stop": "warn",
  "ab.reset": "danger",
  "user.update": "warn",
};

export default function Audit() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("");

  const load = async () => {
    try {
      const { data } = await api.get(`/audit?limit=200${filter ? `&action=${encodeURIComponent(filter)}` : ""}`);
      setItems(data);
    } catch (err) {
      console.error("audit load failed", err);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const actions = Array.from(new Set(items.map((r) => r.action))).sort();

  return (
    <div className="space-y-4 max-w-6xl" data-testid="audit-page">
      <Card>
        <CardHeader
          subtitle="[ Who · What · When ]"
          title="Audit Log"
          right={
            <div className="flex items-center gap-2">
              <Pill tone="accent" testid="audit-count">{items.length} entries</Pill>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                data-testid="audit-filter"
                className="text-xs bg-elevated border border-border rounded-sm px-2 py-1 focus:border-primary focus:outline-none"
              >
                <option value="">all actions</option>
                {actions.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          }
        />
        <div className="divide-y divide-border/60 max-h-[640px] overflow-auto">
          {items.length === 0 && (
            <div className="px-4 py-10 text-center text-xs text-muted font-mono">[ no audit entries match the filter ]</div>
          )}
          {items.map((r, i) => (
            <div key={`${r.ts}-${i}`} className="px-4 py-2.5 grid grid-cols-1 md:grid-cols-12 gap-2 items-center" data-testid={`audit-row-${i}`}>
              <div className="md:col-span-2 text-[11px] text-muted font-mono">{new Date(r.ts).toLocaleString()}</div>
              <div className="md:col-span-2">
                <div className="text-sm">{r.actor_email || <span className="text-muted">(anon)</span>}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted">{r.actor_role || "—"}</div>
              </div>
              <div className="md:col-span-2">
                <Pill tone={ACTION_TONE[r.action] || "neutral"}>{r.action}</Pill>
              </div>
              <div className="md:col-span-6 font-mono text-[11px] text-muted truncate" title={JSON.stringify(r.details)}>
                {r.details && Object.keys(r.details).length > 0 ? JSON.stringify(r.details) : "—"}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
