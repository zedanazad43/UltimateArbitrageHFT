#!/usr/bin/env node

import dotenv from 'dotenv';

dotenv.config({ path: '.dev.vars', override: false });

const DEFAULT_BASE_URL = 'https://api.ecostamp.net';
const baseUrl = (process.env.BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
const adminToken = process.env.ADMIN_TOKEN || process.env.WORKFLOW_ADMIN_TOKEN || '';
const force = process.argv.includes('--force');

if (!adminToken) {
  console.error('ERROR: ADMIN_TOKEN (or WORKFLOW_ADMIN_TOKEN) is required.');
  process.exit(1);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'x-admin-token': adminToken,
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // keep raw text fallback
  }

  return {
    ok: response.ok,
    status: response.status,
    text,
    data,
  };
}

async function main() {
  const readiness = await request('/api/readiness');
  if (!readiness.ok) {
    throw new Error(`/api/readiness failed (${readiness.status}): ${readiness.text}`);
  }

  const readyForLive = readiness.data?.readyForLive === true;
  if (!readyForLive && !force) {
    throw new Error('Live activation blocked: readyForLive=false. Fix readiness checks first, or run with --force.');
  }

  const before = await request('/api/status');
  if (!before.ok) {
    throw new Error(`/api/status failed (${before.status}): ${before.text}`);
  }

  const actions = [];

  const desiredFlags = {
    cex: true,
    dex: true,
    perps: true,
    funding: true,
    triangular: true,
    statistical: true,
  };

  const currentFlags = before.data?.strategy_flags || {};
  const flagsNeedUpdate = Object.entries(desiredFlags)
    .some(([key, value]) => currentFlags[key] !== value);

  if (!before.data?.multi_strategy_live || flagsNeedUpdate) {
    const cfg = await request('/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        multi_strategy_live: true,
        strategy_flags: desiredFlags,
      }),
    });
    if (!cfg.ok) {
      throw new Error(`/config failed (${cfg.status}): ${cfg.text}`);
    }
    actions.push('config->all-strategies-enabled');
  }

  if (before.data?.paper_trading !== false) {
    const modeLive = await request('/mode/live', { method: 'POST' });
    if (!modeLive.ok) {
      throw new Error(`/mode/live failed (${modeLive.status}): ${modeLive.text}`);
    }
    actions.push('mode->live');
  }

  if (!before.data?.trading_enabled) {
    const started = await request('/start');
    if (!started.ok) {
      throw new Error(`/start failed (${started.status}): ${started.text}`);
    }
    actions.push('trading->started');
  }

  const after = await request('/api/status');
  if (!after.ok) {
    throw new Error(`/api/status (after) failed (${after.status}): ${after.text}`);
  }

  console.log(JSON.stringify({
    baseUrl,
    readyForLive,
    forced: force,
    actions,
    before: {
      trading_enabled: before.data?.trading_enabled,
      paper_trading: before.data?.paper_trading,
      enabledExecutionExchanges: before.data?.enabledExecutionExchanges,
      strategy_flags: before.data?.strategy_flags,
      multi_strategy_live: before.data?.multi_strategy_live,
    },
    after: {
      trading_enabled: after.data?.trading_enabled,
      paper_trading: after.data?.paper_trading,
      enabledExecutionExchanges: after.data?.enabledExecutionExchanges,
      strategy_flags: after.data?.strategy_flags,
      multi_strategy_live: after.data?.multi_strategy_live,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
