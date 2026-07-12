// src/infrastructure/cloudflare-tunnel-router.js
// Cloudflare Tunnel with geographic routing for geo-bypass

export class CloudflareTunnelRouter {
  constructor(env) {
    this.env = env;
    this.tunnelRoutes = {
      us_bypass: {
        tunnel: env.CF_TUNNEL_US_BYPASS_URL || 'https://us-bypass.tunnel.example.com',
        regions: ['US', 'CA'],
        purpose: 'Bypass geo-blocks in US/Canada',
      },
      eu_routing: {
        tunnel: env.CF_TUNNEL_EU_URL || 'https://eu.tunnel.example.com',
        regions: ['GB', 'DE', 'FR', 'NL'],
        purpose: 'Optimal EU routing',
      },
      asia_bypass: {
        tunnel: env.CF_TUNNEL_ASIA_URL || 'https://asia.tunnel.example.com',
        regions: ['SG', 'HK', 'JP', 'KR'],
        purpose: 'Asia-Pacific routing',
      },
    };
  }

  // Detect user region
  getRegionFromCF(cfCountry) {
    const regionMap = {
      US: 'us_bypass',
      CA: 'us_bypass',
      GB: 'eu_routing',
      DE: 'eu_routing',
      FR: 'eu_routing',
      SG: 'asia_bypass',
      HK: 'asia_bypass',
      JP: 'asia_bypass',
    };
    return regionMap[cfCountry] || 'eu_routing'; // Default to EU
  }

  // Route request through appropriate tunnel
  async routeThroughTunnel(url, cfCountry, options = {}) {
    const routeName = this.getRegionFromCF(cfCountry);
    const route = this.tunnelRoutes[routeName];

    if (!route || !route.tunnel) {
      console.warn(`[Tunnel] No tunnel configured for ${routeName}`);
      return null;
    }

    try {
      // Rewrite URL to go through tunnel
      // const tunnelUrl = new URL(route.tunnel);
      // const targetUrl = new URL(url);

      const response = await fetch(route.tunnel, {
        ...options,
        method: options.method || 'GET',
        headers: {
          ...options.headers,
          'X-Forwarded-For': '127.0.0.1', // Mask real IP
          'X-Forwarded-Proto': 'https',
          'CF-Connecting-Country': cfCountry,
          'CF-Tunnel-Route': routeName,
          'X-Target-URL': url,
        },
        body: options.body,
      });

      if (response.ok) {
        return {
          response,
          tunnel: routeName,
          region: this.tunnelRoutes[routeName].regions[0],
        };
      }

      throw new Error(`HTTP ${response.status}`);
    } catch (err) {
      console.error(`[Tunnel] Route through ${routeName} failed:`, err.message);
      return null;
    }
  }

  // Split traffic intelligently
  async routeRequest(url, cfCountry, options = {}) {
    // For trading APIs: use tunnel if US
    if (cfCountry === 'US') {
      console.log('[Tunnel] US detected, routing through tunnel...');
      const tunnelResult = await this.routeThroughTunnel(url, cfCountry, options);
      if (tunnelResult) return tunnelResult;
    }

    // For other regions, use direct connection
    return { response: null, tunnel: 'direct' };
  }

  // Health check for all tunnels
  async checkTunnelHealth() {
    const health = {};

    for (const [name, route] of Object.entries(this.tunnelRoutes)) {
      try {
        const response = await fetch(`${route.tunnel}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });
        health[name] = { online: response.ok, latencyMs: 0 };
      } catch (err) {
        health[name] = { online: false, error: err.message };
      }
    }

    return health;
  }

  // Configuration for wrangler.toml
  getWranglerConfig() {
    return `
# Cloudflare Tunnel Configuration
# Add these environment variables to wrangler.toml:

CF_TUNNEL_US_BYPASS_URL = "https://your-us-bypass-tunnel.trycloudflare.com"
CF_TUNNEL_EU_URL = "https://your-eu-tunnel.trycloudflare.com"
CF_TUNNEL_ASIA_URL = "https://your-asia-tunnel.trycloudflare.com"

# Tunnel setup commands:
# 1. Install cloudflared: https://developers.cloudflare.com/cloudflare-one/setup/
# 2. Create tunnels for each region:
#    cloudflared tunnel create us-bypass
#    cloudflared tunnel create eu
#    cloudflared tunnel create asia
# 3. Configure routing in cloudflared config.yml:
#    [{"service": "http://proxy.local:3000", "hostname": "us-bypass.tunnel.example.com"}]
# 4. Update wrangler.toml with tunnel URLs
    `;
  }
}

export function getCloudFlareTunnelRouter(env) {
  return new CloudflareTunnelRouter(env);
}
