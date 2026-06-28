import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, CardHeader, Pill } from "../components/ui/Primitives";
import { Check } from "lucide-react";

const ALL_EX = ["Binance", "KuCoin", "MEXC", "Bybit", "OKX", "Coinbase", "Bitget"];
const ALL_SYM = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT", "BNB/USDT", "ADA/USDT", "DOGE/USDT", "AVAX/USDT", "LINK/USDT", "MATIC/USDT"];

export default function Config() {
  const [cfg, setCfg] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get("/bot/config").then(({ data }) => setCfg(data));
  }, []);

  if (!cfg) return <div className="text-muted font-mono text-sm">[ loading config... ]</div>;

  const toggleArr = (key, val) => {
    const arr = cfg[key] || [];
    const next = arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
    setCfg({ ...cfg, [key]: next });
    setDirty(true);
  };

  const save = async () => {
    await api.put("/bot/config", cfg);
    setDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="space-y-4 max-w-5xl" data-testid="config-page">
      <Card>
        <CardHeader
          subtitle="[ Strategy ]"
          title="Risk & Execution"
          right={
            <div className="flex items-center gap-2">
              {saved && <Pill tone="success"><Check size={10} /> saved</Pill>}
              <button
                onClick={save}
                disabled={!dirty}
                data-testid="config-save-button"
                className="text-xs px-4 py-1.5 bg-primary text-black hover:bg-primary-hover disabled:opacity-30 disabled:cursor-not-allowed rounded-sm"
              >
                Save Config
              </button>
            </div>
          }
        />
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Min Spread %" testid="config-min-spread">
            <input
              type="number"
              step="0.01"
              value={cfg.min_spread_pct}
              data-testid="config-min-spread-input"
              onChange={(e) => {
                setCfg({ ...cfg, min_spread_pct: parseFloat(e.target.value) });
                setDirty(true);
              }}
              className="w-full bg-elevated border border-border rounded-sm px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="Max Position (USD)" testid="config-max-position">
            <input
              type="number"
              step="50"
              value={cfg.max_position_usd}
              data-testid="config-max-position-input"
              onChange={(e) => {
                setCfg({ ...cfg, max_position_usd: parseFloat(e.target.value) });
                setDirty(true);
              }}
              className="w-full bg-elevated border border-border rounded-sm px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="Max Slippage %" testid="config-max-slippage">
            <input
              type="number"
              step="0.01"
              value={cfg.max_slippage_pct}
              data-testid="config-max-slippage-input"
              onChange={(e) => {
                setCfg({ ...cfg, max_slippage_pct: parseFloat(e.target.value) });
                setDirty(true);
              }}
              className="w-full bg-elevated border border-border rounded-sm px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="Trade Cooldown (ms)" testid="config-cooldown">
            <input
              type="number"
              step="50"
              value={cfg.trade_cooldown_ms}
              data-testid="config-cooldown-input"
              onChange={(e) => {
                setCfg({ ...cfg, trade_cooldown_ms: parseInt(e.target.value, 10) });
                setDirty(true);
              }}
              className="w-full bg-elevated border border-border rounded-sm px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="Auto-Restart on Crash" testid="config-auto-restart">
            <button
              data-testid="config-auto-restart-toggle"
              onClick={() => {
                setCfg({ ...cfg, auto_restart: !cfg.auto_restart });
                setDirty(true);
              }}
              className={`px-3 py-2 rounded-sm border text-xs uppercase tracking-wider ${
                cfg.auto_restart ? "border-primary text-primary bg-primary/10" : "border-border text-muted"
              }`}
            >
              {cfg.auto_restart ? "Enabled" : "Disabled"}
            </button>
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader subtitle="[ Universe ]" title="Allowed Symbols" />
        <div className="p-4 flex flex-wrap gap-2" data-testid="config-symbols-list">
          {ALL_SYM.map((s) => {
            const on = cfg.allowed_symbols.includes(s);
            return (
              <button
                key={s}
                data-testid={`config-symbol-${s.replace("/", "-").toLowerCase()}`}
                onClick={() => toggleArr("allowed_symbols", s)}
                className={`text-xs font-mono px-3 py-1.5 rounded-sm border transition-colors ${
                  on ? "border-primary text-primary bg-primary/10" : "border-border text-muted hover:text-white"
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeader subtitle="[ Venues ]" title="Enabled Exchanges" />
        <div className="p-4 flex flex-wrap gap-2" data-testid="config-exchanges-list">
          {ALL_EX.map((s) => {
            const on = cfg.enabled_exchanges.includes(s);
            return (
              <button
                key={s}
                data-testid={`config-exchange-${s.toLowerCase()}`}
                onClick={() => toggleArr("enabled_exchanges", s)}
                className={`text-xs font-mono px-3 py-1.5 rounded-sm border transition-colors ${
                  on ? "border-primary text-primary bg-primary/10" : "border-border text-muted hover:text-white"
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function Field({ label, testid, children }) {
  return (
    <div data-testid={testid}>
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted mb-1.5">{label}</div>
      {children}
    </div>
  );
}
