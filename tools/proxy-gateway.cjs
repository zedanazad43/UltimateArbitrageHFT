#!/usr/bin/env node
/**
 * proxy-gateway.js — Local proxy gateway for UltimateArbitrageHFT Worker.
 *
 * Protocol (matches src/infra/proxy-pool.js + external-proxy.js):
 *   GET/POST/...  /?target=<urlencoded-target>   OR  header X-Proxy-Target: <url>
 *   header X-Proxy-Type: <http|https>   (optional)
 *   header X-Gateway-Token: <token>     (optional, required if GATEWAY_TOKEN set)
 *
 * The gateway forwards the request (method, headers, body) to the target URL.
 * Outbound traffic leaves the machine through whatever egress is active
 * (e.g. the proxy01 VPN client running on this machine), so exchange APIs
 * see a non-US IP.
 *
 * Run:   node tools/proxy-gateway.js
 * Env:   PORT (default 8080), GATEWAY_TOKEN (optional shared secret)
 */

const http = require('http');
const { URL } = require('url');
const { ProxyAgent, fetch: undiciFetch } = require('undici');

const PORT = Number(process.env.PORT || 8080);
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '';

// ── Upstream proxy pool (non-US egress for geo-blocked exchanges) ──────────────
// Comma-separated host:port list via UPSTREAM_PROXIES, else defaults below.
// Each entry is used as http://host:port. The gateway rotates through them with
// failover so exchange APIs see a non-US IP.
const DEFAULT_UPSTREAM_PROXIES = [
  '1.231.81.166:3128',    // KR
  '101.36.109.77:8118',   // HK
  '103.167.61.162:3128',  // HK
  '104.194.148.188:3128', // GB
];
const UPSTREAM_PROXIES = (process.env.UPSTREAM_PROXIES
  ? process.env.UPSTREAM_PROXIES.split(',').map((s) => s.trim()).filter(Boolean)
  : DEFAULT_UPSTREAM_PROXIES);

// Build a ProxyAgent per upstream (lazy cache).
const _agentCache = new Map();
function getAgent(hostport) {
  if (!hostport) return null;
  if (!_agentCache.has(hostport)) {
    _agentCache.set(hostport, new ProxyAgent({
      uri: `http://${hostport}`,
      requestTls: { rejectUnauthorized: false },
    }));
  }
  return _agentCache.get(hostport);
}

let _rrIndex = 0;
function nextProxyOrder() {
  // Round-robin starting point, returns full ordered list for failover.
  const n = UPSTREAM_PROXIES.length;
  if (n === 0) return [];
  const order = [];
  for (let i = 0; i < n; i++) order.push(UPSTREAM_PROXIES[(_rrIndex + i) % n]);
  _rrIndex = (_rrIndex + 1) % n;
  return order;
}

// Headers the gateway injects/uses — strip from the upstream request.
const HOP_BY_HOP = new Set([
  'x-proxy-target',
  'x-proxy-type',
  'x-gateway-token',
  'proxy-connection',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'host',
]);

function getTarget(req) {
  const q = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const fromQuery = q.searchParams.get('target');
  if (fromQuery) return decodeURIComponent(fromQuery);
  const fromHeader = req.headers['x-proxy-target'];
  if (fromHeader) return fromHeader;
  return null;
}

function buildUpstreamHeaders(req) {
  const out = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(Buffer.alloc(0)));
  });
}

const server = http.createServer(async (req, res) => {
  // CORS preflight (in case bot ever calls from a browser context)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,HEAD',
      'Access-Control-Allow-Headers': '*',
    });
    return res.end();
  }

  // Health check
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('proxy-gateway ok');
  }

  // Auth
  if (GATEWAY_TOKEN) {
    const provided = req.headers['x-gateway-token'];
    if (provided !== GATEWAY_TOKEN) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      return res.end('forbidden');
    }
  }

  const target = getTarget(req);
  if (!target) {
    res.writeHead(400, { 'content-type': 'text/plain' });
    return res.end('missing target (use ?target= or X-Proxy-Target header)');
  }

  let parsed;
  try {
    parsed = new URL(target);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('bad proto');
  } catch (e) {
    res.writeHead(400, { 'content-type': 'text/plain' });
    return res.end('invalid target url: ' + target);
  }

  try {
    const body = await readBody(req);
    const upstreamHeaders = buildUpstreamHeaders(req);
    // Force uncompressed upstream responses so the Worker gets plain JSON/text.
    upstreamHeaders['accept-encoding'] = 'identity';

    // Route through the non-US upstream proxy pool with failover.
    const order = nextProxyOrder();
    const attempts = order.length > 0 ? order : [null]; // null = direct (no upstream)
    let upstream = null;
    let lastErr = null;

    for (const hostport of attempts) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const opts = {
          method: req.method,
          headers: upstreamHeaders,
          body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
          signal: controller.signal,
          redirect: 'follow',
        };
        const agent = getAgent(hostport);
        if (agent) opts.dispatcher = agent;
        upstream = await undiciFetch(target, opts);
        clearTimeout(timeout);
        // 403 / cloudflare-block bodies mean this egress IP is blocked → try next proxy.
        if (upstream.status === 403 || upstream.status === 451 || upstream.status === 456) {
          lastErr = new Error(`egress ${hostport || 'direct'} blocked (HTTP ${upstream.status})`);
          upstream = null;
          continue;
        }
        break;
      } catch (e) {
        clearTimeout(timeout);
        lastErr = e;
        upstream = null;
        continue;
      }
    }

    if (!upstream) {
      res.writeHead(502, { 'content-type': 'text/plain' });
      return res.end('gateway: all upstream proxies failed: ' + (lastErr && lastErr.message ? lastErr.message : 'unknown'));
    }

    // Forward response (strip hop-by-hop + any compression headers)
    const respHeaders = {};
    for (const [k, v] of upstream.headers.entries()) {
      if (HOP_BY_HOP.has(k.toLowerCase())) continue;
      if (k.toLowerCase() === 'content-encoding') continue; // we already forced identity
      if (k.toLowerCase() === 'content-length') continue;    // recomputed by res.end
      respHeaders[k] = v;
    }
    respHeaders['Access-Control-Allow-Origin'] = '*';

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, respHeaders);
    res.end(buf);
  } catch (err) {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('gateway upstream error: ' + (err && err.message ? err.message : String(err)));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[proxy-gateway] listening on http://0.0.0.0:${PORT} (token ${GATEWAY_TOKEN ? 'required' : 'disabled'})`);
});
