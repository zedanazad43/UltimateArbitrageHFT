import axios from "axios";

const BASE = process.env.REACT_APP_BACKEND_URL;

// Read a cookie value by name (used to attach the CSRF token to state-changing requests).
function readCookie(name) {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/[.$?*|{}()[\]\\/+^]/g, "\\$&") + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

const api = axios.create({
  baseURL: `${BASE}/api`,
  withCredentials: true,
});

// Auth: httpOnly access_token cookie (XSS-safe).
// CSRF: double-submit pattern — non-httpOnly csrf_token cookie is echoed in X-CSRF-Token header on state-changing requests.
api.interceptors.request.use((config) => {
  const method = (config.method || "get").toLowerCase();
  if (["post", "put", "patch", "delete"].includes(method)) {
    const csrf = readCookie("csrf_token");
    if (csrf) {
      config.headers = config.headers || {};
      config.headers["X-CSRF-Token"] = csrf;
    }
  }
  return config;
});

export default api;
export { readCookie };
