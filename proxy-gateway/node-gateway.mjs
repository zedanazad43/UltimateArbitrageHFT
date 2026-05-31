/* global process, console, Buffer, URL */
import http from 'node:http';
import { fetch, ProxyAgent } from 'undici';

const PORT = Number.parseInt(process.env.PORT || '8788', 10);
const UPSTREAM_PROXY_URL = String(process.env.UPSTREAM_PROXY_URL || '').trim();
const GATEWAY_AUTH_TOKEN = String(process.env.GATEWAY_AUTH_TOKEN || '').trim();

const DEFAULT_ALLOWED_HOSTS = [
  'api.mexc.com', 'contract.mexc.com',
  'api.binance.com', 'api1.binance.com', 'api2.binance.com', 'api3.binance.com',
  'api-futures.binance.com',
  'api.kucoin.com',
  'api.bitget.com', 'capi.bitget.com', 'api2.bitget.com', 'capi2.bitget.com', 'api3.bitget.com',
  'api.bitget.info', 'capi.bitget.info',
  'api-cloud.bitmart.com',
  'api.htx.com',
  'api.bybit.com',
  'api.gateio.ws',
];

const ALLOWED_HOSTS = new Set(
  String(process.env.ALLOWED_HOSTS || DEFAULT_ALLOWED_HOSTS.join(','))
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
);

if (!UPSTREAM_PROXY_URL) {
  console.error('[gateway] Missing UPSTREAM_PROXY_URL');
  process.exit(1);
}

const proxyAgent = new ProxyAgent(UPSTREAM_PROXY_URL);

function isHostAllowed(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  if (ALLOWED_HOSTS.has(host)) return true;
  for (const allowed of ALLOWED_HOSTS) {
    if (host.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function copyHeaders(reqHeaders) {
  const out = {};
  const skip = new Set([
    'host',
    'connection',
    'content-length',
    'accept-encoding',
    'cf-connecting-ip',
    'cf-ipcountry',
    'cf-ray',
  ]);

  for (const [k, v] of Object.entries(reqHeaders)) {
    if (!v || skip.has(k.toLowerCase())) continue;
    out[k] = v;
  }

  out['user-agent'] = out['user-agent'] || 'UltimateArbitrageHFT-Gateway/1.0';
  return out;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Proxy-Target,X-Gateway-Token',
      });
      res.end();
      return;
    }

    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (requestUrl.pathname === '/health') {
      json(res, 200, {
        ok: true,
        service: 'arb-proxy-gateway-node',
        proxyConfigured: true,
      });
      return;
    }

    if (requestUrl.pathname !== '/proxy') {
      json(res, 404, { error: 'Not found' });
      return;
    }

    if (GATEWAY_AUTH_TOKEN) {
      const provided = String(req.headers['x-gateway-token'] || '').trim();
      if (!provided || provided !== GATEWAY_AUTH_TOKEN) {
        json(res, 401, { error: 'Unauthorized gateway token' });
        return;
      }
    }

    const target = requestUrl.searchParams.get('target') || String(req.headers['x-proxy-target'] || '');
    if (!target) {
      json(res, 400, { error: 'Missing target' });
      return;
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      json(res, 400, { error: 'Invalid target URL' });
      return;
    }

    if (!isHostAllowed(targetUrl.hostname)) {
      json(res, 403, { error: `Host not allowed: ${targetUrl.hostname}` });
      return;
    }

    const headers = copyHeaders(req.headers);
    delete headers['x-proxy-target'];
    delete headers['x-gateway-token'];

    const method = (req.method || 'GET').toUpperCase();
    const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);

    const upstream = await fetch(targetUrl.toString(), {
      method,
      headers,
      body,
      dispatcher: proxyAgent,
    });

    const responseHeaders = {};
    upstream.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'content-encoding') return;
      responseHeaders[key] = value;
    });
    responseHeaders['access-control-allow-origin'] = '*';
    responseHeaders['x-proxy-by'] = 'arb-proxy-gateway-node';

    res.writeHead(upstream.status, responseHeaders);
    const arrBuf = await upstream.arrayBuffer();
    res.end(Buffer.from(arrBuf));
  } catch (err) {
    json(res, 502, { error: err?.message || 'Proxy gateway error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[gateway] listening on :${PORT}`);
  console.log('[gateway] endpoint: /proxy?target=https://api.binance.com/api/v3/time');
});
