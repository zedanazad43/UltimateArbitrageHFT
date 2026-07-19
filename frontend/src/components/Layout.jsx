import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { LayoutDashboard, LineChart, History, Wallet, Settings, Terminal, Send, LogOut, Activity, KeyRound, Users as UsersIcon, Share2, Bell, GitCompareArrows, ScrollText, Bot, Cloud, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import api from "../lib/api";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard" },
  { to: "/spreads", label: "Spreads", icon: LineChart, testid: "nav-spreads" },
  { to: "/trades", label: "Trades", icon: History, testid: "nav-trades" },
  { to: "/wallet", label: "Wallet", icon: Wallet, testid: "nav-wallet" },
  { to: "/keys", label: "API Keys", icon: KeyRound, testid: "nav-keys", adminOnly: true },
  { to: "/config", label: "Bot Config", icon: Settings, testid: "nav-config", adminOnly: true },
  { to: "/ab", label: "A/B Test", icon: GitCompareArrows, testid: "nav-ab", adminOnly: true },
  { to: "/autopilot", label: "Autopilot", icon: Bot, testid: "nav-autopilot", adminOnly: true },
  { to: "/worker", label: "Worker Deploy", icon: Cloud, testid: "nav-worker", adminOnly: true },
  { to: "/alerts", label: "Alerts", icon: Bell, testid: "nav-alerts", adminOnly: true },
  { to: "/users", label: "Users", icon: UsersIcon, testid: "nav-users", adminOnly: true },
  { to: "/audit", label: "Audit Log", icon: ScrollText, testid: "nav-audit", adminOnly: true },
  { to: "/logs", label: "Logs", icon: Terminal, testid: "nav-logs" },
  { to: "/telegram", label: "Telegram", icon: Send, testid: "nav-telegram", adminOnly: true },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const isAdmin = user?.role === "admin";
  const visibleNav = NAV.filter((n) => !n.adminOnly || isAdmin);
  const current = visibleNav.find((n) => n.to === loc.pathname) || NAV.find((n) => n.to === loc.pathname) || NAV[0];
  const [worker, setWorker] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close sidebar when route changes (mobile)
  useEffect(() => { setSidebarOpen(false); }, [loc.pathname]);

  useEffect(() => {
    let m = true;
    const tick = async () => {
      try {
        const { data } = await api.get("/worker/health");
        if (m) setWorker(data);
      } catch (err) {
        console.error("worker health check failed", err);
      }
    };
    tick();
    const id = setInterval(tick, 8000);
    return () => {
      m = false;
      clearInterval(id);
    };
  }, []);

  const wTone = !worker?.configured
    ? { dot: "bg-muted", text: "worker · off" }
    : worker?.ok
    ? { dot: "bg-primary animate-pulseDot", text: "worker · live" }
    : { dot: "bg-yellow-400", text: `worker · ${worker?.status_code || "?"}` };

  const SidebarContent = () => (
    <>
      <div className="px-5 py-5 border-b border-border/60 flex items-center gap-3">
        <div className="h-9 w-9 rounded-sm bg-primary/15 border border-primary/40 flex items-center justify-center">
          <span className="font-display font-bold text-primary">U</span>
        </div>
        <div>
          <div className="font-display text-sm tracking-tight font-semibold">ULTIMATEARB</div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted">HFT v1.4.2</div>
        </div>
        <button
          className="ml-auto lg:hidden text-muted hover:text-white"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar"
        >
          <X size={18} />
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {visibleNav.map(({ to, label, icon: Icon, testid }) => (
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

      <div className="px-4 py-4 border-t border-border/60 space-y-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted mb-2">Operator</div>
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{user?.name || "Admin"}</div>
              <div className="text-[11px] text-muted font-mono truncate">{user?.email || "—"}</div>
            </div>
            <span
              data-testid="user-role-pill"
              className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${
                isAdmin ? "border-primary text-primary bg-primary/10" : "border-accent text-accent bg-accent/10"
              }`}
            >
              {user?.role || "admin"}
            </span>
          </div>
        </div>
        <a
          href="/share"
          target="_blank"
          rel="noopener noreferrer"
          data-testid="open-share-link"
          className="w-full flex items-center justify-center gap-2 text-[11px] py-1.5 border border-border/60 hover:border-accent/60 hover:text-accent rounded-sm transition-colors text-muted"
        >
          <Share2 size={11} /> Open Public Share
        </a>
        <button
          onClick={logout}
          data-testid="logout-button"
          className="w-full flex items-center justify-center gap-2 text-xs py-2 border border-border hover:border-destructive/60 hover:text-destructive rounded-sm transition-colors"
        >
          <LogOut size={13} /> Sign out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen grid-bg flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — hidden on mobile unless toggled open */}
      <aside
        data-testid="sidebar"
        className={`
          fixed lg:static inset-y-0 left-0 z-50
          w-64 shrink-0 border-r border-border/60 bg-surface/95 backdrop-blur-sm flex flex-col
          transition-transform duration-200
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}
      >
        <SidebarContent />
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 border-b border-border/60 bg-surface/40 backdrop-blur-sm flex items-center justify-between px-4 lg:px-6 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden text-muted hover:text-white p-1"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sidebar"
              data-testid="sidebar-toggle"
            >
              <Menu size={18} />
            </button>
            <current.icon size={16} className="text-muted hidden lg:block" />
            <div className="font-display text-sm tracking-tight">{current.label}</div>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted font-mono">
            <span className="hidden sm:flex items-center gap-1.5" data-testid="worker-status-pill">
              <span className={`h-1.5 w-1.5 rounded-full ${wTone.dot}`} />
              <span>{wTone.text}</span>
            </span>
            <span className="hidden sm:block w-px h-3 bg-border" />
            <Activity size={12} className="text-primary animate-pulseDot" />
            <span className="hidden md:inline">edge · ENAM · {new Date().toLocaleTimeString()}</span>
          </div>
        </header>
        <div className="flex-1 min-w-0 p-4 lg:p-5">{children}</div>
      </main>
    </div>
  );
}
