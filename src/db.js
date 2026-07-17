// nexus/src/db.js — D1 database helpers + Analytics Engine integration

import { schemaSQL } from '../migrations/schema.js';

// ── Auto-schema initialisation ────────────────────────────────────────────────
// Creates all D1 tables and indexes on first use so the Worker is self-healing:
// the schema is applied automatically even when the manual migration step was
// skipped.  The promise is memoised per Worker instance — subsequent requests
// within the same isolate are no-ops.
// Schema SQL is imported from migrations/schema.js (single source of truth).
let _schemaInitPromise = null;

export function ensureSchema(env) {
  if (!env.DB) return Promise.resolve();
  if (_schemaInitPromise) return _schemaInitPromise;
  _schemaInitPromise = (async () => {
    // D1's exec() does not reliably handle multi-statement SQL, so split the
    // schema string into individual statements and run them via batch().
    const stmts = schemaSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    await env.DB.batch(stmts.map(s => env.DB.prepare(s)));

    // Resilience indexes may already exist or ship inline/out-of-band in legacy
    // migration files. Ensure them idempotently so init never hard-fails.
    try {
      const indexes = env.DB.prepare(
        `CREATE INDEX IF NOT EXISTS idx_backup_status ON backup_positions(status);`
      );
      await indexes.run().catch(() => {});
    } catch {}
    try {
      const symIdx = env.DB.prepare(
        `CREATE INDEX IF NOT EXISTS idx_backup_symbol ON backup_positions(symbol);`
      );
      await symIdx.run().catch(() => {});
    } catch {}
    try {
      const tsIdx = env.DB.prepare(
        `CREATE INDEX IF NOT EXISTS idx_backup_timestamp ON backup_prices(timestamp);`
      );
      await tsIdx.run().catch(() => {});
    } catch {}
  })().catch(e => {
    _schemaInitPromise = null; // allow retry on the next request
    console.error('[DB] ensureSchema error:', e.message);
    throw e; // propagate so the middleware can log / handle
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
    const q = env.DB.prepare(
      `SELECT id, strategy, size_usd, net_profit_percent, mode, created_at FROM trades ORDER BY created_at DESC LIMIT ?`
    ).bind(limit);
    const { results } = await q.all();
    if (!results || results.length === 0) {
      const count = await env.DB.prepare('SELECT COUNT(*) as cnt FROM trades').first().catch(() => null);
      console.warn('[DB] getRecentTrades empty, total trades in DB:', count);
    }
    return Array.isArray(results) ? results : [];
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

/**
 * Returns the most recent backtest run results (for the dashboard).
 */
export async function getRecentBacktestRuns(env, limit = 5) {
  if (!env.DB) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, config, results, created_at FROM backtest_runs ORDER BY created_at DESC LIMIT ?`
    ).bind(limit).all();
    return (results || []).map(r => ({
      ...r,
      config:  JSON.parse(r.config  || '{}'),
      results: JSON.parse(r.results || '{}')
    }));
  } catch (e) {
    console.error('[DB] getRecentBacktestRuns error:', e.message);
    return [];
  }
}

// ── Profit Engine tables ──────────────────────────────────────────────────────

export async function logOpportunity(env, opp) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO opportunities (symbol, strategy, buy_exchange, sell_exchange, gross_pct, net_pct, safety_factor, price_buy, price_sell, est_fee_usd, est_slippage_usd, size_usd, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      opp.symbol, opp.strategy, opp.buyExchange, opp.sellExchange,
      Number(opp.grossPct || 0), Number(opp.netPct || 0),
      Number(opp.safetyFactor || 0),
      Number(opp.buyPrice || 0), Number(opp.sellPrice || 0),
      Number(opp.estFeeUsd || 0), Number(opp.estSlippageUsd || 0),
      Number(opp.sizeUsd || 0), 'open', Date.now(), Date.now() + 60_000
    ).run();
  } catch (e) { console.error('[DB] logOpportunity error:', e.message); }
}

export async function updateOpportunityStatus(env, id, status, reason = null) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`UPDATE opportunities SET status=?, rejected_reason=? WHERE id=?`)
      .bind(status, reason, id).run();
  } catch (e) { console.error('[DB] updateOpportunityStatus error:', e.message); }
}

export async function getOpenOpportunities(env, limit = 50) {
  if (!env.DB) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM opportunities WHERE status='open' ORDER BY created_at DESC LIMIT ?`
    ).bind(limit).all();
    return results || [];
  } catch (e) { console.error('[DB] getOpenOpportunities error:', e.message); return []; }
}

export async function recordPerformanceSnapshot(env, metrics = {}) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO performance_snapshots (total_pnl_usd, equity_usd, daily_pnl_usd, total_trades, win_trades, loss_trades, win_rate, max_drawdown_usd, sharpe, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      Number(metrics.total_pnl_usd || 0), Number(metrics.equity_usd || 0),
      Number(metrics.daily_pnl_usd || 0),
      Number(metrics.total_trades || 0), Number(metrics.win_trades || 0),
      Number(metrics.loss_trades || 0), Number(metrics.win_rate || 0),
      Number(metrics.max_drawdown_usd || 0), Number(metrics.sharpe || 0),
      Date.now()
    ).run();
  } catch (e) { console.error('[DB] recordPerformanceSnapshot error:', e.message); }
}

export async function getPerformanceHistory(env, limit = 200) {
  if (!env.DB) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM performance_snapshots ORDER BY created_at DESC LIMIT ?`
    ).bind(limit).all();
    return results || [];
  } catch (e) { console.error('[DB] getPerformanceHistory error:', e.message); return []; }
}

export async function upsertStrategyInsight(env, insight = {}) {
  if (!env.DB) return;
  try {
    const existing = await env.DB.prepare(
      `SELECT id, sample_size, avg_net_pct, win_rate FROM strategy_insights WHERE strategy=? AND symbol=? AND exchange_pair=? AND direction=?`
    ).bind(insight.strategy, insight.symbol, insight.exchange_pair, insight.direction).first();

    if (existing) {
      const n = Number(existing.sample_size || 0);
      const avgNet = Number(existing.avg_net_pct || 0);
      const avgGross = Number(existing.avg_gross_pct || 0);
      const avgSlip = Number(existing.avg_slippage_pct || 0);
      const winRate = Number(existing.win_rate || 0);
      const profitFactor = Number(existing.profit_factor || 0);
      const sampleSize = n + 1;

      const newAvgNet = (avgNet * n + Number(insight.net_pct || 0)) / sampleSize;
      const newAvgGross = (avgGross * n + Number(insight.gross_pct || 0)) / sampleSize;
      const newAvgSlip = (avgSlip * n + Number(insight.slippage_pct || 0)) / sampleSize;
      const newWinRate = (winRate * n + (insight.outcome === 'win' ? 1 : 0)) / sampleSize;
      const newProfitFactor = profitFactor > 0 ? profitFactor * 0.95 + Number(insight.net_pct || 0) * 0.05 : Number(insight.net_pct || 0);
      const confidence = Math.min(0.99, sampleSize / 100);
      const Kelly = newWinRate > 0 ? Math.max(0, (newWinRate * (1 + newAvgNet / 100) - (1 - newWinRate)) / (1 + newAvgNet / 100)) : 0;

      await env.DB.prepare(
        `UPDATE strategy_insights SET sample_size=?, avg_net_pct=?, avg_gross_pct=?, avg_slippage_pct=?, win_rate=?, profit_factor=?, confidence=?, Kelly=?, last_updated=?
         WHERE id=?`
      ).bind(sampleSize, newAvgNet, newAvgGross, newAvgSlip, newWinRate, newProfitFactor, confidence, Kelly, Date.now(), existing.id).run();
    } else {
      const sampleSize = 1;
      const confidence = 0.1;
      const Kelly = insight.outcome === 'win' ? 0.01 : 0;
      await env.DB.prepare(
        `INSERT INTO strategy_insights (strategy, symbol, exchange_pair, direction, sample_size, avg_net_pct, avg_gross_pct, avg_slippage_pct, win_rate, profit_factor, confidence, Kelly, last_updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        insight.strategy, insight.symbol, insight.exchange_pair, insight.direction,
        sampleSize,
        Number(insight.net_pct || 0), Number(insight.gross_pct || 0), Number(insight.slippage_pct || 0),
        insight.outcome === 'win' ? 1 : 0,
        Number(insight.net_pct || 0),
        confidence, Kelly, Date.now()
      ).run();
    }
  } catch (e) { console.error('[DB] upsertStrategyInsight error:', e.message); }
}

export async function getStrategyInsights(env, strategy = null, limit = 50) {
  if (!env.DB) return [];
  try {
    const sql = strategy
      ? `SELECT * FROM strategy_insights WHERE strategy=? ORDER BY last_updated DESC LIMIT ?`
      : `SELECT * FROM strategy_insights ORDER BY last_updated DESC LIMIT ?`;
    const { results } = strategy
      ? await env.DB.prepare(sql).bind(strategy, limit).all()
      : await env.DB.prepare(sql).bind(limit).all();
    return results || [];
  } catch (e) { console.error('[DB] getStrategyInsights error:', e.message); return []; }
}

export async function auditOpportunity(env, opportunityId, action, reason = null, pnlUsd = null, latencyMs = null) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO opportunity_audit (opportunity_id, action, reason, pnl_usd, latency_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(opportunityId, action, reason, pnlUsd, latencyMs, Date.now()).run();
  } catch (e) { console.error('[DB] auditOpportunity error:', e.message); }
}

export async function getOpportunityStats(env) {
  if (!env.DB) return {};
  try {
    const byStrategy = await env.DB.prepare(
      `SELECT strategy, COUNT(*) as cnt, AVG(net_pct) as avg_net_pct, SUM(CASE WHEN executed=1 THEN 1 ELSE 0 END) as executed_count
       FROM opportunities GROUP BY strategy`
    ).all();
    const byPair = await env.DB.prepare(
      `SELECT exchange_pair, COUNT(*) as cnt, AVG(net_pct) as avg_net_pct
       FROM (SELECT buy_exchange || '->' || sell_exchange as exchange_pair, net_pct FROM opportunities)
       GROUP BY exchange_pair ORDER BY cnt DESC LIMIT 10`
    ).all();
    return { byStrategy: byStrategy.results || [], byPair: byPair.results || [] };
  } catch (e) { console.error('[DB] getOpportunityStats error:', e.message); return {}; }
}
