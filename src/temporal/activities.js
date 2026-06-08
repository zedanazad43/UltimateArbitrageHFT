// src/temporal/activities.js â€” Temporal Activity implementations
//
// Activities are the units of work executed by the Temporal worker.  They
// make HTTP calls to the Cloudflare Worker so the CF Worker remains the
// single source of truth for trading logic, state, and DB access.
//
// All activities are safe to retry (idempotent where possible) and report
// failures by throwing â€” Temporal will retry them according to the policy
// defined in the workflow.

import { Context } from '@temporalio/activity';
import { logEvent, incrementMetric, observeLatency } from '../infra/observability.js';

const ACTIVITY_TIMEOUT_MS = 15000;

function normalizeWorkerUrl(rawUrl) {
  const parsed = new URL(String(rawUrl || '').trim());
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(isLocal && parsed.protocol === 'http:')) {
    throw new Error('workerUrl must use https:// in non-local environments');
  }
  return parsed.toString().replace(/\/+$/, '');
}

async function fetchWithTimeout(url, options = {}, timeoutMs = ACTIVITY_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('activity request timed out'), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Run a market scan via the Cloudflare Worker /scan endpoint.
 * Returns a summary object with HTTP status, text response, and timestamp.
 *
 * @param {object} params
 * @param {string} params.workerUrl   - CF Worker base URL
 * @param {string} params.adminToken  - x-admin-token header value
 */
export async function runScanActivity({ workerUrl, adminToken }) {
  const baseUrl = normalizeWorkerUrl(workerUrl);
  const startedAt = Date.now();
  Context.current().heartbeat('starting scan');
  const resp = await fetchWithTimeout(`${baseUrl}/scan`, {
    headers: { 'x-admin-token': adminToken },
  });
  const text = await resp.text();
  if (!resp.ok) {
    incrementMetric('temporal.activity.scan.error');
    throw new Error(`Scan failed (HTTP ${resp.status}): ${text.slice(0, 200)}`);
  }
  Context.current().heartbeat('scan complete');
  observeLatency('temporal.activity.scan.duration_ms', startedAt);
  incrementMetric('temporal.activity.scan.success');
  return { status: resp.status, result: text, timestamp: Date.now() };
}

/**
 * Fetch the current bot status from the Cloudflare Worker /api/status endpoint.
 *
 * @param {object} params
 * @param {string} params.workerUrl   - CF Worker base URL
 * @param {string} params.adminToken  - x-admin-token header value
 */
export async function getStatusActivity({ workerUrl, adminToken }) {
  const baseUrl = normalizeWorkerUrl(workerUrl);
  const startedAt = Date.now();
  const resp = await fetchWithTimeout(`${baseUrl}/api/status`, {
    headers: { 'x-admin-token': adminToken },
  });
  if (!resp.ok) {
    const text = await resp.text();
    incrementMetric('temporal.activity.status.error');
    throw new Error(`Status check failed (HTTP ${resp.status}): ${text.slice(0, 200)}`);
  }
  observeLatency('temporal.activity.status.duration_ms', startedAt);
  return await resp.json();
}

/**
 * Switch the Cloudflare Worker between paper and live trading modes.
 *
 * @param {object}  params
 * @param {string}  params.workerUrl   - CF Worker base URL
 * @param {string}  params.adminToken  - x-admin-token header value
 * @param {boolean} params.paper       - true â†’ paper mode; false â†’ live mode
 */
export async function updateTradingModeActivity({ workerUrl, adminToken, paper }) {
  const baseUrl = normalizeWorkerUrl(workerUrl);
  const path = paper ? '/mode/paper' : '/mode/live';
  const startedAt = Date.now();
  const resp = await fetchWithTimeout(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'x-admin-token': adminToken },
  });
  const text = await resp.text();
  if (!resp.ok) {
    incrementMetric('temporal.activity.mode.error');
    throw new Error(`Mode update failed (HTTP ${resp.status}): ${text.slice(0, 200)}`);
  }
  logEvent('info', 'temporal.activity.mode.updated', { mode: paper ? 'paper' : 'live' });
  observeLatency('temporal.activity.mode.duration_ms', startedAt, { mode: paper ? 'paper' : 'live' });
  return { mode: paper ? 'paper' : 'live', result: text };
}
