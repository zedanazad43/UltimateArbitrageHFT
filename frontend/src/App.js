import React, { useState, useEffect } from 'react';
import RocketDashboard from './pages/RocketDashboard';

const API = process.env.REACT_APP_BACKEND_URL || '';

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!API) return;
    fetch(`${API}/health`).then(r => r.ok ? setAuthed(true) : setAuthed(false)).catch(() => setAuthed(false));
  }, [API]);

  async function doLogin(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    const fd = new FormData(e.target);
    const tok = String(fd.get('admin_token') || '');
    try {
      const r = await fetch(`${API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': tok },
        body: '{}'
      });
      const j = await r.json();
      if (r.ok && j.token) { localStorage.setItem('admin_token', j.token); setAuthed(true); }
      else setErr(j?.error || 'login failed');
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }

  if (!authed) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg,#0a0e17,#0f172a)', color: '#e2e8f0', fontFamily: 'Inter, system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <form onSubmit={doLogin} style={{ width: '100%', maxWidth: 400, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 32 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, background: 'linear-gradient(90deg,#00ff88,#00ccff)', WebkitBackgroundClip: 'text', color: 'transparent', margin: '0 0 8px' }}>🚀 Rocket HFT</h1>
          <p style={{ color: '#64748b', fontSize: 14, margin: '0 0 24px' }}>Secure admin access</p>
          <input name="admin_token" type="password" placeholder="Admin token" required style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '12px 16px', color: '#e2e8f0', fontSize: 14, marginBottom: 12, boxSizing: 'border-box' }} />
          <button type="submit" disabled={busy} style={{ width: '100%', background: busy ? '#334155' : 'linear-gradient(90deg,#00ff88,#00ccff)', color: '#0a0e17', border: 'none', borderRadius: 12, padding: '14px 0', fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}>{busy ? '...' : 'Login'}</button>
          {err && <p style={{ color: '#ff3344', fontSize: 13, marginTop: 12 }}>{err}</p>}
        </form>
      </div>
    );
  }
  return <RocketDashboard onLogout={() => { localStorage.removeItem('admin_token'); setAuthed(false); }} />;
}
