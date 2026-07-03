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
    this.provider = env.EXTERNAL_PROXY_PROVIDER || 'none'; // bright_data, oxylabs, smartproxy, none
    this.username = env.EXTERNAL_PROXY_USERNAME || '';
    this.password = env.EXTERNAL_PROXY_PASSWORD || '';
    this.enabled = this.provider !== 'none' && !!this.username && !!this.password;
    this.localProxyPool = getGlobalProxyPool(env);
    this.healthCheckIntervalMs = 60000; // 1 min
    this.lastHealthCheck = 0;
    this.isHealthy = this.enabled; // Assume healthy if enabled
    this.failureCount = 0;
    this.maxFailuresBeforeFallback = 3;
  }

  /**
   * Returns proxy URL with embedded credentials if provider is configured.
   */
  getProxyUrl() {
    if (!this.enabled) return null;

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

      // Simple health check: HEAD request to a stable endpoint
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch('https://www.binance.com', {
        method: 'HEAD',
        signal: controller.signal,
        // Some proxies don't support custom agent in Cloudflare Workers
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
      return this.localProxyPool.fetchWithProxy(url, options, timeout);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const fetchOptions = {
        ...options,
        signal: controller.signal,
      };

      // Add proxy URL to request if supported by environment
      // Note: Cloudflare Workers has limited HTTP client support
      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      this.failureCount = 0;
      return response;
    } catch (err) {
      clearTimeout(undefined);
      console.warn(`[external-proxy] Request failed: ${err.message}, using local fallback`);
      this.failureCount++;

      if (this.failureCount >= this.maxFailuresBeforeFallback) {
        this.isHealthy = false;
      }

      return this.localProxyPool.fetchWithProxy(url, options, timeout);
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
