import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, CardHeader, Pill } from "./ui/Primitives";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { BarChart2 } from "lucide-react";

const MAX_EQUITY_SNAPSHOTS = 30;

export default function EquityChart() {
  const [balances, setBalances] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    let m = true;
    const tick = async () => {
      try {
        const { data } = await api.get("/wallet/balances");
        if (!m) return;
        const items = Array.isArray(data) ? data : [];
        setBalances(items);
        // Build a simple "now" snapshot for the chart
        const total = items.reduce((s, w) => s + (w.total_usd || 0), 0);
        if (total > 0) {
          setHistory((prev) => {
            const now = new Date();
            const label = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            const next = [...prev, { label, equity: parseFloat(total.toFixed(2)) }].slice(-MAX_EQUITY_SNAPSHOTS);
            return next;
          });
        }
      } catch (err) {
        console.error("equity chart load failed", err);
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      m = false;
      clearInterval(id);
    };
  }, []);

  const grand = balances.reduce((s, w) => s + (w.total_usd || 0), 0);
  const first = history[0]?.equity || 0;
  const last = history[history.length - 1]?.equity || 0;
  const change = first > 0 ? ((last - first) / first) * 100 : 0;
  const positive = change >= 0;

  return (
    <Card testid="equity-chart-card">
      <CardHeader
        subtitle="[ Cross-Exchange ]"
        title="Portfolio Equity"
        right={
          <div className="flex items-center gap-2">
            <Pill tone={positive ? "success" : "danger"} testid="equity-chart-total">
              <BarChart2 size={10} /> ${grand.toFixed(2)}
            </Pill>
            {history.length > 1 && (
              <Pill tone={positive ? "success" : "danger"}>
                {positive ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
              </Pill>
            )}
          </div>
        }
      />
      <div className="h-56 px-3 py-3">
        {history.length > 1 ? (
          <ResponsiveContainer>
            <AreaChart data={history} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="equitygrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={positive ? "#00E676" : "#FF3B30"} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={positive ? "#00E676" : "#FF3B30"} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#222" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "#888", fontSize: 10, fontFamily: "JetBrains Mono" }}
                axisLine={{ stroke: "#222" }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: "#888", fontSize: 10, fontFamily: "JetBrains Mono" }}
                axisLine={false}
                tickLine={false}
                width={52}
                tickFormatter={(v) => `$${v}`}
              />
              <Tooltip
                contentStyle={{ background: "#0A0A0B", border: "1px solid #222", borderRadius: 2, fontSize: 11, fontFamily: "JetBrains Mono" }}
                labelStyle={{ color: "#888" }}
                itemStyle={{ color: positive ? "#00E676" : "#FF3B30" }}
                formatter={(v) => [`$${v}`, "Equity"]}
              />
              <Area
                type="monotone"
                dataKey="equity"
                stroke={positive ? "#00E676" : "#FF3B30"}
                strokeWidth={1.5}
                fill="url(#equitygrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-muted text-xs font-mono">
            [ collecting equity data... ]
          </div>
        )}
      </div>
    </Card>
  );
}
