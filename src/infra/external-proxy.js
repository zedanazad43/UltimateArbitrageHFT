/**
 * External Proxy Server Manager
 * Connects to premium proxy providers (Bright Data, Oxylabs, Rotating Proxies)
 * Handles authentication, rotation, health checks, and fallback to local pool.
 */

import { getGlobalProxyPool } from './proxy-pool.js';

const PROXY_PROVIDERS = {
  bright_data: {
    endpoint: 'https://zproxy.lum-superproxy.io:22225',
    port: 22225,
    requiresAuth: true,
  },
  oxylabs: {
    endpoint: 'https://proxy.oxylabs.io:7777',
    port: 7777,
    requiresAuth: true,
  },
  smartproxy: {
    endpoint: 'http://gate.smartproxy.com:7000',
    port: 7000,
    requiresAuth: true,
  },
};

let _externalProxy = null;

export class ExternalProxyManager {
  constructor(env) {
    this.env = env;
    this.gatewayUrl = env.EXTERNAL_PROXY_URL || env.EXTERNAL_PROXY_GATEWAY_URL || env.EXTERNAL_PROXY_FALLBACK_URL || '';
    this.provider = env.EXTERNAL_PROXY_PROVIDER || env.EXTERNAL_PROXY_FALLBACK_PROVIDER || 'none'; // bright_data, oxylabs, smartproxy, none
    this.username = env.EXTERNAL_PROXY_USERNAME || env.EXTERNAL_PROXY_FALLBACK_USERNAME || '';
    this.password = env.EXTERNAL_PROXY_PASSWORD || env.EXTERNAL_PROXY_FALLBACK_PASSWORD || '';
    this.authHeader = env.EXTERNAL_PROXY_AUTH_HEADER || env.EXTERNAL_PROXY_FALLBACK_AUTH_HEADER || '';
    this.providerConfigured = this.provider !== 'none' && !!this.username && !!this.password;
    this.enabled = !!this.gatewayUrl || this.providerConfigured;
    this.localProxyPool = getGlobalProxyPool(env);
    this.healthCheckIntervalMs = 60000; // 1 min
    this.lastHealthCheck = 0;
    this.isHealthy = this.enabled; // Assume healthy if enabled
    this.failureCount = 0;
    this.maxFailuresBeforeFallback = 3;
  }

  /**
   * Builds optional auth headers for external gateway calls.
   */
  buildAuthHeaders() {
    const raw = String(this.authHeader || '').trim();
    if (!raw) return {};

    const sep = raw.indexOf(':');
    if (sep <= 0) {
      console.warn('[external-proxy] EXTERNAL_PROXY_AUTH_HEADER is invalid (expected "Header-Name: value")');
      return {};
    }

    const key = raw.slice(0, sep).trim();
    const value = raw.slice(sep + 1).trim();
    if (!key || !value) return {};
    return { [key]: value };
  }

  /**
   * Returns proxy URL with embedded credentials if provider is configured.
   */
  getProxyUrl() {
    if (!this.enabled) return null;

    if (this.gatewayUrl) {
      return this.gatewayUrl;
    }

    const provider = PROXY_PROVIDERS[this.provider];
    if (!provider) {
      console.warn(`[external-proxy] Unknown provider: ${this.provider}`);
      return null;
    }

    if (provider.requiresAuth && this.username && this.password) {
      // Format: http://username:password@host:port
      const endpoint = provider.endpoint.replace(/^https?:\/\//, '');
      return `http://${this.username}:${this.password}@${endpoint.replace(/:\d+$/, '')}:${provider.port}`;
    }

    return provider.endpoint;
  }

  /**
   * Performs health check on external proxy.
   */
  async performHealthCheck() {
    if (!this.enabled) {
      this.isHealthy = false;
      return false;
    }

    const now = Date.now();
    if (now - this.lastHealthCheck < this.healthCheckIntervalMs) {
      return this.isHealthy; // Use cached result
    }

    this.lastHealthCheck = now;

    try {
      const proxyUrl = this.getProxyUrl();
      if (!proxyUrl) {
        this.isHealthy = false;
        return false;
      }

      if (!this.gatewayUrl) {
        console.warn('[external-proxy] Raw authenticated proxies are not directly routable from this Worker runtime; falling back to gateway/local proxy pool');
        this.isHealthy = false;
        return false;
      }

      // Simple health check: HEAD request to a stable endpoint
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const probeTarget = 'https://www.binance.com';
      const response = await fetch(`${proxyUrl}?target=${encodeURIComponent(probeTarget)}`, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'X-Proxy-Target': probeTarget,
          ...this.buildAuthHeaders(),
        },
      });

      clearTimeout(timeoutId);
      this.isHealthy = response.ok || response.status === 403; // 403 is OK (auth works, endpoint blocked)
      this.failureCount = 0;

      console.log(`[external-proxy] Health check passed for ${this.provider}`);
      return this.isHealthy;
    } catch (err) {
      console.warn(`[external-proxy] Health check failed: ${err.message}`);
      this.failureCount++;

      if (this.failureCount >= this.maxFailuresBeforeFallback) {
        this.isHealthy = false;
        console.error(`[external-proxy] Marked ${this.provider} as unhealthy (${this.failureCount} failures)`);
      }

      return this.isHealthy;
    }
  }

  /**
   * Fetches through external proxy if healthy, otherwise falls back to local pool.
   */
  async fetchWithFallback(url, options = {}, timeout = 15000) {
    // Perform health check first
    await this.performHealthCheck();

    if (!this.isHealthy) {
      console.log('[external-proxy] External proxy unhealthy, falling back to local pool');
      return this.localProxyPool.fetchWithProxy(url, options, 2);
    }

    let timeoutId;
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), timeout);

      const fetchOptions = {
        ...options,
        signal: controller.signal,
      };

      const proxyUrl = this.getProxyUrl();
      const response = await fetch(`${proxyUrl}?target=${encodeURIComponent(url)}`, {
        ...fetchOptions,
        headers: {
          ...fetchOptions.headers,
          'X-Proxy-Target': url,
          ...this.buildAuthHeaders(),
        },
      });
      this.failureCount = 0;
      return response;
    } catch (err) {
      this.failureCount++;
      console.warn(`[external-proxy] Request failed: ${err.message}, using local fallback`);

      if (this.failureCount >= this.maxFailuresBeforeFallback) {
        this.isHealthy = false;
      }

      return this.localProxyPool.fetchWithProxy(url, options, 2);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Statistics about external proxy usage.
   */
  getStats() {
    return {
      provider: this.provider,
      enabled: this.enabled,
      healthy: this.isHealthy,
      failureCount: this.failureCount,
      maxFailuresBeforeFallback: this.maxFailuresBeforeFallback,
      lastHealthCheck: this.lastHealthCheck,
      fallbackAvailable: !!this.localProxyPool,
    };
  }
}

/**
 * Global singleton for external proxy management.
 */
export function getExternalProxyManager(env) {
  if (!_externalProxy) {
    _externalProxy = new ExternalProxyManager(env);
  }
  return _externalProxy;
}

/**
 * Reset singleton (for testing).
 */
export function resetExternalProxyManager() {
  _externalProxy = null;
}
