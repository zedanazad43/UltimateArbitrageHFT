import React, { useEffect, useState } from 'react';
import axios from 'axios';

const API = (process.env.REACT_APP_BACKEND_URL || 'http://localhost:8787').replace(/\/$/,'');

export default function RocketDashboard({ onLogout }) {
  const [data, setData] = useState<any>({ stats: null, health: {}, online: false });
  
  useEffect(() => {
    let t;
    async function load() {
      try {
        const [statsR, healthR] = await Promise.all([
          axios.get(`${API}/api/stats`, { timeout: 5000 }).catch(() => ({ data: null })),
          axios.get(`${API}/api/exchanges/health`, { timeout: 5000 }).catch(() => ({ data: {} }))
        ]);
        setData(s => ({ ...s, stats: statsR.data, health: healthR.data, online: true }));
      } catch { setData(s => ({ ...s, online: false })); }
    }
    load(); t = setInterval(load, 3000); return () => clearInterval(t);
  }, []);

  const Card = ({ title, value, color }) => (
    <div style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:16, padding:18, backdropFilter:'blur(10px)' }}>
      <div style={{ fontSize:12, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'1px', marginBottom:8 }}>{title}</div>
      <div style={{ fontSize:28, fontWeight:800, color }}>{value}</div>
    </div>
  );

  const symbols = data.stats?.topSymbols || [];
  const latestSpread = data.stats?.latestSpread ?? '—';

  return (
    <div style={{ background:'linear-gradient(180deg,#0a0e17,#0f172a)', minHeight:'100vh', color:'#e2e8f0', fontFamily:'Inter, system-ui, sans-serif', padding:'24px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24 }}>
        <h1 style={{ fontSize:28, fontWeight:800, background:'linear-gradient(90deg,#00ff88,#00ccff)', WebkitBackgroundClip:'text', color:'transparent', margin:0 }}>🚀 Rocket HFT</h1>
        <div style={{ display:'flex', gap:12, alignItems:'center' }}>
          <span style={{ background: data.online ? '#00ff8822' : '#ff334422', color: data.online ? '#00ff88' : '#ff3344', border:`1px solid ${data.online ? '#00ff88' : '#ff3344'}`, borderRadius:999, padding:'6px 16px', fontWeight:700, fontSize:12 }}>{data.online ? 'LIVE' : 'OFFLINE'}</span>
          <button onClick={onLogout} style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:12, padding:'8px 16px', color:'#e2e8f0', cursor:'pointer' }}>Logout</button>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:16, marginBottom:24 }}>
        <Card title="Latest Spread" value={latestSpread ? `${latestSpread}%` : '—'} color="#00ff88" />
        <Card title="Total Opportunities" value={String(data.stats?.totalOpportunities ?? '—')} color="#00ccff" />
        <Card title="Exchanges Online" value={`${Object.values<any>(data.health).filter(h=>h?.status==='ok').length}/${Object.keys(data.health).length}`} color="#ffaa00" />
      </div>

      <div style={{ marginBottom:32 }}>
        <h2 style={{ fontSize:18, marginBottom:12 }}>🔥 Top Symbols</h2>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {symbols.map(([sym,count]) => (
            <div key={sym} style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:12, padding:'10px 16px', fontSize:13 }}>
              <span style={{ color:'#e2e8f0', fontWeight:600 }}>{sym}</span>
              <span style={{ color:'#64748b', marginLeft:8 }}>#{count}</span>
            </div>
          ))}
          {symbols.length===0 && <div style={{ color:'#64748b' }}>Waiting for scan data...</div>}
        </div>
      </div>

      <div>
        <h2 style={{ fontSize:18, marginBottom:12 }}>📡 Exchange Health</h2>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {Object.entries<any>(data.health).map(([ex,st]) => (
            <div key={ex} style={{ border:`1px solid ${st?.status==='ok'?'#00ff88':st?.status==='degraded'?'#ffaa00':'#ff3344'}`, borderRadius:12, padding:'10px 16px', background:'rgba(255,255,255,0.04)', display:'inline-flex', alignItems:'center', gap:8 }}>
              <span style={{ color:'#e2e8f0' }}>{ex}</span>
              <span style={{ color: st?.status==='ok'?'#00ff88': st?.status==='degraded'?'#ffaa00':'#ff3344', fontWeight:700, fontSize:12 }}>{st?.status || 'unknown'}</span>
            </div>
          ))}
          {Object.keys(data.health).length===0 && <div style={{ color:'#64748b' }}>No health data yet</div>}
        </div>
      </div>
    </div>
  );
}
