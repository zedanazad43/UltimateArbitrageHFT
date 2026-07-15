import React from 'react';
export default function Dashboard({ onLogout }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 0 20px 0' }}>
      <div>
        <h2 style={{ fontSize: 16, color: '#e2e8f0', margin: 0 }}>Dash</h2>
        <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Legacy view replaced by RocketDashboard.</p>
      </div>
      <button onClick={onLogout} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '8px 16px', color: '#e2e8f0', cursor: 'pointer' }}>Logout</button>
    </div>
  );
}
