import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { Card, CardHeader, Pill } from "../components/ui/Primitives";

export default function Wallet() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let m = true;
    const load = async () => {
      try {
        const { data } = await api.get("/wallet/balances");
        if (m) setItems(data);
      } catch {}
    };
    load();
    const id = setInterval(load, 4000);
    return () => {
      m = false;
      clearInterval(id);
    };
  }, []);

  const grand = items.reduce((a, b) => a + b.total_usd, 0);

  return (
    <div className="space-y-4" data-testid="wallet-page">
      <Card>
        <CardHeader
          subtitle="[ Cross-Exchange ]"
          title="Wallet Balances"
          right={<Pill tone="success" testid="wallet-grand-total">Σ ${grand.toFixed(2)}</Pill>}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-4">
          {items.map((w) => (
            <div
              key={w.exchange}
              data-testid={`wallet-card-${w.exchange.toLowerCase()}`}
              className="border border-border/60 rounded-sm p-4 hover:border-primary/40 transition-colors"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="font-display text-sm font-medium">{w.exchange}</div>
                <Pill tone={w.connected ? "success" : "danger"}>{w.connected ? "linked" : "offline"}</Pill>
              </div>
              <div className="text-2xl font-mono font-semibold mb-3">${w.total_usd.toFixed(2)}</div>
              <div className="space-y-1.5 text-xs font-mono">
                {Object.entries(w.balances).map(([asset, amt]) => (
                  <div key={asset} className="flex items-center justify-between text-muted">
                    <span>{asset}</span>
                    <span className="text-white">{typeof amt === "number" ? amt : amt}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
