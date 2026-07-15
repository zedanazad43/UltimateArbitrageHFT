import React from 'react';

export default function Rocket({ onEnter }) {
  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(180deg,#0a0e17,#0f172a)', color:'#e2e8f0', fontFamily:'Inter, system-ui, sans-serif', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ fontSize:96, marginBottom:24 }}>🚀</div>
      <h1 style={{ fontSize:56, fontWeight:900, background:'linear-gradient(90deg,#00ff88,#00ccff,#a855f7)', WebkitBackgroundClip:'text', color:'transparent', margin:0, letterSpacing:'-2px' }}>Rocket HFT</h1>
      <p style={{ fontSize:20, color:'#94a3b8', marginTop:16, maxWidth:600, textAlign:'center' }}>Next-gen arbitrage engine — ultra-low latency, AI-driven, multi-exchange.</p>
      <div style={{ marginTop:32, display:'flex', gap:12, flexWrap:'wrap', justifyContent:'center' }}>
        {['<10ms latency','AI-powered','Multi-exchange','Real-time dashboard','Secure proxy'].map(f=>(
          <span key={f} style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:999, padding:'10px 20px', fontSize:14, color:'#e2e8f0' }}>{f}</span>
        ))}
      </div>
      <button onClick={onEnter} style={{ marginTop:48, background:'linear-gradient(90deg,#00ff88,#00ccff)', color:'#0a0e17', border:'none', borderRadius:16, padding:'16px 48px', fontSize:18, fontWeight:800, cursor:'pointer', boxShadow:'0 0 30px rgba(0,255,136,0.3)' }}>Launch Dashboard →</button>
      <p style={{ marginTop:16, fontSize:12, color:'#64748b' }}>v3.0 · ultimatearbitragehft · ecosamp.net</p>
    </div>
  );
}
