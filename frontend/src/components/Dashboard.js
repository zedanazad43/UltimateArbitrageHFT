import React, { useEffect, useState } from "react";
import { nexus, setToken } from "../lib/api";

function Stat({ label, value, accent }) {
  return (
    <div style={statBox}>
      <div style={{ color: "#888", fontSize: ".75em" }}>{label}</div>
      <div style={{ color: accent || "#eee", fontSize: "1.25em", fontWeight: "bold" }}>
        {value}
      </div>
    </div>
  );
}

export default function Dashboard({ onLogout }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setErr("");
    try {
      const [status, balances, trades, pnl, safety, exec, platforms, ai] =
        await Promise.all([
          nexus.status(),
          nexus.balances(),
          nexus.trades(),
          nexus.pnl(),
          nexus.safetyState(),
          nexus.executionHealth(),
          nexus.platforms(),
          nexus.aiStatus(),
        ]);
      setData({
        status: status.data,
        balances: balances.data,
        trades: trades.data,
        pnl: pnl.data,
        safety: safety.data,
        exec: exec.data,
        platforms: platforms.data,
        ai: ai.data,
      });
    } catch (e) {
      setErr(
        e.response && e.response.status === 401
          ? "Session expired — please log in again."
          : "Failed to load dashboard data."
      );
      if (e.response && e.response.status === 401) onLogout();
    }
  }

  useEffect(() => {
    let active = true;
    const run = () => active && load();
    run();
    const id = setInterval(run, 15000); // live refresh
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  async function toggleMode() {
    setBusy(true);
    try {
      const mode = data.status.paper_trading ? "live" : "paper";
      await nexus.setMode(mode);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggleEngine() {
    setBusy(true);
    try {
      if (data.status.trading_enabled) await nexus.stop();
      else await nexus.start();
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (err) return <div style={errBox}>{err}</div>;
  if (!data) return <div style={errBox}>Loading Nexus state…</div>;

  const totalEquity = (data.balances.data || [])
    .filter((b) => b.configured)
    .reduce((sum, b) => {
      const usdt = parseFloat(b.balances.USDT || 0);
      const usdc = parseFloat(b.balances.USDC || 0);
      return sum + usdt + usdc;
    }, 0);

  const live = !data.status.paper_trading;

  return (
    <div style={wrap}>
      <header style={header}>
        <div>
          <h1 style={title}>UltimateArbitrageHFT</h1>
          <span style={{ color: "#888", fontSize: ".8em" }}>
            Nexus Control Center
          </span>
        </div>
        <div>
          <button style={btnGhost} onClick={toggleMode} disabled={busy}>
            {live ? "🟢 LIVE" : "🟡 PAPER"}
          </button>
          <button style={btnGhost} onClick={toggleEngine} disabled={busy}>
            {data.status.trading_enabled ? "⏸ Stop" : "▶ Start"}
          </button>
          <button
            style={btnGhost}
            onClick={() => {
              setToken("");
              onLogout();
            }}
          >
            ⎋ Logout
          </button>
        </div>
      </header>

      <section style={grid}>
        <Stat label="Mode" value={live ? "LIVE" : "PAPER"} accent={live ? "#2ecc71" : "#f0b90b"} />
        <Stat
          label="Trading"
          value={data.status.trading_enabled ? "ON" : "OFF"}
          accent={data.status.trading_enabled ? "#2ecc71" : "#ff6b6b"}
        />
        <Stat label="Spot Lock" value={data.status.spot_only_lock ? "ON" : "OFF"} />
        <Stat label="Configured Exchanges" value={(data.balances.data || []).filter((b) => b.configured).length} />
        <Stat label="Equity (USDT+USDC)" value={`$${totalEquity.toFixed(2)}`} accent="#f0b90b" />
        <Stat label="Trades" value={data.trades.count ?? 0} />
      </section>

      <section style={grid2}>
        <div style={panel}>
          <h2 style={panelTitle}>Exchange Balances (live)</h2>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Exchange</th>
                <th style={th}>USDT</th>
                <th style={th}>USDC</th>
                <th style={th}>ETH</th>
                <th style={th}>BTC</th>
              </tr>
            </thead>
            <tbody>
              {(data.balances.data || []).map((b) => (
                <tr key={b.exchange} style={!b.configured ? { opacity: 0.45 } : undefined}>
                  <td style={{ ...td, textAlign: "left" }}>{b.exchange}</td>
                  <td style={td}>{(+b.balances.USDT || 0).toFixed(2)}</td>
                  <td style={td}>{(+b.balances.USDC || 0).toFixed(2)}</td>
                  <td style={td}>{(+b.balances.ETH || 0).toFixed(4)}</td>
                  <td style={td}>{(+b.balances.BTC || 0).toFixed(6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={panel}>
          <h2 style={panelTitle}>Safety & Execution</h2>
          <p style={row}>
            <span style={{ color: "#888" }}>Execution health:</span>{" "}
            {JSON.stringify(data.exec).slice(0, 120)}
          </p>
          <p style={row}>
            <span style={{ color: "#888" }}>Safety state:</span>{" "}
            {JSON.stringify(data.safety).slice(0, 120)}
          </p>
          <p style={row}>
            <span style={{ color: "#888" }}>AI status:</span>{" "}
            {JSON.stringify(data.ai).slice(0, 120)}
          </p>
          <p style={row}>
            <span style={{ color: "#888" }}>Platforms:</span>{" "}
            {(data.platforms.data || []).length} connected
          </p>
        </div>
      </section>

      <section style={panel}>
        <h2 style={panelTitle}>Recent Trades</h2>
        {data.trades.count === 0 ? (
          <p style={{ color: "#888" }}>No trades yet.</p>
        ) : (
          <pre style={{ color: "#ccc", fontSize: ".8em", overflowX: "auto" }}>
            {JSON.stringify(data.trades.data, null, 2).slice(0, 800)}
          </pre>
        )}
      </section>
    </div>
  );
}

const wrap = { background: "#0b0e14", color: "#eee", minHeight: "100vh", fontFamily: "Segoe UI, sans-serif", padding: "20px" };
const header = { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" };
const title = { color: "#f0b90b", margin: "0", fontSize: "1.4em" };
const btnGhost = { background: "#1c2230", color: "#eee", border: "1px solid #2a2f3a", borderRadius: "6px", padding: "8px 12px", marginLeft: "8px", cursor: "pointer" };
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: "14px", marginBottom: "18px" };
const statBox = { background: "#151a23", padding: "14px", borderRadius: "10px" };
const grid2 = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: "14px", marginBottom: "18px" };
const panel = { background: "#151a23", padding: "16px", borderRadius: "10px" };
const panelTitle = { color: "#f0b90b", fontSize: "1em", marginTop: "0" };
const table = { width: "100%", borderCollapse: "collapse" };
const th = { textAlign: "left", color: "#888", fontSize: ".8em", padding: "6px", borderBottom: "1px solid #2a2f3a" };
const td = { padding: "6px", borderBottom: "1px solid #1c2230", textAlign: "right", fontFamily: "JetBrains Mono, monospace", fontVariantNumeric: "tabular-nums" };
const row = { margin: "6px 0", fontSize: ".85em" };
const errBox = { background: "#0b0e14", color: "#ff6b6b", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Segoe UI, sans-serif" };
