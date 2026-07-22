const https = require('node:https');

const BASE = 'https://ultimatearbitragehft.zedanazad43.workers.dev';
const TOKEN = '309400';
const endpoints = [
  { method: 'GET', path: '/health', headers: {} },
  { method: 'GET', path: '/api/status', headers: { 'x-admin-token': TOKEN } },
  { method: 'GET', path: '/api/telemetry/latency', headers: { 'x-admin-token': TOKEN } },
  { method: 'GET', path: '/api/readiness', headers: { 'x-admin-token': TOKEN } },
  { method: 'POST', path: '/api/alerts/test', headers: { 'x-admin-token': TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'e2e' }) },
];

function req(opts, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode || 0, ok: res.statusCode === 200, snippet: text.slice(0, 80) });
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

(async () => {
  const results = [];
  for (const ep of endpoints) {
    try {
      const url = new URL(ep.path, BASE);
      const out = await req({
        hostname: url.hostname,
        path: url.pathname,
        method: ep.method,
        headers: ep.headers,
      }, ep.body);
      results.push({ method: ep.method, path: ep.path, ...out });
    } catch (e) {
      results.push({ method: ep.method, path: ep.path, status: 0, ok: false, snippet: e.message });
    }
  }

  for (const r of results) {
    console.log(`${r.method} ${r.path} :: ${r.status} ${r.ok ? 'PASS' : 'FAIL'} :: ${r.snippet}`);
  }
  const pass = results.filter((r) => r.ok).length;
  console.log(`RESULT ${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})();
