import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { LayoutDashboard, LineChart, History, Wallet, Settings, Terminal, Send, LogOut, Activity } from "lucide-react";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard" },
  { to: "/spreads", label: "Spreads", icon: LineChart, testid: "nav-spreads" },
  { to: "/trades", label: "Trades", icon: History, testid: "nav-trades" },
  { to: "/wallet", label: "Wallet", icon: Wallet, testid: "nav-wallet" },
  { to: "/config", label: "Bot Config", icon: Settings, testid: "nav-config" },
  { to: "/logs", label: "Logs", icon: Terminal, testid: "nav-logs" },
  { to: "/telegram", label: "Telegram", icon: Send, testid: "nav-telegram" },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const current = NAV.find((n) => n.to === loc.pathname) || NAV[0];

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
          {NAV.map(({ to, label, icon: Icon, testid }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              data-testid={testid}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-sm text-sm transition-colors border-l-2 ${
                  isActive
                    ? "border-primary bg-elevated text-white"
                    : "border-transparent text-muted hover:text-white hover:bg-elevated/60"
                }`
              }
            >
              <Icon size={15} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-border/60">
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted mb-2">Operator</div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-medium">{user?.name || "Admin"}</div>
              <div className="text-[11px] text-muted font-mono">{user?.email}</div>
            </div>
          </div>
          <button
            onClick={logout}
            data-testid="logout-button"
            className="w-full flex items-center justify-center gap-2 text-xs py-2 border border-border hover:border-destructive/60 hover:text-destructive rounded-sm transition-colors"
          >
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 border-b border-border/60 bg-surface/40 backdrop-blur-sm flex items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <current.icon size={16} className="text-muted" />
            <div className="font-display text-sm tracking-tight">{current.label}</div>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted font-mono">
            <Activity size={12} className="text-primary animate-pulseDot" />
            edge · ENAM · {new Date().toLocaleTimeString()}
          </div>
        </header>
        <div className="flex-1 min-w-0 p-5">{children}</div>
      </main>
    </div>
  );
}
