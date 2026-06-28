import React, { useEffect, useState, useRef } from "react";
import api from "../lib/api";
import { Card, CardHeader, Pill } from "../components/ui/Primitives";
import { ArrowRight } from "lucide-react";

export default function Spreads() {
  const [rows, setRows] = useState([]);
  const [minPct, setMinPct] = useState(0);
  const prevRef = useRef({});
  const [flashKeys, setFlashKeys] = useState({});

  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      try {
        const { data } = await api.get("/market/spreads");
        if (!mounted) return;
        // detect flashes
        const next = {};
        const f = {};
        data.rows.forEach((r) => {
          const prev = prevRef.current[r.symbol];
          if (prev !== undefined && Math.abs(prev - r.spread_pct) > 0.001) {
            f[r.symbol] = Date.now();
          }
          next[r.symbol] = r.spread_pct;
        });
        prevRef.current = next;
        setFlashKeys(f);
        setRows(data.rows);
      } catch (err) {
        console.error("spreads load failed", err);
      }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  const visible = rows.filter((r) => r.spread_pct >= minPct);

  return (
    <div className="space-y-4" data-testid="spreads-page">
      <Card>
        <CardHeader
          subtitle="[ Cross-Exchange ]"
          title="Live Price Spreads"
          right={
            <div className="flex items-center gap-3">
              <Pill tone="success">{rows.length} pairs</Pill>
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="text-muted">min %</span>
                <input
                  type="number"
                  step="0.05"
                  value={minPct}
                  data-testid="spreads-min-input"
                  onChange={(e) => setMinPct(parseFloat(e.target.value) || 0)}
                  className="w-20 bg-elevated border border-border rounded-sm px-2 py-1 text-xs focus:border-primary focus:outline-none"
                />
              </div>
            </div>
          }
        />
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-[0.18em] text-muted">
              <tr className="border-b border-border/60">
                <th className="text-left px-4 py-3 font-normal">Symbol</th>
                <th className="text-left px-4 py-3 font-normal">Buy (Ask)</th>
                <th className="text-left px-4 py-3 font-normal">Sell (Bid)</th>
                <th className="text-right px-4 py-3 font-normal">Buy Price</th>
                <th className="text-right px-4 py-3 font-normal">Sell Price</th>
                <th className="text-right px-4 py-3 font-normal">Spread %</th>
                <th className="text-right px-4 py-3 font-normal">Est. Profit</th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {visible.map((r) => {
                const isHot = r.spread_pct >= 0.5;
                const flashing = flashKeys[r.symbol];
                return (
                  <tr
                    key={r.symbol}
                    data-testid={`spread-row-${r.symbol.replace("/", "-").toLowerCase()}`}
                    className={`border-b border-border/40 hover:bg-elevated/50 ${
                      isHot ? "bg-primary/5" : ""
                    } ${flashing ? "animate-flash" : ""}`}
                  >
                    <td className="px-4 py-2.5 text-white">{r.symbol}</td>
                    <td className="px-4 py-2.5 text-muted">{r.buy_exchange}</td>
                    <td className="px-4 py-2.5 text-muted flex items-center gap-1.5">
                      <ArrowRight size={11} className="text-primary" /> {r.sell_exchange}
                    </td>
                    <td className="px-4 py-2.5 text-right">{r.buy_price.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                    <td className="px-4 py-2.5 text-right">{r.sell_price.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                    <td className={`px-4 py-2.5 text-right ${isHot ? "text-primary" : ""}`}>{r.spread_pct.toFixed(4)}%</td>
                    <td className="px-4 py-2.5 text-right">${r.est_profit_usd.toFixed(2)}</td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted font-mono">
                    [ no pairs match filter ]
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
