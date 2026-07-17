import React, { useState } from "react";
import { setToken } from "../lib/api";

const BACKEND = "https://ultimatearbitragehft.zedanazad43.workers.dev";

export default function Login({ onAuthed }) {
  const [token, setTokenVal] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`${BACKEND}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      if (res.status === 204 || res.status === 200) {
        setToken(token.trim());
        onAuthed(token.trim());
      } else {
        setErr("Invalid admin token");
      }
    } catch (e) {
      setErr(
        e.response && e.response.status === 401
          ? "Invalid admin token"
          : "Connection error — is the backend reachable?"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={wrap}>
      <form onSubmit={submit} style={card}>
        <h1 style={title}>UltimateArbitrageHFT</h1>
        <p style={sub}>Nexus Control Center · Secure Access</p>
        <input
          type="password"
          placeholder="ADMIN_TOKEN"
          value={token}
          onChange={(e) => setTokenVal(e.target.value)}
          style={input}
          autoFocus
        />
        {err && <p style={{ color: "#ff6b6b", margin: "8px 0 0" }}>{err}</p>}
        <button type="submit" disabled={busy} style={btn}>
          {busy ? "Verifying…" : "Enter Control Center"}
        </button>
      </form>
    </div>
  );
}

const wrap = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#0b0e14",
  color: "#eee",
  fontFamily: "Segoe UI, sans-serif",
};
const card = {
  background: "#151a23",
  padding: "32px",
  borderRadius: "12px",
  width: "320px",
  boxShadow: "0 8px 32px rgba(0,0,0,.4)",
  display: "flex",
  flexDirection: "column",
};
const title = { color: "#f0b90b", margin: "0 0 4px", fontSize: "1.3em" };
const sub = { color: "#888", margin: "0 0 20px", fontSize: ".85em" };
const input = {
  padding: "10px",
  borderRadius: "6px",
  border: "1px solid #2a2f3a",
  background: "#0b0e14",
  color: "#eee",
  marginBottom: "12px",
};
const btn = {
  padding: "10px",
  borderRadius: "6px",
  border: "none",
  background: "#f0b90b",
  color: "#0b0e14",
  fontWeight: "bold",
  cursor: "pointer",
};
