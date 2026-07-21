import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, LineChart, History, Wallet, Settings, Terminal, Send, LogOut,
  Activity, KeyRound, Users as UsersIcon, Share2, Bell, GitCompareArrows, ScrollText, Bot, Cloud,
} from 'lucide-react';
import api from './lib/api';
import Dashboard from './pages/Dashboard';
import Spreads from './pages/Spreads';
import Trades from './pages/Trades';
import WalletPage from './pages/Wallet';
import ApiKeys from './pages/ApiKeys';
import Config from './pages/Config';
import ABTest from './pages/ABTest';
import Autopilot from './pages/Autopilot';
import WorkerDeploy from './pages/WorkerDeploy';
import Alerts from './pages/Alerts';
import Users from './pages/Users';
import Audit from './pages/Audit';
import Logs from './pages/Logs';
import Telegram from './pages/Telegram';
import Share from './pages/Share';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, testid: 'nav-dashboard' },
  { to: '/spreads', label: 'Spreads', icon: LineChart, testid: 'nav-spreads' },
  { to: '/trades', label: 'Trades', icon: History, testid: 'nav-trades' },
  { to: '/wallet', label: 'Wallet', icon: Wallet, testid: 'nav-wallet' },
  { to: '/keys', label: 'API Keys', icon: KeyRound, testid: 'nav-keys', adminOnly: true },
  { to: '/config', label: 'Bot Config', icon: Settings, testid: 'nav-config', adminOnly: true },
  { to: '/ab', label: 'A/B Test', icon: GitCompareArrows, testid: 'nav-ab', adminOnly: true },
  { to: '/autopilot', label: 'Autopilot', icon: Bot, testid: 'nav-autopilot', adminOnly: true },
  { to: '/worker', label: 'Worker Deploy', icon: Cloud, testid: 'nav-worker', adminOnly: true },
  { to: '/alerts', label: 'Alerts', icon: Bell, testid: 'nav-alerts', adminOnly: true },
  { to: '/users', label: 'Users', icon: UsersIcon, testid: 'nav-users', adminOnly: true },
  { to: '/audit', label: 'Audit Log', icon: ScrollText, testid: 'nav-audit', adminOnly: true },
  { to: '/logs', label: 'Logs', icon: Terminal, testid: 'nav-logs' },
  { to: '/telegram', label: 'Telegram', icon: Send, testid: 'nav-telegram', adminOnly: true },
];

function AppShell() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  });
  const [authed, setAuthed] = useState(() => !!localStorage.getItem('nexus_admin_token'));
  const loc = useLocation();
  const isAdmin = user?.role === 'admin';
  const visibleNav = NAV.filter((n) => !n.adminOnly || isAdmin);
  const current = visibleNav.find((n) => n.to === loc.pathname) || visibleNav[0];
  const [worker, setWorker] = useState(null);

  useEffect(() => {
    if (!authed) return;
    let m = true;
    const tick = async () => {
      try { const { data } = await api.get('/worker/health'); if (m) setWorker(data); }
      catch { console.error('worker health failed'); }
    };
    tick();
    const id = setInterval(tick, 8000);
    return () => { m = false; clearInterval(id); };
  }, [authed]);

  const wTone = !worker?.configured
    ? { dot: 'bg-muted', text: 'worker · off' }
    : worker?.ok
      ? { dot: 'bg-primary animate-pulseDot', text: 'worker · live' }
      : { dot: 'bg-yellow-400', text: `worker · ${worker?.status_code || '?'}` };

  const logout = () => {
    localStorage.removeItem('nexus_admin_token');
    localStorage.removeItem('user');
    setAuthed(false);
  };

  if (!authed) return <Login onLogin={() => { setAuthed(true); setUser(() => { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; } }); }} />;

  return (
    <div className="min-h-screen grid-bg flex">
      <aside className="w-64 shrink-0 border-r border-border/60 bg-surface/60 backdrop-blur-sm flex flex-col" data-testid="sidebar">
        <div className="px-5 py-5 border-b border-border/60 flex items-center gap-3">
          <div className="h-9 w-9 rounded-sm bg-primary/15 border border-primary/40 flex items-center justify-center">
            <span className="font-display font-bold text-primary">U</span>
          </div>
          <div>
            <div className="font-display text-sm tracking-tight font-semibold">ULTIMATEARB</div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-muted">HFT v1.4.2</div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {visibleNav.map(({ to, label, icon: Icon, testid }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              data-testid={testid}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-sm text-sm transition-colors border-l-2 ${
                  isActive ? 'border-primary bg-elevated text-white' : 'border-transparent text-muted hover:text-white hover:bg-elevated/60'
                }`
              }
            >
              <Icon size={15} /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-border/60 space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-muted mb-2">Operator</div>
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{user?.name || 'Admin'}</div>
                <div className="text-[11px] text-muted font-mono truncate">{user?.email}</div>
              </div>
              <span data-testid="user-role-pill" className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${isAdmin ? 'border-primary text-primary bg-primary/10' : 'border-accent text-accent bg-accent/10'}`}>
                {user?.role || 'viewer'}
              </span>
            </div>
          </div>
          <a href="/share" target="_blank" rel="noopener noreferrer" data-testid="open-share-link" className="w-full flex items-center justify-center gap-2 text-[11px] py-1.5 border border-border/60 hover:border-accent/60 hover:text-accent rounded-sm transition-colors text-muted">
            <Share2 size={11} /> Open Public Share
          </a>
          <button onClick={logout} data-testid="logout-button" className="w-full flex items-center justify-center gap-2 text-xs py-2 border border-border hover:border-destructive/60 hover:text-destructive rounded-sm transition-colors">
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 border-b border-border/60 bg-surface/40 backdrop-blur-sm flex items-center justify-between px-6">
          <div className="flex items-center gap-3">
            {React.createElement(current.icon, { size: 16, className: 'text-muted' })}
            <div className="font-display text-sm tracking-tight">{current.label}</div>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted font-mono">
            <span data-testid="worker-status-pill">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${wTone.dot} mr-1.5`} /><span>{wTone.text}</span>
            </span>
            <span className="w-px h-3 bg-border" />
            <Activity size={12} className="text-primary animate-pulseDot" />
            edge · ENAM · {new Date().toLocaleTimeString()}
          </div>
        </header>
        <div className="flex-1 min-w-0 p-5">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/spreads" element={<Spreads />} />
            <Route path="/trades" element={<Trades />} />
            <Route path="/wallet" element={<WalletPage />} />
            <Route path="/keys" element={<ApiKeys />} />
            <Route path="/config" element={<Config />} />
            <Route path="/ab" element={<ABTest />} />
            <Route path="/autopilot" element={<Autopilot />} />
            <Route path="/worker" element={<WorkerDeploy />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/users" element={<Users />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/telegram" element={<Telegram />} />
            <Route path="/opportunities" element={<Opportunities />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/performance" element={<Performance />} />
            <Route path="/share" element={<Share />} />
            <Route path="*" element={<Fallback />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

function Login({ onLogin }) {
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const tok = String(form.get('admin_token') || '');
    try {
      const r = await api.post('/api/login', { token: tok });
      const j = r.data;
      if (j?.ok) {
        localStorage.setItem('nexus_admin_token', tok);
        localStorage.setItem('user', JSON.stringify(j.user || { name: 'Admin', email: 'admin@local', role: 'admin' }));
        onLogin();
      } else setError(j?.error || 'Invalid token');
    } catch (err) { setError(err.message); }
  };
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg,#0a0e17,#0f172a)', color: '#e2e8f0', fontFamily: 'Inter, system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 420, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 24, padding: 36 }}>
        <h1 style={{ fontSize: 28, fontWeight: 900, background: 'linear-gradient(90deg,#00ff88,#00ccff)', WebkitBackgroundClip: 'text', color: 'transparent', margin: '0 0 8px' }}>🚀 Rocket HFT</h1>
        <p style={{ color: '#94a3b8', fontSize: 14, margin: '0 0 28px' }}>Secure admin access — live trading console</p>
        <input name="admin_token" type="password" placeholder="Admin token" required style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: '14px 16px', color: '#e2e8f0', fontSize: 15, marginBottom: 16, boxSizing: 'border-box' }} autoFocus />
        <button type="submit" style={{ width: '100%', background: 'linear-gradient(90deg,#00ff88,#00ccff)', color: '#0a0e17', border: 'none', borderRadius: 14, padding: '14px 0', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>Login</button>
        {error && <div style={{ marginTop: 12, color: '#ff7a85', fontSize: 13 }}>{error}</div>}
      </form>
    </div>
  );
}

function Fallback() {
  return (
    <div style={{ padding: 24 }}>
      <div className="card">
        <div className="card-label">Not found</div>
        <div className="stat-value">This page does not exist.</div>
      </div>
    </div>
  );
}

function Opportunities() {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('idle');
  const load = async () => {
    setStatus('loading');
    try {
      const r = await api.get('/opportunities');
      setItems(r.data?.items || []);
      setStatus('ok');
    } catch { setStatus('error'); }
  };
  useEffect(() => { load(); const id = setInterval(load, 5000); return () => clearInterval(id); }, []);
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 className="font-display text-xl tracking-tight">Opportunities</h1>
        <span style={{ fontSize: 11, opacity: 0.7 }}>{status === 'loading' ? 'scanning...' : status === 'error' ? 'error' : `${items.length} items`}</span>
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {items.length === 0 && <div style={{ color: '#64748b' }}>No opportunities.</div>}
        {items.slice(0, 100).map((o, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'rgba(255,255,255,0.04)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 900 }}>{o.symbol || o.pair}</div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>{o.strategy} · {(o.buy_exchange || '-').toUpperCase()} → {(o.sell_exchange || '-').toUpperCase()}</div>
            </div>
            <div style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 900 }}>{Number(o.net_pct || o.spread_pct || 0).toFixed(2)}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Performance() {
  const [stats, setStats] = useState([]);
  const [text, setText] = useState('');
  useEffect(() => {
    api.get('/api/self-evaluate').then(r => setStats(Array.isArray(r.data?.rankings) ? r.data.rankings : [])).catch(() => {});
    api.get('/api/report').then(r => setText(String(r.data || ''))).catch(() => {});
  }, []);
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <h1 className="font-display text-xl tracking-tight">Performance</h1>
      <div style={{ display: 'grid', gap: 10 }}>
        {stats.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'rgba(255,255,255,0.04)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontWeight: 700 }}>{s.strategy || s}</div>
            <div style={{ fontWeight: 900 }}>{typeof s === 'string' ? s : JSON.stringify(s)}</div>
          </div>
        ))}
      </div>
      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, color: '#cbd5e1', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 18 }}>{text || 'No report.'}</pre>
    </div>
  );
}