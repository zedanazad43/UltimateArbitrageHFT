module.exports = {
  safeAsync: async (fn, fallback = null, label = 'op') => {
    try { return await fn(); }
    catch (e) { console.error(`[safeAsync] ${label}:`, e.message); return fallback; }
  },
  withTimeout: (promise, ms = 4000, label = 'op') =>
    Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timeout ${ms}ms`)), ms))
    ])
};
