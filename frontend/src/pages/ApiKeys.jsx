import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, CardHeader, Pill } from "../components/ui/Primitives";
import { KeyRound, Check, Trash2, Plus, X } from "lucide-react";

const EXCHANGES = ["Binance", "KuCoin", "MEXC", "Bybit", "OKX", "Coinbase", "Bitget"];

export default function ApiKeys() {
  const [data, setData] = useState({ items: [], supported: EXCHANGES, configured: [] });
  const [editing, setEditing] = useState(null); // exchange or null
  const [form, setForm] = useState({ api_key: "", api_secret: "", passphrase: "", label: "", permissions: ["read"] });
  const [status, setStatus] = useState(null);
  const [tests, setTests] = useState({}); // exchange -> {loading, ok, ms, balances}

  const load = async () => {
    const { data } = await api.get("/exchange-keys");
    setData(data);
  };

  useEffect(() => {
    load();
  }, []);

  const open = (ex) => {
    setEditing(ex);
    const existing = data.items.find((i) => i.exchange === ex);
    setForm({ api_key: "", api_secret: "", passphrase: "", label: existing?.label || "", permissions: existing?.permissions || ["read"] });
    setStatus(null);
  };
  const close = () => {
    setEditing(null);
    setStatus(null);
  };

  const save = async () => {
    try {
      await api.post("/exchange-keys", {
        exchange: editing,
        api_key: form.api_key,
        api_secret: form.api_secret,
        passphrase: form.passphrase || undefined,
        label: form.label || undefined,
        permissions: form.permissions,
      });
      setStatus({ ok: true, msg: "Saved (encrypted)" });
      await load();
      setTimeout(close, 1000);
    } catch (e) {
      setStatus({ ok: false, msg: e.response?.data?.detail || "Failed" });
    }
  };

  const remove = async (ex) => {
    if (!window.confirm(`Remove API keys for ${ex}? This cannot be undone.`)) return;
    await api.delete(`/exchange-keys/${ex}`);
    await load();
  };

  const togglePermission = async (ex, item, perm) => {
    const cur = item.permissions || [];
    const next = cur.includes(perm) ? cur.filter((p) => p !== perm) : [...cur, perm];
    try {
      await api.patch(`/exchange-keys/${ex}/permissions`, { permissions: next });
      await load();
    } catch (err) {
      console.error("permissions update failed", err);
    }
  };

  const testKey = async (ex) => {
    setTests((p) => ({ ...p, [ex]: { loading: true } }));
    try {
      const { data } = await api.post(`/exchange-keys/${ex}/test`);
      setTests((p) => ({ ...p, [ex]: { ok: true, ms: data.latency_ms, source: data.source, balances: data.balances } }));
    } catch (err) {
      setTests((p) => ({ ...p, [ex]: { ok: false, msg: err.response?.data?.detail || "fail" } }));
    }
    setTimeout(() => setTests((p) => ({ ...p, [ex]: null })), 6000);
  };

  const byExchange = Object.fromEntries(data.items.map((i) => [i.exchange, i]));

  return (
    <div className="space-y-4 max-w-5xl" data-testid="apikeys-page">
      <Card>
        <CardHeader
          subtitle="[ Vault ]"
          title="Exchange API Keys"
          right={
            <Pill tone="success">
              <KeyRound size={10} /> AES-128 + HMAC
            </Pill>
          }
        />
        <div className="p-2 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {EXCHANGES.map((ex) => {
            const item = byExchange[ex];
            const configured = !!item;
            return (
              <div
                key={ex}
                data-testid={`apikey-card-${ex.toLowerCase()}`}
                className={`border rounded-sm p-4 transition-colors ${
                  configured ? "border-primary/40 bg-primary/[0.02]" : "border-border/60"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="font-display text-sm font-medium">{ex}</div>
                  {configured ? (
                    <Pill tone="success">
                      <Check size={10} /> linked
                    </Pill>
                  ) : (
                    <Pill>not set</Pill>
                  )}
                </div>

                {configured && (
                  <div className="space-y-1.5 text-[11px] font-mono text-muted">
                    {item.label && <div className="text-white">{item.label}</div>}
                    <div className="flex justify-between">
                      <span>Key</span>
                      <span className="text-white">{item.api_key_masked}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Secret</span>
                      <span className="text-white">{item.api_secret_masked}</span>
                    </div>
                    {item.has_passphrase && (
                      <div className="flex justify-between">
                        <span>Passphrase</span>
                        <span className="text-white">{item.passphrase_masked}</span>
                      </div>
                    )}
                    <div className="pt-2 border-t border-border/40 mt-2 flex flex-wrap gap-1">
                      {["read", "trade", "withdraw"].map((p) => {
                        const on = (item.permissions || []).includes(p);
                        return (
                          <button
                            key={p}
                            data-testid={`apikey-perm-${ex.toLowerCase()}-${p}`}
                            onClick={() => togglePermission(ex, item, p)}
                            className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border transition-colors ${
                              on
                                ? p === "withdraw"
                                  ? "border-destructive text-destructive bg-destructive/10"
                                  : "border-primary text-primary bg-primary/10"
                                : "border-border text-muted hover:text-white"
                            }`}
                          >
                            {p}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => open(ex)}
                    data-testid={`apikey-edit-${ex.toLowerCase()}`}
                    className="flex-1 text-xs px-3 py-1.5 border border-border hover:border-primary/60 hover:text-primary rounded-sm flex items-center justify-center gap-1.5"
                  >
                    {configured ? "Replace" : (<><Plus size={11} /> Add</>)}
                  </button>
                  {configured && (
                    <button
                      onClick={() => remove(ex)}
                      data-testid={`apikey-delete-${ex.toLowerCase()}`}
                      className="text-xs px-3 py-1.5 border border-destructive/40 text-destructive hover:bg-destructive/10 rounded-sm flex items-center gap-1.5"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="px-4 py-3 border-t border-border/60 text-[11px] text-muted font-mono">
          Secrets are encrypted with Fernet (AES-128-CBC + HMAC-SHA256) using the server&apos;s ENCRYPTION_KEY and never returned in cleartext.
        </div>
      </Card>

      {editing && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          data-testid="apikey-modal"
        >
          <div className="w-full max-w-md bg-surface border border-border rounded-sm">
            <div className="px-5 py-3 border-b border-border/60 flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-muted">[ Encrypted at rest ]</div>
                <div className="font-display text-base">{editing} · API Key</div>
              </div>
              <button onClick={close} data-testid="apikey-modal-close" className="text-muted hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <Field label="Label (optional)">
                <input
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder="e.g. primary spot"
                  data-testid="apikey-label-input"
                  className="w-full bg-elevated border border-border rounded-sm px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </Field>
              <Field label="API Key">
                <input
                  value={form.api_key}
                  onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                  data-testid="apikey-key-input"
                  className="w-full bg-elevated border border-border rounded-sm px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
                />
              </Field>
              <Field label="API Secret">
                <input
                  type="password"
                  value={form.api_secret}
                  onChange={(e) => setForm({ ...form, api_secret: e.target.value })}
                  data-testid="apikey-secret-input"
                  className="w-full bg-elevated border border-border rounded-sm px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
                />
              </Field>
              {(editing === "KuCoin" || editing === "OKX" || editing === "Coinbase") && (
                <Field label="Passphrase (required for this exchange)">
                  <input
                    type="password"
                    value={form.passphrase}
                    onChange={(e) => setForm({ ...form, passphrase: e.target.value })}
                    data-testid="apikey-passphrase-input"
                    className="w-full bg-elevated border border-border rounded-sm px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
                  />
                </Field>
              )}

              <Field label="Permissions">
                <div className="flex flex-wrap gap-1.5" data-testid="apikey-form-permissions">
                  {["read", "trade", "withdraw"].map((p) => {
                    const on = (form.permissions || []).includes(p);
                    return (
                      <button
                        type="button"
                        key={p}
                        data-testid={`apikey-form-perm-${p}`}
                        onClick={() => {
                          const cur = form.permissions || [];
                          setForm({ ...form, permissions: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p] });
                        }}
                        className={`text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-sm border ${
                          on
                            ? p === "withdraw"
                              ? "border-destructive text-destructive bg-destructive/10"
                              : "border-primary text-primary bg-primary/10"
                            : "border-border text-muted"
                        }`}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
              </Field>

              {status && (
                <div
                  data-testid="apikey-status"
                  className={`text-xs px-3 py-2 rounded-sm border ${
                    status.ok
                      ? "border-primary/40 text-primary bg-primary/5"
                      : "border-destructive/40 text-destructive bg-destructive/5"
                  }`}
                >
                  {status.msg}
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={save}
                  disabled={!form.api_key || !form.api_secret}
                  data-testid="apikey-save-button"
                  className="flex-1 text-xs px-4 py-2 bg-primary text-black hover:bg-primary-hover disabled:opacity-30 disabled:cursor-not-allowed rounded-sm"
                >
                  Encrypt & Save
                </button>
                <button
                  onClick={close}
                  data-testid="apikey-cancel-button"
                  className="text-xs px-4 py-2 border border-border hover:border-white rounded-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted mb-1.5">{label}</div>
      {children}
    </div>
  );
}
