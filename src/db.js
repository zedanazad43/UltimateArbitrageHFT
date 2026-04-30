// nexus/src/db.js — D1 database helpers + Analytics Engine integration

// ── Auto-schema initialisation ────────────────────────────────────────────────
// Creates all D1 tables and indexes on first use so the Worker is self-healing:
// the schema is applied automatically even when the manual migration step was
// skipped.  The promise is memoised per Worker instance — subsequent requests
// within the same isolate are no-ops.
let _schemaInitPromise = null;

export function ensureSchema(env) {
  if (!env.DB) return Promise.resolve();
  if (_schemaInitPromise) return _schemaInitPromise;
  _schemaInitPromise = env.DB.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy           TEXT    NOT NULL,
      size_usd           REAL    NOT NULL,
      net_profit_percent REAL    NOT NULL,
      mode               TEXT    NOT NULL DEFAULT 'paper',
      created_at         INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      action     TEXT    NOT NULL,
      source_ip  TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bot_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT    NOT NULL,
      details    TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS paper_positions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy      TEXT    NOT NULL,
      symbol        TEXT    NOT NULL,
      direction     TEXT    NOT NULL,
      size_usd      REAL    NOT NULL,
      entry_price   REAL    NOT NULL,
      buy_exchange  TEXT    NOT NULL,
      sell_exchange TEXT    NOT NULL,
      opened_at     INTEGER NOT NULL,
      closed_at     INTEGER,
      exit_price    REAL,
      pnl_usd       REAL
    );
    CREATE INDEX IF NOT EXISTS idx_trades_created_at         ON trades(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_trades_strategy           ON trades(strategy);
    CREATE INDEX IF NOT EXISTS idx_trades_mode               ON trades(mode);
    CREATE INDEX IF NOT EXISTS idx_admin_events_created_at   ON admin_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bot_events_created_at     ON bot_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_paper_positions_opened_at ON paper_positions(opened_at DESC);
    CREATE INDEX IF NOT EXISTS idx_paper_positions_closed_at ON paper_positions(closed_at);
  `).catch(e => {
    _schemaInitPromise = null; // allow retry on the next request
    console.error('[DB] ensureSchema error:', e.message);
  });
  return _schemaInitPromise;
}

// ── Analytics Engine helper ───────────────────────────────────────────────────
// Writes a structured data point to the ANALYTICS binding (Analytics Engine).
// The binding is optional — all callers guard with an existence check so the
// Worker degrades gracefully when the dataset has not yet been provisioned.
//
// Schema:
//   blobs[0]  = event_type  (e.g. "trade", "scan", "admin", "error")
//   blobs[1]  = strategy    (e.g. "cex", "dex", "perps")
//   blobs[2]  = mode        (e.g. "paper", "live")
//   doubles[0] = size_usd
//   doubles[1] = net_profit_percent
//   indexes[0] = event_type (for fast GROUP-BY queries via SQL API)
export function writeAnalyticsEvent(env, eventType, { strategy = '', mode = '', sizeUsd = 0, netPct = 0 } = {}) {
  if (!env.ANALYTICS) return;
  try {
    env.ANALYTICS.writeDataPoint({
      blobs:   [eventType, strategy, mode],
      doubles: [sizeUsd, netPct],
      indexes: [eventType],
    });
  } catch (e) {
    console.error('[Analytics] writeDataPoint error:', e.message);
  }
}

export async function logTrade(env, { strategy, sizeUsd, netPct, mode }) {
  // Emit to Analytics Engine (non-blocking, fire-and-forget)
  writeAnalyticsEvent(env, 'trade', { strategy, sizeUsd, netPct, mode });

  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO trades (strategy, size_usd, net_profit_percent, mode, created_at) VALUES (?, ?, ?, ?, ?)`
    ).bind(strategy, sizeUsd, netPct, mode, Date.now()).run();
  } catch (e) { console.error('[DB] logTrade error:', e.message); }
}

export async function getRecentTrades(env, limit = 20) {
  if (!env.DB) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM trades ORDER BY created_at DESC LIMIT ?`
    ).bind(limit).all();
    return results || [];
  } catch (e) { console.error('[DB] getRecentTrades error:', e.message); return []; }
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
  } catch (e) { console.error('[DB] getStrategyPnL error:', e.message); return empty; }
}

export async function logAdminEvent(env, action, request) {
  writeAnalyticsEvent(env, 'admin', { strategy: action });
  if (!env.DB) return;
  try {
    const ip = request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-forwarded-for') || null;
    await env.DB.prepare(
      `INSERT INTO admin_events (action, source_ip, created_at) VALUES (?, ?, ?)`
    ).bind(action, ip, Date.now()).run();
  } catch (e) { console.error('[DB] logAdminEvent error:', e.message); }
}

export async function logBotEvent(env, eventType, details = null) {
  writeAnalyticsEvent(env, eventType, {});
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO bot_events (event_type, details, created_at) VALUES (?, ?, ?)`
    ).bind(eventType, details ? JSON.stringify(details) : null, Date.now()).run();
  } catch (e) { console.error('[DB] logBotEvent error:', e.message); }
}

/**
 * Returns aggregate performance metrics for the /api/report endpoint.
 * Computes: total trades, win rate, average P&L, max drawdown,
 * best/worst trade, total P&L, and an annualised Sharpe-ratio approximation.
 */
export async function getPerformanceMetrics(env, fromMs = 0, toMs = Date.now()) {
  const empty = {
    total_trades: 0, win_trades: 0, loss_trades: 0,
    win_rate: 0, avg_pnl_usd: 0,
    best_trade_usd: 0, worst_trade_usd: 0,
    max_drawdown_usd: 0, total_pnl_usd: 0, sharpe: 0
  };
  if (!env.DB) return empty;
  try {
    const { results } = await env.DB.prepare(
      `SELECT size_usd, net_profit_percent FROM trades
       WHERE created_at >= ? AND created_at <= ? ORDER BY created_at ASC`
    ).bind(fromMs, toMs).all();
    const rows = results || [];
    if (rows.length === 0) return empty;

    const pnls   = rows.map(r => (r.size_usd * r.net_profit_percent) / 100);
    const wins   = pnls.filter(p => p > 0).length;
    const total  = pnls.length;
    const totalPnl = pnls.reduce((s, p) => s + p, 0);
    const avgPnl   = totalPnl / total;
    const best     = Math.max(...pnls);
    const worst    = Math.min(...pnls);

    // Max drawdown: largest peak-to-trough drop in cumulative P&L
    let peak = 0, cumPnl = 0, maxDrawdown = 0;
    for (const p of pnls) {
      cumPnl += p;
      if (cumPnl > peak) peak = cumPnl;
      const dd = peak - cumPnl;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    // Sharpe ratio approximation.
    // Annualisation factor: sqrt(1440) assumes one trade per minute (cron runs every minute).
    // In practice trades are less frequent, so the actual annualised Sharpe will be lower.
    // This figure should be treated as an order-of-magnitude indicator only.
    const variance = pnls.reduce((s, p) => s + (p - avgPnl) ** 2, 0) / total;
    const stdDev   = Math.sqrt(variance);
    const sharpe   = stdDev > 0 ? (avgPnl / stdDev) * Math.sqrt(1440) : 0;

    return {
      total_trades: total,
      win_trades: wins,
      loss_trades: total - wins,
      win_rate: wins / total,
      avg_pnl_usd: avgPnl,
      best_trade_usd: best,
      worst_trade_usd: worst,
      max_drawdown_usd: maxDrawdown,
      total_pnl_usd: totalPnl,
      sharpe
    };
  } catch (e) {
    console.error('[DB] getPerformanceMetrics error:', e.message);
    return empty;
  }
}

/**
 * Returns all trades within the given date range (for CSV export).
 */
export async function exportTrades(env, fromMs = 0, toMs = Date.now()) {
  if (!env.DB) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM trades WHERE created_at >= ? AND created_at <= ? ORDER BY created_at ASC`
    ).bind(fromMs, toMs).all();
    return results || [];
  } catch (e) {
    console.error('[DB] exportTrades error:', e.message);
    return [];
  }
}

// ── Paper position tracking ───────────────────────────────────────────────────

/**
 * Records a newly opened paper position.
 */
export async function openPaperPosition(env, opp, sizeUsd) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO paper_positions
         (strategy, symbol, direction, size_usd, entry_price, buy_exchange, sell_exchange, opened_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      opp.strategy, opp.symbol, opp.direction,
      sizeUsd, opp.buyPrice,
      opp.buyExchange, opp.sellExchange,
      Date.now()
    ).run();
  } catch (e) { console.error('[DB] openPaperPosition error:', e.message); }
}

/**
 * Fetches all currently open (unresolved) paper positions.
 */
export async function getOpenPaperPositions(env) {
  if (!env.DB) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM paper_positions WHERE closed_at IS NULL ORDER BY opened_at ASC`
    ).all();
    return results || [];
  } catch (e) {
    console.error('[DB] getOpenPaperPositions error:', e.message);
    return [];
  }
}

/**
 * Closes a paper position, recording the exit price and realised P&L.
 */
export async function closePaperPosition(env, id, exitPrice, pnlUsd) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `UPDATE paper_positions SET closed_at = ?, exit_price = ?, pnl_usd = ? WHERE id = ?`
    ).bind(Date.now(), exitPrice, pnlUsd, id).run();
  } catch (e) { console.error('[DB] closePaperPosition error:', e.message); }
}
