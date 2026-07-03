// src/temporal/activities.js — Temporal Activity implementations
//
// Activities are the units of work executed by the Temporal worker.  They
// make HTTP calls to the Cloudflare Worker so the CF Worker remains the
// single source of truth for trading logic, state, and DB access.
//
// All activities are safe to retry (idempotent where possible) and report
// failures by throwing — Temporal will retry them according to the policy
// defined in the workflow.

import { Context } from '@temporalio/activity';

/**
 * Run a market scan via the Cloudflare Worker /scan endpoint.
 * Returns a summary object with HTTP status, text response, and timestamp.
 *
 * @param {object} params
 * @param {string} params.workerUrl   - CF Worker base URL
 * @param {string} params.adminToken  - x-admin-token header value
 */
export async function runScanActivity({ workerUrl, adminToken }) {
  Context.current().heartbeat('starting scan');
  const resp = await fetch(`${workerUrl}/scan`, {
    headers: { 'x-admin-token': adminToken },
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Scan failed (HTTP ${resp.status}): ${text.slice(0, 200)}`);
  }
  Context.current().heartbeat('scan complete');
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
  const resp = await fetch(`${workerUrl}/api/status`, {
    headers: { 'x-admin-token': adminToken },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Status check failed (HTTP ${resp.status}): ${text.slice(0, 200)}`);
  }
  return await resp.json();
}

/**
 * Switch the Cloudflare Worker between paper and live trading modes.
 *
 * @param {object}  params
 * @param {string}  params.workerUrl   - CF Worker base URL
 * @param {string}  params.adminToken  - x-admin-token header value
 * @param {boolean} params.paper       - true → paper mode; false → live mode
 */
export async function updateTradingModeActivity({ workerUrl, adminToken, paper }) {
  const path = paper ? '/mode/paper' : '/mode/live';
  const resp = await fetch(`${workerUrl}${path}`, {
    method: 'POST',
    headers: { 'x-admin-token': adminToken },
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Mode update failed (HTTP ${resp.status}): ${text.slice(0, 200)}`);
  }
  return { mode: paper ? 'paper' : 'live', result: text };
}
