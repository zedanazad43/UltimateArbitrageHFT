import React, { useEffect, useState } from 'react';
import axios from 'axios';

const API = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8787';

export default function RocketDashboard() {
  const [spreads, setSpreads] = useState([]);
  const [trades, setTrades] = useState([]);
  const [health, setHealth] = useState({});
  const [online, setOnline] = useState(false);

  useEffect(() => {
    let timer;
    async function load() {
      try {
        const [s, h] = await Promise.all([
          axios.get(`${API}/api/scan-rejections?limit=20`).catch(() => ({ data: [] })),
          axios.get(`${API}/status`).catch(() => ({ data: {} }))
        ]);
        setSpreads(Array.isArray(s.data) ? s.data.slice(0, 20) : []);
        setHealth(h.data.exchanges || {});
        setOnline(true);
      } catch { setOnline(false); }
    }
    load(); timer = setInterval(load, 3000); return () => clearInterval(timer);
  }, []);

  const Card = ({ title, value, color }) => (
    <div style={styles.card}>
      <div style={styles.cardTitle}>{title}</div>
      <div style={{ ...styles.cardValue, color }}>{value}</div>
    </div>
  );

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.h1}>🚀 Rocket HFT Dashboard</h1>
        <div style={styles.statusPill(online ? '#00ff88' : '#ff3344')}>
          {online ? 'LIVE' : 'OFFLINE'}
        </div>
      </div>

      <div style={styles.grid}>
        <Card title="Live Spread" value={spreads[0]?.spread_pct ? spreads[0].spread_pct + '%' : '—'} color="#00ff88" />
        <Card title="Exchanges" value={Object.keys(health).filter(k => health[k] === 'ok').length + '/' + Object.keys(health).length} color="#00ccff" />
        <Card title="Queue" value={spreads.length} color="#ffaa00" />
      </div>

      <div style={styles.section}>
        <h2 style={styles.h2}>🔥 Live Spreads</h2>
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>SYMBOL</th>
                <th style={styles.th}>BUY</th>
                <th style={styles.th}>SELL</th>
                <th style={styles.th}>SPREAD</th>
                <th style={styles.th}>SPOT/FUT</th>
                <th style={styles.th}>TS</th>
              </tr>
            </thead>
            <tbody>
              {spreads.map((r, i) => (
                <tr key={i} style={i % 2 ? styles.trAlt : styles.tr}>
                  <td style={styles.td}>{r.symbol}</td>
                  <td style={styles.td}>{r.buy_exchange}</td>
                  <td style={styles.td}>{r.sell_exchange}</td>
                  <td style={{ ...styles.td, color: '#00ff88', fontWeight: 700 }}>{r.spread_pct}%</td>
                  <td style={styles.td}>{r.spot_futures || '—'}</td>
                  <td style={styles.td}>{new Date(r.detected_at).toLocaleTimeString()}</td>
                </tr>
              ))}
              {spreads.length === 0 && (
                <tr><td style={styles.td} colSpan="6" align="center">Scanning...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={styles.section}>
        <h2 style={styles.h2}>📡 Exchange Health</h2>
        <div style={styles.exchanges}>
          {Object.entries(health).map(([ex, st]) => (
            <div key={ex} style={{ ...styles.exBadge, borderColor: st === 'ok' ? '#00ff88' : st === 'degraded' ? '#ffaa00' : '#ff3344' }}>
              <span style={styles.exName}>{ex}</span>
              <span style={{ ...styles.exStatus, color: st === 'ok' ? '#00ff88' : st === 'degraded' ? '#ffaa00' : '#ff3344' }}>{st}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: { background: 'linear-gradient(180deg,#0a0e17,#0f172a)', minHeight: '100vh', color: '#e2e8f0', padding: '24px', fontFamily: 'Inter, system-ui, sans-serif' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  h1: { fontSize: 28, fontWeight: 800, background: 'linear-gradient(90deg,#00ff88,#00ccff)', WebkitBackgroundClip: 'text', color: 'transparent', margin: 0 },
  statusPill: (color) => ({ background: `${color}22`, color, border: `1px solid ${color}`, borderRadius: 999, padding: '6px 16px', fontWeight: 700, fontSize: 12, letterSpacing: '.5px' }),
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 },
  card: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 18, backdropFilter: 'blur(10px)' },
  cardTitle: { fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 },
  cardValue: { fontSize: 28, fontWeight: 800 },
  section: { marginBottom: 32 },
  h2: { fontSize: 18, color: '#e2e8f0', marginBottom: 12 },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '10px 8px', color: '#64748b', fontSize: 12, textTransform: 'uppercase', letterSpacing: '1px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  td: { padding: '10px 8px', fontSize: 13, borderBottom: '1px solid rgba(255,255,255,0.04)', whiteSpace: 'nowrap' },
  tr: { background: 'rgba(255,255,255,0.01)' },
  trAlt: { background: 'rgba(255,255,255,0.04)' },
  exBadge: { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 12, border: '1px solid', margin: '4px', background: 'rgba(255,255,255,0.04)' },
  exName: { color: '#e2e8f0' },
  exStatus: { fontWeight: 700, fontSize: 12 }
};
