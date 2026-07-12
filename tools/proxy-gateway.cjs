#!/usr/bin/env node
/**
 * proxy-gateway.js — Local proxy gateway for UltimateArbitrageHFT Worker.
 *
 * Protocol (matches src/infra/proxy-pool.js + external-proxy.js):
 *   GET/POST/...  /?target=<urlencoded-target>   OR  header X-Proxy-Target: <url>
 *   header X-Gateway-Token: <token>     (optional, required if GATEWAY_TOKEN set)
 *
 * The gateway forwards the request (method, headers, body) to the target URL
 * through a rotating pool of upstream non-US proxies (for geo-blocked exchanges
 * like Binance/KuCoin/Bitget). Failed/blocked upstreams are skipped with failover.
 *
 * Run:   node tools/proxy-gateway.js
 * Env:   PORT (default 8080), GATEWAY_TOKEN (optional shared secret),
 *        UPSTREAM_PROXIES (comma host:port list, optional)
 */

const http = require('http');
const { URL } = require('url');
const { ProxyAgent, fetch: undiciFetch } = require('undici');

const PORT = Number(process.env.PORT || 8080);
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '';

// ── Upstream proxy pool (non-US egress for geo-blocked exchanges) ──────────────
const DEFAULT_UPSTREAM_PROXIES = [
  '1.231.81.166:3128',    // KR
  '101.36.109.77:8118',   // HK
  '103.167.61.162:3128',  // HK
  '104.194.148.188:3128', // GB
  '112.28.149.152:8443',  // JP
  '114.134.187.153:1081', // HK
  '103.82.20.76:8080',    // VN
  '113.160.132.26:8080',  // VN
  '118.71.44.153:2080',   // VN
];
const UPSTREAM_PROXIES = (process.env.UPSTREAM_PROXIES
  ? process.env.UPSTREAM_PROXIES.split(',').map((s) => s.trim()).filter(Boolean)
  : DEFAULT_UPSTREAM_PROXIES);

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
  const n = UPSTREAM_PROXIES.length;
  if (n === 0) return [];
  const order = [];
  for (let i = 0; i < n; i++) order.push(UPSTREAM_PROXIES[(_rrIndex + i) % n]);
  _rrIndex = (_rrIndex + 1) % n;
  return order;
}

const HOP_BY_HOP = new Set([
  'x-proxy-target', 'x-proxy-type', 'x-gateway-token', 'proxy-connection',
  'connection', 'keep-alive', 'transfer-encoding', 'host',
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
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,HEAD',
      'Access-Control-Allow-Headers': '*',
    });
    return res.end();
  }

  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('proxy-gateway ok');
  }


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
    upstreamHeaders['accept-encoding'] = 'identity';

    // Exchanges that must use DIRECT egress (German IP) to avoid geo-blocks.
    // All other targets rotate through the upstream proxy pool.
    const DIRECT_HOSTS = ['api.binance.com', 'api.binance.us', 'api.kucoin.com', 'api.bitget.com', 'api.htx.com'];
    const useDirect = DIRECT_HOSTS.some((h) => parsed.hostname.includes(h));
    const order = useDirect ? [null] : nextProxyOrder();
    const attempts = order.length > 0 ? order : [null];
    let upstream = null;
    let lastErr = null;

    for (const hostport of attempts) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
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
        // 403/451/456 from upstream = egress IP blocked → try next proxy.
        // 000/timeout/connection errors also fall through to next proxy.
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

    const respHeaders = {};
    for (const [k, v] of upstream.headers.entries()) {
      if (HOP_BY_HOP.has(k.toLowerCase())) continue;
      if (k.toLowerCase() === 'content-encoding') continue;
      if (k.toLowerCase() === 'content-length') continue;
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

server.listen(PORT, '::', () => {
  console.log(`[proxy-gateway] listening on http://[::]:${PORT} (IPv4+IPv6, token ${GATEWAY_TOKEN ? 'required' : 'disabled'})`);
  console.log(`[proxy-gateway] upstream proxies: ${UPSTREAM_PROXIES.length}`);
});
