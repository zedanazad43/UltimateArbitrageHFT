import React, { useEffect, useState, useCallback } from "react";
import api from "../lib/api";
import { Card, CardHeader, Metric, Pill } from "../components/ui/Primitives";
import { Play, Square, RotateCcw, ShieldAlert } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import PnlChart from "../components/PnlChart";
import EquityChart from "../components/EquityChart";

export default function Dashboard() {
  const { user } = useAuth();
  const isAdmin = !!user && user.role === "admin";
  const [status, setStatus] = useState<any>(null);
  const [pnl, setPnl] = useState<any>(null);
  const [opps, setOpps] = useState<any[]>([]);
  const [trades, setTrades] = useState<any[]>([]);
  const [readiness, setReadiness] = useState<any>(null);
  const [actionError, setActionError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [s, p, o] = await Promise.all([
        api.get("/status"),
        api.get("/api/pnl"),
        api.get("/opportunities"),
      ]);
      setStatus(s.data);
      setPnl(p.data);
      setOpps(Array.isArray(o.data) ? o.data : (o.data?.items || []));
      setTrades(Array.isArray(s.data?.recentTrades) ? s.data.recentTrades.slice(0, 10) : []);
      setReadiness({ live: s.data?.mode === "live", paper: s.data?.paper_trading !== false });
    } catch (e) { console.error("dashboard refresh failed", e); }
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 5000); return () => clearInterval(id); }, [refresh]);

  const action = async (a) => {
    setActionError("");
    try {
      await api.post("/bot/action", { action: a });
      refresh();
    } catch (err) {
      setActionError(err.response?.data?.detail || "Action failed");
      setTimeout(() => setActionError(""), 4500);
    }
  };
  const setMode = async (mode) => {
    setActionError("");
    try {
      await api.post("/bot/mode", { mode });
      refresh();
    } catch (err) {
      setActionError(err.response?.data?.detail || "Mode change failed");
      setTimeout(() => setActionError(""), 6000);
    }
  };

  const running = status?.trading_enabled;
  const live = status?.mode === "live";

  return (
    <div className="space-y-5" data-testid="dashboard-page">
      {/* Master control */}
      <Card className={`${running ? "glow-primary" : "glow-destructive"}`} testid="master-control-card">
        <div className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="flex items-center gap-5">
            <div className={`h-14 w-14 rounded-sm border flex items-center justify-center ${running ? "border-primary/60 bg-primary/10" : "border-destructive/60 bg-destructive/10"}`}>
              <span className={`h-3 w-3 rounded-full ${running ? "bg-primary animate-pulseDot" : "bg-destructive"}`} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-muted">Bot Status</div>
              <div className="font-display text-2xl tracking-tight" data-testid="bot-status-text">{running ? "RUNNING" : "STOPPED"}</div>
              <div className="text-xs text-muted font-mono mt-1">
                region <span className="text-white">{status?.worker_region || "—"}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 border border-border rounded-sm p-1 bg-elevated/50" data-testid="mode-switch">
              <button onClick={() => setMode("paper")} disabled={!isAdmin} data-testid="mode-paper-button" className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${!live ? "bg-accent text-white" : "text-muted hover:text-white"}`}>Paper</button>
              <button onClick={() => setMode("live")} disabled={!isAdmin} data-testid="mode-live-button" className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded-sm transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed ${live ? "bg-destructive text-white" : "text-muted hover:text-white"}`}><ShieldAlert size={12} /> Live</button>
            </div>

            <button onClick={() => action("start")} disabled={running || !isAdmin} className="px-3 py-1.5 text-xs bg-primary/20 border border-primary/40 text-primary rounded-sm hover:bg-primary/30 disabled:opacity-40 flex items-center gap-1"><Play size={12} />Start</button>
            <button onClick={() => action("stop")} disabled={!running || !isAdmin} className="px-3 py-1.5 text-xs bg-destructive/20 border border-destructive/40 text-destructive rounded-sm hover:bg-destructive/30 disabled:opacity-40 flex items-center gap-1"><Square size={12} />Stop</button>
            <button onClick={refresh} className="px-3 py-1.5 text-xs bg-accent/20 border border-accent/40 text-accent rounded-sm hover:bg-accent/30 flex items-center gap-1"><RotateCcw size={12} />Refresh</button>
          </div>
          {actionError && <div className="text-xs text-destructive font-mono">{actionError}</div>}
        </div>
      </Card>

      {/* Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card testid="metric-capital">
          <CardHeader title="Capital / Equity" />
          <Metric value={`$${(status?.capital || 0).toLocaleString()}`} />
        </Card>
        <Card testid="metric-pnl">
          <CardHeader title="Total P&L" />
          <Metric value={`${status?.totalProfit >= 0 ? "+" : ""}$${(status?.totalProfit || 0).toFixed(2)}`} status={status?.totalProfit >= 0 ? "success" : "error"} />
        </Card>
        <Card testid="metric-trades">
          <CardHeader title="Total Trades" />
          <Metric value={status?.totalTrades || 0} />
        </Card>
        <Card testid="metric-winrate">
          <CardHeader title="Win Rate" />
          <Metric value={`${((status?.winRate || 0) * 100).toFixed(1)}%`} />
        </Card>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <PnlChart />
        <EquityChart />
      </div>

      {/* Trades + PnL by category */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card testid="trades-card">
            <CardHeader title="Live Trades (D1)" />
            <div className="p-4">
              {trades.length === 0 ? <div className="text-xs text-muted font-mono">[ waiting for trades... ]</div> : (
                <div className="space-y-2">
                  {trades.map((t, i) => (
                    <div key={t.id || i} className="flex items-center justify-between text-xs border-b border-border/40 pb-2">
                      <div className="font-mono text-white">#{t.id || i} <span className="text-muted">{t.strategy}</span></div>
                      <div className="text-muted">{t.created_at ? new Date(typeof t.created_at === "number" ? t.created_at : t.created_at).toLocaleString() : "—"}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
        <div>
          <Card testid="pnl-card">
            <CardHeader title="P&L by Category" />
            <div className="p-4 space-y-3">
              {pnl?.data && Object.entries<any>(pnl.data).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-xs">
                  <span className="text-muted uppercase">{k}</span>
                  <span className={`font-mono ${(v.pnl || 0) >= 0 ? "text-primary" : "text-destructive"}`}>
                    {(v.pnl || 0).toFixed(4)} USDT ({v.trades || 0})
                  </span>
                </div>
              ))}
              {(!pnl?.data || Object.keys(pnl.data || {}).length === 0) && (
                <div className="text-xs text-muted font-mono">[ no category data ]</div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Opportunities + Safety */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card testid="opps-card">
          <CardHeader title="Open Opportunities" right={<Pill tone="success">{opps.length}</Pill>} />
          <div className="p-4">
            {opps.length === 0 ? <div className="text-xs text-muted font-mono">[ scanning... ]</div> : (
              <div className="space-y-2">{opps.slice(0, 10).map((o, i) => (
                <div key={i} className="flex items-center justify-between text-xs border-b border-border/40 pb-2">
                  <div className="text-white font-mono">{o.pair || o.symbol || o.id}</div>
                  <div className="text-muted">{o.spread_pct ? `${o.spread_pct.toFixed(2)}%` : o.kind || "—"}</div>
                </div>
              ))}</div>
            )}
          </div>
        </Card>
        <Card testid="safety-card">
          <CardHeader title="Safety & Readiness" />
          <div className="p-4 space-y-3 text-xs">
            <div className="flex items-center justify-between"><span className="text-muted">Live readiness</span><Pill tone={readiness?.live ? "success" : "warn"}>{readiness?.live ? "READY" : "PAPER"}</Pill></div>
            <div className="flex items-center justify-between"><span className="text-muted">Paper trading</span><Pill tone={readiness?.paper ? "warn" : "success"}>{readiness?.paper ? "ON" : "OFF"}</Pill></div>
            <div className="flex items-center justify-between"><span className="text-muted">Sharpe</span><span className="text-white font-mono">{status?.sharpe || "—"}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted">Max Drawdown</span><span className="text-destructive font-mono">{status?.maxDrawdown || 0} USDT</span></div>
          </div>
        </Card>
      </div>
    </div>
  );
}
