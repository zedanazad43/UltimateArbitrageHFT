// nexus/src/db.js — D1 database helpers

export async function logTrade(env, { strategy, sizeUsd, netPct, mode }) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO trades (strategy, size_usd, net_profit_percent, mode, created_at) VALUES (?, ?, ?, ?, ?)`
    ).bind(strategy, sizeUsd, netPct, mode, Date.now()).run();
  } catch (_) {}
}

export async function getRecentTrades(env, limit = 20) {
  if (!env.DB) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM trades ORDER BY created_at DESC LIMIT ?`
    ).bind(limit).all();
    return results || [];
  } catch (_) { return []; }
}

export async function getStrategyPnL(env) {
  const empty = { cex: { pnl: 0, trades: 0 }, dex: { pnl: 0, trades: 0 }, perps: { pnl: 0, trades: 0 } };
  if (!env.DB) return empty;
  try {
    const { results } = await env.DB.prepare(
      `SELECT strategy, SUM(size_usd * net_profit_percent / 100.0) AS pnl, COUNT(*) AS trades
       FROM trades GROUP BY strategy`
    ).all();
    const out = { cex: { pnl: 0, trades: 0 }, dex: { pnl: 0, trades: 0 }, perps: { pnl: 0, trades: 0 } };
    for (const row of (results || [])) {
      // strategy field is stored as "cex:MEXC→BINANCE" — extract the prefix
      const type = (row.strategy || '').split(':')[0].toLowerCase();
      if (out[type]) {
        out[type].pnl += row.pnl || 0;
        out[type].trades += row.trades || 0;
      }
    }
    return out;
  } catch (_) { return empty; }
}

export async function logAdminEvent(env, action, request) {
  if (!env.DB) return;
  try {
    const ip = request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-forwarded-for') || null;
    await env.DB.prepare(
      `INSERT INTO admin_events (action, source_ip, created_at) VALUES (?, ?, ?)`
    ).bind(action, ip, Date.now()).run();
  } catch (_) {}
}

export async function logBotEvent(env, eventType, details = null) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO bot_events (event_type, details, created_at) VALUES (?, ?, ?)`
    ).bind(eventType, details ? JSON.stringify(details) : null, Date.now()).run();
  } catch (_) {}
}
