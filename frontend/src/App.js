import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import Login from "./components/Login";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Spreads from "./pages/Spreads";
import Trades from "./pages/Trades";
import Wallet from "./pages/Wallet";
import Config from "./pages/Config";
import Logs from "./pages/Logs";
import Telegram from "./pages/Telegram";

function Shell() {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="font-mono text-sm text-muted" data-testid="boot-loader">
          [ CONNECTING... ]
        </div>
      </div>
    );
  }
  if (user === false) return <Login />;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/spreads" element={<Spreads />} />
        <Route path="/trades" element={<Trades />} />
        <Route path="/wallet" element={<Wallet />} />
        <Route path="/config" element={<Config />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/telegram" element={<Telegram />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
