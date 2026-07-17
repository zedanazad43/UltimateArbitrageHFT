import React, { useState, useEffect, useCallback } from 'react';

const API = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8787';

async function api(path) {
  const token = localStorage.getItem('admin_token');
  const headers = { 'Content-Type': 'application/json', ...(token ? { 'x-admin-token': token } : {}) };
  const res = await fetch(`${API}${path}`, { headers });
  if (res.status === 401) { localStorage.removeItem('admin_token'); window.location.reload(); }
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

export default function Dashboard() {
  const [status, setStatus] = useState(null);
  const [trades, setTrades] = useState([]);
  const [pnl, setPnl] = useState({});
  const [opps, setOpps] = useState([]);
  const [health, setHealth] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [s, t, p, o, h] = await Promise.all([
        api('/status').catch(() => null),
        api('/api/trades').catch(() => ({ data: [] })),
        api('/api/pnl').catch(() => ({ data: {} })),
        api('/api/opportunities/recent').catch(() => ({ items: [] })),
        api('/health').catch(() => ({})),
      ]);
      setStatus(s); setTrades(t.data || []); setPnl(p.data || {}); setOpps(o.items || []); setHealth(h);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); const i = setInterval(load, 5000); return () => clearInterval(i); }, [load]);

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e2e8f0' }}>
      <div>Loading...</div>
    </div>
  );

  const winRate = status?.winRate ? (status.winRate * 100).toFixed(1) : '—';
  const totalProfit = status?.totalProfit ? status.totalProfit.toFixed(2) : '0.00';

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 16px', display: 'grid', gap: 16 }}>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {[
          ['Equity', `$${Number(status?.capital || 0).toFixed(2)}`],
          ['PnL', `$${totalProfit}`],
          ['Mode', status?.paper_trading === false ? 'Live' : 'Paper'],
          ['Trades', String(status?.totalTrades || trades.length)],
          ['Win Rate', `${winRate}%`],
          ['DB', health?.db_healthy ? 'Healthy' : '—'],
        ].map(([k, v]) => (
          <div key={k} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 16 }}>
            <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>{k}</div>
            <div style={{ fontSize: 18, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
          </div>
        ))}
      </div>

      {/* PnL + Opportunities */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 18 }}>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>Strategy P&L</div>
          <pre style={{ fontSize: 12, color: '#cbd5e1' }}>{JSON.stringify(pnl, null, 2)}</pre>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 18 }}>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>Recent Opportunities ({opps.length})</div>
          {opps.length === 0 && <div style={{ color: '#64748b' }}>No open opportunities</div>}
          {opps.map((o, i) => (
            <div key={i} style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 10, marginBottom: 6, border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{o.symbol} · {o.strategy}</div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>{o.buy_exchange} → {o.sell_exchange} · net {Number(o.net_pct || 0).toFixed(2)}%</div>
            </div>
          ))}
        </div>
      </div>

      {/* Trades */}
      <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 18 }}>
        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>Recent Trades ({trades.length})</div>
        {trades.length === 0 && <div style={{ color: '#64748b' }}>No trades yet</div>}
        {trades.map((t, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 10, marginBottom: 6, border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{t.strategy || '—'}</div>
            <div style={{ fontSize: 13, color: '#94a3b8' }}>${Number(t.size_usd || 0).toFixed(2)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
