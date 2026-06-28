import axios from "axios";

const BASE = process.env.REACT_APP_BACKEND_URL;

const api = axios.create({
  baseURL: `${BASE}/api`,
  withCredentials: true,
});

// Also send Authorization bearer if available (fallback for cross-domain cookie blocks)
api.interceptors.request.use((config) => {
  const t = localStorage.getItem("auth_token");
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

export default api;
