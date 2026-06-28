import React, { useEffect, useState } from "react";
import axios from "axios";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const BASE = process.env.REACT_APP_BACKEND_URL;

export default function Share() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let m = true;
    const tick = async () => {
      try {
        const { data } = await axios.get(`${BASE}/api/public/stats`);
        if (m) setData(data);
      } catch (e) {
        if (m) setErr(e.message);
      }
    };
    tick();
    const id = setInterval(tick, 8000);
    return () => {
      m = false;
      clearInterval(id);
    };
  }, []);

  if (err) return <div className="min-h-screen flex items-center justify-center text-destructive font-mono text-sm">{err}</div>;
  if (!data) return <div className="min-h-screen flex items-center justify-center text-muted font-mono text-sm" data-testid="share-loading">[ loading public stats... ]</div>;

  const running = data.status === "running";
  const live = data.mode === "live";

  return (
    <div className="min-h-screen grid-bg" data-testid="share-page">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-sm bg-primary/15 border border-primary/40 flex items-center justify-center">
              <span className="font-display font-bold text-primary text-lg">U</span>
            </div>
            <div>
              <div className="font-display text-xl tracking-tight font-semibold">{data.name}</div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Public Profit Share · v{data.version}</div>
            </div>
          </div>
          <div className="flex items-center gap-3 font-mono text-xs">
            <span className={`flex items-center gap-1.5 ${running ? "text-primary" : "text-destructive"}`} data-testid="share-status">
              <span className={`h-1.5 w-1.5 rounded-full ${running ? "bg-primary animate-pulseDot" : "bg-destructive"}`} />
              {running ? "running" : "stopped"}
            </span>
            <span className="w-px h-3 bg-border" />
            <span className={live ? "text-destructive" : "text-accent"}>{live ? "LIVE" : "PAPER"}</span>
          </div>
        </header>

        <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat label="PnL · Today" value={`$${data.pnl.today.toFixed(2)}`} positive={data.pnl.today >= 0} testid="share-pnl-today" />
          <Stat label="PnL · 24h" value={`$${data.pnl.h24.toFixed(2)}`} positive={data.pnl.h24 >= 0} testid="share-pnl-24h" />
          <Stat label="PnL · Total" value={`$${data.pnl.total.toFixed(2)}`} positive={data.pnl.total >= 0} testid="share-pnl-total" />
          <Stat label="Win Rate" value={`${(data.pnl.win_rate * 100).toFixed(1)}%`} sub={`${data.pnl.trades_total} trades`} testid="share-winrate" />
        </section>

        <section className="bg-surface border border-border/60 rounded-sm p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-muted">[ Last 24h ]</div>
              <div className="font-display text-lg font-semibold">Cumulative PnL Curve</div>
            </div>
          </div>
          <div className="h-64" data-testid="share-chart">
            <ResponsiveContainer>
              <AreaChart data={data.series_24h} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00E676" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#00E676" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#222" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#888", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: "#222" }} tickLine={false} />
                <YAxis tick={{ fill: "#888", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} width={48} />
                <Tooltip
                  contentStyle={{ background: "#0A0A0B", border: "1px solid #222", borderRadius: 2, fontSize: 11, fontFamily: "JetBrains Mono" }}
                  labelStyle={{ color: "#888" }}
                  itemStyle={{ color: "#00E676" }}
                />
                <Area type="monotone" dataKey="cumulative" stroke="#00E676" strokeWidth={1.5} fill="url(#g)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
          <div className="bg-surface border border-border/60 rounded-sm p-4">
            <div className="text-[10px] uppercase tracking-[0.22em] text-muted mb-2">Exchanges Monitored</div>
            <div className="flex flex-wrap gap-1.5">
              {data.exchanges.map((e) => (
                <span key={e} className="text-[11px] font-mono px-2 py-0.5 rounded-sm border border-border text-white">{e}</span>
              ))}
            </div>
          </div>
          <div className="bg-surface border border-border/60 rounded-sm p-4">
            <div className="text-[10px] uppercase tracking-[0.22em] text-muted mb-2">Symbols Tracked</div>
            <div className="flex flex-wrap gap-1.5">
              {data.symbols.map((s) => (
                <span key={s} className="text-[11px] font-mono px-2 py-0.5 rounded-sm border border-border text-white">{s}</span>
              ))}
            </div>
          </div>
        </section>

        <footer className="text-center text-[11px] text-muted font-mono pt-6 border-t border-border/40">
          read-only · auto-refresh every 8s · {new Date(data.ts).toLocaleString()}
        </footer>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, positive, testid }) {
  return (
    <div className="bg-surface border border-border/60 rounded-sm px-4 py-4">
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted mb-1">{label}</div>
      <div
        data-testid={testid}
        className={`text-2xl font-mono font-semibold tracking-tight ${positive === undefined ? "" : positive ? "text-primary" : "text-destructive"}`}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted font-mono mt-1">{sub}</div>}
    </div>
  );
}
