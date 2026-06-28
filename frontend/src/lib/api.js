import axios from "axios";

const BASE = process.env.REACT_APP_BACKEND_URL;

// All requests use httpOnly cookies for auth (set by /api/auth/login).
// We intentionally do NOT store the JWT in localStorage to avoid XSS exposure.
const api = axios.create({
  baseURL: `${BASE}/api`,
  withCredentials: true,
});

export default api;
