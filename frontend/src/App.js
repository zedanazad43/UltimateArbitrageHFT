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
import ApiKeys from "./pages/ApiKeys";
import Users from "./pages/Users";
import Alerts from "./pages/Alerts";
import ABTest from "./pages/ABTest";
import Audit from "./pages/Audit";
import Autopilot from "./pages/Autopilot";
import WorkerDeploy from "./pages/WorkerDeploy";
import Share from "./pages/Share";

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
  const isAdmin = user.role === "admin";
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
        <Route path="/keys" element={<ApiKeys />} />
        <Route path="/api-keys" element={<ApiKeys />} />
        {isAdmin && <Route path="/users" element={<Users />} />}
        {isAdmin && <Route path="/alerts" element={<Alerts />} />}
        {isAdmin && <Route path="/ab" element={<ABTest />} />}
        {isAdmin && <Route path="/autopilot" element={<Autopilot />} />}
        {isAdmin && <Route path="/worker" element={<WorkerDeploy />} />}
        {isAdmin && <Route path="/audit" element={<Audit />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <Routes>
      {/* Public share — no auth, outside the AuthProvider shell isn't necessary but we keep it simple */}
      <Route
        path="/share"
        element={<Share />}
      />
      <Route
        path="/*"
        element={
          <AuthProvider>
            <Shell />
          </AuthProvider>
        }
      />
    </Routes>
  );
}
