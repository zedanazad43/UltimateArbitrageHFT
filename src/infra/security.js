/**
 * Security Layer — Advanced security for API key management,
 * request signing, rate limiting, and audit logging.
 * 
 * Features:
 * - In-memory API key encryption
 * - Per-exchange rate limiting
 * - Request signing with nonce tracking
 * - Audit logging for all trade operations
 * - IP allowlist enforcement
 */

// ── In-memory key encryption ──────────────────────────────────────────────────

const _keyStore = new Map();
const _obfuscationSalt = 'nexus_hft_' + (Date.now() ^ 0xDEADBEEF).toString(36);

/**
 * Stores an API key in obfuscated form in memory.
 * Not cryptographically secure — just prevents accidental plaintext leaks
 * in logs, heap dumps, or error messages.
 */
export function secureStoreKey(exchange, keyName, value) {
  if (!value) return;
  const storeKey = `${exchange}:${keyName}`;
  _keyStore.set(storeKey, {
    _v: btoa(value + _obfuscationSalt),
    _t: Date.now(),
  });
}

/**
 * Retrieves a previously stored API key.
 */
export function secureGetKey(exchange, keyName) {
  const storeKey = `${exchange}:${keyName}`;
  const entry = _keyStore.get(storeKey);
  if (!entry) return null;
  try {
    const decoded = atob(entry._v);
    return decoded.replace(_obfuscationSalt, '');
  } catch {
    return null;
  }
}

/**
 * Clears all stored keys from memory.
 */
export function clearAllKeys() {
  _keyStore.clear();
}

// ── Rate Limiter ──────────────────────────────────────────────────────────────

const DEFAULT_RATE_LIMITS = {
  mexc:      { maxRequests: 20, windowMs: 1000 },
  binance:   { maxRequests: 10, windowMs: 1000 },
  kucoin:    { maxRequests: 10, windowMs: 1000 },
  okx:       { maxRequests: 10, windowMs: 1000 },
  bitget:    { maxRequests: 10, windowMs: 1000 },
  bitmart:   { maxRequests: 5,  windowMs: 1000 },
  htx:       { maxRequests: 10, windowMs: 1000 },
  bybit:     { maxRequests: 10, windowMs: 1000 },
  gateio:    { maxRequests: 10, windowMs: 1000 },
};

class RateLimiter {
  constructor() {
    this._buckets = new Map();
    this._backoff = new Map();  // exchange → { until, level }
  }

  /**
   * Checks if a request is allowed for the given exchange.
   * Returns { allowed: boolean, retryAfterMs: number }
   */
  check(exchange) {
    const limit = DEFAULT_RATE_LIMITS[exchange] || { maxRequests: 5, windowMs: 1000 };
    const now = Date.now();

    // Check adaptive backoff first
    const backoff = this._backoff.get(exchange);
    if (backoff && now < backoff.until) {
      return { allowed: false, retryAfterMs: backoff.until - now };
    }

    const bucketKey = exchange;

    let bucket = this._buckets.get(bucketKey);
    if (!bucket || (now - bucket.windowStart) >= limit.windowMs) {
      bucket = { windowStart: now, count: 0 };
      this._buckets.set(bucketKey, bucket);
    }

    if (bucket.count < limit.maxRequests) {
      bucket.count++;
      return { allowed: true, retryAfterMs: 0 };
    }

    const retryAfterMs = limit.windowMs - (now - bucket.windowStart);
    return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 100) };
  }

  /**
   * Applies adaptive backoff for an exchange (e.g. after 429 response).
   * Each call doubles the backoff level, up to 60 seconds max.
   */
  applyBackoff(exchange, baseMs = 1000) {
    const current = this._backoff.get(exchange) || { until: 0, level: 0 };
    const newLevel = current.level + 1;
    const backoffMs = Math.min(baseMs * Math.pow(2, newLevel - 1), 60_000);
    this._backoff.set(exchange, {
      until: Date.now() + backoffMs,
      level: newLevel,
    });
    console.warn(`[rate-limiter] Applied backoff for ${exchange}: level=${newLevel}, wait=${backoffMs}ms`);
  }

  /**
   * Resets backoff for an exchange (e.g. after successful request).
   */
  resetBackoff(exchange) {
    this._backoff.delete(exchange);
  }

  /**
   * Waits until a request is allowed, then returns.
   * Includes adaptive backoff awareness.
   */
  async waitUntilAllowed(exchange) {
    // Max 5 retries to prevent infinite loops
    for (let i = 0; i < 5; i++) {
      const { allowed, retryAfterMs } = this.check(exchange);
      if (allowed) return;
      await new Promise(resolve => setTimeout(resolve, retryAfterMs));
    }
    // Force allow after max retries — better to try than deadlock
    console.warn(`[rate-limiter] Force-allowing ${exchange} after max wait retries`);
  }
}

const _globalRateLimiter = new RateLimiter();

/**
 * Returns the global rate limiter instance.
 */
export function getRateLimiter() {
  return _globalRateLimiter;
}

/**
 * Decorator-like wrapper: rate-limits a function call per exchange.
 * Automatically handles backoff on failure and reset on success.
 */
export async function withRateLimit(exchange, fn) {
  await _globalRateLimiter.waitUntilAllowed(exchange);
  try {
    const result = await fn();
    _globalRateLimiter.resetBackoff(exchange);
    return result;
  } catch (err) {
    // If it's a rate limit error, apply backoff
    if (err.status === 429 || err.message?.includes('rate limit') || err.message?.includes('Too Many Requests')) {
      _globalRateLimiter.applyBackoff(exchange);
    }
    throw err;
  }
}

// ── Nonce Tracking ────────────────────────────────────────────────────────────

const _nonceStore = new Map();

/**
 * Generates a monotonically increasing nonce for the given exchange.
 * Ensures no duplicate nonces even under high concurrency.
 */
export function getNextNonce(exchange) {
  const key = exchange;
  const last = _nonceStore.get(key) || 0;
  const next = Math.max(last + 1, Date.now());
  _nonceStore.set(key, next);
  return next;
}

// ── Audit Logger ──────────────────────────────────────────────────────────────

const AUDIT_LOG_MAX_ENTRIES = 1000;
const _auditLog = [];
const SENSITIVE_KEY_PATTERN = /(token|secret|api[_-]?key|signature|authorization|cookie|passphrase|memo)/i;

function redactSensitive(value, keyHint = '') {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (SENSITIVE_KEY_PATTERN.test(keyHint)) return '***';
    return value
      .replace(/(token=)[^&\s]+/ig, '$1***')
      .replace(/(signature=)[^&\s]+/ig, '$1***')
      .replace(/(secret=)[^&\s]+/ig, '$1***')
      .replace(/(authorization:\s*)[^\s]+/ig, '$1***');
  }
  if (Array.isArray(value)) return value.map(v => redactSensitive(v));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactSensitive(v, k);
    }
    return out;
  }
  return value;
}

/**
 * Logs a trade operation for audit purposes.
 * Entries are kept in memory (circular buffer) and can be persisted to KV.
 */
export function auditLog(event) {
  const entry = {
    timestamp: Date.now(),
    iso: new Date().toISOString(),
    ...redactSensitive(event),
  };

  _auditLog.push(entry);

  // Circular buffer — drop oldest when over limit
  if (_auditLog.length > AUDIT_LOG_MAX_ENTRIES) {
    _auditLog.splice(0, _auditLog.length - AUDIT_LOG_MAX_ENTRIES);
  }

  // Console log for Cloudflare Worker logs
  const level = event.level || 'info';
  const msg = `[AUDIT] ${entry.iso} ${level.toUpperCase()} ${entry.type || 'unknown'}: ${JSON.stringify(entry.details || {})}`;
  if (level === 'error') console.error(msg);
  else if (level === 'warn') console.warn(msg);
  else console.log(msg);
}

/**
 * Returns recent audit log entries.
 */
export function getAuditLog(limit = 100) {
  return _auditLog.slice(-limit);
}

/**
 * Persists the audit log to KV storage.
 */
export async function persistAuditLog(kvNamespace, key = 'nexus_audit_log') {
  if (_auditLog.length === 0) return;
  try {
    const existing = await kvNamespace.get(key, 'json') || [];
    const merged = [...existing, ..._auditLog].slice(-AUDIT_LOG_MAX_ENTRIES);
    await kvNamespace.put(key, JSON.stringify(merged), { expirationTtl: 86400 * 7 });
    _auditLog.length = 0; // Clear in-memory log after persist
  } catch (e) {
    console.error('[security] Failed to persist audit log:', e.message);
  }
}

// ── Request Signing ───────────────────────────────────────────────────────────

/**
 * Generates a unique request ID for tracing.
 */
export function generateRequestId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `req_${ts}_${rand}`;
}

// ── IP Allowlist ──────────────────────────────────────────────────────────────

/**
 * Checks if the incoming request IP is allowed.
 * If ALLOWED_IPS env var is set, only those IPs can access admin endpoints.
 * If not set, all IPs are allowed (open mode for development).
 */
export function isIpAllowed(request, env) {
  if (!env.ALLOWED_IPS) return true;
  const allowedIps = env.ALLOWED_IPS.split(',').map(ip => ip.trim());
  const clientIp = request.headers.get('CF-Connecting-IP') ||
                   request.headers.get('X-Real-IP') ||
                   request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim();
  if (!clientIp) return false;
  return allowedIps.includes(clientIp);
}

// ── Secure Fetch Wrapper ──────────────────────────────────────────────────────

/**
 * Secure fetch wrapper that:
 * 1. Rate-limits per exchange
 * 2. Routes through proxy pool when available
 * 3. Logs the request for audit
 * 4. Validates response and handles 429 backoff
 * 5. Masks sensitive data in logs
 * 6. Retries on transient failures
 *
 * @param {string} exchange - Exchange name (e.g. 'bitmart')
 * @param {string} url - Target URL
 * @param {object} options - fetch() options
 * @param {object} [proxyPool] - Optional ProxyPool instance for proxy routing
 * @param {number} [maxRetries=2] - Max retries on transient errors
 */
export async function secureFetch(exchange, url, options = {}, proxyPool = null, maxRetries = 2) {
  const requestId = generateRequestId();
  const startTime = Date.now();
  const shouldProxy = !!proxyPool && typeof proxyPool.shouldProxy === 'function'
    ? proxyPool.shouldProxy(exchange)
    : !!proxyPool;

  // Mask sensitive query params in logs
  const maskedUrl = url
    .replace(/key=[^&]+/ig, 'key=***')
    .replace(/signature=[^&]+/ig, 'signature=***')
    .replace(/secret=[^&]+/ig, 'secret=***')
    .replace(/token=[^&]+/ig, 'token=***');

  auditLog({
    type: 'fetch_start',
    level: 'info',
    requestId,
    details: {
      exchange,
      url: maskedUrl,
      method: options.method || 'GET',
      viaProxy: shouldProxy,
    },
  });

  await _globalRateLimiter.waitUntilAllowed(exchange);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Use proxy pool if available, otherwise direct fetch
      const resp = shouldProxy
        ? await proxyPool.fetchWithProxy(url, options, 2, exchange)
        : await fetch(url, options);

      const latency = Date.now() - startTime;

      // Handle 429 Too Many Requests
      if (resp.status === 429) {
        _globalRateLimiter.applyBackoff(exchange);

        const retryAfter = parseInt(resp.headers.get('Retry-After') || '0', 10) * 1000;
        auditLog({
          type: 'rate_limited',
          level: 'warn',
          requestId,
          details: {
            exchange,
            status: resp.status,
            latencyMs: latency,
            retryAfterMs: retryAfter || 'unknown',
            attempt: attempt + 1,
          },
        });

        if (attempt < maxRetries) {
          const waitMs = retryAfter > 0 ? retryAfter : 2000 * (attempt + 1);
          await new Promise(resolve => setTimeout(resolve, waitMs));
          continue;
        }
      }

      // Handle 5xx server errors — retryable
      if (resp.status >= 500 && resp.status !== 501 && attempt < maxRetries) {
        auditLog({
          type: 'server_error_retry',
          level: 'warn',
          requestId,
          details: {
            exchange,
            status: resp.status,
            latencyMs: latency,
            attempt: attempt + 1,
          },
        });
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }

      // Success or non-retryable error
      if (resp.ok) {
        _globalRateLimiter.resetBackoff(exchange);
      }

      auditLog({
        type: 'fetch_complete',
        level: resp.ok ? 'info' : 'warn',
        requestId,
        details: {
          exchange,
          status: resp.status,
          latencyMs: latency,
          attempt: attempt + 1,
        },
      });

      return resp;
    } catch (err) {
      const latency = Date.now() - startTime;
      const isLastAttempt = attempt === maxRetries;

      auditLog({
        type: 'fetch_error',
        level: isLastAttempt ? 'error' : 'warn',
        requestId,
        details: {
          exchange,
          error: err.message,
          latencyMs: latency,
          attempt: attempt + 1,
          willRetry: !isLastAttempt,
        },
      });

      if (isLastAttempt) throw err;

      // Brief wait before retry
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}
