// nexus/src/backtest.js — Backtesting Engine
//
// Replays stored trade history (or simulated price sequences) using configurable
// strategy parameters, computes comprehensive performance metrics, and stores
// results in D1.
//
// Design constraints:
//  - Pure JS, no external libraries, runs in Cloudflare Worker environment
//  - Works on real D1 trade data or synthetic price sequences
//  - Returns metrics compatible with the dashboard's reporting format

// ── Performance metrics ───────────────────────────────────────────────────────

/**
 * Computes a full suite of performance statistics from an ordered array of
 * trade P&L values (in USD).
 *
 * @param {number[]} pnls  — trade P&L values in chronological order
 * @returns {object}
 */
export function computeMetrics(pnls) {
  if (!pnls || pnls.length === 0) {
    return {
      total_trades: 0, win_trades: 0, loss_trades: 0,
      win_rate: 0, avg_pnl_usd: 0,
      best_trade_usd: 0, worst_trade_usd: 0,
      max_drawdown_usd: 0, max_drawdown_pct: 0,
      total_pnl_usd: 0, sharpe: 0, sortino: 0,
      profit_factor: 0, expectancy: 0,
      equity_peak: 0
    };
  }

  const total     = pnls.length;
  const wins      = pnls.filter(p => p > 0);
  const losses    = pnls.filter(p => p <= 0);
  const totalPnl  = pnls.reduce((s, p) => s + p, 0);
  const avgPnl    = totalPnl / total;
  const best      = Math.max(...pnls);
  const worst     = Math.min(...pnls);

  // Max drawdown (peak-to-trough on cumulative equity curve)
  let peak = 0, cumPnl = 0, maxDD = 0;
  let peakEquity = 0;
  for (const p of pnls) {
    cumPnl += p;
    if (cumPnl > peak) { peak = cumPnl; peakEquity = peak; }
    const dd = peak - cumPnl;
    if (dd > maxDD) maxDD = dd;
  }
  const maxDDPct = peakEquity > 0 ? (maxDD / peakEquity) * 100 : 0;

  // Sharpe ratio (annualised). Annualization factor = sqrt(1440) assumes the scan
  // cycle runs once per minute (1440 minutes/day × 365 days annualises daily trades).
  // Adjust if your SCAN_INTERVAL_MS differs significantly from 60 000 ms.
  const annFactor = Math.sqrt(1440); // configurable: sqrt(tradesPerYear) for your scan rate
  const variance  = pnls.reduce((s, p) => s + (p - avgPnl) ** 2, 0) / total;
  const stdDev    = Math.sqrt(variance);
  const sharpe    = stdDev > 0 ? (avgPnl / stdDev) * annFactor : 0;

  // Sortino ratio (downside deviation only, same annualization factor)
  const negPnls       = pnls.filter(p => p < 0);
  const downVariance  = negPnls.length > 0
    ? negPnls.reduce((s, p) => s + p ** 2, 0) / negPnls.length
    : 0;
  const downStdDev    = Math.sqrt(downVariance);
  const sortino       = downStdDev > 0 ? (avgPnl / downStdDev) * annFactor : 0;

  // Profit factor: gross wins / |gross losses|
  const grossWin  = wins.reduce((s, p) => s + p, 0);
  const grossLoss = Math.abs(losses.reduce((s, p) => s + p, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;

  // Expectancy per trade
  const winRate  = wins.length / total;
  const avgWin   = wins.length > 0  ? grossWin  / wins.length   : 0;
  const avgLoss  = losses.length > 0 ? grossLoss / losses.length : 0;
  const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;

  return {
    total_trades:      total,
    win_trades:        wins.length,
    loss_trades:       losses.length,
    win_rate:          winRate,
    avg_pnl_usd:       avgPnl,
    best_trade_usd:    best,
    worst_trade_usd:   worst,
    max_drawdown_usd:  maxDD,
    max_drawdown_pct:  maxDDPct,
    total_pnl_usd:     totalPnl,
    sharpe,
    sortino,
    profit_factor:     profitFactor,
    expectancy,
    equity_peak:       peakEquity
  };
}

// ── Simulation helpers ────────────────────────────────────────────────────────

/**
 * Monte Carlo simulation: runs N resamplings of the trade P&L sequence.
 * Returns the 5th, 50th, and 95th percentile final equity outcomes.
 *
 * @param {number[]} pnls         — historical P&L values
 * @param {number}   initialCapital — starting capital
 * @param {number}   simulations  — number of Monte Carlo paths (default 1000)
 * @returns {{ p5: number, p50: number, p95: number, worst: number, best: number }}
 */
export function monteCarloSimulation(pnls, initialCapital = 1000, simulations = 500) {
  if (pnls.length === 0) return { p5: 0, p50: 0, p95: 0, worst: 0, best: 0 };

  const finalEquities = [];

  for (let sim = 0; sim < simulations; sim++) {
    let equity = initialCapital;
    // Resample with replacement
    for (let i = 0; i < pnls.length; i++) {
      const randomIdx = Math.floor(Math.random() * pnls.length);
      equity += pnls[randomIdx];
    }
    finalEquities.push(equity);
  }

  finalEquities.sort((a, b) => a - b);

  const idx5  = Math.floor(simulations * 0.05);
  const idx50 = Math.floor(simulations * 0.50);
  const idx95 = Math.floor(simulations * 0.95);

  return {
    p5:    finalEquities[idx5],
    p50:   finalEquities[idx50],
    p95:   finalEquities[idx95],
    worst: finalEquities[0],
    best:  finalEquities[finalEquities.length - 1]
  };
}

// ── Parameter sweep ───────────────────────────────────────────────────────────

/**
 * Walks through the stored trades with different risk-parameter settings and
 * returns which configuration produces the highest Sharpe ratio.
 *
 * Tested dimensions:
 *   - minNetPct: minimum net profit threshold to take a trade
 *   - positionFraction: fraction of equity per trade
 *
 * @param {Array}  trades           — raw D1 trade rows (strategy, size_usd, net_profit_percent)
 * @param {number} initialCapital   — starting capital
 * @returns {{ best: object, results: Array }}
 */
export function parameterSweep(trades, initialCapital = 1000) {
  const minNetPctOptions    = [0, 0.02, 0.05, 0.1, 0.2, 0.5];
  const positionFracOptions = [0.05, 0.1, 0.15, 0.20];

  const results = [];

  for (const minNet of minNetPctOptions) {
    for (const posFrac of positionFracOptions) {
      let equity = initialCapital;
      const pnls = [];

      for (const t of trades) {
        const netPct = t.net_profit_percent;
        if (netPct < minNet) continue;  // filter below-threshold trades

        const sizeUsd = equity * posFrac;
        const tradePnl = sizeUsd * netPct / 100;
        equity += tradePnl;
        pnls.push(tradePnl);
      }

      const metrics = computeMetrics(pnls);
      results.push({
        params: { minNetPct: minNet, positionFrac: posFrac },
        metrics,
        final_equity: equity,
        return_pct: ((equity - initialCapital) / initialCapital) * 100
      });
    }
  }

  // Rank by Sharpe ratio (prefer higher Sharpe; use total P&L as tiebreaker)
  results.sort((a, b) =>
    b.metrics.sharpe !== a.metrics.sharpe
      ? b.metrics.sharpe - a.metrics.sharpe
      : b.metrics.total_pnl_usd - a.metrics.total_pnl_usd
  );

  return { best: results[0], results };
}

// ── Strategy isolation ────────────────────────────────────────────────────────

/**
 * Computes per-strategy performance from a mixed trade array.
 *
 * @param {Array} trades — raw D1 rows
 * @returns {object} keyed by strategy prefix ('cex', 'dex', 'perps', 'funding', 'triangular', 'statistical')
 */
export function strategyBreakdown(trades) {
  const groups = {};

  for (const t of trades) {
    const prefix = (t.strategy || 'unknown').split(':')[0].toLowerCase();
    if (!groups[prefix]) groups[prefix] = [];
    const pnl = (t.size_usd * t.net_profit_percent) / 100;
    groups[prefix].push(pnl);
  }

  const result = {};
  for (const [key, pnls] of Object.entries(groups)) {
    result[key] = computeMetrics(pnls);
  }
  return result;
}

// ── Main backtest runner ──────────────────────────────────────────────────────

/**
 * Runs a full backtest on the stored trade history.
 *
 * @param {object} env     — Cloudflare Worker env (DB binding)
 * @param {object} config  — {
 *   from_ms?:         start timestamp (default: 30 days ago),
 *   to_ms?:           end timestamp (default: now),
 *   initial_capital?: starting capital in USDT (default: 1000),
 *   min_net_pct?:     minimum net profit filter (default: 0),
 *   position_frac?:   position size as fraction of equity (default: 0.10),
 *   strategies?:      ['cex','dex','perps'] filter array (empty = all),
 *   run_monte_carlo?: boolean (default: true),
 *   run_param_sweep?: boolean (default: false)
 * }
 * @returns {object} backtest results
 */
export async function runBacktest(env, config = {}) {
  const {
    from_ms         = Date.now() - 30 * 24 * 60 * 60 * 1000,
    to_ms           = Date.now(),
    initial_capital = 1000,
    min_net_pct     = 0,
    position_frac   = 0.10,
    strategies      = [],
    run_monte_carlo = true,
    run_param_sweep = false
  } = config;

  // ── Load raw trades from D1 ──────────────────────────────────────────────
  let trades = [];
  if (env?.DB) {
    try {
      const { results } = await env.DB.prepare(
        `SELECT strategy, size_usd, net_profit_percent, mode, created_at
         FROM trades
         WHERE created_at >= ? AND created_at <= ?
         ORDER BY created_at ASC`
      ).bind(from_ms, to_ms).all();
      trades = results || [];
    } catch (e) {
      console.error('[Backtest] DB load error:', e.message);
    }
  }

  // ── Strategy filter ──────────────────────────────────────────────────────
  if (strategies.length > 0) {
    trades = trades.filter(t =>
      strategies.some(s => (t.strategy || '').toLowerCase().startsWith(s.toLowerCase()))
    );
  }

  // ── Filter by minimum net profit ─────────────────────────────────────────
  if (min_net_pct > 0) {
    trades = trades.filter(t => t.net_profit_percent >= min_net_pct);
  }

  // ── Simulate equity curve with position_frac ─────────────────────────────
  let equity = initial_capital;
  const pnls = [];
  const equityCurve = [{ t: from_ms, equity }];

  for (const trade of trades) {
    const sizeUsd = equity * position_frac;
    const tradePnl = sizeUsd * trade.net_profit_percent / 100;
    equity += tradePnl;
    pnls.push(tradePnl);
    equityCurve.push({ t: trade.created_at, equity });
  }

  // ── Metrics ──────────────────────────────────────────────────────────────
  const metrics   = computeMetrics(pnls);
  const breakdown = strategyBreakdown(trades);

  // ── Monte Carlo ──────────────────────────────────────────────────────────
  const monteCarlo = run_monte_carlo
    ? monteCarloSimulation(pnls, initial_capital)
    : null;

  // ── Parameter sweep ───────────────────────────────────────────────────────
  const sweep = run_param_sweep
    ? parameterSweep(trades, initial_capital)
    : null;

  const results = {
    config: { from_ms, to_ms, initial_capital, min_net_pct, position_frac, strategies },
    trade_count:    trades.length,
    filtered_count: pnls.length,
    final_equity:   equity,
    return_pct:     ((equity - initial_capital) / initial_capital) * 100,
    metrics,
    strategy_breakdown: breakdown,
    equity_curve:   equityCurve.slice(-200), // cap curve to 200 points for response size
    monte_carlo:    monteCarlo,
    param_sweep:    sweep,
    generated_at:   Date.now()
  };

  // ── Persist to D1 ────────────────────────────────────────────────────────
  if (env?.DB) {
    try {
      await env.DB.prepare(
        `INSERT INTO backtest_runs (config, results, created_at) VALUES (?, ?, ?)`
      ).bind(
        JSON.stringify(config),
        JSON.stringify({ metrics, final_equity: equity, return_pct: results.return_pct }),
        Date.now()
      ).run();
    } catch (_) { /* table may not exist yet — schema init will handle it */ }
  }

  return results;
}
