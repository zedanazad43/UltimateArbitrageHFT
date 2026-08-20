import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getToken, setToken, nexus } from "../lib/api";

const AuthCtx = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null); // null=checking, false=guest, object=authed user
  const [error, setError] = useState("");

  // Verify a stored token is still valid by hitting /health
  const refreshMe = useCallback(async () => {
    const token = getToken();
    if (!token) { setUser(false); return; }
    try {
      await nexus.health();
      setUser({ role: "admin", authed: true });
    } catch (err) {
      if (err.response?.status === 401) {
        setToken("");
        setUser(false);
      } else {
        // Network hiccup — assume token still valid to avoid spurious logouts
        console.warn("health check failed (network?):", err.message || err);
        setUser((prev) => prev ?? { role: "admin", authed: true });
      }
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  // login(token) — accepts the ADMIN_TOKEN sent as x-admin-token
  const login = async (token) => {
    setError("");
    const t = String(token || "").trim();
    if (!t) { setError("Admin token is required"); return false; }
    try {
      setToken(t);
      await nexus.health();
      setUser({ role: "admin", authed: true });
      return true;
    } catch (e) {
      setToken("");
      const status = e.response?.status;
      setError(
        status === 401
          ? "Invalid admin token"
          : "Connection error — is the backend reachable?"
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

export const useAuth = () => useContext(AuthCtx);
