import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, CardHeader, Pill } from "../components/ui/Primitives";

export default function Trades() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let m = true;
    const tick = async () => {
      try {
        const { data } = await api.get("/trades?limit=100");
        if (m) setItems(data);
      } catch (err) {
        console.error("trades load failed", err);
      }
    };
    tick();
    const id = setInterval(tick, 2500);
    return () => {
      m = false;
      clearInterval(id);
    };
  }, []);

  const totalPnl = items.reduce((a, b) => a + b.pnl_usd, 0);

  return (
    <div className="space-y-4" data-testid="trades-page">
      <Card>
        <CardHeader
          subtitle="[ Execution Log ]"
          title="All Trades"
          right={
            <div className="flex items-center gap-2">
              <Pill tone={totalPnl >= 0 ? "success" : "danger"} testid="trades-total-pnl">
                Σ PnL ${totalPnl.toFixed(2)}
              </Pill>
              <Pill>{items.length} rows</Pill>
            </div>
          }
        />
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-[0.18em] text-muted">
              <tr className="border-b border-border/60">
                <th className="text-left px-4 py-3 font-normal">Time</th>
                <th className="text-left px-4 py-3 font-normal">Symbol</th>
                <th className="text-left px-4 py-3 font-normal">Route</th>
                <th className="text-right px-4 py-3 font-normal">Qty (USD)</th>
                <th className="text-right px-4 py-3 font-normal">Buy</th>
                <th className="text-right px-4 py-3 font-normal">Sell</th>
                <th className="text-right px-4 py-3 font-normal">PnL</th>
                <th className="text-right px-4 py-3 font-normal">Mode</th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {items.map((t) => (
                <tr key={t.id} className="border-b border-border/40 hover:bg-elevated/50" data-testid={`trade-${t.id}`}>
                  <td className="px-4 py-2 text-muted">{new Date(t.ts).toLocaleTimeString()}</td>
                  <td className="px-4 py-2 text-white">{t.symbol}</td>
                  <td className="px-4 py-2">{t.buy_exchange} → {t.sell_exchange}</td>
                  <td className="px-4 py-2 text-right">{t.qty_usd.toFixed(2)}</td>
                  <td className="px-4 py-2 text-right">{t.buy_price.toFixed(4)}</td>
                  <td className="px-4 py-2 text-right">{t.sell_price.toFixed(4)}</td>
                  <td className={`px-4 py-2 text-right ${t.pnl_usd >= 0 ? "text-primary" : "text-destructive"}`}>
                    {t.pnl_usd >= 0 ? "+" : ""}
                    {t.pnl_usd.toFixed(2)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span className={`text-[10px] uppercase tracking-wider ${t.mode === "live" ? "text-destructive" : "text-accent"}`}>
                      {t.mode}
                    </span>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted font-mono">[ awaiting first trade ]</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
