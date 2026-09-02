#!/usr/bin/env node

import dotenv from 'dotenv';

dotenv.config({ path: '.dev.vars', override: false });

const DEFAULT_BASE_URL = 'https://api.ecostamp.net';
const baseUrl = (process.env.BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
const adminToken = process.env.ADMIN_TOKEN || process.env.WORKFLOW_ADMIN_TOKEN || '';

const args = process.argv.slice(2);
const hasArg = (name) => args.includes(name);
const getArgValue = (name, fallback = '') => {
  const idx = args.indexOf(name);
  return idx >= 0 ? (args[idx + 1] || fallback) : fallback;
};

const force = hasArg('--force');
const dryRun = hasArg('--dry-run');
const withPerps = hasArg('--with-perps');
const allowDexDegraded = hasArg('--allow-dex-degraded');
const profile = String(getArgValue('--profile', 'turbo') || 'turbo').toLowerCase();
const allowedProfiles = new Set(['conservative', 'balanced', 'turbo', 'overdrive']);
const selectedProfile = allowedProfiles.has(profile) ? profile : 'turbo';

const maxDailyLossUsdArg = Number(getArgValue('--max-daily-loss-usd', '20'));
const maxPerTradeLossPctArg = Number(getArgValue('--max-per-trade-loss-pct', '0.015'));
const maxSpreadPctArg = Number(getArgValue('--max-spread-pct', '10'));

const maxDailyLossUsd = Number.isFinite(maxDailyLossUsdArg) && maxDailyLossUsdArg > 0 ? maxDailyLossUsdArg : 20;
const maxPerTradeLossPct = Number.isFinite(maxPerTradeLossPctArg) && maxPerTradeLossPctArg > 0 ? maxPerTradeLossPctArg : 0.015;
const maxSpreadPct = Number.isFinite(maxSpreadPctArg) && maxSpreadPctArg > 0 ? maxSpreadPctArg : 10;

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
  const [readiness, before, dex, safety] = await Promise.all([
    request('/api/readiness'),
    request('/api/status'),
    request('/api/dex'),
    request('/api/safety-state'),
  ]);

  if (!readiness.ok) throw new Error(`/api/readiness failed (${readiness.status}): ${readiness.text}`);
  if (!before.ok) throw new Error(`/api/status failed (${before.status}): ${before.text}`);
  if (!dex.ok) throw new Error(`/api/dex failed (${dex.status}): ${dex.text}`);
  if (!safety.ok) throw new Error(`/api/safety-state failed (${safety.status}): ${safety.text}`);

  const readyForLive = readiness.data?.readyForLive === true;
  if (!readyForLive && !force) {
    throw new Error('Live activation blocked: readyForLive=false. Fix readiness checks first, or run with --force.');
  }

  const dexReady = dex.data?.executionReady === true;
  if (!dexReady && !allowDexDegraded) {
    throw new Error(
      'DEX activation blocked: /api/dex executionReady=false. Configure HFT_ENGINE_URL + HFT_ENGINE_SECRET then retry, or pass --allow-dex-degraded.'
    );
  }

  if (withPerps && safety.data?.spotOnlyLock === true) {
    throw new Error('Perps activation blocked: spot_only_lock is enabled. Disable lock first or run without --with-perps.');
  }

  const actions = [];

  const desiredFlags = {
    cex: true,
    dex: true,
    perps: withPerps,
    funding: withPerps,
    triangular: true,
    statistical: true,
  };

  const desiredConfig = {
    multi_strategy_live: true,
    auto_profiler_enabled: true,
    auto_profile: selectedProfile,
    scan_symbol_mode: 'cex_union',
    scan_quote_assets: ['USDT', 'USDC', 'FDUSD', 'BUSD'],
    max_dynamic_symbols: 2000,
    max_live_trades_per_scan: 5,
    max_daily_loss_usd: maxDailyLossUsd,
    max_per_trade_loss_pct: maxPerTradeLossPct,
    max_spread_pct: maxSpreadPct,
    strategy_flags: desiredFlags,
  };

  const currentFlags = before.data?.strategy_flags || {};
  const flagsNeedUpdate = Object.entries(desiredFlags)
    .some(([key, value]) => currentFlags[key] !== value);
  const profileNeedsUpdate = String(before.data?.auto_profile || '').toLowerCase() !== selectedProfile;

  const summaryBefore = {
    trading_enabled: before.data?.trading_enabled,
    paper_trading: before.data?.paper_trading,
    enabledExecutionExchanges: before.data?.enabledExecutionExchanges,
    strategy_flags: before.data?.strategy_flags,
    multi_strategy_live: before.data?.multi_strategy_live,
    auto_profile: before.data?.auto_profile,
    dex_execution_ready: dexReady,
    spot_only_lock: safety.data?.spotOnlyLock,
    execution_mode: safety.data?.executionMode,
  };

  if (dryRun) {
    console.log(JSON.stringify({
      baseUrl,
      dryRun: true,
      forced: force,
      allowDexDegraded,
      withPerps,
      readyForLive,
      summaryBefore,
      desiredConfig,
      note: 'No remote writes were performed.',
    }, null, 2));
    return;
  }

  if (!before.data?.multi_strategy_live || flagsNeedUpdate || profileNeedsUpdate) {
    const cfg = await request('/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(desiredConfig),
    });
    if (!cfg.ok) {
      throw new Error(`/config failed (${cfg.status}): ${cfg.text}`);
    }
    actions.push(`config->cex+dex${withPerps ? '+perps' : ''}`);
  }

  if (!withPerps && safety.data?.spotOnlyLock !== true) {
    const lock = await request('/strategy/spot-lock/enable', { method: 'POST' });
    if (!lock.ok) {
      throw new Error(`/strategy/spot-lock/enable failed (${lock.status}): ${lock.text}`);
    }
    actions.push('spot-lock->enabled');
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

  const [after, afterReadiness, afterDex, afterSafety] = await Promise.all([
    request('/api/status'),
    request('/api/readiness'),
    request('/api/dex'),
    request('/api/safety-state'),
  ]);
  if (!after.ok) throw new Error(`/api/status (after) failed (${after.status}): ${after.text}`);
  if (!afterReadiness.ok) throw new Error(`/api/readiness (after) failed (${afterReadiness.status}): ${afterReadiness.text}`);
  if (!afterDex.ok) throw new Error(`/api/dex (after) failed (${afterDex.status}): ${afterDex.text}`);
  if (!afterSafety.ok) throw new Error(`/api/safety-state (after) failed (${afterSafety.status}): ${afterSafety.text}`);

  console.log(JSON.stringify({
    baseUrl,
    readyForLive,
    dexReadyBefore: dexReady,
    dexReadyAfter: afterDex.data?.executionReady === true,
    forced: force,
    withPerps,
    selectedProfile,
    actions,
    before: summaryBefore,
    after: {
      trading_enabled: after.data?.trading_enabled,
      paper_trading: after.data?.paper_trading,
      enabledExecutionExchanges: after.data?.enabledExecutionExchanges,
      strategy_flags: after.data?.strategy_flags,
      multi_strategy_live: after.data?.multi_strategy_live,
      auto_profile: after.data?.auto_profile,
      spot_only_lock: afterSafety.data?.spotOnlyLock,
      execution_mode: afterSafety.data?.executionMode,
      readyForLive: afterReadiness.data?.readyForLive,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
