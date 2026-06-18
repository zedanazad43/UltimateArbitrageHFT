// Local bot runner — wraps the Worker's fetch handler in a Node HTTP server
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Load .dev.vars as env
function loadDevVars() {
    const env = {};
    const devVarsPath = resolve(ROOT, '.dev.vars');
    if (existsSync(devVarsPath)) {
        const content = readFileSync(devVarsPath, 'utf8');
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eq = trimmed.indexOf('=');
            if (eq > 0) {
                env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
            }
        }
    }
    // Also merge process.env
    return { ...env, ...process.env };
}

async function main() {
    const mod = await import('../index.js');
    const handler = mod.default?.fetch || mod.fetch;
    if (!handler) {
        console.error('No fetch handler exported from index.js');
        process.exit(1);
    }

    const env = loadDevVars();
  
  // Stub Cloudflare bindings for local dev
  const stubStore = new Map();
  const stubKV = {
    get: async (key, type) => {
      const val = stubStore.get(key);
      if (!val) return null;
      if (type === 'json') return JSON.parse(val);
      return val;
    },
    put: async (key, val) => { stubStore.set(key, typeof val === 'string' ? val : JSON.stringify(val)); },
    delete: async (key) => { stubStore.delete(key); },
    list: async () => ({ keys: [...stubStore.keys()].map(name => ({ name })), list_complete: true }),
  };
  const stubD1 = {
    prepare: () => ({ bind: () => ({ run: async () => ({}), first: async () => null, all: async () => ({ results: [] }) })}),
    exec: async () => ({}),
    batch: async () => [],
  };
  
  env.BOT_STATE = stubKV;
  env.DB = stubD1;
  env.TRADE_LOGS = { put: async () => {}, get: async () => null };
  env.TRADE_QUEUE = { send: async () => {} };
  env.ANALYTICS = { writeDataPoint: () => {} };
  env.AIWORKER = { run: async () => ({ response: 'AI stub' }) };
  env.RATE_LIMITER = { limit: () => ({ outcome: 'ok' }) };
  env.METADATA = { get: async () => ({}) };
  env.MARKET_STREAMER = { idFromName: () => ({ fetch: async () => new Response('OK') }) };

    createServer(async (req, res) => {
        try {
            const url = `http://localhost${req.url}`;
            const headers = {};
            for (const [k, v] of Object.entries(req.headers)) {
                if (v) headers[k] = Array.isArray(v) ? v[0] : v;
            }
            const cfReq = new Request(url, { method: req.method, headers });
            const cfRes = await handler(cfReq, env, { waitUntil: () => { } });

            res.writeHead(cfRes.status, Object.fromEntries(cfRes.headers.entries()));
            res.end(await cfRes.text());
        } catch (err) {
            console.error('Request error:', err.message);
            res.writeHead(500);
            res.end('Internal error');
        }
    }).listen(8787, () => {
        console.log('🤖 Bot running on http://localhost:8787');
    });
}

main().catch(e => {
    console.error('Startup error:', e);
    process.exit(1);
});
