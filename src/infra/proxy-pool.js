/**
 * Proxy Pool Manager — Manages a rotating pool of proxy servers
 * for API requests to prevent rate-limiting and IP bans.
 * 
 * Features:
 * - Dynamic proxy list with health checking
 * - Automatic rotation on failure
 * - Performance tracking per proxy
 * - Residential proxy support (HTTP/SOCKS5)
 * - Auto-recovery with exponential backoff
 */

const PROXY_HEALTH_CHECK_INTERVAL_MS = 60 * 1000;   // 1 min
const PROXY_MAX_FAILURES_BEFORE_COOLDOWN = 3;
const PROXY_COOLDOWN_MS = 5 * 60 * 1000;             // 5 min
const PROXY_REQUEST_TIMEOUT_MS = 10 * 1000;           // 10 sec
const PROXY_STICKY_SESSION_TTL_MS = 30 * 1000;        // 30 sec sticky session
const PROXY_MODE_VALUES = new Set(['auto', 'off', 'required']);

function parseCsvSet(raw) {
  if (!raw || typeof raw !== 'string') return new Set();
  return new Set(raw.split(',').map(v => v.trim().toLowerCase()).filter(Boolean));
}

function parseHeaderLine(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const sep = value.indexOf(':');
  if (sep <= 0) return null;
  const key = value.slice(0, sep).trim();
  const headerValue = value.slice(sep + 1).trim();
  if (!key || !headerValue) return null;
  return { key, value: headerValue };
}

// Exchange → preferred proxy region mapping for optimal latency
const EXCHANGE_REGION_MAP = {
  mexc:    'eu',    // Malta
  binance: 'eu',    // Ireland
  kucoin:  'eu',    // Seychelles (EU relay)
  bitget:  'eu',    // EU relay
  bitmart: 'us',    // US (Cayman relay)
  htx:     'ap',    // Singapore
  bybit:   'eu',    // EU relay
  gateio:  'ap',    // Cayman/AP relay
};

/**
 * Represents a single proxy endpoint with health state.
 */
class ProxyEndpoint {
  constructor(url, type = 'http', priority = 0, region = 'eu') {
    this.url = url;
    this.type = type;         // 'http' | 'socks5'
    this.priority = priority; // higher = preferred
    this.region = region;     // 'eu' | 'us' | 'ap' | 'global'
    this.failures = 0;
    this.successes = 0;
    this.lastFailure = 0;
    this.lastSuccess = 0;
    this.avgLatencyMs = 0;
    this.totalRequests = 0;
    this.cooldownUntil = 0;
  }

  get isAvailable() {
    return Date.now() >= this.cooldownUntil;
  }

  get score() {
    // Higher score = better proxy
    const reliability = this.totalRequests > 0
      ? this.successes / this.totalRequests
      : 0.5;
    const latencyScore = this.avgLatencyMs > 0
      ? Math.max(0, 1 - (this.avgLatencyMs / 5000))
      : 0.5;
    const priorityScore = this.priority / 10;
    return (reliability * 0.5) + (latencyScore * 0.3) + (priorityScore * 0.2);
  }

  recordSuccess(latencyMs) {
    this.successes++;
    this.totalRequests++;
    this.lastSuccess = Date.now();
    this.failures = 0; // reset consecutive failures
    // Exponential moving average for latency
    this.avgLatencyMs = this.avgLatencyMs === 0
      ? latencyMs
      : this.avgLatencyMs * 0.8 + latencyMs * 0.2;
  }

  recordFailure() {
    this.failures++;
    this.totalRequests++;
    this.lastFailure = Date.now();
    if (this.failures >= PROXY_MAX_FAILURES_BEFORE_COOLDOWN) {
      this.cooldownUntil = Date.now() + PROXY_COOLDOWN_MS;
    }
  }
}

/**
 * ProxyPool — manages a pool of proxy endpoints with rotation and health tracking.
 */
export class ProxyPool {
  /**
   * @param {object} env - Environment bindings (PROXY_LIST, etc.)
   */
  constructor(env = {}) {
    this.proxies = [];
    this.currentIndex = 0;
    this.env = env;
    this._initialized = false;
    this._stickySessions = new Map();  // exchange → { proxy, expiresAt }
    this._lastHealthCheck = 0;
    const mode = String(env.PROXY_MODE || 'auto').toLowerCase();
    this.proxyMode = PROXY_MODE_VALUES.has(mode) ? mode : 'auto';
    this.directExchanges = parseCsvSet(env.DIRECT_EXCHANGES || '');
  }

  _proxyAuthHeaderValue() {
    return this.env.PROXY_FALLBACK_AUTH_HEADER || this.env.PROXY_AUTH_HEADER || '';
  }

  updateEnv(env = {}) {
    if (!env || typeof env !== 'object') return;

    let requiresReinitialize = false;
    for (const [key, value] of Object.entries(env)) {
      if (this.env[key] === value) continue;
      this.env[key] = value;
      if (
        key === 'PROXY_LIST' ||
        key === 'PROXY_URL' ||
        key.startsWith('PROXY_URL_') ||
        key === 'RESIDENTIAL_PROXY_URL' ||
        key === 'RESIDENTIAL_PROXY_REGION' ||
        key === 'PROXY_MODE' ||
        key === 'DIRECT_EXCHANGES'
      ) {
        requiresReinitialize = true;
      }
    }

    const mode = String(this.env.PROXY_MODE || 'auto').toLowerCase();
    this.proxyMode = PROXY_MODE_VALUES.has(mode) ? mode : 'auto';
    this.directExchanges = parseCsvSet(this.env.DIRECT_EXCHANGES || '');

    if (requiresReinitialize) {
      this.proxies = [];
      this.currentIndex = 0;
      this._stickySessions.clear();
      this._initialized = false;
    }
  }

  shouldProxy(exchange = null) {
    if (this.proxyMode === 'off') return false;
    if (exchange && this.directExchanges.has(String(exchange).toLowerCase())) return false;
    return true;
  }

  /**
   * Initialize the proxy pool from environment configuration.
   * Expected env vars:
   *   PROXY_LIST — JSON array of { url, type?, priority?, region? }
   *   PROXY_URL  — Single proxy URL (fallback)
   *   RESIDENTIAL_PROXY_URL — Residential proxy for sensitive exchanges
   *   RESIDENTIAL_PROXY_REGION — Region for residential proxy (default: 'us')
   */
  initialize() {
    if (this._initialized) return;

    // Try loading from PROXY_LIST (JSON array)
    if (this.env.PROXY_LIST) {
      try {
        const list = typeof this.env.PROXY_LIST === 'string'
          ? JSON.parse(this.env.PROXY_LIST)
          : this.env.PROXY_LIST;
        if (Array.isArray(list)) {
          for (const p of list) {
            if (p.url) {
              this.proxies.push(new ProxyEndpoint(
                p.url, p.type || 'http', p.priority || 0, p.region || 'global'
              ));
            }
          }
        }
      } catch (e) {
        console.error('[proxy-pool] Failed to parse PROXY_LIST:', e.message);
      }
    }

    // Fallback: single proxy URL
    const primaryProxyUrl = this.env.PROXY_FALLBACK_URL || this.env.PROXY_URL || '';
    if (this.proxies.length === 0 && primaryProxyUrl) {
      this.proxies.push(new ProxyEndpoint(primaryProxyUrl, 'http', 0, 'global'));
    }

    // Fallback: multiple proxy URLs with index suffix
    let idx = 1;
    while (this.env[`PROXY_URL_${idx}`]) {
      this.proxies.push(new ProxyEndpoint(this.env[`PROXY_URL_${idx}`], 'http', idx, 'global'));
      idx++;
    }

    // Residential proxy — higher priority for sensitive exchange operations
    if (this.env.RESIDENTIAL_PROXY_URL) {
      const region = this.env.RESIDENTIAL_PROXY_REGION || 'us';
      this.proxies.push(new ProxyEndpoint(
        this.env.RESIDENTIAL_PROXY_URL, 'http', 100, region
      ));
      console.log(`[proxy-pool] Added residential proxy (region: ${region}, priority: 100)`);
    }

    // Sort by priority (descending)
    this.proxies.sort((a, b) => b.priority - a.priority);
    this._initialized = true;

    console.log(
      `[proxy-pool] Initialized with ${this.proxies.length} proxy(ies) — mode=${this.proxyMode}, regions: ${[...new Set(this.proxies.map(p => p.region))].join(', ')}`
    );
  }

  /**
   * Returns the number of available (non-cooldown) proxies.
   */
  get availableCount() {
    return this.proxies.filter(p => p.isAvailable).length;
  }

  /**
   * Gets the next best available proxy using weighted scoring.
   * Returns null if no proxies are configured or available.
   */
  getNext() {
    this.initialize();
    if (this.proxies.length === 0) return null;

    const available = this.proxies.filter(p => p.isAvailable);
    if (available.length === 0) {
      // All in cooldown — pick the one with earliest cooldown end
      available.sort((a, b) => a.cooldownUntil - b.cooldownUntil);
      return available[0] || null;
    }

    // Sort by score (descending) and pick the best
    available.sort((a, b) => b.score - a.score);
    return available[0];
  }

  /**
   * Gets the next proxy using round-robin rotation.
   */
  getNextRoundRobin() {
    this.initialize();
    if (this.proxies.length === 0) return null;

    const available = this.proxies.filter(p => p.isAvailable);
    if (available.length === 0) return this.getNext();

    this.currentIndex = this.currentIndex % available.length;
    const proxy = available[this.currentIndex];
    this.currentIndex++;
    return proxy;
  }

  /**
   * Gets a proxy for a specific exchange, preferring the correct region.
   * Uses sticky sessions to maintain IP consistency per exchange.
   * @param {string} exchange - Exchange name (e.g. 'bitmart', 'binance')
   * @returns {ProxyEndpoint|null}
   */
  getProxyForExchange(exchange) {
    this.initialize();
    if (this.proxies.length === 0) return null;

    // Check sticky session first
    const sticky = this._stickySessions.get(exchange);
    if (sticky && sticky.expiresAt > Date.now() && sticky.proxy.isAvailable) {
      return sticky.proxy;
    }

    // Prefer proxy in the exchange's region
    const preferredRegion = EXCHANGE_REGION_MAP[exchange] || 'global';
    const available = this.proxies.filter(p => p.isAvailable);

    let candidates = available;
    if (preferredRegion !== 'global') {
      const regionMatches = available.filter(p => p.region === preferredRegion);
      if (regionMatches.length > 0) {
        candidates = regionMatches;
      }
    }

    // Sort by score (descending) and pick the best
    candidates.sort((a, b) => b.score - a.score);
    const selected = candidates[0] || null;

    // Set sticky session
    if (selected) {
      this._stickySessions.set(exchange, {
        proxy: selected,
        expiresAt: Date.now() + PROXY_STICKY_SESSION_TTL_MS,
      });
    }

    return selected;
  }

  /**
   * Clears the sticky session for a given exchange (e.g. after a failure).
   * @param {string} exchange
   */
  clearStickySession(exchange) {
    this._stickySessions.delete(exchange);
  }

  /**
   * Runs a health check on all proxies by probing a lightweight endpoint.
   * Proxies that fail the health check are put on cooldown.
   */
  async runHealthCheck() {
    this.initialize();
    if (this.proxies.length === 0) return;

    // Throttle health checks
    if (Date.now() - this._lastHealthCheck < PROXY_HEALTH_CHECK_INTERVAL_MS) return;
    this._lastHealthCheck = Date.now();

    console.log(`[proxy-pool] Running health check on ${this.proxies.length} proxy(ies)`);

    await Promise.allSettled(
      this.proxies.map(async (proxy) => {
        try {
          const start = Date.now();
          const Controller = globalThis.AbortController;
          const controller = Controller ? new Controller() : null;
          const timeout = controller ? setTimeout(() => controller.abort(), PROXY_REQUEST_TIMEOUT_MS) : null;
          const authHeader = parseHeaderLine(this._proxyAuthHeaderValue());

          const resp = await fetch(`${proxy.url}?target=${encodeURIComponent('https://api-cloud.bitmart.com/spot/v1/ticker?symbol=BTC_USDT')}`, {
                headers: {
                  'X-Proxy-Target': 'https://api-cloud.bitmart.com/spot/v1/ticker?symbol=BTC_USDT',
              ...(authHeader ? { [authHeader.key]: authHeader.value } : {}),
                },
            ...(controller ? { signal: controller.signal } : {}),
          });
          if (timeout) clearTimeout(timeout);

          const latency = Date.now() - start;
          if (resp.ok) {
            proxy.recordSuccess(latency);
          } else {
            proxy.recordFailure();
          }
        } catch {
          proxy.recordFailure();
        }
      })
    );

    const healthy = this.proxies.filter(p => p.isAvailable).length;
    console.log(`[proxy-pool] Health check complete: ${healthy}/${this.proxies.length} proxies healthy`);
  }

  /**
   * Records a successful request through the given proxy.
   */
  recordSuccess(proxyUrl, latencyMs) {
    const proxy = this.proxies.find(p => p.url === proxyUrl);
    if (proxy) proxy.recordSuccess(latencyMs);
  }

  /**
   * Records a failed request through the given proxy.
   */
  recordFailure(proxyUrl) {
    const proxy = this.proxies.find(p => p.url === proxyUrl);
    if (proxy) proxy.recordFailure();
  }

  /**
   * Fetches a URL through the proxy pool with automatic rotation on failure.
   * Tries each available proxy before falling back to direct fetch.
   * Supports region-based routing for exchange-specific requests.
   *
   * @param {string} url - Target URL
   * @param {object} fetchOptions - fetch() options
   * @param {number} maxRetries - Max proxy retries before direct fallback
   * @param {string} [exchange] - Optional exchange name for region-based routing
   * @returns {Promise<Response>}
   */
  async fetchWithProxy(url, fetchOptions = {}, maxRetries = 2, exchange = null) {
    this.initialize();

    if (!this.shouldProxy(exchange)) {
      return fetch(url, { ...fetchOptions });
    }

    if (this.proxies.length === 0) {
      if (this.proxyMode === 'required') {
        throw new Error('Proxy mode is required but no proxies are configured');
      }
      return fetch(url, { ...fetchOptions });
    }

    // Detect exchange from URL if not provided
    if (!exchange) {
      exchange = this._detectExchange(url);
    }

    const tried = new Set();
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Use region-based routing if exchange is known
      const proxy = exchange
        ? this.getProxyForExchange(exchange)
        : this.getNextRoundRobin();

      if (!proxy || tried.has(proxy.url)) {
        // Try any available proxy if region-based one is exhausted
        const fallback = this.getNext();
        if (!fallback || tried.has(fallback.url)) continue;
        tried.add(fallback.url);
        return this._executeProxyFetch(fallback, url, fetchOptions, exchange);
      }
      tried.add(proxy.url);

      try {
        return await this._executeProxyFetch(proxy, url, fetchOptions, exchange);
      } catch (err) {
        proxy.recordFailure();
        // Clear sticky session on failure so next call picks a different proxy
        if (exchange) this.clearStickySession(exchange);
        console.warn(`[proxy-pool] Proxy ${proxy.url} failed: ${err.message}`);
      }
    }

    // All proxies failed — direct fallback unless proxy mode is strict.
    if (this.proxyMode === 'required') {
      throw new Error('All proxies failed while PROXY_MODE=required');
    }

    console.warn('[proxy-pool] All proxies failed, falling back to direct fetch');
    return fetch(url, { ...fetchOptions });
  }

  /**
   * Executes a single fetch through a proxy endpoint.
   * @private
   */
  async _executeProxyFetch(proxy, url, fetchOptions, exchange = null) {
    const startTime = Date.now();

    // Build proxy fetch URL
    // For Cloudflare Workers, we use the proxy as a gateway
    const proxyUrl = `${proxy.url}?target=${encodeURIComponent(url)}`;

    const Controller = globalThis.AbortController;
    const controller = Controller ? new Controller() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), PROXY_REQUEST_TIMEOUT_MS) : null;

    const authHeader = parseHeaderLine(this._proxyAuthHeaderValue());

    let resp;
    try {
      resp = await fetch(proxyUrl, {
        ...fetchOptions,
        headers: {
          ...fetchOptions.headers,
          'X-Proxy-Target': url,
          'X-Proxy-Type': proxy.type,
          ...(authHeader ? { [authHeader.key]: authHeader.value } : {}),
          ...(exchange ? { 'X-Proxy-Exchange': exchange } : {}),
        },
        ...(controller ? { signal: controller.signal } : {}),
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    const latency = Date.now() - startTime;

    // Check if proxy returned an upstream/proxy transport error page.
    // 530 is frequently returned by Cloudflare-backed gateway URLs when the
    // tunnel/hostname is invalid (for example 1016 origin DNS errors).
    if (resp.status === 407 || resp.status === 502 || resp.status === 504 || resp.status === 530) {
      proxy.recordFailure();
      throw new Error(`Proxy returned HTTP ${resp.status}`);
    }

    // Cloudflare challenge detection
    if (resp.status === 403) {
      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        proxy.recordFailure();
        throw new Error('Proxy returned Cloudflare challenge (403)');
      }
    }

    proxy.recordSuccess(latency);
    return resp;
  }

  /**
   * Detects the exchange name from an API URL.
   * @private
   */
  _detectExchange(url) {
    const patterns = [
      { pattern: /api\.mexc\.com/i, exchange: 'mexc' },
      { pattern: /api\.binance\.com/i, exchange: 'binance' },
      { pattern: /api-futures\.binance\.com/i, exchange: 'binance' },
      { pattern: /api\.kucoin\.com/i, exchange: 'kucoin' },
      { pattern: /(?:^|\.)c?api\.bitget\.com/i, exchange: 'bitget' },
      { pattern: /api-cloud\.bitmart\.com/i, exchange: 'bitmart' },
      { pattern: /api\.htx\.com/i, exchange: 'htx' },
      { pattern: /api\.bybit\.com/i, exchange: 'bybit' },
      { pattern: /api\.gateio\.ws/i, exchange: 'gateio' },
    ];
    for (const { pattern, exchange } of patterns) {
      if (pattern.test(url)) return exchange;
    }
    return null;
  }

  /**
   * Returns health stats for all proxies.
   */
  getStats() {
    return this.proxies.map(p => ({
      url: p.url.replace(/\/\/[^@]+@/, '//***@'), // mask credentials
      type: p.type,
      region: p.region,
      available: p.isAvailable,
      score: Math.round(p.score * 100) / 100,
      successes: p.successes,
      failures: p.failures,
      avgLatencyMs: Math.round(p.avgLatencyMs),
      totalRequests: p.totalRequests,
    }));
  }
}

// Singleton instance for reuse across the application
let _globalPool = null;

/**
 * Returns the global proxy pool instance (lazy-initialized).
 */
export function getGlobalProxyPool(env) {
  if (!_globalPool) {
    _globalPool = new ProxyPool(env);
  } else if (env) {
    _globalPool.updateEnv(env);
  }
  return _globalPool;
}
