import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { ReactNode } from "react";
import type { AxiosError } from "axios";
import { getToken, setToken, nexus } from "../lib/api";

export type AuthUser =
  | { role: "admin"; authed: true; name?: string; email?: string; id?: string }
  | null
  | false;

export type AuthValue = {
  user: AuthUser; // null=checking, false=guest, object=authed user
  error: string;
  login: (token: string) => Promise<boolean>;
  logout: () => void;
  refreshMe: () => Promise<void>;
};

const AuthCtx = createContext<AuthValue | null>(null);

function statusOf(e: unknown): number | undefined {
  return (e as AxiosError)?.response?.status;
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser>(null);
  const [error, setError] = useState("");

  // Verify a stored token is still valid by hitting /health
  const refreshMe = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setUser(false);
      return;
    }
    try {
      await nexus.health();
      setUser({ role: "admin", authed: true });
    } catch (err) {
      if (statusOf(err) === 401) {
        setToken("");
        setUser(false);
      } else {
        // Network hiccup — assume token still valid to avoid spurious logouts
        console.warn("health check failed (network?):", (err as Error)?.message || err);
        setUser((prev) => prev ?? { role: "admin", authed: true });
      }
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  // login(token) — accepts the ADMIN_TOKEN sent as x-admin-token
  const login = async (token: string): Promise<boolean> => {
    setError("");
    const t = String(token || "").trim();
    if (!t) {
      setError("Admin token is required");
      return false;
    }
    try {
      setToken(t);
      await nexus.health();
      setUser({ role: "admin", authed: true });
      return true;
    } catch (e) {
      setToken("");
      const status = statusOf(e);
      setError(
        status === 401 ? "Invalid admin token" : "Connection error — is the backend reachable?"
      );
      return false;
    }
  };

  const logout = () => {
    setToken("");
    setUser(false);
  };

  return (
    <AuthCtx.Provider value={{ user, error, login, logout, refreshMe }}>
      {children}
    </AuthCtx.Provider>
  );
};

export const useAuth = (): AuthValue => {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
};