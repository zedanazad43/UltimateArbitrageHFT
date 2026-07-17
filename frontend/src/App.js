import React, { useState, useEffect, useCallback } from 'react';
import { MatchIDProvider } from '@matchain/matchid-sdk-react';

const API = process.env.REACT_APP_BACKEND_URL || '';

const MATCHAIN_CONFIG = {
  projectId: 'fsthjglonup0fpbj',
  loginMethods: {
    wallet: true,
    walletEvm: true,
    walletBitcoin: true,
    walletSolana: true,
    walletTron: true,
    walletTon: true,
    email: true,
    twitter: true,
    telegram: true,
    google: true,
    github: true,
    discord: true,
    linkedin: true,
    kakao: true,
  },
  theme: { mode: 'dark', primaryColor: '#f0b90b' },
};

async function api(path, opts = {}) {
  const token = localStorage.getItem('admin_token');
  const headers = { 'Content-Type': 'application/json', ...(token ? { 'x-admin-token': token } : {}) };
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  if (res.status === 401) { localStorage.removeItem('admin_token'); window.location.reload(); }
  return res;
}

export default function App() {
  const [authed, setAuthed] = useState(() => !!localStorage.getItem('admin_token'));
  const [view, setView] = useState('dashboard');

  useEffect(() => {
    if (!authed || !API) return;
    api('/health').then(r => { if (!r.ok) { localStorage.removeItem('admin_token'); setAuthed(false); } }).catch(() => {});
  }, [authed]);

  const doLogin = useCallback(async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const tok = String(fd.get('admin_token') || '');
    try {
      const r = await fetch(`${API}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': tok }, body: '{}' });
      const j = await r.json();
      if (r.ok && j.ok) { localStorage.setItem('admin_token', tok); setAuthed(true); }
      else alert(j?.error || 'Invalid token');
    } catch (err) { alert(err.message); }
  }, [API]);

  if (!authed) {
    return (
      <MatchIDProvider {...MATCHAIN_CONFIG}>
        <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg,#0a0e17,#0f172a)', color: '#e2e8f0', fontFamily: 'Inter, system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <form onSubmit={doLogin} style={{ width: '100%', maxWidth: 420, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 24, padding: 36 }}>
            <h1 style={{ fontSize: 28, fontWeight: 900, background: 'linear-gradient(90deg,#00ff88,#00ccff)', WebkitBackgroundClip: 'text', color: 'transparent', margin: '0 0 8px' }}>🚀 Rocket HFT</h1>
            <p style={{ color: '#94a3b8', fontSize: 14, margin: '0 0 28px' }}>Secure admin access — live trading console</p>
            <input name="admin_token" type="password" placeholder="Admin token" required style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: '14px 16px', color: '#e2e8f0', fontSize: 15, marginBottom: 16, boxSizing: 'border-box' }} />
            <button type="submit" style={{ width: '100%', background: 'linear-gradient(90deg,#00ff88,#00ccff)', color: '#0a0e17', border: 'none', borderRadius: 14, padding: '14px 0', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>Login</button>
          </form>
        </div>
      </MatchIDProvider>
    );
  }

  return (
    <MatchIDProvider {...MATCHAIN_CONFIG}>
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(15,23,42,0.8)', backdropFilter: 'blur(8px)', position: 'sticky', top: 0, zIndex: 50 }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18, background: 'linear-gradient(90deg,#00ff88,#00ccff)', WebkitBackgroundClip: 'text', color: 'transparent' }}>Rocket HFT</div>
            <div style={{ color: '#94a3b8', fontSize: 12 }}>Live console</div>
          </div>
          <nav style={{ display: 'flex', gap: 10 }}>
            {['dashboard','opportunities','performance'].map(v => (
              <button key={v} onClick={() => setView(v)} style={{ background: view===v ? 'rgba(255,255,255,0.08)' : 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0', padding: '8px 12px', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 700, textTransform: 'capitalize' }}>{v}</button>
            ))}
            <button onClick={() => { localStorage.removeItem('admin_token'); setAuthed(false); }} style={{ background: 'rgba(255,51,68,0.15)', border: '1px solid rgba(255,51,68,0.3)', color: '#ff7a85', padding: '8px 12px', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Logout</button>
          </nav>
        </header>
        <main style={{ padding: 24 }}>
          {view === 'dashboard' && <Dashboard />}
          {view === 'opportunities' && <Section title="Opportunities" fallback="/opportunities" />}
          {view === 'performance' && <Section title="Performance" fallback="/performance" />}
        </main>
      </div>
    </MatchIDProvider>
  );
}

function Section({ title, fallback }) {
  const [text, setText] = useState('');
  useEffect(() => {
    api(fallback).then(r => r.text()).then(setText).catch(() => setText('unavailable'));
  }, [fallback]);
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 24 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 20, fontWeight: 900 }}>{title}</h2>
      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, color: '#cbd5e1' }}>{text}</pre>
    </div>
  );
}

import { useState, useEffect, useMemo } from 'react';
function Dashboard() {
  const [status, setStatus] = useState(null);
  const [balances, setBalances] = useState([]);
  const [pnl, setPnl] = useState({});
  const [spreads, setSpreads] = useState([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const load = async () => {
      try {
        const [s, b, t] = await Promise.all([api('/status').then(r=>r.json()), api('/api/balances').then(r=>r.json()), api('/api/trades').then(r=>r.json())]);
        setStatus(s); setBalances(Array.isArray(b)?b:[]); setTrades(Array.isArray(t)?t:[]);
      } catch (e) { /* keep previous state */ }
    };
    load();
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const loadPnl = async () => {
      try { setPnl(await api('/api/pnl').then(r=>r.json())); } catch {}
    };
    loadPnl();
    const i = setInterval(loadPnl, 5000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const loadSpreads = async () => {
      try { setSpreads(await api('/spreads').then(r=>r.json())); } catch {}
    };
    loadSpreads();
    const i = setInterval(loadSpreads, 2000);
    return () => clearInterval(i);
  }, []);

  const cumPnl = useMemo(() => {
    let c = 0; return pnl.map((p) => { c += Number(p.net_profit_percent || 0); return { ts: p.created_at, cum: +c.toFixed(3) }; });
  }, [pnl]);

  const totalEquity = useMemo(() => balances.reduce((s, b) => s + Number(b.balance || 0), 0), [balances]);

  const stats = useMemo(() => {
    if (!status) return null;
    return { ...status, equity: totalEquity, totalTrades: trades.length, updatedAt: now };
  }, [status, totalEquity, trades.length, now]);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {[
          ['Equity', stats ? `$${stats.equity.toFixed(2)}` : '—'],
          ['Mode', stats?.paper_trading === false ? 'Live' : 'Paper'],
          ['Win Rate', stats ? `${((stats.winRate || 0) * 100).toFixed(1)}%` : '—'],
          ['Drawdown', stats ? `$${(stats.max_drawdown || 0).toFixed(2)}` : '—'],
          ['Trades', trades.length.toString()],
          ['Sharpe', stats ? (stats.sharpe||0).toFixed(2) : '—'],
        ].map(([k,v]) => (
          <div key={k} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: 18 }}>
            <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>{k}</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#e2e8f0' }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 18 }}>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>Cumulative PnL</div>
          <pre style={{ fontSize: 12, color: '#cbd5e1' }}>{JSON.stringify(cumPnl.slice(-10), null, 2)}</pre>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 18 }}>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>Top spreads</div>
          <pre style={{ fontSize: 12, color: '#cbd5e1' }}>{JSON.stringify(spreads.slice(0, 10), null, 2)}</pre>
        </div>
      </div>

      <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 18 }}>
        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>Balances</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {balances.length === 0 && <div style={{ color: '#64748b' }}>No balances</div>}
          {balances.map((b, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontWeight: 700 }}>{b.exchange || b.currency || '—'}</div>
              <div style={{ color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' }}>{(Number(b.balance ?? b.total ?? 0)).toFixed(4)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
