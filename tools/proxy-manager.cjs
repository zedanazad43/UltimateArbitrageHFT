const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROXY_STATE = path.join(process.cwd(), '.proxy-state.json');
const HEALTH_INTERVAL_MS = 30_000;
const FAIL_THRESHOLD = 3;

function readState() {
  try { return JSON.parse(fs.readFileSync(PROXY_STATE, 'utf8')); }
  catch { return { current: null, proxies: {} }; }
}
function writeState(state) { fs.writeFileSync(PROXY_STATE, JSON.stringify(state)); }

function checkProxy(proxyUrl, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const url = new URL(proxyUrl);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, { method: 'GET', path: '/health', timeout: timeoutMs }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode, body: d.slice(0, 120) }));
    });
    req.on('error', () => resolve({ ok: false, status: 0, body: req.error?.message || 'network_error' }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, body: 'timeout' }); });
    req.end();
  });
}

async function serveoHealth() {
  return { ok: true, status: 200, body: 'ok' };
}

async function main() {
  const primary = process.env.PROXY_URL_1 || 'https://proxy-gateway.zedanazad43.workers.dev';
  const fallback = process.env.PROXY_URL_2 || '';
  const proxies = [
    { url: primary, name: 'primary' },
    { url: fallback, name: 'serveo' },
  ].filter(p => p.url);

  const state = readState();
  for (const p of proxies) {
    const result = await checkProxy(p.url);
    const rec = state.proxies[p.url] || { failures: 0, successes: 0 };
    if (result.ok) {
      rec.successes++;
      rec.failures = 0;
      rec.lastOk = Date.now();
    } else {
      rec.failures++;
      rec.lastFail = Date.now();
    }
    state.proxies[p.url] = rec;
  }

  const healthy = proxies.filter(p => (state.proxies[p.url]?.failures || 0) < FAIL_THRESHOLD);
  const best = healthy.sort((a, b) => (state.proxies[b.url]?.successes || 0) - (state.proxies[a.url]?.successes || 0))[0];

  if (!state.current || !healthy.find(p => p.url === state.current)) {
    state.current = best?.url || primary;
  }

  writeState(state);
  console.log(JSON.stringify({ current: state.current, healthy: healthy.map(p => p.url), ts: Date.now() }, null, 2));
  process.exit(0);
}

if (require.main === module) main().catch(() => process.exit(1));
