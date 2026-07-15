const MAX_OPPORTUNITIES = 500;
const TTL_MS = 5 * 60 * 1000; // 5 minutes

const memory = new Map();
let lastFlush = Date.now();

function set(key, value, ttl = TTL_MS) {
  memory.set(key, { value, expires: Date.now() + ttl });
  prune();
}
function get(key) {
  const entry = memory.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { memory.delete(key); return null; }
  return entry.value;
}
function prune() {
  if (Date.now() - lastFlush < 10000) return;
  lastFlush = Date.now();
  for (const [k, v] of memory) { if (Date.now() > v.expires) memory.delete(k); }
}

function storeOpportunity(opp) {
  set(`opp:${opp.symbol}:${Date.now()}`, opp, TTL_MS);
}
function getRecentOpportunities(limit = 50) {
  const all = [];
  for (const [k, v] of memory) {
    if (k.startsWith('opp:') && v.expires > Date.now()) all.push(v.value);
  }
  all.sort((a, b) => (b.detected_at || 0) - (a.detected_at || 0));
  return all.slice(0, limit);
}

module.exports = { set, get, storeOpportunity, getRecentOpportunities, MAX_OPPORTUNITIES };
