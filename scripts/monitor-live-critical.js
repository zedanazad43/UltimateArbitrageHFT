#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleepTimeout } from 'node:timers/promises';
import dotenv from 'dotenv';

dotenv.config({ path: '.dev.vars', override: false });

const args = process.argv.slice(2);

function getArg(name, fallback = '') {
  for (let i = args.length - 1; i >= 0; i -= 1) {
    if (args[i] === name) {
      return args[i + 1] || fallback;
    }
  }
  return fallback;
}

function boolArg(name, fallback = false) {
  const raw = String(getArg(name, fallback ? 'true' : 'false')).toLowerCase();
  return ['1', 'true', 'on', 'yes'].includes(raw);
}

const baseUrl = String(getArg('--base', process.env.API_BASE || 'https://api.ecostamp.net')).replace(/\/$/, '');
const adminToken = getArg('--token', process.env.WORKFLOW_ADMIN_TOKEN || process.env.ADMIN_TOKEN || '');
const samples = Number.parseInt(getArg('--samples', '288'), 10); // 24h at 5m intervals
const intervalMs = Number.parseInt(getArg('--interval-ms', '300000'), 10);
const maxDailyLossUsd = Number.parseFloat(getArg('--max-daily-loss-usd', '12'));
const autoStop = boolArg('--auto-stop', true);
const forceStopOnStartup = boolArg('--force-stop-on-startup', false);
const outDir = getArg('--out-dir', 'logs');
const label = getArg('--label', 'monitor-live-critical');

const telegramToken = process.env.TELEGRAM_BOT_TOKEN || '';
const telegramChatId = process.env.TELEGRAM_CHAT_ID || '';

if (!adminToken) {
  console.error('Missing admin token. Pass --token or set ADMIN_TOKEN/WORKFLOW_ADMIN_TOKEN.');
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

if (!Number.isFinite(maxDailyLossUsd) || maxDailyLossUsd <= 0) {
  console.error('Invalid --max-daily-loss-usd value (must be > 0).');
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
      'x-admin-token': adminToken,
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

  return {
    ok: response.ok,
    status: response.status,
    text,
    json,
  };
}

async function sendTelegram(message) {
  if (!telegramToken || !telegramChatId) {
    return { sent: false, reason: 'telegram_not_configured' };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text: message,
      }),
    });

    return { sent: response.ok, status: response.status };
  } catch (error) {
    return { sent: false, reason: String(error?.message || error) };
  }
}

async function runAutoStopSequence() {
  const calls = [];

  const stopResp = await fetchJson('/stop', { method: 'POST' });
  calls.push({ endpoint: '/stop', status: stopResp.status, ok: stopResp.ok });

  const paperResp = await fetchJson('/mode/paper', { method: 'POST' });
  calls.push({ endpoint: '/mode/paper', status: paperResp.status, ok: paperResp.ok });

  const lockResp = await fetchJson('/strategy/spot-lock/enable', { method: 'POST' });
  calls.push({ endpoint: '/strategy/spot-lock/enable', status: lockResp.status, ok: lockResp.ok });

  const [statusResp, safetyResp] = await Promise.all([
    fetchJson('/api/status'),
    fetchJson('/api/safety-state'),
  ]);

  const verified =
    statusResp.ok &&
    safetyResp.ok &&
    statusResp.json?.trading_enabled === false &&
    statusResp.json?.paper_trading === true &&
    safetyResp.json?.spotOnlyLock === true &&
    safetyResp.json?.strategyFlags?.perps === false &&
    safetyResp.json?.strategyFlags?.funding === false;

  return {
    calls,
    verified,
    postState: {
      status: statusResp.json,
      safety: safetyResp.json,
    },
  };
}

function evaluateCritical(sample, state) {
  const reasons = [];

  const statusOk = sample.status?.status === 200;
  const safetyOk = sample.safety?.status === 200;
  const readinessOk = sample.readiness?.status === 200;
  const endpointOk = statusOk && safetyOk && readinessOk;

  if (!endpointOk) {
    state.protectedEndpointFailuresConsecutive += 1;
  } else {
    state.protectedEndpointFailuresConsecutive = 0;
  }

  if (state.protectedEndpointFailuresConsecutive >= 2) {
    reasons.push('protected_endpoints_failed_twice_consecutively');
  }

  const readiness = sample.readiness?.json || {};
  const safety = sample.safety?.json || {};
  const status = sample.status?.json || {};

  const readyForLive = readiness?.readyForLive === true;
  if (!readyForLive) {
    reasons.push('ready_for_live_false');
  }

  const lock = safety?.spotOnlyLock === true;
  if (!lock) {
    reasons.push('spot_only_lock_false');
  }

  const perpsEnabled = safety?.strategyFlags?.perps === true || status?.strategy_flags?.perps === true;
  const fundingEnabled = safety?.strategyFlags?.funding === true || status?.strategy_flags?.funding === true;
  if (perpsEnabled) {
    reasons.push('perps_enabled_while_spot_only_required');
  }
  if (fundingEnabled) {
    reasons.push('funding_enabled_while_spot_only_required');
  }

  const flags = status?.strategy_flags || {};
  const coreFlagsStable =
    flags?.cex === true &&
    flags?.dex === true &&
    flags?.triangular === true &&
    flags?.statistical === true;
  if (!coreFlagsStable) {
    reasons.push('core_flags_drift_detected');
  }

  const authFailures = Number(readiness?.checks?.exchangeAuthFailures ?? readiness?.exchangeAuthFailures ?? 0);
  if (authFailures > 0) {
    state.exchangeAuthFailuresConsecutive += 1;
  } else {
    state.exchangeAuthFailuresConsecutive = 0;
  }

  if (state.exchangeAuthFailuresConsecutive >= 2) {
    reasons.push('exchange_auth_failures_twice_consecutively');
  }

  const dailyPnl = Number(status?.daily_pnl ?? status?.todayProfit ?? 0);
  if (Number.isFinite(dailyPnl) && dailyPnl <= -Math.abs(maxDailyLossUsd)) {
    reasons.push('daily_pnl_below_operational_limit');
  }

  return {
    critical: reasons.length > 0,
    reasons,
    diagnostics: {
      readyForLive,
      lock,
      perpsEnabled,
      fundingEnabled,
      coreFlagsStable,
      authFailures,
      dailyPnl,
      protectedEndpointFailuresConsecutive: state.protectedEndpointFailuresConsecutive,
      exchangeAuthFailuresConsecutive: state.exchangeAuthFailuresConsecutive,
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
  const state = {
    protectedEndpointFailuresConsecutive: 0,
    exchangeAuthFailuresConsecutive: 0,
  };

  console.log(`LIVE_CRITICAL_MONITOR_START ${startedAt}`);
  console.log(`LIVE_CRITICAL_MONITOR_OUTPUT ${jsonlPath}`);
  console.log(`LIVE_CRITICAL_MONITOR_CONFIG ${JSON.stringify({ baseUrl, samples, intervalMs, maxDailyLossUsd, autoStop })}`);

  if (forceStopOnStartup) {
    const startupStop = await runAutoStopSequence();
    console.log(`LIVE_CRITICAL_MONITOR_FORCE_STOP ${JSON.stringify(startupStop)}`);
  }

  let stoppedByCritical = false;
  let stopResult = null;
  let stopReasons = [];

  for (let i = 1; i <= samples; i++) {
    const ts = new Date().toISOString();

    try {
      const [status, safety, readiness, executionHealth] = await Promise.all([
        fetchJson('/api/status'),
        fetchJson('/api/safety-state'),
        fetchJson('/api/readiness'),
        fetchJson('/api/execution-health'),
      ]);

      const evalResult = evaluateCritical({ i, ts, status, safety, readiness, executionHealth }, state);

      const row = {
        i,
        ts,
        critical: evalResult.critical,
        reasons: evalResult.reasons,
        diagnostics: evalResult.diagnostics,
        httpCodes: {
          status: status.status,
          safety: safety.status,
          readiness: readiness.status,
          executionHealth: executionHealth.status,
        },
      };

      rows.push(row);
      fs.appendFileSync(jsonlPath, `${JSON.stringify(row)}\n`, 'utf8');
      console.log(`LIVE_CRITICAL_MONITOR_SAMPLE ${JSON.stringify(row)}`);

      if (evalResult.critical) {
        stopReasons = evalResult.reasons;
        const message =
          `[CRITICAL] Live monitor triggered auto-stop\n` +
          `time=${ts}\n` +
          `reasons=${evalResult.reasons.join(', ')}\n` +
          `dailyPnl=${evalResult.diagnostics.dailyPnl}\n` +
          `readyForLive=${evalResult.diagnostics.readyForLive}\n` +
          `spotOnlyLock=${evalResult.diagnostics.lock}`;

        const telegramResult = await sendTelegram(message);
        console.log(`LIVE_CRITICAL_MONITOR_ALERT ${JSON.stringify(telegramResult)}`);

        if (autoStop) {
          stopResult = await runAutoStopSequence();
          console.log(`LIVE_CRITICAL_MONITOR_AUTO_STOP ${JSON.stringify(stopResult)}`);
        }

        stoppedByCritical = true;
        break;
      }
    } catch (error) {
      const row = {
        i,
        ts,
        critical: false,
        reasons: [],
        fatalSampleError: String(error?.message || error),
      };
      rows.push(row);
      fs.appendFileSync(jsonlPath, `${JSON.stringify(row)}\n`, 'utf8');
      console.log(`LIVE_CRITICAL_MONITOR_SAMPLE ${JSON.stringify(row)}`);
    }

    if (i < samples) {
      await sleep(intervalMs);
    }
  }

  const criticalCount = rows.filter((r) => r.critical === true).length;
  const summary = {
    startedAt,
    endedAt: new Date().toISOString(),
    sampleCount: rows.length,
    requestedSamples: samples,
    intervalMs,
    maxDailyLossUsd,
    stoppedByCritical,
    criticalCount,
    stopReasons,
    autoStop,
    stopResult,
    first: rows[0] || null,
    last: rows[rows.length - 1] || null,
  };

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`LIVE_CRITICAL_MONITOR_SUMMARY ${JSON.stringify(summary)}`);
  console.log(`LIVE_CRITICAL_MONITOR_SUMMARY_FILE ${summaryPath}`);
  console.log(`LIVE_CRITICAL_MONITOR_END ${new Date().toISOString()}`);

  if (stoppedByCritical) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(`LIVE_CRITICAL_MONITOR_FATAL ${String(error?.message || error)}`);
  process.exit(1);
});
