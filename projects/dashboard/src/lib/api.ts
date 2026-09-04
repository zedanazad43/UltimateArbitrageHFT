import axios, { AxiosError } from "axios";

// Backend is the Nexus arbitrage bot (index.js deployed on the Worker).
// It authenticates with either:
//   - an `x-admin-token` header, OR
//   - a `nexus_session` HttpOnly cookie (set by POST /api/login)
// We use the header approach for the SPA — the token is stored in
// localStorage and attached to every request.
const BACKEND_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ||
  (process.env.REACT_APP_BACKEND_URL as string | undefined) ||
  "https://ultimatearbitragehft.zedanazad43.workers.dev";

const TOKEN_KEY = "nexus_admin_token";

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || "";
}
export function setToken(t: string): void {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

const api = axios.create({ baseURL: BACKEND_URL });

// Attach the admin token to every request.
api.interceptors.request.use((config) => {
  const t = getToken();
  if (t) config.headers.set("x-admin-token", t);
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err: AxiosError) => {
    if (err.response && err.response.status === 401) {
      // Token invalid/expired — drop it so the UI shows the login screen.
      setToken("");
    }
    return Promise.reject(err);
  }
);

export default api;

// ── Endpoint wrappers (mirror Nexus routes) ───────────────────────────────
export const nexus = {
  login: (token: string) => api.post("/api/login", { token }),
  health: () => api.get("/health"),
  status: () => api.get("/status"),
  balances: () => api.get("/api/balances"),
  // trades: () => api.get("/status"), // use status.recentTrades
  pnl: () => api.get("/api/pnl"),
  safetyState: () => api.get("/api/safety-state"),
  executionHealth: () => api.get("/api/execution-health"),
  platforms: () => api.get("/api/platforms"),
  aiStatus: () => api.get("/api/ai/status"),
  scan: () => api.post("/api/scan"),
  setMode: (mode: string) => api.post(`/mode/${mode}`),
  start: () => api.get("/start"),
  stop: () => api.get("/stop"),
};