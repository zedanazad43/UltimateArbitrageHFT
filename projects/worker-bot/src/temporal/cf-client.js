// src/temporal/cf-client.js — Temporal Cloud HTTP API client
//
// Cloudflare Workers cannot run a Temporal worker process (no long-lived
// poll loop), but they *can* call the Temporal Cloud HTTP API via fetch().
// This module exposes helpers that let the CF Worker start, stop, and query
// the ArbitrageTradingWorkflow running on a Temporal Cloud namespace.
//
// Required env vars / Worker secrets:
//   TEMPORAL_API_KEY    — Temporal Cloud API key (wrangler secret put TEMPORAL_API_KEY)
//   TEMPORAL_ADDRESS    — Temporal Cloud namespace base URL
//                         e.g. https://default.abc123.tmprl.cloud
//   TEMPORAL_NAMESPACE  — Temporal namespace name (default: "default")

// ── Constants ─────────────────────────────────────────────────────────────────

const TASK_QUEUE    = 'arbitrage-tasks';
const WORKFLOW_TYPE = 'arbitrageTradingWorkflow';
const WORKFLOW_ID   = 'arbitrage-trading-session';

// ── Payload helpers ───────────────────────────────────────────────────────────
//
// The Temporal HTTP gateway uses the protobuf JSON encoding for payloads.
// Each payload is:
//   { metadata: { encoding: base64("json/plain") }, data: base64(JSON.stringify(value)) }

function encodePayload(value) {
  return {
    metadata: { encoding: btoa('json/plain') },
    data: btoa(JSON.stringify(value)),
  };
}

function decodePayload(payload) {
  if (!payload?.data) return null;
  try {
    return JSON.parse(atob(payload.data));
  } catch (_) {
    return atob(payload.data);
  }
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

/**
 * Make an authenticated HTTP request to the Temporal Cloud API.
 *
 * @param {object} env              - CF Worker env bindings
 * @param {string} path             - API path (relative to /api/v1/namespaces/<ns>)
 * @param {object} [fetchOptions]   - Standard fetch options
 * @returns {object} Parsed JSON response body
 */
async function temporalFetch(env, path, fetchOptions = {}) {
  const baseUrl   = (env.TEMPORAL_ADDRESS || '').replace(/\/+$/, '');
  const namespace = env.TEMPORAL_NAMESPACE || 'default';
  const apiKey    = env.TEMPORAL_API_KEY;

  if (!baseUrl) throw new Error('TEMPORAL_ADDRESS is not configured');
  if (!apiKey)  throw new Error('TEMPORAL_API_KEY is not configured');

  const url  = `${baseUrl}/api/v1/namespaces/${namespace}${path}`;
  const resp = await fetch(url, {
    ...fetchOptions,
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...fetchOptions.headers,
    },
  });

  const text = await resp.text();
  let body;
  try { body = JSON.parse(text); } catch (_) { body = { raw: text }; }

  if (!resp.ok) {
    const msg = body?.message || body?.raw || `HTTP ${resp.status}`;
    throw new Error(`Temporal API error ${resp.status}: ${msg}`);
  }

  return body;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start the ArbitrageTradingWorkflow on Temporal Cloud.
 * If the workflow is already running, it is terminated and a fresh run begins
 * (workflowIdReusePolicy = TERMINATE_IF_RUNNING).
 *
 * @param {object} env    - CF Worker env bindings
 * @param {object} params - Workflow parameters
 * @param {string} params.workerUrl              - CF Worker base URL for activities
 * @param {string} [params.adminToken]           - Admin token (defaults to env.ADMIN_TOKEN)
 * @param {number} [params.cycleIntervalSeconds] - Seconds between scans (default 60)
 * @param {number} [params.maxCyclesBeforeReset] - Cycles before continueAsNew (default 100)
 */
export async function startWorkflow(env, params = {}) {
  const workerUrl  = params.workerUrl  || env.TEMPORAL_WORKER_URL || '';
  const adminToken = params.adminToken || env.ADMIN_TOKEN || '';

  return temporalFetch(env, `/workflows/${WORKFLOW_ID}`, {
    method: 'POST',
    body: JSON.stringify({
      workflowType: { name: WORKFLOW_TYPE },
      taskQueue:    { name: TASK_QUEUE },
      input: {
        payloads: [
          encodePayload({
            workerUrl,
            adminToken,
            cycleIntervalSeconds: params.cycleIntervalSeconds ?? 60,
            maxCyclesBeforeReset: params.maxCyclesBeforeReset ?? 100,
          }),
        ],
      },
      workflowExecutionTimeout: '86400s',
      workflowRunTimeout:       '7200s',
      workflowTaskTimeout:      '10s',
      workflowIdReusePolicy:    'WORKFLOW_ID_REUSE_POLICY_TERMINATE_IF_RUNNING',
    }),
  });
}

/**
 * Send a graceful stop signal to the workflow.
 * The workflow will exit after completing the current scan cycle.
 *
 * @param {object} env - CF Worker env bindings
 */
export async function stopWorkflow(env) {
  return temporalFetch(env, `/workflows/${WORKFLOW_ID}/signal/stop`, {
    method: 'POST',
    body: JSON.stringify({ input: { payloads: [encodePayload({})] } }),
  });
}

/**
 * Immediately terminate the workflow.
 *
 * @param {object} env    - CF Worker env bindings
 * @param {string} reason - Termination reason (logged in Temporal UI)
 */
export async function terminateWorkflow(env, reason = 'Manually terminated via CF Worker') {
  return temporalFetch(env, `/workflows/${WORKFLOW_ID}/terminate`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

/**
 * Describe the current workflow execution (status, start/close times, etc.).
 *
 * @param {object} env - CF Worker env bindings
 */
export async function describeWorkflow(env) {
  return temporalFetch(env, `/workflows/${WORKFLOW_ID}`);
}

/**
 * Query the workflow for a live status snapshot.
 * Returns { running, cycles, lastScanResult, mode } or null on error.
 *
 * @param {object} env - CF Worker env bindings
 */
export async function queryWorkflowStatus(env) {
  try {
    const result = await temporalFetch(
      env,
      `/workflows/${WORKFLOW_ID}/runs/-/query/status`,
      { method: 'POST', body: JSON.stringify({ queryType: 'status' }) },
    );
    const payload = result?.queryResult?.payloads?.[0];
    return payload ? decodePayload(payload) : null;
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Send a signal to switch the trading mode.
 *
 * @param {object}  env   - CF Worker env bindings
 * @param {boolean} paper - true → paper mode; false → live mode
 */
export async function setTradingModeSignal(env, paper) {
  return temporalFetch(env, `/workflows/${WORKFLOW_ID}/signal/setPaperMode`, {
    method: 'POST',
    body: JSON.stringify({ input: { payloads: [encodePayload({ paper })] } }),
  });
}
