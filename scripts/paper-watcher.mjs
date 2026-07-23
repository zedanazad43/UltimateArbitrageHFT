import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://ultimatearbitragehft.zedanazad43.workers.dev';
const TOKEN = '309400';
const REPORT_DIR = path.join(process.cwd(), '.archive', 'test_reports');

function httpsGet(urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const req = https.request({ hostname: url.hostname, path: url.pathname, method: 'GET', headers: { 'x-admin-token': TOKEN } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

function httpsPost(urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const payload = JSON.stringify(body || {});
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { 'x-admin-token': TOKEN, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function loadLatestReports(count = 10) {
  const files = fs.readdirSync(REPORT_DIR)
    .filter(name => /^iteration_\d+\.json$/.test(name))
    .sort((a, b) => {
      const aNum = Number(a.replace('iteration_', '').replace('.json', ''));
      const bNum = Number(b.replace('iteration_', '').replace('.json', ''));
      return aNum - bNum;
    })
    .slice(-count);

  return files.map(name => {
    const content = fs.readFileSync(path.join(REPORT_DIR, name), 'utf8');
    return JSON.parse(content);
  });
}

function analyzeExternalWarnings(reports) {
  const counts = {};
  let total = 0;
  for (const report of reports) {
    const readiness = report.checks?.readiness?.body;
    if (!readiness) continue;
    let readinessJson = {};
    try { readinessJson = JSON.parse(readiness); } catch {}
    const exchanges = readinessJson.exchanges || {};
    for (const [exchange, data] of Object.entries(exchanges)) {
      if (!data?.readinessIgnored && !data?.authValidated) {
        counts[exchange] = (counts[exchange] || 0) + 1;
        total++;
      }
    }
  }
  return { counts, total };
}

function analyzePaperHealth(reports) {
  if (!reports.length) return { status: 'insufficient_data' };
  const latest = reports[reports.length - 1];
  const summary = latest.summary || {};
  return {
    status: summary.paperMode ? 'ok' : 'missing_paper_mode',
    trades: Number(summary.trades || 0),
    totalTrades: Number(summary.totalTrades || 0),
    pnl: Number(summary.pnl || 0),
    tradingEnabled: !!summary.tradingEnabled,
  };
}

function autoFix(analysis, reports) {
  const actions = [];
  if (!analysis.paperHealth) return actions;

  if (analysis.paperHealth.status !== 'ok') {
    actions.push({ type: 'paper_mode_missing', fixable: true });
  }

  for (const [exchange, count] of Object.entries(analysis.externalWarnings.counts)) {
    if (count >= 3) {
      actions.push({ type: 'external_warning_storm', exchange, count, fixable: false });
    }
  }

  if (analysis.externalWarnings.total > 0 && analysis.paperHealth.totalTrades === 0) {
    actions.push({ type: 'no_paper_trades', fixable: true });
  }

  return actions;
}

async function runIteration(iteration) {
  const timestamp = Date.now();
  const report = { iteration, ts: timestamp, checks: {}, actions: [] };

  try {
    const health = await httpsGet('/health');
    report.checks.health = { status: health.status, body: health.body };
  } catch (e) {
    report.checks.health = { status: 0, error: e.message };
  }

  try {
    const status = await httpsGet('/api/status');
    report.checks.status = { status: status.status, body: status.body };
    let statusJson = {};
    try { statusJson = JSON.parse(status.body); } catch {}
    report.summary = {
      tradingEnabled: !!statusJson.trading_enabled,
      paperMode: !!statusJson.paper_trading,
      pnl: Number(statusJson.daily_pnl || 0),
      trades: Number(statusJson.daily_trades || 0),
      totalTrades: Number(statusJson.total_trades || 0),
    };
  } catch (e) {
    report.checks.status = { status: 0, error: e.message };
  }

  try {
    const latency = await httpsGet('/api/telemetry/latency');
    report.checks.latency = { status: latency.status, body: latency.body };
  } catch (e) {
    report.checks.latency = { status: 0, error: e.message };
  }

  try {
    const readiness = await httpsGet('/api/readiness');
    report.checks.readiness = { status: readiness.status, body: readiness.body };
  } catch (e) {
    report.checks.readiness = { status: 0, error: e.message };
  }

  const any4xxOr5xx = Object.values(report.checks).some((c) => !!(c.status && c.status >= 400));
  if (any4xxOr5xx) report.actions.push('endpoint_error_detected');
  if (report.summary && !report.summary.paperMode) report.actions.push('paper_mode_missing');

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, `iteration_${iteration}.json`), JSON.stringify(report, null, 2));

  const recent = loadLatestReports(10);
  const externalWarnings = analyzeExternalWarnings(recent);
  const paperHealth = analyzePaperHealth(recent);
  const analysis = { externalWarnings, paperHealth };
  const fixes = autoFix(analysis, recent);

  process.stdout.write(`iteration=${iteration} trades=${report.summary?.totalTrades ?? '-'} pnl=${report.summary?.pnl ?? '-'} actions=${(report.actions.length ? report.actions.join(',') : '-') + (fixes.length ? ' fixes=' + fixes.map(f => f.type).join(',') : '')}\n`);

  if (fixes.some(f => f.type === 'paper_mode_missing' && f.fixable)) {
    console.log(`[auto-fix] paper mode missing at iteration ${iteration}; manual action required: POST /mode/paper`);
  }
  if (fixes.some(f => f.type === 'no_paper_trades' && f.fixable)) {
    console.log(`[auto-fix] no paper trades in recent history at iteration ${iteration}; continue watcher run`);
  }
}

async function run() {
  const argIdx = process.argv.indexOf('--start-iteration');
  const startIteration = argIdx >= 0 && Number(process.argv[argIdx + 1]) ? Number(process.argv[argIdx + 1]) : 1;
  const intervalMs = Number(process.env.PAPER_WATCHER_INTERVAL_MS || 5 * 60 * 1000);

  process.stdout.write(`paper-watcher start-iteration=${startIteration} intervalMs=${intervalMs}\n`);
  for (let i = startIteration; ; i++) {
    try {
      await runIteration(i);
    } catch (e) {
      process.stdout.write(`iteration=${i} error=${String(e.message || e)}\n`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

run().catch((e) => { process.stderr.write(`fatal ${String(e.message || e)}\n`); process.exit(1); });
