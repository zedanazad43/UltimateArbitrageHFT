#!/usr/bin/env node

const fs = await import('node:fs/promises');
const path = await import('node:path');

const args = process.argv.slice(2);
function getArg(name, fallback = null) {
  const i = args.lastIndexOf(name);
  if (i === -1 || i + 1 >= args.length) return fallback;
  return args[i + 1];
}

function boolArg(name, fallback = false) {
  const v = getArg(name, null);
  if (v === null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

const BASE_URL = getArg('--base', process.env.BASE_URL || 'https://ultimatearbitragehft.zedanazad43.workers.dev').replace(/\/+$/, '');
const TOKEN = process.env.WORKFLOW_ADMIN_TOKEN || process.env.ADMIN_TOKEN || getArg('--token', null);
const HOURS = Number(getArg('--hours', '6'));
const INTERVAL_MS = Number(getArg('--interval-ms', '300000'));
const RUN_WINDOW = boolArg('--run-window', false);

if (!TOKEN) {
  console.error('Missing ADMIN_TOKEN / WORKFLOW_ADMIN_TOKEN');
  process.exit(1);
}

if (!Number.isFinite(HOURS) || HOURS <= 0) {
  console.error('Invalid --hours');
  process.exit(1);
}

if (!Number.isFinite(INTERVAL_MS) || INTERVAL_MS < 1000) {
  console.error('Invalid --interval-ms');
  process.exit(1);
}

const headers = {
  'x-admin-token': TOKEN,
  'content-type': 'application/json',
};

function tsMs(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw > 1e12 ? raw : raw * 1000;
  if (typeof raw === 'string') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000;
    const d = Date.parse(raw);
    if (Number.isFinite(d)) return d;
  }
  return null;
}

async function fetchJson(pathname) {
  const url = `${BASE_URL}${pathname}`;
  const resp = await fetch(url, { headers });
  const text = await resp.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { parseError: true, raw: text.slice(0, 400) };
  }
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${pathname}: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

function summarizeWindow(trades, nowMs, hours) {
  const from = nowMs - (hours * 3600 * 1000);
  const windowTrades = trades.filter((t) => {
    const tms = tsMs(t.timestamp ?? t.created_at ?? t.time ?? t.ts);
    return tms && tms >= from;
  });

  const byMode = {};
  const byStrategy = {};
  let sumNet = 0;
  let netN = 0;
  for (const t of windowTrades) {
    const mode = String(t.mode || 'unknown').toLowerCase();
    byMode[mode] = (byMode[mode] || 0) + 1;
    const strategy = String(t.strategy || 'unknown').toLowerCase();
    byStrategy[strategy] = (byStrategy[strategy] || 0) + 1;
    const net = Number(t.net_profit_percent ?? t.netPct ?? t.net_pct ?? NaN);
    if (Number.isFinite(net)) {
      sumNet += net;
      netN += 1;
    }
  }

  const top = Object.entries(byStrategy).sort((a, b) => b[1] - a[1])[0] || null;

  return {
    hours,
    trades: windowTrades.length,
    byMode,
    byStrategy,
    avgNetPct: netN ? Number((sumNet / netN).toFixed(6)) : null,
    bestStrategyByCount: top ? { strategy: top[0], count: top[1] } : null,
  };
}

async function takeSnapshot(label) {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const [status, readiness, execution, tradesPayload, memoryPayload] = await Promise.all([
    fetchJson('/api/status'),
    fetchJson('/api/readiness'),
    fetchJson('/api/execution-health'),
    fetchJson('/api/trades?limit=500'),
    fetchJson('/api/memory'),
  ]);

  const trades = Array.isArray(tradesPayload?.data) ? tradesPayload.data : [];
  const windowSummary = summarizeWindow(trades, nowMs, HOURS);
  const memSummary = memoryPayload?.summary || {};

  const snapshot = {
    label,
    ts: nowIso,
    live: {
      tradingEnabled: status?.trading_enabled === true,
      paperTrading: status?.paper_trading !== false,
      readyForLive: readiness?.readyForLive === true,
      noOpportunityStreak: Number(status?.no_opportunity_streak || 0),
      dailyTrades: Number(status?.daily_trades || 0),
      dailyPnl: Number(status?.daily_pnl || 0),
      totalTrades: Number(status?.total_trades || 0),
      totalPnl: Number(status?.total_pnl || 0),
      maxSpreadPct: Number(status?.max_spread_pct || 0),
      maxDynamicSymbols: Number(status?.max_dynamic_symbols || 0),
      scanSymbolMode: status?.scan_symbol_mode || null,
      strategyFlags: status?.strategy_flags || null,
      openPositions: Number(execution?.openPositions || 0),
    },
    window: windowSummary,
    memory: {
      hasData: !!memSummary?.hasData,
      leader: memSummary?.leader || null,
      laggard: memSummary?.laggard || null,
      strategyWeights: memSummary?.strategyWeights || null,
      recommendations: memSummary?.recommendations || [],
    },
  };

  return snapshot;
}

function buildComparison(before, after) {
  const b = before.window;
  const a = after.window;
  return {
    windowHours: HOURS,
    before: b,
    after: a,
    delta: {
      trades: (a.trades || 0) - (b.trades || 0),
      avgNetPct: Number(((a.avgNetPct || 0) - (b.avgNetPct || 0)).toFixed(6)),
    },
    streakDelta: Number(after.live.noOpportunityStreak || 0) - Number(before.live.noOpportunityStreak || 0),
    bestStrategyBefore: b.bestStrategyByCount,
    bestStrategyAfter: a.bestStrategyByCount,
    memoryLeaderAfter: after.memory?.leader || null,
  };
}

async function writeOutputs(payload) {
  const outDir = path.resolve(process.cwd(), 'logs');
  await fs.mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[.:]/g, '-');
  const jsonPath = path.join(outDir, `feasibility-window-${stamp}.json`);
  await fs.writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const mdPath = path.join(outDir, `feasibility-window-${stamp}.md`);
  const md = [
    `# Feasibility Window Report (${HOURS}h)`,
    '',
    `- Started: ${payload.startedAt}`,
    `- Ended: ${payload.endedAt}`,
    '',
    '## Before',
    `- Trades: ${payload.before.window.trades}`,
    `- Avg Net %: ${payload.before.window.avgNetPct ?? 'n/a'}`,
    `- Best Strategy: ${payload.before.window.bestStrategyByCount?.strategy || 'n/a'}`,
    '',
    '## After',
    `- Trades: ${payload.after.window.trades}`,
    `- Avg Net %: ${payload.after.window.avgNetPct ?? 'n/a'}`,
    `- Best Strategy: ${payload.after.window.bestStrategyByCount?.strategy || 'n/a'}`,
    '',
    '## Delta',
    `- Trades Δ: ${payload.comparison.delta.trades}`,
    `- Avg Net % Δ: ${payload.comparison.delta.avgNetPct}`,
    `- No-op streak Δ: ${payload.comparison.streakDelta}`,
    `- Memory leader (after): ${payload.comparison.memoryLeaderAfter?.strategy || 'n/a'}`,
    '',
  ].join('\n');
  await fs.writeFile(mdPath, `${md}\n`, 'utf8');

  return { jsonPath, mdPath };
}

async function sleep(ms) {
  await new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

async function run() {
  const startedAt = new Date().toISOString();
  const before = await takeSnapshot('before');

  if (RUN_WINDOW) {
    const loops = Math.max(1, Math.floor((HOURS * 3600 * 1000) / INTERVAL_MS));
    for (let i = 0; i < loops; i++) {
      const live = await fetchJson('/api/status').catch(() => null);
      const row = {
        ts: new Date().toISOString(),
        i: i + 1,
        tradingEnabled: live?.trading_enabled === true,
        noOpportunityStreak: Number(live?.no_opportunity_streak || 0),
        dailyTrades: Number(live?.daily_trades || 0),
        dailyPnl: Number(live?.daily_pnl || 0),
      };
      console.log(`WINDOW_SAMPLE ${JSON.stringify(row)}`);
      if (i < loops - 1) {
        await sleep(INTERVAL_MS);
      }
    }
  }

  const after = await takeSnapshot('after');
  const comparison = buildComparison(before, after);
  const endedAt = new Date().toISOString();

  const payload = {
    startedAt,
    endedAt,
    baseUrl: BASE_URL,
    hours: HOURS,
    intervalMs: INTERVAL_MS,
    before,
    after,
    comparison,
  };

  const out = await writeOutputs(payload);
  console.log(`FEASIBILITY_REPORT_JSON ${out.jsonPath}`);
  console.log(`FEASIBILITY_REPORT_MD ${out.mdPath}`);
  console.log(`FEASIBILITY_COMPARISON ${JSON.stringify(comparison)}`);
}

run().catch((err) => {
  console.error(`feasibility-window-report failed: ${err.message}`);
  process.exit(1);
});
