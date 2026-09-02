export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Auth
    const auth = request.headers.get('X-Gateway-Token') || url.searchParams.get('token');
    if (auth !== env.GATEWAY_TOKEN) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 403, headers: { 'Content-Type': 'application/json' } 
      });
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, ts: Date.now() }), { 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    // Get target
    const target = url.searchParams.get('target') || request.headers.get('X-Proxy-Target');
    if (!target) {
      return new Response(JSON.stringify({ error: 'Missing target' }), { 
        status: 400, headers: { 'Content-Type': 'application/json' } 
      });
    }

    try {
      // Build headers - copy important ones and set User-Agent
      const headers = {};
      const ua = request.headers.get('User-Agent');
      if (ua) headers['User-Agent'] = ua;
      headers['Accept'] = 'application/json';
      const ct = request.headers.get('Content-Type');
      if (ct) headers['Content-Type'] = ct;

      const resp = await fetch(target, {
        method: request.method,
        headers,
        body: (request.method !== 'GET' && request.method !== 'HEAD') ? await request.text() : undefined,
      });

      // Return response with CORS headers
      const respHeaders = new Headers(resp.headers);
      respHeaders.set('Access-Control-Allow-Origin', '*');
      respHeaders.set('Content-Type', resp.headers.get('Content-Type') || 'application/json');

      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: respHeaders,
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { 
        status: 502, headers: { 'Content-Type': 'application/json' } 
      });
    }
  }
};
