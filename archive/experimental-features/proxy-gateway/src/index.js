/* global URL, Response, fetch, Headers */
/**
 * Minimal CORS/Proxy Gateway Worker for UltimateArbitrageHFT
 * Usage: GET https://proxy-gateway.workers.dev/?target=https://api.mexc.com/api/v3/time
 */
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('target');

    if (!target) {
      return new Response(JSON.stringify({ error: 'Missing ?target= parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate target is an allowed exchange API
    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid target URL' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const allowedHosts = [
      'api.mexc.com', 'contract.mexc.com',
      'api.binance.com', 'api-futures.binance.com',
      'api.kucoin.com',
      'api.bitget.com', 'capi.bitget.com',
      'api-cloud.bitmart.com',
      'api.htx.com',
      'api.bybit.com',
      'api.gateio.ws',
    ];

    if (!allowedHosts.some(h => targetUrl.hostname === h || targetUrl.hostname.endsWith('.' + h))) {
      return new Response(JSON.stringify({ error: 'Host not allowed: ' + targetUrl.hostname }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Forward headers from original request
    const forwardHeaders = new Headers();
    const skipHeaders = new Set(['host', 'origin', 'referer', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray']);
    request.headers.forEach((value, key) => {
      if (!skipHeaders.has(key.toLowerCase())) {
        forwardHeaders.set(key, value);
      }
    });
    forwardHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    try {
      const resp = await fetch(target, {
        method: request.method,
        headers: forwardHeaders,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.text() : undefined,
      });

      const responseHeaders = new Headers(resp.headers);
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('X-Proxy-By', 'arb-proxy-gw');

      return new Response(resp.body, {
        status: resp.status,
        headers: responseHeaders,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};