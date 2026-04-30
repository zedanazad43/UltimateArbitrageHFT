// src/temporal/workflows.js — Temporal Workflow definitions
//
// ⚠️  This file runs inside Temporal's deterministic workflow sandbox.
//     Only import from '@temporalio/workflow'. Any side-effectful or
//     non-deterministic Node.js APIs must be placed in activities.js.

import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  continueAsNew,
  sleep,
  log,
} from '@temporalio/workflow';

// ── Activity proxy ────────────────────────────────────────────────────────────
// Each activity call is durable and retried on failure.

const { runScanActivity, getStatusActivity, updateTradingModeActivity } =
  proxyActivities({
    startToCloseTimeout: '2 minutes',
    retry: {
      initialInterval: '5 seconds',
      maximumInterval: '30 seconds',
      maximumAttempts: 3,
    },
  });

// ── Signals ───────────────────────────────────────────────────────────────────

/** Signal: gracefully stop the trading loop. */
export const stopSignal = defineSignal('stop');

/** Signal: switch trading mode.  Payload: { paper: boolean } */
export const setPaperModeSignal = defineSignal('setPaperMode');

// ── Queries ───────────────────────────────────────────────────────────────────

/** Query: return current workflow status snapshot. */
export const statusQuery = defineQuery('status');

// ── Workflow ──────────────────────────────────────────────────────────────────

/**
 * ArbitrageTradingWorkflow
 *
 * Durable, long-running workflow that repeatedly triggers market scans via the
 * Cloudflare Worker HTTP API.  Survives worker crashes and Temporal server
 * restarts because every step is recorded in the Temporal event history.
 *
 * Uses `continueAsNew` after `maxCyclesBeforeReset` iterations to keep the
 * event history from growing without bound.
 *
 * @param {object} params
 * @param {string} params.workerUrl              - CF Worker base URL (e.g. https://…workers.dev)
 * @param {string} params.adminToken             - Value for x-admin-token header
 * @param {number} [params.cycleIntervalSeconds] - Seconds to wait between scans (default 60)
 * @param {number} [params.maxCyclesBeforeReset] - Cycles before continueAsNew (default 100)
 */
export async function arbitrageTradingWorkflow({
  workerUrl,
  adminToken,
  cycleIntervalSeconds = 60,
  maxCyclesBeforeReset = 100,
}) {
  let running = true;
  let cycles = 0;
  let lastScanResult = null;
  let mode = 'paper';
  // pendingModeUpdate is set by the setPaperModeSignal handler and consumed
  // in the main loop, because signal handlers must be synchronous (no await).
  let pendingModeUpdate = null;

  // ── Signal handlers ────────────────────────────────────────────────────────
  setHandler(stopSignal, () => {
    running = false;
    log.info('Stop signal received — workflow will exit after current cycle');
  });

  // Signal handlers must be synchronous; schedule the activity for the loop.
  setHandler(setPaperModeSignal, ({ paper }) => {
    mode = paper ? 'paper' : 'live';
    pendingModeUpdate = paper;
    log.info('Trading mode signal received', { mode });
  });

  // ── Query handler ──────────────────────────────────────────────────────────
  setHandler(statusQuery, () => ({ running, cycles, lastScanResult, mode }));

  // ── Main scan loop ─────────────────────────────────────────────────────────
  while (running && cycles < maxCyclesBeforeReset) {
    await sleep(cycleIntervalSeconds * 1000);
    if (!running) break;

    // Apply any pending mode change inside the loop where await is safe.
    if (pendingModeUpdate !== null) {
      try {
        await updateTradingModeActivity({ workerUrl, adminToken, paper: pendingModeUpdate });
        log.info('Trading mode updated on CF Worker', { mode });
      } catch (e) {
        log.error('Failed to update trading mode', { error: e.message });
      }
      pendingModeUpdate = null;
    }

    try {
      lastScanResult = await runScanActivity({ workerUrl, adminToken });
      cycles++;
      log.info('Arbitrage scan completed', { cycles, result: lastScanResult });
    } catch (e) {
      log.error('Scan activity failed', { error: e.message });
    }
  }

  // ── Continue as new or exit ────────────────────────────────────────────────
  if (running) {
    // Start a fresh workflow run with a clean history to prevent unbounded growth.
    log.info('Continuing workflow as new run', { completedCycles: cycles });
    await continueAsNew({ workerUrl, adminToken, cycleIntervalSeconds, maxCyclesBeforeReset });
  }

  log.info('Arbitrage trading workflow finished', { totalCycles: cycles });
}
