import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, CardHeader, Pill } from "../components/ui/Primitives";
import { Send, Check, X } from "lucide-react";

export default function Telegram() {
  const [cfg, setCfg] = useState({ bot_token: "", chat_id: "", alerts_enabled: false });
  const [editingToken, setEditingToken] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    api.get("/telegram/config").then(({ data }) => setCfg(data));
  }, []);

  const save = async () => {
    const payload = { chat_id: cfg.chat_id, alerts_enabled: cfg.alerts_enabled };
    if (editingToken) payload.bot_token = cfg.bot_token;
    await api.put("/telegram/config", payload);
    setEditingToken(false);
    setStatus({ ok: true, msg: "Settings saved" });
    setTimeout(() => setStatus(null), 1800);
    api.get("/telegram/config").then(({ data }) => setCfg(data));
  };

  const test = async () => {
    try {
      await api.post("/telegram/test");
      setStatus({ ok: true, msg: "Test alert dispatched" });
    } catch (e) {
      setStatus({ ok: false, msg: e.response?.data?.detail || "Failed" });
    }
    setTimeout(() => setStatus(null), 2400);
  };

  return (
    <div className="space-y-4 max-w-3xl" data-testid="telegram-page">
      <Card>
        <CardHeader
          subtitle="[ Notifications ]"
          title="Telegram Alerts"
          right={<Pill tone={cfg.alerts_enabled ? "success" : "neutral"}>{cfg.alerts_enabled ? "active" : "disabled"}</Pill>}
        />
        <div className="p-5 space-y-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-muted mb-1.5">Bot Token</div>
            <div className="flex gap-2">
              <input
                type="text"
                value={cfg.bot_token}
                disabled={!editingToken}
                onChange={(e) => setCfg({ ...cfg, bot_token: e.target.value })}
                placeholder="123456:ABC-DEF..."
                data-testid="telegram-token-input"
                className="flex-1 bg-elevated border border-border rounded-sm px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none disabled:opacity-60"
              />
              <button
                onClick={() => setEditingToken((v) => !v)}
                data-testid="telegram-edit-token-button"
                className="text-xs px-3 py-2 border border-border hover:border-white rounded-sm"
              >
                {editingToken ? "Cancel" : "Edit"}
              </button>
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-muted mb-1.5">Chat ID</div>
            <input
              type="text"
              value={cfg.chat_id}
              onChange={(e) => setCfg({ ...cfg, chat_id: e.target.value })}
              placeholder="-100123456789"
              data-testid="telegram-chatid-input"
              className="w-full bg-elevated border border-border rounded-sm px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-between border border-border/60 rounded-sm px-3 py-2.5">
            <div>
              <div className="text-sm">Enable Alerts</div>
              <div className="text-[11px] text-muted">Trade fills, errors and critical warnings</div>
            </div>
            <button
              data-testid="telegram-alerts-toggle"
              onClick={() => setCfg({ ...cfg, alerts_enabled: !cfg.alerts_enabled })}
              className={`px-3 py-1 rounded-sm text-xs uppercase tracking-wider border ${
                cfg.alerts_enabled ? "border-primary text-primary bg-primary/10" : "border-border text-muted"
              }`}
            >
              {cfg.alerts_enabled ? "ON" : "OFF"}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={save}
              data-testid="telegram-save-button"
              className="text-xs px-4 py-2 bg-primary text-black hover:bg-primary-hover rounded-sm"
            >
              Save
            </button>
            <button
              onClick={test}
              data-testid="telegram-test-button"
              className="text-xs px-4 py-2 border border-accent/60 text-accent hover:bg-accent/10 rounded-sm flex items-center gap-1.5"
            >
              <Send size={12} /> Send Test Alert
            </button>
            {status && (
              <span
                data-testid="telegram-status"
                className={`text-xs flex items-center gap-1.5 ${status.ok ? "text-primary" : "text-destructive"}`}
              >
                {status.ok ? <Check size={12} /> : <X size={12} />}
                {status.msg}
              </span>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
