// src/hft-client.js — Go HFT engine HTTP client
//
// The Cloudflare Worker cannot run a long-lived Go process, but it can call
// the HTTP API exposed by the separately-deployed Go HFT engine.  This module
// provides helpers for:
//
//   1. Fetching the best current opportunity from the Go engine's price book
//      (WebSocket-fed, sub-millisecond latency).
//   2. Delegating on-chain DEX execution to the Go engine, which holds the
//      wallet private key and handles Flashbots bundle submission.
//
// Required env vars (set via `wrangler secret put` or wrangler.toml [vars]):
//   HFT_ENGINE_URL    — Base URL of the running Go HFT engine API server
//                       e.g. https://hft.example.com  or  http://1.2.3.4:8080
//   HFT_ENGINE_SECRET — Bearer token that must match HFT_ENGINE_SECRET on the
//                       Go engine side (leave blank to disable auth check)

const HFT_TIMEOUT_MS = 5000; // abort if engine does not respond in 5 s
import { logEvent, incrementMetric, observeLatency } from './infra/observability.js';

// ── Configuration check ───────────────────────────────────────────────────────

/**
 * Returns true if the HFT engine URL is configured in the environment.
 * @param {object} env — Cloudflare Worker env bindings
 */
export function isHFTEngineConfigured(env) {
  return typeof env.HFT_ENGINE_URL === 'string' && env.HFT_ENGINE_URL.length > 0;
}

function validateHftEngineUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(isLocal && parsed.protocol === 'http:')) {
    throw new Error('HFT_ENGINE_URL must use https:// in non-local environments');
  }
  return parsed.toString().replace(/\/+$/, '');
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

/**
 * Makes an authenticated fetch request to the Go HFT engine with a timeout.
 *
 * @param {object}  env     — Cloudflare Worker env bindings
 * @param {string}  path    — API path relative to HFT_ENGINE_URL, e.g. '/api/scan'
 * @param {object}  [opts]  — Standard fetch options (method, body, etc.)
 * @returns {Promise<Response>}
 */
async function hftFetch(env, path, opts = {}) {
  const base = validateHftEngineUrl(String(env.HFT_ENGINE_URL || '').trim());

  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (env.HFT_ENGINE_SECRET) {
    headers['Authorization'] = `Bearer ${env.HFT_ENGINE_SECRET}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('HFT engine request timed out'), HFT_TIMEOUT_MS);
  try {
    return await fetch(`${base}${path}`, { ...opts, headers, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetches the best current opportunity from the Go HFT engine's live price book.
 * Returns an OpportunityObject compatible with the JS orchestrator, or null when
 * the engine is unavailable, has no opportunities, or returns an error.
 *
 * @param {object} env — Cloudflare Worker env bindings
 * @returns {Promise<object|null>}
 */
export async function scanFromHFT(env) {
  if (!isHFTEngineConfigured(env)) return null;
  const startedAt = Date.now();
  try {
    const resp = await hftFetch(env, '/api/scan');
    if (!resp.ok) return null;
    const data = await resp.json();
    const normalized = data.opportunity ? normalizeOpportunity(data.opportunity) : null;
    if (normalized) {
      incrementMetric('hft.scan.hit');
    } else {
      incrementMetric('hft.scan.miss');
    }
    observeLatency('hft.scan.duration_ms', startedAt);
    return normalized;
  } catch (e) {
    console.error('[HFT] scanFromHFT error:', e.message);
    logEvent('error', 'hft.scan.error', { error: e.message });
    incrementMetric('hft.scan.error');
    return null;
  }
}

/**
 * Executes a trade via the Go HFT engine.
 *
 * Used for DEX and on-chain opportunities that the Cloudflare Worker cannot
 * execute natively (no secp256k1 signing, no Flashbots access).
 *
 * @param {object} env     — Cloudflare Worker env bindings
 * @param {object} opp     — OpportunityObject from the orchestrator
 * @param {number} sizeUsd — Trade size in USD
 * @returns {Promise<void>}
 * @throws {Error} when the engine is unreachable or rejects the request
 */
export async function executeViaHFT(env, opp, sizeUsd) {
  if (!isHFTEngineConfigured(env)) {
    throw new Error(
      'HFT_ENGINE_URL is not configured — cannot execute DEX trade. ' +
      'Deploy the Go HFT engine and set HFT_ENGINE_URL + HFT_ENGINE_SECRET.'
    );
  }

  const startedAt = Date.now();
  const resp = await hftFetch(env, '/api/execute', {
    method: 'POST',
    body: JSON.stringify({
      opportunity: denormalizeOpportunity(opp),
      size_usd: sizeUsd,
    }),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
    incrementMetric('hft.execute.error');
    throw new Error(`HFT engine execute failed (${resp.status}): ${body.error || resp.statusText}`);
  }

  observeLatency('hft.execute.duration_ms', startedAt, { strategy: opp?.strategy || 'unknown' });
  incrementMetric('hft.execute.success');
}

// ── Normalisation helpers ─────────────────────────────────────────────────────
//
// The Go engine uses PascalCase JSON field names (Go default encoding).
// The JS orchestrator expects camelCase / snake_case fields.

/**
 * Maps a Go engine Opportunity (PascalCase) to the JS OpportunityObject format.
 * Accepts either casing so the function is tolerant of both engine versions.
 *
 * @param {object} o — Raw opportunity object from the Go engine
 * @returns {object} OpportunityObject compatible with the orchestrator
 */
function normalizeOpportunity(o) {
  return {
    strategy: (o.Strategy ?? o.strategy ?? 'cex').toLowerCase(),
    symbol: o.Symbol ?? o.symbol ?? '',
    buyExchange: (o.BuyExchange ?? o.buyExchange ?? '').toLowerCase(),
    sellExchange: (o.SellExchange ?? o.sellExchange ?? '').toLowerCase(),
    buyPrice: o.BuyPrice ?? o.buyPrice ?? 0,
    sellPrice: o.SellPrice ?? o.sellPrice ?? 0,
    grossPct: o.GrossPct ?? o.grossPct ?? 0,
    netPct: o.NetPct ?? o.netPct ?? 0,
    safetyFactor: o.SafetyFactor ?? o.safetyFactor ?? 0,
    direction: o.Direction ?? o.direction ?? '',
    isPerp: o.IsPerp ?? o.isPerp ?? false,
    // Mark the source so the orchestrator can route execution back to the engine
    source: 'hft_engine',
  };
}

/**
 * Maps a JS OpportunityObject back to Go Opportunity field names for the
 * /api/execute endpoint.
 *
 * @param {object} o — JS OpportunityObject
 * @returns {object} Go-style Opportunity for the execute request body
 */
function denormalizeOpportunity(o) {
  return {
    Strategy: o.strategy,
    Symbol: o.symbol,
    BuyExchange: o.buyExchange,
    SellExchange: o.sellExchange,
    BuyPrice: o.buyPrice,
    SellPrice: o.sellPrice,
    GrossPct: o.grossPct,
    NetPct: o.netPct,
    SafetyFactor: o.safetyFactor,
    Direction: o.direction,
    IsPerp: o.isPerp,
  };
}

// ── Health Check with Retry ──────────────────────────────────────────────────

// Health Check with Retry
export async function checkHFTEngineHealth(env, maxRetries = 2) {
  if (!isHFTEngineConfigured(env)) return false;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const base = String(env.HFT_ENGINE_URL || '').trim().replace(/\/+$/, '');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch(base + '/api/health', { signal: controller.signal });
      clearTimeout(timeout);
      if (resp.ok) {
        const data = await resp.json().catch(() => ({}));
        if (data.status === 'ok') return true;
      }
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    } catch (_e) {
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  return false;
}
