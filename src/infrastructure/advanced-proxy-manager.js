// src/infrastructure/advanced-proxy-manager.js
// Bright Data + Oxylabs proxy integration for geo-bypass

export class AdvancedProxyManager {
  constructor(env) {
    this.env = env;
    this.brightDataUrl = 'http://brd.superproxy.io:22225';
    this.oxylabsUrl = 'http://pr.oxylabs.io:7777';
    this.proxyRotation = 0;
    this.failureCount = {};
  }

  getProxyAuth() {
    // Bright Data format: username-country-session-[id]:[password]
    const country = this.env.PROXY_COUNTRY || 'us';
    const sessionId = Math.random().toString(36).substring(7);

    return {
      brightData: {
        user: `${this.env.BRIGHT_DATA_USER}-country-${country}-session-${sessionId}`,
        password: this.env.BRIGHT_DATA_PASSWORD || '',
        url: this.brightDataUrl,
      },
      oxylabs: {
        user: this.env.OXYLABS_USER || '',
        password: this.env.OXYLABS_PASSWORD || '',
        url: this.oxylabsUrl,
      },
    };
  }

  getProxyUrl(provider = 'brightdata') {
    const auth = this.getProxyAuth();

    if (provider === 'brightdata' && auth.brightData.user) {
      return `http://${auth.brightData.user}:${auth.brightData.password}@${this.brightDataUrl}`;
    }
    if (provider === 'oxylabs' && auth.oxylabs.user) {
      return `http://${auth.oxylabs.user}:${auth.oxylabs.password}@${this.oxylabsUrl}`;
    }
    return null;
  }

  // Rotate through proxy providers
  async selectBestProxy() {
    const providers = ['brightdata', 'oxylabs'];
    const availableProxies = providers.filter((p) => this.getProxyUrl(p));

    if (availableProxies.length === 0) {
      console.warn('[Proxy] No proxies configured');
      return null;
    }

    // Rotate providers, avoiding recently failed ones
    this.proxyRotation = (this.proxyRotation + 1) % availableProxies.length;
    const selected = availableProxies[this.proxyRotation];

    return {
      provider: selected,
      url: this.getProxyUrl(selected),
      sessionId: Math.random().toString(36).substring(7),
    };
  }

  // Fetch through proxy with retry logic
  async fetchThroughProxy(url, options = {}, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const proxy = await this.selectBestProxy();
      if (!proxy) {
        throw new Error('No proxy available');
      }

      try {
        const proxyUrl = new URL(proxy.url);

        // Build proxy request
        const response = await fetch(`${proxy.url}${url}`, {
          ...options,
          headers: {
            ...options.headers,
            'Proxy-Authorization': `Basic ${btoa(
              `${proxyUrl.username}:${proxyUrl.password}`
            )}`,
          },
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok && response.status === 407) {
          // Proxy auth failed
          this.recordFailure(proxy.provider);
          continue;
        }

        if (response.ok) {
          this.recordSuccess(proxy.provider);
          return { response, proxy: proxy.provider, attempt };
        }

        throw new Error(`HTTP ${response.status}`);
      } catch (err) {
        console.warn(
          `[Proxy] Attempt ${attempt + 1}/${maxRetries} failed (${proxy.provider}): ${err.message}`
        );
        this.recordFailure(proxy.provider);
        if (attempt < maxRetries - 1) await this.sleep(1000 * (attempt + 1));
      }
    }

    throw new Error('All proxy attempts exhausted');
  }

  recordSuccess(provider) {
    this.failureCount[provider] = 0;
  }

  recordFailure(provider) {
    this.failureCount[provider] = (this.failureCount[provider] || 0) + 1;
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getStats() {
    return {
      proxyRotation: this.proxyRotation,
      failureCount: this.failureCount,
      availableProviders: ['brightdata', 'oxylabs'].filter((p) =>
        this.getProxyUrl(p)
      ),
    };
  }
}

export function getAdvancedProxyManager(env) {
  return new AdvancedProxyManager(env);
}
