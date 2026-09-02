#!/usr/bin/env node
// scripts/backtest-automated.js
//
// Automated backtesting scheduler for UltimateArbitrageHFT.
// Calls POST /api/backtest on schedule, stores results, and alerts if performance degrades.
//
// Usage:
//   node scripts/backtest-automated.js --interval-hours 24 --capital 1000
//   node scripts/backtest-automated.js --once                          (single run)
//   node scripts/backtest-automated.js --interval-hours 6 --alert-pnl -50  (alert if PnL < -$50)
//
// Env vars (can also set in wrangler.toml or .dev.vars):
//   BACKTEST_AUTO_ENABLED=true          — enable automated backtesting
//   BACKTEST_AUTO_INTERVAL_HOURS=24     — run every N hours
//   ADMIN_TOKEN                         — auth token for API calls
//   WORKER_URL                          — base URL of the deployed worker

const BASE_URL = process.env.WORKER_URL || 'https://ultimatearbitragehft.zedanazad43.workers.dev';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const BACKTEST_ENABLED = String(process.env.BACKTEST_AUTO_ENABLED || 'true').toLowerCase() !== 'false';
const INTERVAL_HOURS = Number(process.env.BACKTEST_AUTO_INTERVAL_HOURS) || 24;

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = { once: false, intervalHours: INTERVAL_HOURS, capital: 1000, alertPnl: null };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--once') opts.once = true;
        if (args[i] === '--interval-hours' && args[i + 1]) opts.intervalHours = Number(args[++i]);
        if (args[i] === '--capital' && args[i + 1]) opts.capital = Number(args[++i]);
        if (args[i] === '--alert-pnl' && args[i + 1]) opts.alertPnl = Number(args[++i]);
    }
    return opts;
}

async function runBacktest(capital, lookbackDays = 30) {
    const toMs = Date.now();
    const fromMs = toMs - lookbackDays * 24 * 60 * 60 * 1000;

    console.log(`[backtest] Running backtest for last ${lookbackDays} days (capital: $${capital})...`);

    const resp = await fetch(`${BASE_URL}/api/backtest`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-admin-token': ADMIN_TOKEN,
        },
        body: JSON.stringify({
            from_ms: fromMs,
            to_ms: toMs,
            initial_capital: capital,
            run_monte_carlo: true,
            run_param_sweep: true,
        }),
    });

    if (!resp.ok) {
        const err = await resp.text().catch(() => 'Unknown error');
        throw new Error(`Backtest API returned ${resp.status}: ${err.slice(0, 200)}`);
    }

    return resp.json();
}

function formatResults(results) {
    const { return_pct, trade_count, sharpe_ratio, max_drawdown_pct, total_pnl, strategy_breakdown } = results;

    console.log('\n═══════════════════════════════════════════');
    console.log('  Automated Backtest Results');
    console.log('═══════════════════════════════════════════');
    console.log(`  Period:      30 days`);
    console.log(`  Trades:      ${trade_count || 0}`);
    console.log(`  Total PnL:   $${(total_pnl || 0).toFixed(2)}`);
    console.log(`  Return:      ${(return_pct || 0).toFixed(2)}%`);
    console.log(`  Sharpe:      ${(sharpe_ratio || 0).toFixed(3)}`);
    console.log(`  Max DD:      ${(max_drawdown_pct || 0).toFixed(2)}%`);
    console.log('───────────────────────────────────────────');

    if (strategy_breakdown && typeof strategy_breakdown === 'object') {
        console.log('  Strategy Breakdown:');
        for (const [name, stats] of Object.entries(strategy_breakdown)) {
            const winRate = stats.trades > 0 ? ((stats.wins / stats.trades) * 100).toFixed(0) : 'N/A';
            console.log(`    ${name.padEnd(16)} ${String(stats.trades).padStart(4)} trades | PnL: $${(stats.pnl || 0).toFixed(2).padStart(8)} | WR: ${winRate}%`);
        }
    }
    console.log('═══════════════════════════════════════════\n');

    return { return_pct, trade_count, total_pnl, max_drawdown_pct };
}

async function main() {
    const opts = parseArgs();

    if (!BACKTEST_ENABLED) {
        console.log('[backtest] BACKTEST_AUTO_ENABLED is false — exiting.');
        process.exit(0);
    }

    if (!ADMIN_TOKEN) {
        console.error('[backtest] ADMIN_TOKEN not set. Set it via environment variable.');
        process.exit(1);
    }

    if (opts.once) {
        try {
            const results = await runBacktest(opts.capital);
            const summary = formatResults(results);

            if (opts.alertPnl !== null && summary.total_pnl < opts.alertPnl) {
                console.error(`[ALERT] Backtest PnL ($${summary.total_pnl.toFixed(2)}) below threshold ($${opts.alertPnl.toFixed(2)})!`);
                process.exit(2);
            }
        } catch (e) {
            console.error('[backtest] Error:', e.message);
            process.exit(1);
        }
        return;
    }

    console.log(`[backtest] Starting automated backtesting every ${opts.intervalHours}h (Ctrl+C to stop)...`);
    console.log(`[backtest] URL: ${BASE_URL}`);

    async function loop() {
        try {
            const results = await runBacktest(opts.capital);
            const summary = formatResults(results);

            if (opts.alertPnl !== null && summary.total_pnl < opts.alertPnl) {
                console.error(`[ALERT] Backtest PnL ($${summary.total_pnl.toFixed(2)}) below threshold ($${opts.alertPnl.toFixed(2)})!`);
            }

            console.log(`[backtest] Next run in ${opts.intervalHours}h (at ${new Date(Date.now() + opts.intervalHours * 3600_000).toISOString()})`);
        } catch (e) {
            console.error('[backtest] Error:', e.message);
        }
    }

    // Run immediately, then on interval
    await loop();
    setInterval(loop, opts.intervalHours * 3_600_000);
}

main().catch(e => { console.error('[backtest] Fatal:', e.message); process.exit(1); });
