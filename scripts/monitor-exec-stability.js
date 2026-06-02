#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleepTimeout } from 'node:timers/promises';
import dotenv from 'dotenv';

dotenv.config({ path: '.dev.vars', override: false });

const args = process.argv.slice(2);

function getArg(name, fallback = '') {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  return args[idx + 1] || fallback;
}

function boolArg(name, fallback = false) {
  const raw = getArg(name, fallback ? 'true' : 'false').toLowerCase();
  return ['1', 'true', 'on', 'yes'].includes(raw);
}

const baseUrl = getArg('--base', process.env.API_BASE || 'https://api.ecostamp.net');
const token = getArg('--token', process.env.WORKFLOW_ADMIN_TOKEN || process.env.ADMIN_TOKEN || '');
const samples = Number.parseInt(getArg('--samples', '6'), 10); // 6 * 5m = 30m
const intervalMs = Number.parseInt(getArg('--interval-ms', '300000'), 10); // 5 minutes
const runExecuteAll = boolArg('--run-execute-all', true);
const archivePrefix = getArg('--archive-prefix', 'exports/');
const outDir = getArg('--out-dir', 'logs');
const label = getArg('--label', 'exec-stability');

if (!token) {
  console.error('Missing admin token. Use --token or set WORKFLOW_ADMIN_TOKEN/ADMIN_TOKEN.');
  process.exit(1);
}

if (!Number.isFinite(samples) || samples < 1) {
  console.error('Invalid --samples value.');
  process.exit(1);
}

if (!Number.isFinite(intervalMs) || intervalMs < 1000) {
  console.error('Invalid --interval-ms value (must be >= 1000).');
  process.exit(1);
}

function sleep(ms) {
  return sleepTimeout(ms);
}

async function fetchJson(pathname, init = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      'x-admin-token': token,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });

  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return { status: response.status, ok: response.ok, text, json };
}

function evaluateSample(sample) {
  const issues = [];

  const flags = sample.status?.json?.strategy_flags || {};
  const breakerKeys = Object.keys(sample.status?.json?.circuitBreaker || {});
  const execStatus = Array.isArray(sample.execStatus?.json?.integrations)
    ? sample.execStatus.json.integrations
    : [];

  if (sample.status?.status !== 200) issues.push('status_endpoint_non_200');
  if (sample.dex?.status !== 200) issues.push('dex_endpoint_non_200');
  if (sample.perps?.status !== 200) issues.push('perps_endpoint_non_200');
  if (sample.execStatus?.status !== 200) issues.push('executive_status_non_200');
  if (sample.archives?.status !== 200) issues.push('archives_non_200');

  if (flags.dex !== true) issues.push('dex_flag_not_true');
  if (flags.perps !== false) issues.push('perps_flag_not_false');
  if (sample.dex?.json?.executionReady !== true) issues.push('dex_execution_not_ready');
  if (breakerKeys.includes('mexc_perp')) issues.push('mexc_perp_breaker_visible');

  if (!execStatus.length) {
    issues.push('executive_integrations_empty');
  } else {
    for (const item of execStatus) {
      if (item.configured !== true) issues.push(`integration_not_configured:${item.integration}`);
      if (item.reachable !== true) issues.push(`integration_not_reachable:${item.integration}`);
    }
  }

  if (runExecuteAll) {
    const runAll = sample.executeAll?.json || {};
    if (sample.executeAll?.status !== 200) issues.push('execute_all_non_200');
    if (runAll.success !== true) issues.push('execute_all_failed');
    if (Number(runAll.success_count || 0) !== 4) issues.push('execute_all_success_count_not_4');
  }

  return { pass: issues.length === 0, issues };
}

async function collectSample(index) {
  const now = new Date().toISOString();

  const [status, dex, perps, execStatus, archives, executeAll] = await Promise.all([
    fetchJson('/api/status'),
    fetchJson('/api/dex'),
    fetchJson('/api/perps'),
    fetchJson('/api/integrations/executive/status'),
    fetchJson(`/api/logs/archives?prefix=${encodeURIComponent(archivePrefix)}&limit=5`),
    runExecuteAll
      ? fetchJson('/api/integrations/executive/execute-all', {
          method: 'POST',
          body: JSON.stringify({
            defaultPayload: {
              trigger: 'stability-monitor',
              requested_at: now,
            },
          }),
        })
      : Promise.resolve({ status: null, ok: true, json: null, text: '' }),
  ]);

  const sample = {
    i: index,
    ts: now,
    status,
    dex,
    perps,
    execStatus,
    executeAll,
    archives,
  };

  const verdict = evaluateSample(sample);
  return {
    i: index,
    ts: now,
    pass: verdict.pass,
    issues: verdict.issues,
    flags: sample.status?.json?.strategy_flags || null,
    breakerKeys: Object.keys(sample.status?.json?.circuitBreaker || {}),
    dexExecutionReady: sample.dex?.json?.executionReady === true,
    perpsEnabled: sample.perps?.json?.perpsEnabled === true,
    integrations: Array.isArray(sample.execStatus?.json?.integrations)
      ? sample.execStatus.json.integrations.map((it) => ({
          integration: it.integration,
          configured: it.configured,
          reachable: it.reachable,
        }))
      : [],
    executeAll: sample.executeAll?.json
      ? {
          success: sample.executeAll.json.success,
          success_count: sample.executeAll.json.success_count,
          total: sample.executeAll.json.total,
        }
      : null,
    archivesCount: Array.isArray(sample.archives?.json?.objects) ? sample.archives.json.objects.length : null,
    httpCodes: {
      status: sample.status?.status,
      dex: sample.dex?.status,
      perps: sample.perps?.status,
      execStatus: sample.execStatus?.status,
      executeAll: sample.executeAll?.status,
      archives: sample.archives?.status,
    },
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[:.]/g, '-');
  const outputDir = path.resolve(outDir);
  const jsonlPath = path.join(outputDir, `${label}-${stamp}.jsonl`);
  const summaryPath = path.join(outputDir, `${label}-${stamp}.summary.json`);

  fs.mkdirSync(outputDir, { recursive: true });

  const rows = [];
  console.log(`EXEC_STABILITY_START ${startedAt}`);
  console.log(`EXEC_STABILITY_OUTPUT ${jsonlPath}`);

  for (let i = 1; i <= samples; i++) {
    const row = await collectSample(i);
    rows.push(row);
    fs.appendFileSync(jsonlPath, `${JSON.stringify(row)}\n`, 'utf8');
    console.log(`EXEC_STABILITY_SAMPLE ${JSON.stringify(row)}`);

    if (i < samples) {
      await sleep(intervalMs);
    }
  }

  const failed = rows.filter((r) => !r.pass);
  const summary = {
    startedAt,
    endedAt: new Date().toISOString(),
    sampleCount: rows.length,
    intervalMs,
    durationMinutes: Number(((rows.length - 1) * intervalMs / 60000).toFixed(2)),
    pass: failed.length === 0,
    failedSamples: failed.length,
    first: rows[0] || null,
    last: rows[rows.length - 1] || null,
  };

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`EXEC_STABILITY_SUMMARY ${JSON.stringify(summary)}`);
  console.log(`EXEC_STABILITY_SUMMARY_FILE ${summaryPath}`);
  console.log(`EXEC_STABILITY_END ${new Date().toISOString()}`);

  if (!summary.pass) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`EXEC_STABILITY_FATAL ${String(error?.message || error)}`);
  process.exit(1);
});
