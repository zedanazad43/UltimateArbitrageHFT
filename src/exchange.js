// nexus/src/exchange.js — Exchange order placement (MEXC, Binance, KuCoin, Bitget, Bitmart)

import { getGlobalProxyPool } from './infra/proxy-pool.js';
import { auditLog, secureFetch } from './infra/security.js';
import { getExternalProxyManager } from './infra/external-proxy.js';
import { ProxyBypassEngine } from './ultra-fast-engine.js';

// ── HMAC-SHA256 helpers ───────────────────────────────────────────────────────

/** Returns HMAC-SHA256 as a lowercase hex string (used by MEXC & Binance). */
async function hmacHex(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Returns HMAC-SHA256 as a base64 string (used by KuCoin, Bitget, Bitmart). */
export async function hmacBase64(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// ── Credential alias helpers ──────────────────────────────────────────────────

/**
 * Alternate env-var names accepted for credential keys that users may have
 * already configured under a different naming convention.
 * Canonical key is tried first; aliases are tried in order.
 */
const CRED_ALIASES = {
  BINANCE_API_SECRET: ['BINANC_API_SECRET'],
  KUCOIN_SECRET_KEY: ['KUCOIN_API_SECRET'],
  BITGET_SECRET_KEY: ['BITGET_API_SECRET'],
  BITMART_SECRET_KEY: ['BITMART_API_SECRET'],
};

/**
 * Reads a credential from env by its canonical key name, transparently
 * falling back to any configured aliases when the canonical key is absent.
 * Returns the value string, or undefined if neither the canonical key nor any
 * alias is set in env.
 */
function resolveEnvKey(env, canonicalKey) {
  const normalize = (v) => {
    if (typeof v !== 'string') return v;
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const canonical = normalize(env[canonicalKey]);
  if (canonical) return canonical;
  for (const alias of (CRED_ALIASES[canonicalKey] || [])) {
    const aliased = normalize(env[alias]);
    if (aliased) return aliased;
  }
  return undefined;
}

/**
 * Returns an error message for a missing credential that includes alias hints.
 */
function missingCredError(canonicalKey) {
  const aliases = CRED_ALIASES[canonicalKey];
  return aliases?.length
    ? `${canonicalKey} (or ${aliases.join(' or ')}) is not configured`
    : `${canonicalKey} is not configured`;
}

const KNOWN_QUOTES = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'DAI', 'TUSD', 'BTC', 'ETH'];

function splitTradingSymbol(symbol) {
  const normalized = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const quotes = [...KNOWN_QUOTES].sort((a, b) => b.length - a.length);
  for (const quote of quotes) {
    if (!normalized.endsWith(quote)) continue;
    const base = normalized.slice(0, -quote.length);
    if (!base || base.length < 2) continue;
    return { symbol: normalized, base, quote };
  }
  return null;
}

// ── Safe JSON parsing ─────────────────────────────────────────────────────────

/** Maximum number of raw-body characters to include in non-JSON error messages. */
const MAX_ERROR_SNIPPET_LENGTH = 200;

function normalizeExchangeErrorMessage(exchange, message) {
  const raw = String(message || 'unknown error');
  const lower = raw.toLowerCase();

  if (
    lower.includes('<!doctype') ||
    lower.includes('cloudflare') ||
    lower.includes('access denied') ||
    lower.includes('forbidden')
  ) {
    return `${raw} (hint: ${exchange} network/WAF block detected from current egress; configure proxy routing)`;
  }

  if (lower.includes('timestamp') || lower.includes('recvwindow') || lower.includes('outside of the recvwindow')) {
    return `${raw} (hint: ${exchange} rejected request timestamp; check clock drift/recvWindow)`;
  }

  return raw;
}

/**
 * Reads the response body as text then parses it as JSON.
 * When the body is not valid JSON (e.g. a Cloudflare error page or plain-text
 * rate-limit message), throws a descriptive error that includes the HTTP status
 * code and the first MAX_ERROR_SNIPPET_LENGTH characters of the raw body instead
 * of a cryptic SyntaxError.
 *
 * @param {Response} resp     – fetch() Response object
 * @param {string}   context  – short label for the exchange/call (e.g. "Bitget trading")
 */
export async function parseJsonResponse(resp, context = '') {
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch (parseErr) {
    // Some exchanges (and some proxy responses) wrap JSON in whitespace,
    // a BOM, or stray text. Try to recover the first balanced {...} or [...] block.
    const cleaned = String(text).replace(/^﻿/, '').trim();
    const firstBrace = cleaned.search(/[[{]/);
    if (firstBrace >= 0) {
      const candidate = cleaned.slice(firstBrace);
      try {
        return JSON.parse(candidate);
      } catch (_) { /* fall through to original error */ }
    }
    const snippet = text.slice(0, MAX_ERROR_SNIPPET_LENGTH);
    const prefix = context ? `${context}: ` : '';
    // Attach HTTP status so callers can detect 429 / 5xx
    const err = new Error(`${prefix}Non-JSON response (HTTP ${resp.status}): ${snippet}`, { cause: parseErr });
    err.status = resp.status;
    throw err;
  }
}

// ── Exchange-aware fetch helper ──────────────────────────────────────────────

/**
 * Detects the exchange name from a URL for rate-limiting and proxy routing.
 * @private
 */
function _detectExchangeFromUrl(url) {
  if (/api\.mexc\.com/i.test(url) || /contract\.mexc\.com/i.test(url)) return 'mexc';
  if (/api\.binance\.com/i.test(url) || /api-futures\.binance\.com/i.test(url)) return 'binance';
  if (/api\.kucoin\.com/i.test(url)) return 'kucoin';
  if (/(?:^|\.)c?api\.bitget\.com/i.test(url) || /api\.bitget\.com/i.test(url)) return 'bitget';
  if (/api-cloud\.bitmart\.com/i.test(url)) return 'bitmart';
  if (/api\.htx\.com/i.test(url)) return 'htx';
  if (/api\.bybit\.com/i.test(url)) return 'bybit';
  if (/api\.gateio\.ws/i.test(url)) return 'gateio';
  return 'unknown';
}

/**
 * Exchange-aware fetch that routes through secureFetch with rate-limiting,
 * proxy pool integration, retry on transient errors, and 429 backoff.
 *
 * @param {string} url      - Target URL
 * @param {object} options  - fetch() options
 * @param {string} [exchange] - Override exchange name (auto-detected from URL if omitted)
 * @param {number} [maxRetries=2] - Max retries on transient errors
 */
export async function exchangeFetch(url, options = {}, exchange, maxRetries = 2, env = null) {
  const ex = exchange || _detectExchangeFromUrl(url);

  // ── Proxy bypass for geo-blocked exchanges ──
  // Route Binance/KuCoin/Bitget through the external proxy manager (non-US
  // egress + gateway auth). This is the reliable path used by bitgetFetch.
  if (env && ex && ['kucoin', 'binance'].includes(ex)) {
    try {
      const proxyManager = getExternalProxyManager(env);
      const stats = proxyManager.getStats();
      if (stats?.enabled) {
        return proxyManager.fetchWithFallback(url, options, 15000);
      }
    } catch (_) {
      // Fall through to standard path below
    }
  }

  // ── Legacy ProxyBypassEngine path (kept for bitget-style fallback) ──
  if (env && ex && ['bitget'].includes(ex)) {
    try {
      const bypassEngine = new ProxyBypassEngine(env);
      const result = await bypassEngine.fetchWithBypass(url, ex, {
        method: options.method || 'GET',
        headers: options.headers,
        body: options.body,
      });
      if (result) return result;
    } catch (_) {
      // Fall through to standard path below
    }
  }

  // ── Standard routing: use global proxy pool ──
  const proxyPool = getGlobalProxyPool(env || undefined);
  return secureFetch(ex, url, options, proxyPool, maxRetries);
}

/**
 * Bitget-aware fetch helper.
 * Uses external proxy manager when configured; otherwise falls back to
 * exchangeFetch for normal secure/rate-limited routing.
 */
async function bitgetFetch(env, url, options = {}, maxRetries = 2) {
  try {
    const proxyManager = getExternalProxyManager(env);
    const stats = proxyManager.getStats();
    if (stats?.enabled) {
      return proxyManager.fetchWithFallback(url, options, 15000);
    }
  } catch (_) {
    // Fallback to standard exchange path if proxy manager is unavailable.
  }
  return secureFetch('bitget', url, options, getGlobalProxyPool(env), maxRetries);
}

/**
 * Fetches the MEXC spot account balance for a given asset (default: USDT).
 * Returns { free: number, locked: number } or throws on error.
 */
export async function getMEXCBalance(env, asset = 'USDT') {
  const apiKey = resolveEnvKey(env, 'MEXC_API_KEY');
  const apiSecret = resolveEnvKey(env, 'MEXC_API_SECRET');
  if (!apiKey) throw new Error('MEXC_API_KEY is not configured');
  if (!apiSecret) throw new Error('MEXC_API_SECRET is not configured');

  const fetchAccount = async (timestampMs) => {
    const query = `timestamp=${timestampMs}&recvWindow=10000`;
    const signature = await hmacHex(apiSecret, query);
    const resp = await exchangeFetch(
      `https://api.mexc.com/api/v3/account?${query}&signature=${signature}`,
      { headers: { 'X-MEXC-APIKEY': apiKey } },
      'mexc', 2, env
    );
    return parseJsonResponse(resp, 'MEXC account');
  };

  let data;
  try {
    data = await fetchAccount(Date.now().toString());
  } catch (err) {
    throw new Error(normalizeExchangeErrorMessage('MEXC', err.message), { cause: err });
  }

  // Timestamp drift fallback: query exchange server time and retry once.
  if (data?.code && String(data.msg || '').toLowerCase().includes('timestamp')) {
    try {
      const timeResp = await exchangeFetch('https://api.mexc.com/api/v3/time', {}, 'mexc', 2, env);
      const timeData = await parseJsonResponse(timeResp, 'MEXC time');
      const serverTime = String(timeData?.serverTime || Date.now());
      data = await fetchAccount(serverTime);
    } catch (err) {
      throw new Error(normalizeExchangeErrorMessage('MEXC', err.message), { cause: err });
    }
  }

  if (data.code) {
    throw new Error(normalizeExchangeErrorMessage('MEXC', data.msg || `MEXC account error ${data.code}`));
  }

  // When no asset specified, return the full balance list (used by getAllExchangeBalances)
  if (!asset) {
    return { balances: data.balances || [] };
  }

  const bal = (data.balances || []).find(b => b.asset === asset);
  return {
    free: parseFloat(bal?.free || '0'),
    locked: parseFloat(bal?.locked || '0')
  };
}

/**
 * Returns true when free USDT balance >= requiredUsd.
 * Returns false (safe default) when the API call fails.
 */
export async function hasSufficientUSDT(env, requiredUsd) {
  try {
    const bal = await getMEXCBalance(env, 'USDT');
    return bal.free >= requiredUsd;
  } catch (e) {
    console.error('[exchange] balance check failed:', e.message);
    return false;
  }
}

function getMEXCFuturesCredentialCandidates(env) {
  const candidates = [];
  if (env.MEXC_API_KEY && env.MEXC_API_SECRET) {
    candidates.push({ label: 'primary', apiKey: env.MEXC_API_KEY, apiSecret: env.MEXC_API_SECRET });
  }
  if (env.MEXC_API_KEY_2 && env.MEXC_API_SECRET_2) {
    const duplicatePrimary =
      env.MEXC_API_KEY_2 === env.MEXC_API_KEY &&
      env.MEXC_API_SECRET_2 === env.MEXC_API_SECRET;
    if (!duplicatePrimary) {
      candidates.push({ label: 'secondary', apiKey: env.MEXC_API_KEY_2, apiSecret: env.MEXC_API_SECRET_2 }); // gitleaks:allow
    }
  }
  return candidates;
}

function assertMEXCFuturesCredentialShape(env) {
  const hasSecondaryComplete = !!(env.MEXC_API_KEY_2 && env.MEXC_API_SECRET_2);
  if (env.MEXC_API_KEY && !env.MEXC_API_SECRET && !hasSecondaryComplete) {
    throw new Error('MEXC_API_SECRET is not configured');
  }
  if (!env.MEXC_API_KEY && env.MEXC_API_SECRET && !hasSecondaryComplete) {
    throw new Error('MEXC_API_KEY is not configured');
  }
}

/**
 * Fetches the MEXC Futures account balance for a given currency (default: USDT).
 * Returns { equity: number, availableBalance: number } or throws on error.
 */
export async function getMEXCFuturesBalance(env, currency = 'USDT') {
  assertMEXCFuturesCredentialShape(env);
  const candidates = getMEXCFuturesCredentialCandidates(env);
  if (candidates.length === 0) {
    throw new Error('MEXC Futures credentials are not configured (set MEXC_API_KEY/MEXC_API_SECRET, optional fallback: MEXC_API_KEY_2/MEXC_API_SECRET_2)');
  }

  const errors = [];
  for (const { label, apiKey, apiSecret } of candidates) {
    const timestamp = Date.now();
    const recvWindow = 5000;
    const authModes = [
      { mode: 'with-recv-window', rawSig: `${timestamp}${apiKey}${recvWindow}`, includeRecvWindow: true },
      { mode: 'no-recv-window', rawSig: `${timestamp}${apiKey}`, includeRecvWindow: false },
    ];

    for (const auth of authModes) {
      const signature = await hmacHex(apiSecret, auth.rawSig);
      try {
        const headers = {
          'ApiKey': apiKey,
          'Request-Time': timestamp.toString(),
          'Signature': signature,
        };
        if (auth.includeRecvWindow) {
          headers['recv-window'] = recvWindow.toString();
        }

        const resp = await exchangeFetch('https://contract.mexc.com/api/v1/private/account/assets', {
          headers
        });
        const data = await parseJsonResponse(resp, 'MEXC futures account');
        if (!data.success) {
          throw new Error(`code=${data.code} message=${data.message} auth=${auth.mode}`);
        }

        const assets = Array.isArray(data.data) ? data.data : [];
        const asset = assets.find(a => a.currency === currency);
        return {
          equity: parseFloat(asset?.equity || '0'),
          availableBalance: parseFloat(asset?.availableBalance || '0'),
          positionMargin: parseFloat(asset?.positionMargin || '0'),
          unrealisedPnl: parseFloat(asset?.unrealisedPnl || '0')
        };
      } catch (err) {
        errors.push(`${label}:${auth.mode}:${err.message}`);
      }
    }
  }

  throw new Error(`MEXC futures account failed across credential candidates (${errors.join(' | ')})`);
}

/**
 * Places a market order on MEXC spot.
 * side: 'BUY' | 'SELL'
 * BUY uses quoteOrderQty (USDT amount); SELL uses quantity (base asset).
 */
export async function placeMarketOrderMEXC(env, symbol, side, quantity, sizeUsd) {
  const apiKey = env.MEXC_API_KEY;
  const apiSecret = env.MEXC_API_SECRET;
  if (!apiKey) throw new Error('MEXC_API_KEY is not configured');
  if (!apiSecret) throw new Error('MEXC_API_SECRET is not configured');

  const timestamp = Date.now().toString();
  const params = { symbol, side: side.toUpperCase(), type: 'MARKET', timestamp };

  if (side.toUpperCase() === 'BUY') {
    // Use quoteOrderQty only when caller provided a valid positive USDT notional.
    if (typeof sizeUsd === 'number' && Number.isFinite(sizeUsd) && sizeUsd > 0) {
      params.quoteOrderQty = sizeUsd.toFixed(2);
    } else {
      // Fallback: allow market buy by base quantity when sizeUsd isn't provided.
      params.quantity = quantity;
    }
  } else {
    params.quantity = quantity;
  }

  const serialized = new URLSearchParams(params).toString();
  params.signature = await hmacHex(apiSecret, serialized);

  const body = new URLSearchParams(params).toString();
  const resp = await exchangeFetch('https://api.mexc.com/api/v3/order', {
    method: 'POST',
    headers: {
      'X-MEXC-APIKEY': apiKey,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  let data = await parseJsonResponse(resp, 'MEXC order');
  if (!data.code) return data;

  // Some MEXC deployments reject form-encoded bodies and only accept signed
  // parameters in the query string for POST /api/v3/order.
  if (String(data.msg || '').toLowerCase().includes('invalid content type')) {
    const query = new URLSearchParams(params).toString();
    const retryResp = await exchangeFetch(`https://api.mexc.com/api/v3/order?${query}`, {
      method: 'POST',
      headers: {
        'X-MEXC-APIKEY': apiKey
      }
    });
    data = await parseJsonResponse(retryResp, 'MEXC order (query fallback)');
    if (!data.code) return data;
  }

  throw new Error(data.msg || `MEXC spot error ${data.code}`);
}

/**
 * Places a futures (perpetuals) order on MEXC.
 * side: 'LONG' | 'SHORT'
 */
export async function placeMEXCFuturesOrder(env, symbol, side, quantity, leverage) {
  assertMEXCFuturesCredentialShape(env);
  const candidates = getMEXCFuturesCredentialCandidates(env);
  if (candidates.length === 0) {
    throw new Error('MEXC Futures credentials are not configured (set MEXC_API_KEY/MEXC_API_SECRET, optional fallback: MEXC_API_KEY_2/MEXC_API_SECRET_2)');
  }

  const perpSymbol = symbol.replace('USDT', '_USDT');
  const recvWindow = 5000;
  // MEXC Futures side codes: 1=open long, 2=close short (buy), 3=open short, 4=close long
  const sideCode = side === 'LONG' ? 1 : 3;

  const orderBody = JSON.stringify({
    symbol: perpSymbol,
    side: sideCode,
    openType: 1,
    type: 5,
    vol: parseFloat(quantity),
    leverage
  });

  const errors = [];
  for (const { label, apiKey, apiSecret } of candidates) {
    const ts = Date.now();
    const authModes = [
      { mode: 'with-recv-window', rawSig: `${ts}${apiKey}${recvWindow}${orderBody}`, includeRecvWindow: true },
      { mode: 'no-recv-window', rawSig: `${ts}${apiKey}${orderBody}`, includeRecvWindow: false },
    ];

    for (const auth of authModes) {
      const signature = await hmacHex(apiSecret, auth.rawSig);

      try {
        const headers = {
          'Content-Type': 'application/json',
          'ApiKey': apiKey,
          'Request-Time': ts.toString(),
          'Signature': signature,
        };
        if (auth.includeRecvWindow) {
          headers['recv-window'] = recvWindow.toString();
        }

        const resp = await exchangeFetch('https://contract.mexc.com/api/v1/private/order/submit', {
          method: 'POST',
          headers,
          body: orderBody
        });
        const data = await parseJsonResponse(resp, 'MEXC futures order');
        if (!data.success) {
          throw new Error((data.message || `MEXC Futures order error code=${data.code || 'unknown'}`) + ` auth=${auth.mode}`);
        }
        return data;
      } catch (err) {
        errors.push(`${label}:${auth.mode}:${err.message}`);
      }
    }
  }

  throw new Error(`MEXC Futures order failed across credential candidates (${errors.join(' | ')})`);
}

// ── Binance ───────────────────────────────────────────────────────────────────

/**
 * Fetches the Binance spot account balance for a given asset (default: USDT).
 * recvWindow=10000 gives a 10-second window to absorb clock drift between
 * the Cloudflare Worker and Binance servers (default 5 s is often too tight).
 */
export async function getBinanceBalance(env, asset = 'USDT') {
  const apiKey = resolveEnvKey(env, 'BINANCE_API_KEY');
  const apiSecret = resolveEnvKey(env, 'BINANCE_API_SECRET');
  if (!apiKey) throw new Error('BINANCE_API_KEY is not configured');
  if (!apiSecret) throw new Error(missingCredError('BINANCE_API_SECRET'));

  const binanceHosts = ['api.binance.com', 'api1.binance.com', 'api2.binance.com', 'api3.binance.com'];
  const fetchAccount = async (host, timestampMs) => {
    const query = `timestamp=${timestampMs}&recvWindow=10000`;
    const signature = await hmacHex(apiSecret, query);
    const resp = await exchangeFetch(
      `https://${host}/api/v3/account?${query}&signature=${signature}`,
      { headers: { 'X-MBX-APIKEY': apiKey } },
      'binance', 2, env
    );
    const data = await parseJsonResponse(resp, 'Binance account');
    return { data, host };
  };

  const errors = [];
  let result = null;
  for (const host of binanceHosts) {
    try {
      result = await fetchAccount(host, Date.now().toString());
      break;
    } catch (err) {
      errors.push(`${host}: ${err.message}`);
    }
  }

  if (!result) {
    throw new Error(normalizeExchangeErrorMessage('Binance', errors.join(' | ') || 'unknown account error'));
  }

  let { data, host } = result;
  if (data?.code === -1021 || String(data?.msg || '').toLowerCase().includes('timestamp')) {
    try {
      const timeResp = await exchangeFetch(`https://${host}/api/v3/time`, {}, 'binance', 2, env);
      const timeData = await parseJsonResponse(timeResp, 'Binance time');
      const retry = await fetchAccount(host, String(timeData?.serverTime || Date.now()));
      data = retry.data;
    } catch (err) {
      throw new Error(normalizeExchangeErrorMessage('Binance', err.message), { cause: err });
    }
  }

  if (data.code) {
    throw new Error(normalizeExchangeErrorMessage('Binance', data.msg || `Binance account error ${data.code}`));
  }

  const bal = (data.balances || []).find(b => b.asset === asset);
  return {
    free: parseFloat(bal?.free || '0'),
    locked: parseFloat(bal?.locked || '0')
  };
}

/**
 * Places a market order on Binance spot.
 * BUY uses quoteOrderQty (USDT); SELL uses quantity (base asset).
 */
export async function placeMarketOrderBinance(env, symbol, side, quantity, sizeUsd) {
  const apiKey = env.BINANCE_API_KEY;
  const apiSecret = resolveEnvKey(env, 'BINANCE_API_SECRET');
  if (!apiKey) throw new Error('BINANCE_API_KEY is not configured');
  if (!apiSecret) throw new Error(missingCredError('BINANCE_API_SECRET'));

  const timestamp = Date.now().toString();
  const params = { symbol, side: side.toUpperCase(), type: 'MARKET', timestamp };

  if (side.toUpperCase() === 'BUY') {
    params.quoteOrderQty = sizeUsd.toFixed(2);
  } else {
    params.quantity = quantity;
  }

  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  params.signature = await hmacHex(apiSecret, sorted);

  const body = new URLSearchParams(params).toString();
  const resp = await exchangeFetch('https://api.binance.com/api/v3/order', {
    method: 'POST',
    headers: {
      'X-MBX-APIKEY': apiKey,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  }, 'binance', 2, env);
  const data = await parseJsonResponse(resp, 'Binance order');
  if (data.code) throw new Error(data.msg || `Binance spot error ${data.code}`);
  return data;
}

// ── KuCoin ────────────────────────────────────────────────────────────────────

function getKuCoinKeyVersions(env) {
  const configured = String(env.KUCOIN_API_KEY_VERSION || '').trim();
  return [...new Set([configured, '2', '3'].filter(Boolean))];
}

async function buildKuCoinAuthHeaders({ apiKey, apiSecret, passphrase, timestamp, method, path, body = '', keyVersion }) {
  const signature = await hmacBase64(apiSecret, timestamp + method + path + body);
  const encPassphrase = await hmacBase64(apiSecret, passphrase);
  return {
    'KC-API-KEY': apiKey,
    'KC-API-SIGN': signature,
    'KC-API-TIMESTAMP': timestamp,
    'KC-API-PASSPHRASE': encPassphrase,
    'KC-API-KEY-VERSION': keyVersion,
  };
}

function isKuCoinAuthVersionError(message) {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('kc-api-key not exists') ||
    normalized.includes('invalid kc-api-key') ||
    normalized.includes('kc-api-key-version') ||
    normalized.includes('passphrase error') ||
    normalized.includes('invalid kc-api-passphrase');
}

function isKuCoinTimestampError(message) {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('kc-api-timestamp') ||
    normalized.includes('timestamp') ||
    normalized.includes('time offset');
}

async function getKuCoinServerTimestamp(env) {
  const resp = await exchangeFetch('https://api.kucoin.com/api/v1/timestamp', {}, 'kucoin', 2, env);
  const data = await parseJsonResponse(resp, 'KuCoin server time');
  if (data?.code !== '200000') {
    throw new Error(data?.msg || `KuCoin server time error ${data?.code || 'unknown'}`);
  }
  const raw = Number(data?.data || Date.now());
  if (!Number.isFinite(raw) || raw <= 0) return Date.now().toString();
  // KuCoin may return seconds on some edges; normalize to ms.
  const ms = raw < 1e12 ? Math.floor(raw * 1000) : Math.floor(raw);
  return String(ms);
}

/**
 * Fetches the KuCoin spot account balance for a given asset (default: USDT).
 * KuCoin API v2: passphrase is HMAC-SHA256 signed.
 *
 * Queries ALL account types (main, trade, margin) without the `type` filter so
 * that funds sitting in the main (deposit) wallet are included.  The `reduce`
 * sums `available` across every returned account entry; `holds` is summed for
 * the locked amount.
 */
export async function getKuCoinBalance(env, asset = 'USDT') {
  const apiKey = resolveEnvKey(env, 'KUCOIN_API_KEY');
  const apiSecret = resolveEnvKey(env, 'KUCOIN_SECRET_KEY');
  const passphrase = resolveEnvKey(env, 'KUCOIN_PASSPHRASE');
  if (!apiKey) throw new Error('KUCOIN_API_KEY is not configured');
  if (!apiSecret) throw new Error(missingCredError('KUCOIN_SECRET_KEY'));
  if (!passphrase) throw new Error('KUCOIN_PASSPHRASE is not configured');

  const path = `/api/v1/accounts?currency=${asset}`;
  const errors = [];

  for (const keyVersion of getKuCoinKeyVersions(env)) {
    const tryBalanceRequest = async (timestamp) => {
      const headers = await buildKuCoinAuthHeaders({
        apiKey,
        apiSecret,
        passphrase,
        timestamp,
        method: 'GET',
        path,
        keyVersion,
      });
      // Do not retry signed calls with the same headers/timestamp.
      const resp = await exchangeFetch(`https://api.kucoin.com${path}`, { headers }, 'kucoin', 0, env);
      return parseJsonResponse(resp, 'KuCoin balance');
    };

    let data;
    try {
      data = await tryBalanceRequest(Date.now().toString());
    } catch (err) {
      errors.push(`v${keyVersion}: ${err.message}`);
      continue;
    }

    if (data.code === '200000') {
      const accounts = data.data || [];
      const free = accounts.reduce((sum, acc) => sum + parseFloat(acc.available || '0'), 0);
      const locked = accounts.reduce((sum, acc) => sum + parseFloat(acc.holds || '0'), 0);
      return { free, locked };
    }

    let message = data.msg || `KuCoin balance error ${data.code}`;
    if (isKuCoinTimestampError(message)) {
      try {
        const serverTimestamp = await getKuCoinServerTimestamp(env);
        const retryData = await tryBalanceRequest(serverTimestamp);
        if (retryData.code === '200000') {
          const accounts = retryData.data || [];
          const free = accounts.reduce((sum, acc) => sum + parseFloat(acc.available || '0'), 0);
          const locked = accounts.reduce((sum, acc) => sum + parseFloat(acc.holds || '0'), 0);
          return { free, locked };
        }
        message = retryData.msg || `KuCoin balance error ${retryData.code}`;
      } catch (retryErr) {
        message = `${message} | retry: ${retryErr.message}`;
      }
    }

    errors.push(`v${keyVersion}: ${message}`);
    if (!isKuCoinAuthVersionError(message) && !isKuCoinTimestampError(message)) {
      throw new Error(message);
    }
  }

  throw new Error(errors.join(' | '));
}

/**
 * Places a market order on KuCoin spot.
 * BUY uses `funds` (USDT amount); SELL uses `size` (base asset amount).
 * Symbol format: BTC-USDT.
 */
export async function placeMarketOrderKuCoin(env, symbol, side, quantity, sizeUsd) {
  const apiKey = resolveEnvKey(env, 'KUCOIN_API_KEY');
  const apiSecret = resolveEnvKey(env, 'KUCOIN_SECRET_KEY');
  const passphrase = resolveEnvKey(env, 'KUCOIN_PASSPHRASE');
  if (!apiKey) throw new Error('KUCOIN_API_KEY is not configured');
  if (!apiSecret) throw new Error(missingCredError('KUCOIN_SECRET_KEY'));
  if (!passphrase) throw new Error('KUCOIN_PASSPHRASE is not configured');

  const parsed = splitTradingSymbol(symbol);
  if (!parsed) throw new Error(`Unsupported symbol format: ${symbol}`);
  const kuSymbol = `${parsed.base}-${parsed.quote}`;
  const path = '/api/v1/orders';

  const orderObj = {
    clientOid: `nexus_${Date.now()}`,
    side: side.toLowerCase(),
    symbol: kuSymbol,
    type: 'market'
  };
  if (side.toUpperCase() === 'BUY') {
    orderObj.funds = sizeUsd.toFixed(2);   // quote currency (USDT, 2 decimal precision)
  } else {
    orderObj.size = quantity;              // base currency
  }

  const bodyStr = JSON.stringify(orderObj);
  const errors = [];

  for (const keyVersion of getKuCoinKeyVersions(env)) {
    const tryOrderRequest = async (timestamp) => {
      const headers = await buildKuCoinAuthHeaders({
        apiKey,
        apiSecret,
        passphrase,
        timestamp,
        method: 'POST',
        path,
        body: bodyStr,
        keyVersion,
      });

      const resp = await exchangeFetch(`https://api.kucoin.com${path}`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: bodyStr
      }, 'kucoin', 0, env);
      return parseJsonResponse(resp, 'KuCoin order');
    };

    let data;
    try {
      data = await tryOrderRequest(Date.now().toString());
    } catch (err) {
      errors.push(`v${keyVersion}: ${err.message}`);
      continue;
    }
    if (data.code === '200000') return data;

    let message = data.msg || `KuCoin spot error ${data.code}`;
    if (isKuCoinTimestampError(message)) {
      try {
        const serverTimestamp = await getKuCoinServerTimestamp(env);
        const retryData = await tryOrderRequest(serverTimestamp);
        if (retryData.code === '200000') return retryData;
        message = retryData.msg || `KuCoin spot error ${retryData.code}`;
      } catch (retryErr) {
        message = `${message} | retry: ${retryErr.message}`;
      }
    }

    errors.push(`v${keyVersion}: ${message}`);
    if (!isKuCoinAuthVersionError(message) && !isKuCoinTimestampError(message)) {
      throw new Error(message);
    }
  }

  throw new Error(errors.join(' | '));
}

// ── Bitget ────────────────────────────────────────────────────────────────────

const BITGET_API_HOSTS = [
  'api.bitget.com',
  'capi.bitget.com',
  'api2.bitget.com',
  'capi2.bitget.com',
  'api3.bitget.com',
  'api.bitget.info',
  'capi.bitget.info',
];
const BITGET_BALANCE_ENDPOINTS = ['/api/v2/spot/account/assets', '/api/spot/v1/account/assets'];
const BITGET_ACCOUNT_BALANCE_ENDPOINT = '/api/v2/account/all-account-balance';
const BITGET_BROWSER_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://www.bitget.com',
  'Referer': 'https://www.bitget.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
};

/**
 * Normalizes Bitget balance payloads across API versions:
 * - v2: { data: [{ coin, available, frozen }] }
 * - legacy variants: { data: { assets|list: [...] } } or entries with coinName/availableAmount/freeze fields
 */
function normalizeBitgetAssets(data) {
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.data?.assets)) return data.data.assets;
  if (Array.isArray(data?.data?.list)) return data.data.list;
  return [];
}

/**
 * Fetches the Bitget spot account balance for a given asset (default: USDT).
 */
export async function getBitgetBalance(env, asset = 'USDT') {
  const apiKey = resolveEnvKey(env, 'BITGET_API_KEY');
  const apiSecret = resolveEnvKey(env, 'BITGET_SECRET_KEY');
  const passphrase = resolveEnvKey(env, 'BITGET_API_PASSPHRASE');
  if (!apiKey) throw new Error('BITGET_API_KEY is not configured');
  if (!apiSecret) throw new Error(missingCredError('BITGET_SECRET_KEY'));
  if (!passphrase) throw new Error('BITGET_API_PASSPHRASE is not configured');

  const errors = [];
  const targetAsset = String(asset ?? '').trim().toUpperCase();
  if (!targetAsset) throw new Error('asset is required');

  for (const requestPath of BITGET_BALANCE_ENDPOINTS) {
    for (const host of BITGET_API_HOSTS) {
      try {
        const timestamp = Date.now().toString();
        // Bitget signature: timestamp + method + requestPath (no query/body for GET)
        const signature = await hmacBase64(apiSecret, timestamp + 'GET' + requestPath);
        const resp = await bitgetFetch(env, `https://${host}${requestPath}`, {
          headers: {
            'ACCESS-KEY': apiKey,
            'ACCESS-SIGN': signature,
            'ACCESS-TIMESTAMP': timestamp,
            'ACCESS-PASSPHRASE': passphrase,
            'Content-Type': 'application/json',
            locale: 'en-US',
            ...BITGET_BROWSER_HEADERS,
          }
        });
        const data = await parseJsonResponse(resp, 'Bitget balance');
        if (data?.code !== '00000') {
          const msg = data?.msg || data?.message || data?.error || JSON.stringify(data);
          errors.push(`${host}${requestPath}: ${msg}`);
          continue;
        }

        const assets = normalizeBitgetAssets(data);
        const bal = assets.find((a) => {
          const coin = String(a?.coin ?? a?.coinName ?? a?.asset ?? a?.currency ?? '').toUpperCase();
          return coin === targetAsset;
        });
        if (!bal) return { free: 0, locked: 0 };

        return {
          free: parseFloat(bal?.available ?? bal?.availableAmount ?? bal?.usable ?? '0'),
          locked: parseFloat(bal?.frozen ?? bal?.locked ?? bal?.freeze ?? '0')
        };
      } catch (err) {
        const errMsg = (err?.cause?.message || err?.message || String(err) || 'unknown fetch error');
        errors.push(`${host}${requestPath}: ${errMsg}`);
      }
    }
  }

  throw new Error(normalizeExchangeErrorMessage('Bitget', `Bitget balance failed: ${errors.join(' | ') || 'unknown error'}`));
}

/**
 * Fetches Bitget account-level USDT-equivalent balances across account types.
 * Returns spot/futures/funding breakdown + total (all in USDT terms).
 */
export async function getBitgetAccountEquityUSDT(env) {
  const apiKey = resolveEnvKey(env, 'BITGET_API_KEY');
  const apiSecret = resolveEnvKey(env, 'BITGET_SECRET_KEY');
  const passphrase = resolveEnvKey(env, 'BITGET_API_PASSPHRASE');
  if (!apiKey) throw new Error('BITGET_API_KEY is not configured');
  if (!apiSecret) throw new Error(missingCredError('BITGET_SECRET_KEY'));
  if (!passphrase) throw new Error('BITGET_API_PASSPHRASE is not configured');

  // Perf fix: probe every configured Bitget host in parallel and take the FIRST
  // successful response (Promise.any) instead of trying them one-by-one
  // sequentially. The hosts are independent, so a slow/blocked origin no longer
  // adds up to N× latency — we only wait for the fastest healthy host.
  // Rate-limit (code !== '00000' but a soft rejection) is treated as a failed
  // attempt so a different host gets a chance to win the race.
  const errors = [];
  const attemptHost = async (host) => {
    const timestamp = Date.now().toString();
    const requestPath = BITGET_ACCOUNT_BALANCE_ENDPOINT;
    const signature = await hmacBase64(apiSecret, timestamp + 'GET' + requestPath);
    const resp = await bitgetFetch(env, `https://${host}${requestPath}`, {
      headers: {
        'ACCESS-KEY': apiKey,
        'ACCESS-SIGN': signature,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': passphrase,
        'Content-Type': 'application/json',
        locale: 'en-US',
        ...BITGET_BROWSER_HEADERS,
      }
    });
    const data = await parseJsonResponse(resp, 'Bitget all-account-balance');
    if (data?.code !== '00000') {
      const msg = data?.msg || data?.message || data?.error || JSON.stringify(data);
      throw new Error(`${host}${requestPath}: ${msg}`);
    }

    const rows = Array.isArray(data?.data) ? data.data : [];
    const summary = {
      spot: 0,
      futures: 0,
      funding: 0,
      total: 0,
    };

    for (const row of rows) {
      const type = String(row?.accountType || '').toLowerCase();
      const value = Number.parseFloat(row?.usdtBalance ?? '0');
      const usdt = Number.isFinite(value) ? value : 0;
      if (type === 'spot') summary.spot = usdt;
      else if (type === 'futures') summary.futures = usdt;
      else if (type === 'funding') summary.funding = usdt;
    }
    summary.total = summary.spot + summary.futures + summary.funding;
    return { host, summary };
  };

  try {
    const winner = await Promise.any(BITGET_API_HOSTS.map(attemptHost));
    return winner.summary;
  } catch (aggregate) {
    // Promise.any rejects with AggregateError when ALL hosts failed. Flatten the
    // per-host reasons into the existing error shape for callers.
    const reasons = (aggregate?.errors || [])
      .map((e) => (e?.message || String(e)))
      .filter(Boolean);
    if (reasons.length) errors.push(...reasons);
    throw new Error(normalizeExchangeErrorMessage('Bitget', `Bitget account equity failed: ${errors.join(' | ') || 'unknown error'}`));
  }
}

/**
 * Places a market order on Bitget spot.
 * BUY: size = USDT amount.
 * SELL: size = base asset amount.
 */
export async function placeMarketOrderBitget(env, symbol, side, quantity, sizeUsd) {
  const apiKey = env.BITGET_API_KEY;
  const apiSecret = resolveEnvKey(env, 'BITGET_SECRET_KEY');
  const passphrase = env.BITGET_API_PASSPHRASE;
  if (!apiKey) throw new Error('BITGET_API_KEY is not configured');
  if (!apiSecret) throw new Error(missingCredError('BITGET_SECRET_KEY'));
  if (!passphrase) throw new Error('BITGET_API_PASSPHRASE is not configured');

  const timestamp = Date.now().toString();
  const path = '/api/v2/spot/trade/place-order';

  const orderObj = {
    symbol,
    side: side.toLowerCase(),
    orderType: 'market',
    force: 'gtc',
    size: side.toUpperCase() === 'BUY' ? sizeUsd.toFixed(8) : quantity
  };

  const bodyStr = JSON.stringify(orderObj);
  const strToSign = timestamp + 'POST' + path + bodyStr;
  const signature = await hmacBase64(apiSecret, strToSign);

  const errors = [];
  for (const host of BITGET_API_HOSTS) {
    try {
      const resp = await bitgetFetch(env, `https://${host}${path}`, {
        method: 'POST',
        headers: {
          'ACCESS-KEY': apiKey,
          'ACCESS-SIGN': signature,
          'ACCESS-TIMESTAMP': timestamp,
          'ACCESS-PASSPHRASE': passphrase,
          'Content-Type': 'application/json',
          'locale': 'en-US',
          ...BITGET_BROWSER_HEADERS,
        },
        body: bodyStr
      });
      const data = await parseJsonResponse(resp, 'Bitget order');
      if (data?.code === '00000') return data;

      const msg = data?.msg || data?.message || data?.error || JSON.stringify(data);
      errors.push(`${host}: ${msg}`);
      if (data?.cloudflare === 'block') continue;
    } catch (err) {
      errors.push(`${host}: ${err.message || String(err)}`);
    }
  }
  throw new Error(`Bitget order failed: ${errors.join(' | ') || 'unknown error'}`);
}

// ── Bitmart ───────────────────────────────────────────────────────────────────

/**
 * Fetches the Bitmart spot wallet balance for a given asset (default: USDT).
 * Requires BITMART_MEMO (generated when creating the API key on Bitmart).
 */
export async function getBitmartBalance(env, asset = 'USDT') {
  const apiKey = resolveEnvKey(env, 'BITMART_API_KEY');
  const apiSecret = resolveEnvKey(env, 'BITMART_SECRET_KEY');
  const memo = resolveEnvKey(env, 'BITMART_MEMO');
  if (!apiKey) throw new Error('BITMART_API_KEY is not configured');
  if (!apiSecret) throw new Error(missingCredError('BITMART_SECRET_KEY'));
  if (!memo) throw new Error('BITMART_MEMO is not configured');

  // BitMart has strict rate limits — use proxy + retry
  const proxyPool = getGlobalProxyPool(env);
  const maxRetries = 3;
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const timestamp = Date.now().toString();
      const strToSign = `${timestamp}#${memo}#`;
      const signature = await hmacBase64(apiSecret, strToSign);

      const url = 'https://api-cloud.bitmart.com/spot/v1/wallet';
      const headers = {
        'X-BM-KEY': apiKey,
        'X-BM-SIGN': signature,
        'X-BM-TIMESTAMP': timestamp,
        'Content-Type': 'application/json',
      };

      const resp = await proxyPool.fetchWithProxy(url, { headers }, 2);
      const data = await parseJsonResponse(resp, 'Bitmart balance');

      // BitMart rate limit: code 429 or 50006
      if (data.code === 429 || data.code === 50006) {
        const backoff = Math.min(1000 * Math.pow(2, attempt), 8000);
        console.warn(`[bitmart] Rate limited on balance query, retrying in ${backoff}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }

      if (data.code !== 1000) {
        throw new Error(data.message || `Bitmart balance error ${data.code}`);
      }

      const wallet = (data.data?.wallet || []).find(w => w.currency === asset);
      return {
        free: parseFloat(wallet?.available || '0'),
        locked: parseFloat(wallet?.frozen || '0'),
      };
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        const backoff = Math.min(1000 * Math.pow(2, attempt), 8000);
        console.warn(`[bitmart] Balance query failed: ${err.message}, retrying in ${backoff}ms`);
        await new Promise(r => setTimeout(r, backoff));
      }
    }
  }
  throw lastError || new Error('Bitmart balance query failed after retries');
}

/**
 * Places a market order on Bitmart spot.
 * BUY: notional = USDT amount.
 * SELL: size = base asset amount.
 * Symbol format: BTC_USDT.
 */
export async function placeMarketOrderBitmart(env, symbol, side, quantity, sizeUsd) {
  const apiKey = env.BITMART_API_KEY;
  const apiSecret = resolveEnvKey(env, 'BITMART_SECRET_KEY');
  const memo = env.BITMART_MEMO;
  if (!apiKey) throw new Error('BITMART_API_KEY is not configured');
  if (!apiSecret) throw new Error(missingCredError('BITMART_SECRET_KEY'));
  if (!memo) throw new Error('BITMART_MEMO is not configured');

  const parsed = splitTradingSymbol(symbol);
  if (!parsed) throw new Error(`Unsupported symbol format: ${symbol}`);
  const bmSymbol = `${parsed.base}_${parsed.quote}`;

  // BitMart order placement — proxy + retry with exponential backoff
  const proxyPool = getGlobalProxyPool(env);
  const maxRetries = 3;
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const timestamp = Date.now().toString();

      const orderObj = {
        symbol: bmSymbol,
        side: side.toLowerCase(),
        type: 'market',
      };
      if (side.toUpperCase() === 'BUY') {
        orderObj.notional = sizeUsd.toFixed(8);  // USDT amount
      } else {
        orderObj.size = quantity;                // base asset amount
      }

      const bodyStr = JSON.stringify(orderObj);
      const strToSign = `${timestamp}#${memo}#${bodyStr}`;
      const signature = await hmacBase64(apiSecret, strToSign);

      const url = 'https://api-cloud.bitmart.com/spot/v2/submit_order';
      const resp = await proxyPool.fetchWithProxy(url, {
        method: 'POST',
        headers: {
          'X-BM-KEY': apiKey,
          'X-BM-SIGN': signature,
          'X-BM-TIMESTAMP': timestamp,
          'Content-Type': 'application/json',
        },
        body: bodyStr,
      }, 2);

      const data = await parseJsonResponse(resp, 'Bitmart order');

      // BitMart rate limit: code 429 or 50006
      if (data.code === 429 || data.code === 50006) {
        const backoff = Math.min(1500 * Math.pow(2, attempt), 10000);
        console.warn(`[bitmart] Rate limited on order, retrying in ${backoff}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }

      // BitMart insufficient balance: code 40001 or 50011
      if (data.code === 40001 || data.code === 50011) {
        throw new Error(`BitMart insufficient balance: ${data.message || data.code}`);
      }

      // BitMart trading restricted / symbol issues: code 40005, 40006
      if (data.code === 40005 || data.code === 40006) {
        throw new Error(`BitMart trading restricted: ${data.message || data.code}`);
      }

      if (data.code !== 1000) {
        throw new Error(data.message || `Bitmart order error ${data.code}`);
      }

      auditLog({
        type: 'bitmart_order_placed',
        level: 'info',
        details: {
          symbol: bmSymbol, side, sizeUsd,
          orderId: data.data?.order_id,
          attempt: attempt + 1,
        },
      });

      return data;
    } catch (err) {
      lastError = err;
      // Don't retry on balance/restriction errors — they won't change
      if (err.message.includes('insufficient balance') || err.message.includes('trading restricted')) {
        throw err;
      }
      if (attempt < maxRetries - 1) {
        const backoff = Math.min(1500 * Math.pow(2, attempt), 10000);
        console.warn(`[bitmart] Order failed: ${err.message}, retrying in ${backoff}ms`);
        await new Promise(r => setTimeout(r, backoff));
      }
    }
  }
  throw lastError || new Error('Bitmart order failed after retries');
}

// ── Bybit ─────────────────────────────────────────────────────────────────────

/**
 * Fetches the Bybit unified account wallet balance for a given asset (default: USDT).
 */
export async function getBybitBalance(env, asset = 'USDT') {
  const apiKey = env.BYBIT_API_KEY;
  const apiSecret = env.BYBIT_API_SECRET;
  if (!apiKey) throw new Error('BYBIT_API_KEY is not configured');
  if (!apiSecret) throw new Error('BYBIT_API_SECRET is not configured');

  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const params = `accountType=UNIFIED&coin=${asset}`;
  const rawSign = timestamp + apiKey + recvWindow + params;
  const signature = await hmacHex(apiSecret, rawSign);

  const resp = await exchangeFetch(
    `https://api.bybit.com/v5/account/wallet-balance?${params}`,
    {
      headers: {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'X-BAPI-SIGN': signature
      }
    }
  );
  const data = await parseJsonResponse(resp, 'Bybit balance');
  if (data.retCode !== 0) throw new Error(data.retMsg || `Bybit balance error ${data.retCode}`);

  const coins = data?.result?.list?.[0]?.coin || [];
  const coin = coins.find(c => c.coin === asset);
  return {
    free: parseFloat(coin?.availableToWithdraw || coin?.walletBalance || '0'),
    locked: parseFloat(coin?.locked || '0')
  };
}

/**
 * Places a market order on Bybit spot (V5 API).
 * BUY uses marketUnit=quoteCoin (spend USDT); SELL uses marketUnit=baseCoin.
 */
export async function placeMarketOrderBybit(env, symbol, side, quantity, sizeUsd) {
  const apiKey = env.BYBIT_API_KEY;
  const apiSecret = env.BYBIT_API_SECRET;
  if (!apiKey) throw new Error('BYBIT_API_KEY is not configured');
  if (!apiSecret) throw new Error('BYBIT_API_SECRET is not configured');

  const timestamp = Date.now().toString();
  const recvWindow = '5000';

  const orderObj = {
    category: 'spot',
    symbol,
    side: side === 'BUY' ? 'Buy' : 'Sell',
    orderType: 'Market',
    qty: side === 'BUY' ? sizeUsd.toFixed(8) : quantity,
    marketUnit: side === 'BUY' ? 'quoteCoin' : 'baseCoin'
  };

  const bodyStr = JSON.stringify(orderObj);
  const rawSign = timestamp + apiKey + recvWindow + bodyStr;
  const signature = await hmacHex(apiSecret, rawSign);

  const resp = await exchangeFetch('https://api.bybit.com/v5/order/create', {
    method: 'POST',
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
      'X-BAPI-SIGN': signature,
      'Content-Type': 'application/json'
    },
    body: bodyStr
  });
  const data = await parseJsonResponse(resp, 'Bybit order');
  if (data.retCode !== 0) throw new Error(data.retMsg || `Bybit order error ${data.retCode}`);
  return data;
}

// ── Gate.io ───────────────────────────────────────────────────────────────────

/** Returns HMAC-SHA512 as a lowercase hex string (used by Gate.io). */
async function hmacSha512Hex(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Returns SHA-256 hex digest of a string (used by Gate.io request signing). */
async function sha256Hex(data) {
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Fetches the Gate.io spot account balance for a given asset (default: USDT).
 */
export async function getGateioBalance(env, asset = 'USDT') {
  const apiKey = env.GATEIO_API_KEY;
  const apiSecret = env.GATEIO_API_SECRET;
  if (!apiKey) throw new Error('GATEIO_API_KEY is not configured');
  if (!apiSecret) throw new Error('GATEIO_API_SECRET is not configured');

  const method = 'GET';
  const path = '/api/v4/spot/accounts';
  const query = `currency=${asset}`;
  const bodyHash = await sha256Hex('');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const rawSign = `${method}\n${path}\n${query}\n${bodyHash}\n${timestamp}`;
  const signature = await hmacSha512Hex(apiSecret, rawSign);

  const resp = await exchangeFetch(`https://api.gateio.ws${path}?${query}`, {
    headers: {
      'KEY': apiKey,
      'SIGN': signature,
      'Timestamp': timestamp
    }
  });
  const data = await parseJsonResponse(resp, 'Gateio balance');
  if (!Array.isArray(data)) throw new Error(`Gateio balance error: ${JSON.stringify(data)}`);

  const acc = data.find(a => a.currency === asset);
  return {
    free: parseFloat(acc?.available || '0'),
    locked: parseFloat(acc?.locked || '0')
  };
}

/**
 * Places a market order on Gate.io spot.
 * BUY: amount is in quote currency (USDT); SELL: amount is in base currency.
 */
export async function placeMarketOrderGateio(env, symbol, side, quantity, sizeUsd) {
  const apiKey = env.GATEIO_API_KEY;
  const apiSecret = env.GATEIO_API_SECRET;
  if (!apiKey) throw new Error('GATEIO_API_KEY is not configured');
  if (!apiSecret) throw new Error('GATEIO_API_SECRET is not configured');

  const parsed = splitTradingSymbol(symbol);
  if (!parsed) throw new Error(`Unsupported symbol format: ${symbol}`);
  const gateSymbol = `${parsed.base}_${parsed.quote}`;
  const method = 'POST';
  const path = '/api/v4/spot/orders';
  const query = '';

  const orderObj = {
    currency_pair: gateSymbol,
    type: 'market',
    side: side.toLowerCase(),
    time_in_force: 'ioc',
    amount: side === 'BUY' ? sizeUsd.toFixed(8) : quantity
  };

  const bodyStr = JSON.stringify(orderObj);
  const bodyHash = await sha256Hex(bodyStr);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const rawSign = `${method}\n${path}\n${query}\n${bodyHash}\n${timestamp}`;
  const signature = await hmacSha512Hex(apiSecret, rawSign);

  const resp = await exchangeFetch(`https://api.gateio.ws${path}`, {
    method: 'POST',
    headers: {
      'KEY': apiKey,
      'SIGN': signature,
      'Timestamp': timestamp,
      'Content-Type': 'application/json'
    },
    body: bodyStr
  });
  const data = await parseJsonResponse(resp, 'Gateio order');
  if (data.label) throw new Error(`Gateio order error: ${data.label} — ${data.message || ''}`);
  return data;
}

// ── HTX (Huobi) ───────────────────────────────────────────────────────────────

/**
 * Fetches the HTX spot account balance for a given asset (default: USDT).
 * Uses HTX REST API v1 with HMAC-SHA256 signature.
 */
export async function getHTXBalance(env, asset = 'usdt') {
  const apiKey = env.HTX_API_KEY;
  const apiSecret = env.HTX_API_SECRET;
  if (!apiKey) throw new Error('HTX_API_KEY is not configured');
  if (!apiSecret) throw new Error('HTX_API_SECRET is not configured');

  const method = 'GET';
  const host = 'api.htx.com';
  const path = '/v1/account/accounts';
  const timestamp = new Date().toISOString(); // Keep full ISO with milliseconds for HTX compatibility
  const params = new URLSearchParams({
    AccessKeyId: apiKey,
    SignatureMethod: 'HmacSHA256',
    SignatureVersion: '2',
    Timestamp: timestamp
  });
  const payload = `${method}\n${host}\n${path}\n${params.toString()}`;
  const signature = await hmacBase64(apiSecret, payload);
  params.append('Signature', signature);

  const resp = await exchangeFetch(`https://${host}${path}?${params}`, { method });
  const data = await parseJsonResponse(resp, 'HTX accounts');
  if (data.status !== 'ok') throw new Error(data['err-msg'] || `HTX accounts error`);

  // Look up the balance for the specific account ID with 'spot' subtype
  const spotAccounts = (data.data || []).filter(a => a.type === 'spot');
  if (spotAccounts.length === 0) return { free: 0, locked: 0 };

  const accountId = spotAccounts[0].id;

  const balPath = `/v1/account/accounts/${accountId}/balance`;
  const balParams = new URLSearchParams({
    AccessKeyId: apiKey,
    SignatureMethod: 'HmacSHA256',
    SignatureVersion: '2',
    Timestamp: timestamp
  });
  const balPayload = `${method}\n${host}\n${balPath}\n${balParams.toString()}`;
  const balSignature = await hmacBase64(apiSecret, balPayload);
  balParams.append('Signature', balSignature);

  const balResp = await exchangeFetch(`https://${host}${balPath}?${balParams}`);
  const balData = await parseJsonResponse(balResp, 'HTX balance');
  if (balData.status !== 'ok') throw new Error(balData['err-msg'] || 'HTX balance error');

  const lowerAsset = asset.toLowerCase();
  const list = balData.data?.list || [];
  let free = 0, locked = 0;
  for (const entry of list) {
    if (entry.currency !== lowerAsset) continue;
    if (entry.type === 'trade') free = parseFloat(entry.balance || '0');
    if (entry.type === 'frozen') locked = parseFloat(entry.balance || '0');
  }
  return { free, locked };
}

/**
 * Places a market order on HTX spot.
 * BUY: uses buy-market (USDT amount); SELL: uses sell-market (base asset amount).
 */
export async function placeMarketOrderHTX(env, symbol, side, quantity, sizeUsd) {
  const apiKey = env.HTX_API_KEY;
  const apiSecret = env.HTX_API_SECRET;
  if (!apiKey) throw new Error('HTX_API_KEY is not configured');
  if (!apiSecret) throw new Error('HTX_API_SECRET is not configured');

  const method = 'POST';
  const host = 'api.htx.com';
  const timestamp = new Date().toISOString(); // Keep full ISO with milliseconds for HTX compatibility
  const htxSymbol = symbol.toLowerCase();  // BTCUSDT → btcusdt

  // Determine order type: buy-market or sell-market
  const orderType = side.toUpperCase() === 'BUY' ? 'buy-market' : 'sell-market';
  // buy-market amount is in quote currency (USDT), sell-market in base currency
  const amount = side.toUpperCase() === 'BUY' ? sizeUsd.toFixed(8) : quantity;

  // Step 1: get spot account ID (cached in practice; fetched once per request here)
  const acctPath = '/v1/account/accounts';
  const acctQS = new URLSearchParams({
    AccessKeyId: apiKey, SignatureMethod: 'HmacSHA256',
    SignatureVersion: '2', Timestamp: timestamp
  });
  const acctSig = await hmacBase64(apiSecret, `GET\n${host}\n${acctPath}\n${acctQS.toString()}`);
  acctQS.append('Signature', acctSig);
  const acctResp = await exchangeFetch(`https://${host}${acctPath}?${acctQS}`);
  const acctData = await parseJsonResponse(acctResp, 'HTX account lookup');
  if (acctData.status !== 'ok') throw new Error(acctData['err-msg'] || 'HTX account lookup failed');
  const accountId = (acctData.data || []).find(a => a.type === 'spot')?.id;
  if (!accountId) throw new Error('HTX: no spot account found');

  // Step 2: place the order
  const orderPath = '/v1/order/orders/place';
  const orderQS = new URLSearchParams({
    AccessKeyId: apiKey, SignatureMethod: 'HmacSHA256',
    SignatureVersion: '2', Timestamp: timestamp
  });
  const orderBodyObj = {
    'account-id': accountId,
    symbol: htxSymbol,
    type: orderType,
    amount,
    source: 'spot-api'
  };
  const orderBodyStr = JSON.stringify(orderBodyObj);
  const orderSig = await hmacBase64(
    apiSecret,
    `${method}\n${host}\n${orderPath}\n${orderQS.toString()}`
  );
  orderQS.append('Signature', orderSig);

  const resp = await exchangeFetch(`https://${host}${orderPath}?${orderQS}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: orderBodyStr
  });
  const data = await parseJsonResponse(resp, 'HTX order');
  if (data.status !== 'ok') throw new Error(data['err-msg'] || `HTX order error`);
  return data;
}

// ── Exchange dispatchers ──────────────────────────────────────────────────────

/**
 * Required environment variable keys for each exchange.
 * Used by hasExchangeCredentials to verify configuration.
 */
const EXCHANGE_CRED_KEYS = {
  mexc: ['MEXC_API_KEY', 'MEXC_API_SECRET'],
  binance: ['BINANCE_API_KEY', 'BINANCE_API_SECRET'],
  kucoin: ['KUCOIN_API_KEY', 'KUCOIN_SECRET_KEY', 'KUCOIN_PASSPHRASE'],
  bitget: ['BITGET_API_KEY', 'BITGET_SECRET_KEY', 'BITGET_API_PASSPHRASE'],
  bitmart: ['BITMART_API_KEY', 'BITMART_SECRET_KEY', 'BITMART_MEMO'],
  htx: ['HTX_API_KEY', 'HTX_API_SECRET'],
  // bybit and gateio are price-data sources only (German regulatory restrictions)
};

/**
 * Exchanges excluded from live execution (data-only price feeds).
 * bybit/gateio: German regulatory restrictions (BaFin).
 * kraken/coinbase: public price feeds used for wider market coverage;
 *   execution credentials are not configured — data-only.
 * NOTE: perp feed labels (mexc_perp, binance_perp, bybit_perp) are
 * opportunity buyExchange/sellExchange values — they are NOT in this set so the
 * DATA_ONLY guard in executeTrade() does not block isPerp opportunities before
 * they reach the perp routing branch.
 */
export const DATA_ONLY_EXCHANGES = new Set(['kraken', 'coinbase']);
export const ACTIVE_EXECUTION_EXCHANGES = [
  'mexc', 'binance', 'kucoin', 'bitget', 'bitmart', 'htx', 'bybit', 'gateio'
];

function parseExchangeAllowlist(rawList) {
  if (!rawList) return [];
  return String(rawList)
    .split(',')
    .map((v) => String(v || '').trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Returns currently enabled execution exchanges.
 *
 * Optional env override:
 * - EXECUTION_EXCHANGES_ALLOWLIST="mexc,binance"
 * - ACTIVE_EXECUTION_EXCHANGES="mexc,binance" (legacy alias)
 *
 * Perf fix: the resolved list is memoized by the raw allowlist string so the
 * (cheap but repeated) parse + Set + filter work runs once per distinct config
 * instead of on every call. This function is invoked many times per request
 * (getConfiguredExchanges, isExecutionExchangeEnabled, balance snapshots), and
 * env rarely changes within a Worker instance, so the cache is virtually always
 * a hit. The cache key is the *raw* allowlist value, so an env change (which
 * produces a different raw string) invalidates the entry correctly.
 */
const _enabledExchangesCache = new Map(); // rawAllowlist -> string[]
const _enabledExchangesCacheLimit = 8;     // guard against unbounded growth

export function getEnabledExecutionExchanges(env) {
  const allowlistRaw =
    resolveEnvKey(env, 'EXECUTION_EXCHANGES_ALLOWLIST') ||
    resolveEnvKey(env, 'ACTIVE_EXECUTION_EXCHANGES');
  const cacheKey = allowlistRaw || '';
  const cached = _enabledExchangesCache.get(cacheKey);
  if (cached) return cached;

  const allowlist = parseExchangeAllowlist(allowlistRaw);
  const resolved = allowlist.length === 0
    ? [...ACTIVE_EXECUTION_EXCHANGES]
    : ACTIVE_EXECUTION_EXCHANGES.filter((ex) => allowlist.includes(ex));

  // Bounded cache: drop the oldest entry once we exceed the limit.
  if (_enabledExchangesCache.size >= _enabledExchangesCacheLimit) {
    const oldestKey = _enabledExchangesCache.keys().next().value;
    if (oldestKey !== undefined) _enabledExchangesCache.delete(oldestKey);
  }
  _enabledExchangesCache.set(cacheKey, resolved);
  return resolved;
}

/** Returns true when the exchange is enabled for live execution in the current env. */
export function isExecutionExchangeEnabled(env, exchange) {
  const normalized = String(exchange || '').toLowerCase();
  if (!normalized) return false;
  return getEnabledExecutionExchanges(env).includes(normalized);
}

/**
 * Returns true if all required API credentials for the given exchange are configured.
 * Accepts alias key names (e.g. KUCOIN_API_SECRET in place of KUCOIN_SECRET_KEY).
 */
export function hasExchangeCredentials(env, exchange) {
  const normalized = String(exchange || '').toLowerCase();
  if (!isExecutionExchangeEnabled(env, normalized)) return false;
  const keys = EXCHANGE_CRED_KEYS[normalized];
  if (!keys) return false;
  return keys.every(k => !!resolveEnvKey(env, k));
}

/**
 * Returns the list of required credential keys for an exchange (for error messages).
 */
export function getRequiredCredentialKeys(exchange) {
  return EXCHANGE_CRED_KEYS[exchange?.toLowerCase()] || [];
}

/**
 * Returns the list of canonical credential keys that are not configured for the
 * given exchange, accounting for alias names.  A key is NOT considered missing
 * when an accepted alias is present in env.
 * Labels include "(or ALIAS)" hints where aliases exist.
 */
export function getMissingCredentialKeys(env, exchange) {
  const keys = EXCHANGE_CRED_KEYS[exchange?.toLowerCase()] || [];
  return keys
    .filter(k => !resolveEnvKey(env, k))
    .map(k => {
      const aliases = CRED_ALIASES[k];
      return aliases?.length ? `${k} (or ${aliases.join(' or ')})` : k;
    });
}

/**
 * Returns the list of exchanges that have valid credentials configured in env.
 */
export function getConfiguredExchanges(env) {
  return getEnabledExecutionExchanges(env).filter(ex => hasExchangeCredentials(env, ex));
}

/**
 * Selects the best available exchange for execution based on:
 * 1. Credential availability
 * 2. Priority order (mexc → bitget → others) as tiebreaker
 * 3. USDT balance (picks highest balance among exchanges that meet the requirement)
 * Returns null if no exchange has sufficient balance.
 *
 * @param {object} env        — Cloudflare Worker env bindings
 * @param {number} requiredUsd — minimum USDT balance needed
 * @returns {Promise<string|null>} exchange name or null
 */
export async function selectBestExchange(env, requiredUsd) {
  // Priority order: mexc first, bitget second, others sorted alphabetically
  const PRIORITY = ['mexc', 'bitget'];
  const configured = getConfiguredExchanges(env);
  if (configured.length === 0) return null;

  // Sort configured exchanges by priority then name
  const sorted = [...configured].sort((a, b) => {
    const pa = PRIORITY.indexOf(a);
    const pb = PRIORITY.indexOf(b);
    if (pa !== -1 && pb !== -1) return pa - pb;
    if (pa !== -1) return -1;
    if (pb !== -1) return 1;
    return a.localeCompare(b);
  });

  const balances = await Promise.allSettled(
    sorted.map(async ex => ({ ex, bal: await getExchangeBalance(env, ex, 'USDT') }))
  );

  let bestEx = null;
  let bestBal = 0;

  for (const result of balances) {
    if (result.status !== 'fulfilled') continue;
    const { ex, bal } = result.value;
    if (bal < requiredUsd) continue;
    // Prefer higher balance, but honour priority: among ties keep the higher-priority exchange
    const currentPriority = bestEx ? PRIORITY.indexOf(bestEx) : -2;
    const candidatePriority = PRIORITY.indexOf(ex);
    const higherBalance = bal > bestBal;
    const samePriorityOrBetter =
      bestEx === null ||
      (candidatePriority !== -1 && (currentPriority === -1 || candidatePriority < currentPriority)) ||
      (candidatePriority === currentPriority && higherBalance);
    if (higherBalance || samePriorityOrBetter) {
      bestEx = ex;
      bestBal = bal;
    }
  }

  return bestEx;
}

/**
 * Gets the free balance for the specified asset on the given exchange.
 *
 * Throws on any API or credential error — callers must handle the rejection
 * (e.g. with Promise.allSettled or a per-exchange try/catch).  An unknown
 * exchange name returns 0 as a safe no-op rather than throwing.
 */
export async function getExchangeBalance(env, exchange, asset = 'USDT') {
  switch (exchange?.toLowerCase()) {
    case 'mexc': return (await getMEXCBalance(env, asset)).free;
    case 'binance': return (await getBinanceBalance(env, asset)).free;
    case 'kucoin': return (await getKuCoinBalance(env, asset)).free;
    case 'bitget': return (await getBitgetBalance(env, asset)).free;
    case 'bitmart': return (await getBitmartBalance(env, asset)).free;
    case 'htx': return (await getHTXBalance(env, asset.toLowerCase())).free;
    // bybit/gateio: data-only, no live execution
    default: return 0;
  }
}

/**
 * Returns ALL non-zero balances for an exchange (not just one asset).
 * Each entry: { asset, free, locked, total }.
 *
 * Results are memoized for ALL_BALANCES_CACHE_TTL_MS. This function fans out
 * one upstream call per asset (13 by default) and is invoked by the balances
 * snapshot for every configured exchange, so the in-memory cache collapses
 * repeated route calls within the same Worker instance without changing the
 * success path's shape.
 *
 * IMPORTANT (reliability fix): a fetch failure is now SURFACED by throwing
 * instead of silently returning []. The snapshot caller (getExecutionBalancesSnapshot
 * in index.js) catches this and returns balance: null with an explicit error flag,
 * so a failed fetch is never mis-reported as a genuine $0 balance (which would skew
 * rebalancer capital routing). The cache still collapses only *successful* results;
 * failures are never cached, so each fresh invocation retries upstream once.
 */
const ALL_BALANCES_CACHE_TTL_MS = 5_000;
const _allBalancesCache = new Map(); // exchange -> { ts, value }

export async function getAllExchangeBalances(env, exchange) {
  const cached = _allBalancesCache.get(exchange);
  if (cached && (Date.now() - cached.ts) < ALL_BALANCES_CACHE_TTL_MS) {
    return cached.value;
  }

  const common = ['USDT', 'USDC', 'BTC', 'ETH', 'BNB', 'SOL', 'TRX', 'HT', 'KCS', 'GT', 'BMX', 'MX', 'DOGE'];
  const entries = await Promise.all(
    common.map(async (asset) => {
      const free = Number(await getExchangeBalance(env, exchange, asset) || 0);
      return free > 0 ? { asset, free, locked: 0, total: free } : null;
    })
  );
  const value = entries.filter(Boolean).sort((a, b) => b.total - a.total);

  // Cache ONLY successful results. Failures are intentionally not cached so a
  // transient upstream error is retried on the next snapshot rather than being
  // pinned to [] for the whole cache window.
  _allBalancesCache.set(exchange, { ts: Date.now(), value });
  return value;
}

/**
 * Places a spot market order on the specified exchange.
 * bybit and gateio throw — they are data-only (German regulatory restrictions).
 *
 * @param {object} env       — Cloudflare Worker env bindings
 * @param {string} exchange  — exchange identifier
 * @param {string} symbol    — trading pair, e.g. 'BTCUSDT'
 * @param {string} side      — 'BUY' | 'SELL'
 * @param {string} quantity  — base asset amount (used for SELL)
 * @param {number} sizeUsd   — quote amount in quote asset (used for BUY)
 */
export async function placeExchangeMarketOrder(env, exchange, symbol, side, quantity, sizeUsd) {
  switch (exchange?.toLowerCase()) {
    case 'mexc': return placeMarketOrderMEXC(env, symbol, side, quantity, sizeUsd);
    case 'binance': return placeMarketOrderBinance(env, symbol, side, quantity, sizeUsd);
    case 'kucoin': return placeMarketOrderKuCoin(env, symbol, side, quantity, sizeUsd);
    case 'bitget': return placeMarketOrderBitget(env, symbol, side, quantity, sizeUsd);
    case 'bitmart': return placeMarketOrderBitmart(env, symbol, side, quantity, sizeUsd);
    case 'htx': return placeMarketOrderHTX(env, symbol, side, quantity, sizeUsd);
    case 'bybit':
    case 'gateio':
      throw new Error(
        `${exchange} is not available for live execution (German regulatory restrictions). ` +
        `Use paper trading mode or switch to MEXC, Binance, KuCoin, Bitget, Bitmart, or HTX.`
      );
    default:
      throw new Error(`No execution layer for exchange: ${exchange}`);
  }
}

function toFiniteNumber(value) {
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

function sumFillFees(fills) {
  if (!Array.isArray(fills)) return 0;
  return fills.reduce((sum, fill) => {
    const commission = toFiniteNumber(
      fill?.commission
      ?? fill?.fee
      ?? fill?.fees
      ?? fill?.fillFee
    );
    return commission ? sum + commission : sum;
  }, 0);
}

/**
 * Extracts best-effort fill metrics from heterogeneous exchange order responses.
 * Returns null when executed quantity or quote quantity cannot be determined.
 */
export function extractFillMetrics(orderResult) {
  const root = orderResult?.data?.[0]
    ?? orderResult?.data
    ?? orderResult?.result
    ?? orderResult;
  if (!root || typeof root !== 'object') return null;

  const executedQty = toFiniteNumber(
    root.executedQty
    ?? root.dealSize
    ?? root.filledSize
    ?? root.accFillSz
    ?? root.filledAmount
  );

  let quoteQty = toFiniteNumber(
    root.cummulativeQuoteQty
    ?? root.cumulativeQuoteQty
    ?? root.dealFunds
    ?? root.filledValue
    ?? root.accFillNotionalUsd
    ?? root.filledAmountQuote
  );

  if (!quoteQty && Array.isArray(root.fills)) {
    quoteQty = root.fills.reduce((sum, fill) => {
      const price = toFiniteNumber(fill?.price);
      const qty = toFiniteNumber(fill?.qty ?? fill?.quantity);
      return (price && qty) ? sum + (price * qty) : sum;
    }, 0);
  }

  const avgPrice = toFiniteNumber(root.avgPrice ?? root.priceAvg ?? root.fillPrice);
  if (!quoteQty && avgPrice && executedQty) {
    quoteQty = avgPrice * executedQty;
  }

  if (!executedQty || !quoteQty || executedQty <= 0 || quoteQty <= 0) return null;

  return {
    executedQty,
    quoteQty,
    avgPrice: quoteQty / executedQty,
    feeQty: sumFillFees(root.fills),
  };
}





// ── Web3 EVM public RPC balance checker ────────────────────────────────────
//
// Uses public RPC endpoints to query ETH/BSC/ARB/POLYGON/OP balances.
// No API key required — fallback to multiple public RPCs if one fails.

const PUBLIC_RPCS = [
  'https://ethereum-rpc.publicnode.com',
  'https://1rpc.io/eth',
  'https://rpc.ankr.com/eth',
  'https://eth.drpc.org',
  'https://eth-mainnet.g.alchemy.com/public'
];

async function rpcFetch(url, body, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      keepalive: false,
      cf: { cacheTtl: 2, cacheEverything: false }
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function publicRpcCall(method, params, fallbacks = PUBLIC_RPCS) {
  const body = { jsonrpc: '2.0', id: 1, method, params };
  for (const rpc of fallbacks) {
    const result = await rpcFetch(rpc, body);
    if (result && result.result) return result.result;
  }
  return null;
}

const TOKEN_DECIMALS = {
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 6,   // USDT
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6,   // USDC
  '0x6b175474e89094c44da98b954eedeac495271d0f': 18,  // DAI
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 18,  // USDC BSC
  '0x55d398326f99059ff775485246999027b3197955': 18,  // USDT BSC
  '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 6,   // USDC Polygon
  '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 6,   // USDT Polygon
};

async function getErc20Balance(rpcUrl, tokenAddress, walletAddress) {
  const data = '0x70a08231' + walletAddress.slice(2).padStart(64, '0');
  const result = await publicRpcCall('eth_call', [
    { to: tokenAddress, data },
    'latest'
  ], [rpcUrl]);
  if (!result || result === '0x') return null;
  const raw = parseInt(result, 16);
  const decimals = TOKEN_DECIMALS[tokenAddress.toLowerCase()] || 18;
  return raw / Math.pow(10, decimals);
}

export async function getWeb3Balance(chain, walletAddress, asset = 'ETH') {
  const chainConfig = {
    'ethereum': { rpcs: ['https://ethereum-rpc.publicnode.com', 'https://1rpc.io/eth'] },
    'bsc':      { rpcs: ['https://bsc-rpc.publicnode.com', 'https://1rpc.io/bsc'] },
    'polygon':  { rpcs: ['https://polygon-rpc.publicnode.com', 'https://1rpc.io/polygon'] },
    'arbitrum': { rpcs: ['https://arbitrum-rpc.publicnode.com', 'https://1rpc.io/arb'] },
    'optimism': { rpcs: ['https://optimism-rpc.publicnode.com', 'https://1rpc.io/opt'] },
  };

  const cfg = chainConfig[chain?.toLowerCase()];
  if (!cfg) throw new Error(`Unsupported chain: ${chain}`);

  const assetU = asset.toUpperCase();

  if (assetU === 'ETH' || assetU === 'BNB' || assetU === 'MATIC' || assetU === 'OP') {
    const rpc = cfg.rpcs[0];
    const result = await publicRpcCall('eth_getBalance', [walletAddress, 'latest'], cfg.rpcs);
    if (!result || result === '0x') return 0;
    const raw = parseInt(result, 16);
    if (chain.toLowerCase() === 'bsc') return raw / 1e18;
    if (assetU === 'MATIC') return raw / 1e18;
    return raw / 1e18;
  }

  if (assetU === 'USDT' || assetU === 'USDC' || assetU === 'DAI') {
    const tokenMap = {
      'ethereum': { USDT: '0xdac17f958d2ee523a2206206994597c13d831ec7', USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', DAI: '0x6b175474e89094c44da98b954eedeac495271d0f' },
      'bsc':      { USDT: '0x55d398326f99059ff775485246999027b3197955', USDC: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d' },
      'polygon':  { USDT: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', USDC: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174' },
      'arbitrum': { USDC: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', USDT: '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8' },
      'optimism': { USDC: '0x0b2c639c533813f4aa9d7837caf62653d097ffc7', USDT: '0x94b008aa00558c879f3fe814534da8a173912da5' },
    };
    const tokenAddress = tokenMap[chain.toLowerCase()]?.[assetU];
    if (!tokenAddress) return 0;
    const balances = await Promise.all(
      cfg.rpcs.map(rpc => getErc20Balance(rpc, tokenAddress, walletAddress))
    );
    return balances.find(b => b !== null && b > 0) || 0;
  }

  return 0;
}

