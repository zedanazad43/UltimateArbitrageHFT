import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://ultimatearbitragehft.zedanazad43.workers.dev';
const TOKEN = '309400';
const REPORT_DIR = path.join(process.cwd(), '.archive', 'test_reports');
const LOG_DIR = path.join(process.cwd(), '.archive');

function httpsGet(urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const req = https.request({ hostname: url.hostname, path: url.pathname, method: 'GET', headers: { 'x-admin-token': TOKEN } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, body: text });
      });
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

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

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
  if (any4xxOr5xx) {
    report.actions.push('endpoint_error_detected');
  }

  if (report.summary && !report.summary.paperMode) {
    report.actions.push('paper_mode_missing');
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const fileName = `iteration_${iteration}.json`;
  const filePath = path.join(REPORT_DIR, fileName);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));

  return report;
}

async function run() {
  const argIdx = process.argv.indexOf('--start-iteration');
  const startIteration = argIdx >= 0 && Number(process.argv[argIdx + 1]) ? Number(process.argv[argIdx + 1]) : 1;
  const intervalMs = Number(process.env.PAPER_WATCHER_INTERVAL_MS || 5 * 60 * 1000);

  process.stdout.write(`paper-watcher start-iteration=${startIteration} intervalMs=${intervalMs}\n`);
  for (let i = startIteration; ; i++) {
    try {
      const report = await runIteration(i);
      process.stdout.write(`iteration=${i} trades=${report.summary?.totalTrades ?? '-'} pnl=${report.summary?.pnl ?? '-'} actions=${report.actions.join(',') || '-'}\n`);
    } catch (e) {
      process.stdout.write(`iteration=${i} error=${String(e.message || e)}\n`);
    }
    await sleep(intervalMs);
  }
}

run().catch((e) => { process.stderr.write(`fatal ${String(e.message || e)}\n`); process.exit(1); });
