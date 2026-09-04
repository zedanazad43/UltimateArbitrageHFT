import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, CardHeader, Pill } from "../components/ui/Primitives";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { TrendingUp } from "lucide-react";

export default function PnlChart() {
  const [hours, setHours] = useState(24);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    let m = true;
    const tick = async () => {
      try {
        const { data } = await api.get(`/pnl/series?hours=${hours}`);
        if (m) setData(data);
      } catch (err) {
        console.error("pnl series failed", err);
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      m = false;
      clearInterval(id);
    };
  }, [hours]);

  const last = data?.buckets?.[data.buckets.length - 1];
  const cum = last?.cumulative || 0;
  const positive = cum >= 0;

  return (
    <Card testid="pnl-chart-card">
      <CardHeader
        subtitle={`[ Last ${hours}h ]`}
        title="Cumulative PnL"
        right={
          <div className="flex items-center gap-2">
            <Pill tone={positive ? "success" : "danger"} testid="pnl-chart-cum">
              <TrendingUp size={10} /> ${cum.toFixed(2)}
            </Pill>
            <div className="flex border border-border rounded-sm bg-elevated/50 p-0.5" data-testid="pnl-chart-range">
              {[6, 24, 72, 168].map((h) => (
                <button
                  key={h}
                  data-testid={`pnl-chart-range-${h}h`}
                  onClick={() => setHours(h)}
                  className={`px-2 py-0.5 text-[10px] uppercase tracking-wider rounded-sm ${
                    hours === h ? "bg-primary text-black" : "text-muted hover:text-white"
                  }`}
                >
                  {h}h
                </button>
              ))}
            </div>
          </div>
        }
      />
      <div className="h-56 px-3 py-3">
        {data?.buckets?.length ? (
          <ResponsiveContainer>
            <AreaChart data={data.buckets} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="dashpnl" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={positive ? "#00E676" : "#FF3B30"} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={positive ? "#00E676" : "#FF3B30"} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#222" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#888", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={{ stroke: "#222" }} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: "#888", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} width={44} />
              <Tooltip
                contentStyle={{ background: "#0A0A0B", border: "1px solid #222", borderRadius: 2, fontSize: 11, fontFamily: "JetBrains Mono" }}
                labelStyle={{ color: "#888" }}
                itemStyle={{ color: positive ? "#00E676" : "#FF3B30" }}
              />
              <Area type="monotone" dataKey="cumulative" stroke={positive ? "#00E676" : "#FF3B30"} strokeWidth={1.5} fill="url(#dashpnl)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-muted text-xs font-mono">[ no PnL data yet ]</div>
        )}
      </div>
    </Card>
  );
}
