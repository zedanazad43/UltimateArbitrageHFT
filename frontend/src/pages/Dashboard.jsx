import React, { useEffect, useState, useCallback } from "react";
import api from "../lib/api";
import { Card, CardHeader, Metric, Pill } from "../components/ui/Primitives";
import { motion } from "framer-motion";
import { Play, Square, RotateCcw, Zap, ShieldAlert, ArrowRight, Check, X, ChevronRight, Rocket } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { Link } from "react-router-dom";
import PnlChart from "../components/PnlChart";

function uptime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export default function Dashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [status, setStatus] = useState(null);
  const [pnl, setPnl] = useState(null);
  const [opps, setOpps] = useState([]);
  const [trades, setTrades] = useState([]);
  const [readiness, setReadiness] = useState(null);
  const [actionError, setActionError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [s, p, o, t, r] = await Promise.all([
        api.get("/bot/status"),
        api.get("/pnl"),
        api.get("/market/opportunities"),
        api.get("/trades?limit=6"),
        isAdmin ? api.get("/safety/live-readiness") : Promise.resolve({ data: null }),
      ]);
      setStatus(s.data);
      setPnl(p.data);
      setOpps(o.data);
      setTrades(t.data);
      setReadiness(r.data);
    } catch (e) {
      console.error("dashboard refresh failed", e);
    }
  }, [isAdmin]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 2500);
    return () => clearInterval(id);
  }, [refresh]);

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

  const running = status?.status === "running";
  const live = status?.mode === "live";

  return (
    <div className="space-y-5" data-testid="dashboard-page">
      {/* Master control */}
      <Card className={`${running ? "glow-primary" : "glow-destructive"}`} testid="master-control-card">
        <div className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="flex items-center gap-5">
            <div
              className={`h-16 w-16 rounded-sm border flex items-center justify-center ${
                running ? "border-primary/60 bg-primary/10" : "border-destructive/60 bg-destructive/10"
              }`}
            >
              <span className={`h-3 w-3 rounded-full ${running ? "bg-primary animate-pulseDot" : "bg-destructive"}`} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-muted">Bot Status</div>
              <div className="font-display text-2xl tracking-tight" data-testid="bot-status-text">
                {running ? "RUNNING" : "STOPPED"}
              </div>
              <div className="text-xs text-muted font-mono mt-1">
                uptime <span className="text-white">{uptime(status?.uptime_seconds || 0)}</span> · health{" "}
                <span className={status?.health === "healthy" ? "text-primary" : "text-yellow-400"}>
                  {status?.health || "—"}
                </span>{" "}
                · feed <span className={status?.source === "worker" ? "text-primary" : "text-yellow-400"} data-testid="feed-source">
                  {status?.source === "worker" ? "live" : "mock"}
                </span>{" "}
                · region <span className="text-white">{status?.worker_region || "—"}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 border border-border rounded-sm p-1 bg-elevated/50" data-testid="mode-switch">
              <button
                onClick={() => setMode("paper")}
                disabled={!isAdmin}
                data-testid="mode-paper-button"
                className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  !live ? "bg-accent text-white" : "text-muted hover:text-white"
                }`}
              >
                Paper
              </button>
              <button
                onClick={() => setMode("live")}
                disabled={!isAdmin}
                data-testid="mode-live-button"
                className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded-sm transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed ${
                  live ? "bg-destructive text-white" : "text-muted hover:text-white"
                }`}
              >
                <ShieldAlert size={12} /> Live
              </button>
            </div>

            <button
              onClick={() => action("start")}
              disabled={running || !isAdmin}
              data-testid="bot-start-button"
              className="flex items-center gap-1.5 text-sm bg-primary text-black hover:bg-primary-hover disabled:opacity-30 disabled:cursor-not-allowed px-4 py-2 rounded-sm transition-colors"
            >
              <Play size={14} /> Start
            </button>
            <button
              onClick={() => action("stop")}
              disabled={!running || !isAdmin}
              data-testid="bot-stop-button"
              className="flex items-center gap-1.5 text-sm border border-destructive/60 text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:cursor-not-allowed px-4 py-2 rounded-sm transition-colors"
            >
              <Square size={14} /> Stop
            </button>
            <button
              onClick={() => action("restart")}
              disabled={!isAdmin}
              data-testid="bot-restart-button"
              className="flex items-center gap-1.5 text-sm border border-border hover:border-white disabled:opacity-30 disabled:cursor-not-allowed px-4 py-2 rounded-sm transition-colors"
            >
              <RotateCcw size={14} /> Restart
            </button>
          </div>
        </div>
        {actionError && (
          <div
            data-testid="dashboard-action-error"
            className="mx-5 mb-4 border border-destructive/50 bg-destructive/10 text-destructive text-xs px-3 py-2 rounded-sm"
          >
            {actionError}
          </div>
        )}
      </Card>

      {/* Go-Live Roadmap (admin only — only shown until everything's green) */}
      {isAdmin && readiness && !readiness.ready && (
        <GoLiveRoadmap readiness={readiness} />
      )}

      {/* PnL chart */}
      <PnlChart />

      {/* PnL row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card testid="pnl-today-card">
          <Metric
            testid="pnl-today-value"
            label="PnL · Today"
            value={`$${(pnl?.today ?? 0).toFixed(2)}`}
            change={`${((pnl?.today ?? 0) > 0 ? "+" : "")}${(pnl?.today ?? 0).toFixed(2)} USDT`}
            changePositive={(pnl?.today ?? 0) >= 0}
          />
        </Card>
        <Card testid="pnl-24h-card">
          <Metric
            label="PnL · 24h"
            value={`$${(pnl?.h24 ?? 0).toFixed(2)}`}
            change={`${((pnl?.h24 ?? 0) > 0 ? "+" : "")}${(pnl?.h24 ?? 0).toFixed(2)} USDT`}
            changePositive={(pnl?.h24 ?? 0) >= 0}
          />
        </Card>
        <Card testid="pnl-total-card">
          <Metric label="PnL · Total" value={`$${(pnl?.total ?? 0).toFixed(2)}`} />
        </Card>
        <Card testid="winrate-card">
          <Metric
            label="Win Rate · Trades"
            value={`${((pnl?.win_rate ?? 0) * 100).toFixed(1)}%`}
            change={`${pnl?.trades_total ?? 0} executed`}
            changePositive
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* Opportunities feed */}
        <Card className="lg:col-span-7" testid="opportunities-card">
          <CardHeader subtitle="[ Real-Time ]" title="Arbitrage Opportunities" right={<Pill tone="success" testid="opps-live-pill"><Zap size={10} /> live</Pill>} />
          <div className="divide-y divide-border/60 max-h-[420px] overflow-auto">
            {opps.length === 0 && (
              <div className="px-4 py-10 text-center text-xs text-muted font-mono">[ scanning · no opportunities above threshold ]</div>
            )}
            {opps.map((o) => (
              <motion.div
                key={`${o.symbol}-${o.buy_exchange}-${o.sell_exchange}`}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-elevated/60"
                data-testid={`opp-row-${o.symbol.replace("/", "-").toLowerCase()}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="font-mono text-sm w-24 truncate">{o.symbol}</div>
                  <div className="text-xs text-muted flex items-center gap-1.5 font-mono">
                    <span className="text-white">{o.buy_exchange}</span>
                    <ArrowRight size={11} className="text-primary" />
                    <span className="text-white">{o.sell_exchange}</span>
                  </div>
                </div>
                <div className="flex items-center gap-5">
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-muted">Spread</div>
                    <div className="font-mono text-sm text-primary">{o.spread_pct.toFixed(3)}%</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-muted">Est. Profit</div>
                    <div className="font-mono text-sm">${o.est_profit_usd.toFixed(2)}</div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </Card>

        {/* Recent trades */}
        <Card className="lg:col-span-5" testid="recent-trades-card">
          <CardHeader subtitle="[ Last 6 ]" title="Recent Trades" right={<Pill tone={live ? "danger" : "accent"}>{live ? "LIVE" : "PAPER"}</Pill>} />
          <div className="divide-y divide-border/60 max-h-[420px] overflow-auto">
            {trades.length === 0 && (
              <div className="px-4 py-10 text-center text-xs text-muted font-mono">[ no trades yet ]</div>
            )}
            {trades.map((t) => (
              <div key={t.id} className="px-4 py-3 flex items-center justify-between" data-testid={`trade-row-${t.id}`}>
                <div className="min-w-0">
                  <div className="font-mono text-sm">{t.symbol}</div>
                  <div className="text-[11px] text-muted font-mono mt-0.5">
                    {t.buy_exchange} → {t.sell_exchange}
                  </div>
                </div>
                <div className={`font-mono text-sm ${t.pnl_usd >= 0 ? "text-primary" : "text-destructive"}`}>
                  {t.pnl_usd >= 0 ? "+" : ""}
                  {t.pnl_usd.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// Maps each safety check id to a friendly title + an in-app action route.
const ROADMAP_ACTIONS = {
  worker: {
    title: "Deploy your Cloudflare Worker",
    detail: "Until ecostamp.net is reachable, the dashboard runs on mock data. Real-money trading requires a live worker.",
    cta: "Open Deploy Helper",
    to: "/worker",
  },
  trade_key: {
    title: "Add an exchange API key with 'trade' permission",
    detail: "At least one enabled exchange (Binance / KuCoin / MEXC) must have a key with the 'trade' permission.",
    cta: "Open API Keys",
    to: "/keys",
  },
  telegram: {
    title: "Configure Telegram alerts",
    detail: "Set the bot_token and chat_id so the bot can notify you about fills, errors and circuit-breaker pauses.",
    cta: "Open Telegram",
    to: "/telegram",
  },
  fast_alert: {
    title: "Enable a fast alert rule (cooldown ≤ 60s)",
    detail: "Real-time alerting is required so a runaway spread, latency spike or empty wallet can pause the bot in seconds.",
    cta: "Open Alerts",
    to: "/alerts",
  },
  paper_track: {
    title: "Build a positive 24h paper-mode track record",
    detail: "≥10 paper trades with positive total PnL in the last 24h. This proves the strategy works before risking capital.",
    cta: "Open Autopilot",
    to: "/autopilot",
  },
};

function GoLiveRoadmap({ readiness }) {
  const checks = readiness.checks || [];
  const done = checks.filter((c) => c.ok).length;
  const total = checks.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <Card className="border-accent/40" testid="go-live-roadmap-card">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-sm border border-accent/40 bg-accent/10 text-accent flex items-center justify-center">
            <Rocket size={16} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-muted">Path to Real-Money Trading</div>
            <div className="font-display text-sm font-medium">{done}/{total} prerequisites complete · LIVE mode locked until all pass</div>
          </div>
        </div>
        <Pill tone="warn" testid="go-live-progress-pill">{pct}%</Pill>
      </div>
      <div className="h-1.5 bg-elevated">
        <div
          data-testid="go-live-progress-bar"
          className="h-full bg-accent transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="divide-y divide-border/40">
        {checks.map((c) => {
          const meta = ROADMAP_ACTIONS[c.id] || { title: c.label, detail: "", cta: null, to: null };
          return (
            <div
              key={c.id}
              data-testid={`roadmap-step-${c.id}`}
              className="px-4 py-3 flex items-start gap-3"
            >
              <div
                className={`h-6 w-6 rounded-sm flex items-center justify-center shrink-0 ${
                  c.ok ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive"
                }`}
              >
                {c.ok ? <Check size={13} /> : <X size={13} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{meta.title}</div>
                <div className="text-[11px] text-muted font-mono mt-0.5">{meta.detail}</div>
              </div>
              {!c.ok && meta.to && (
                <Link
                  to={meta.to}
                  data-testid={`roadmap-cta-${c.id}`}
                  className="shrink-0 flex items-center gap-1 text-[11px] uppercase tracking-wider px-2.5 py-1.5 border border-accent/40 text-accent hover:bg-accent/10 rounded-sm"
                >
                  {meta.cta} <ChevronRight size={11} />
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
