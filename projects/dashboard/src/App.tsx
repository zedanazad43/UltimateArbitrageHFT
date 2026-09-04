import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import Login from "./components/Login";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Spreads from "./pages/Spreads";
import Trades from "./pages/Trades";
import Wallet from "./pages/Wallet";
import ApiKeys from "./pages/ApiKeys";
import Config from "./pages/Config";
import ABTest from "./pages/ABTest";
import Autopilot from "./pages/Autopilot";
import WorkerDeploy from "./pages/WorkerDeploy";
import Alerts from "./pages/Alerts";
import Users from "./pages/Users";
import Audit from "./pages/Audit";
import Logs from "./pages/Logs";
import Telegram from "./pages/Telegram";

// Splash shown while checking stored token
function Splash() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#050505",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          fontFamily: '"IBM Plex Sans", sans-serif',
          color: "#00E676",
          fontSize: 13,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
        }}
      >
        [ loading... ]
      </div>
    </div>
  );
}

// Renders the authenticated app shell with all routes
function AuthenticatedApp() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/spreads" element={<Spreads />} />
        <Route path="/trades" element={<Trades />} />
        <Route path="/wallet" element={<Wallet />} />
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

// Top-level router that gates on auth state
function AppRoutes() {
  const { user } = useAuth();

  // Still verifying stored token
  if (user === null) return <Splash />;

  // Not authed → show login for all paths
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  // Authed → show the full app; redirect /login → /
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/*" element={<AuthenticatedApp />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}