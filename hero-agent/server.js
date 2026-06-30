/**
 * hero-agent/server.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Hero Super Agent Server v2.2.0
 *
 * Endpoints:
 *   GET  /health       — liveness + version
 *   GET  /api/status   — all platform connection statuses
 *   POST /api/agent    — forward prompt to aimaster orchestrator
 *   GET  /api/files    — list project files (attached-files feature)
 *
 * Start:  node hero-agent/server.js
 * Status: node hero-agent/server.js --status-only
 */

import http from 'http';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { checkAllPlatforms } from './platforms.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

// ── Load .env from project root (best-effort, no hard dependency) ─────────────
function loadDotEnv() {
  const envPath = join(PROJECT_ROOT, '.env');
  if (!existsSync(envPath)) return;
  try {
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !(key in process.env)) {
        process.env[key] = val;
      }
    }
  } catch {
    // silently skip unreadable .env
  }
}
loadDotEnv();

const VERSION = '2.2.0';
const PORT = parseInt(process.env.PORT ?? '3001', 10);
const AIMASTER_ENDPOINT = (process.env.AIMASTER_ENDPOINT ?? 'http://127.0.0.1:8000').replace(/\/$/, '');
const MAX_PROMPT_LENGTH = 8192;

const PLATFORM_LABELS = {
  github: 'GitHub',
  cloudflare: 'Cloudflare',
  railway: 'Railway',
  stripe: 'Stripe',
  wallet: 'Wallet',
  manus: 'Manus',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ── Route: GET /health ────────────────────────────────────────────────────────
async function handleHealth(req, res) {
  const platforms = await checkAllPlatforms();
  json(res, 200, {
    status: 'ok',
    server: `Hero Super Agent Server v${VERSION}`,
    version: VERSION,
    timestamp: new Date().toISOString(),
    endpoints: {
      agent: `http://localhost:${PORT}/api/agent`,
      files: `http://localhost:${PORT}/api/files`,
      status: `http://localhost:${PORT}/api/status`,
    },
    platforms,
  });
}

// ── Route: GET /api/status ────────────────────────────────────────────────────
async function handleStatus(req, res) {
  const platforms = await checkAllPlatforms();
  const summary = Object.fromEntries(
    Object.entries(platforms).map(([k, v]) => [k, v.connected ? '✅' : '❌'])
  );
  json(res, 200, {
    summary,
    details: platforms,
    timestamp: new Date().toISOString(),
  });
}

// ── Route: POST /api/agent ────────────────────────────────────────────────────
async function handleAgent(req, res) {
  let body;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  const prompt = body.prompt ?? body.message ?? body.query;
  if (!prompt || typeof prompt !== 'string') return json(res, 400, { error: 'Missing field: prompt / message / query' });
  if (prompt.length > MAX_PROMPT_LENGTH) return json(res, 400, { error: `Prompt too long (max ${MAX_PROMPT_LENGTH} chars)` });

  // Try aimaster HTTP endpoint first
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const upstream = await fetch(`${AIMASTER_ENDPOINT}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, stream: false }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (upstream.ok) {
      const data = await upstream.json();
      return json(res, 200, {
        response: data.response ?? data.content ?? data.text ?? data,
        provider: data.provider ?? 'aimaster',
        source: 'aimaster-http',
      });
    }
    // Non-200 from upstream — fall through to subprocess fallback
    console.warn(`[hero-agent] aimaster HTTP returned ${upstream.status}, trying CLI fallback`);
  } catch (err) {
    console.warn(`[hero-agent] aimaster HTTP unreachable (${err.message}), trying CLI fallback`);
  }

  // Fallback: invoke aimaster CLI as subprocess
  try {
    const { spawn } = await import('child_process');
    const result = await new Promise((resolve, reject) => {
      const py = spawn('python3', [join(PROJECT_ROOT, 'aimaster', 'run.py'), 'chat', '--prompt', prompt], {
        cwd: PROJECT_ROOT,
        timeout: 30_000,
      });
      const stdout = [];
      const stderr = [];
      py.stdout.on('data', (d) => stdout.push(d));
      py.stderr.on('data', (d) => stderr.push(d));
      py.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(stdout).toString('utf8').trim());
        } else {
          reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `exit code ${code}`));
        }
      });
      py.on('error', reject);
    });
    return json(res, 200, { response: result, provider: 'aimaster-cli', source: 'subprocess' });
  } catch (cliErr) {
    return json(res, 503, {
      error: 'aimaster unavailable',
      detail: cliErr.message,
      hint: `Start aimaster: python ${join(PROJECT_ROOT, 'aimaster', 'run.py')} serve`,
    });
  }
}

// ── Route: GET /api/files ─────────────────────────────────────────────────────
function listFiles(dir, base = '', depth = 0, max = 3) {
  if (depth >= max) return [];
  const results = [];
  try {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === '__pycache__') continue;
      const fullPath = join(dir, entry);
      const relPath = base ? `${base}/${entry}` : entry;
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          results.push(...listFiles(fullPath, relPath, depth + 1, max));
        } else {
          results.push({ path: relPath, size: stat.size, mtime: stat.mtime.toISOString() });
        }
      } catch {
        // skip unreadable entries
      }
    }
  } catch {
    // skip unreadable directories
  }
  return results;
}

function handleFiles(req, res) {
  const files = listFiles(PROJECT_ROOT);
  json(res, 200, {
    root: PROJECT_ROOT,
    count: files.length,
    files,
  });
}

// ── Router ────────────────────────────────────────────────────────────────────
async function router(req, res) {
  const url = req.url.split('?')[0];
  const method = req.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  if (method === 'GET' && url === '/health') return handleHealth(req, res);
  if (method === 'GET' && url === '/api/status') return handleStatus(req, res);
  if (method === 'POST' && url === '/api/agent') return handleAgent(req, res);
  if (method === 'GET' && url === '/api/files') return handleFiles(req, res);

  json(res, 404, { error: 'Not found', available: ['/health', '/api/status', '/api/agent', '/api/files'] });
}

// ── Status-only mode ──────────────────────────────────────────────────────────
async function runStatusOnly() {
  console.log('\n🦸 Hero Super Agent — Platform Status Check\n');
  const platforms = await checkAllPlatforms();
  for (const [key, result] of Object.entries(platforms)) {
    const icon = result.connected ? '✅' : '❌';
    const label = (PLATFORM_LABELS[key] ?? key).padEnd(12);
    console.log(`   ${icon} ${label} ${result.detail}`);
  }
  console.log();
  process.exit(0);
}

// ── Entry point ───────────────────────────────────────────────────────────────
(async () => {
  if (process.argv.includes('--status-only')) {
    await runStatusOnly();
  } else {
    const server = http.createServer(async (req, res) => {
      try {
        await router(req, res);
      } catch (err) {
        console.error('[hero-agent] Unhandled error:', err);
        try { json(res, 500, { error: 'Internal server error', detail: err.message }); } catch { res.end(); }
      }
    });

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`\n🦸 Hero Super Agent Server v${VERSION}`);
      console.log(`📍 http://localhost:${PORT}`);
      console.log(`📍 Agent: http://localhost:${PORT}/api/agent`);
      console.log(`📍 Files: http://localhost:${PORT}/api/files`);
      console.log(`📍 Health: http://localhost:${PORT}/health`);
      console.log('\n🔗 Checking platform connections...\n');

      checkAllPlatforms().then((platforms) => {
        console.log('🔗 Connected Platforms Status:');
        for (const [key, result] of Object.entries(platforms)) {
          const icon = result.connected ? '✅' : '❌';
          const label = (PLATFORM_LABELS[key] ?? key).padEnd(12);
          console.log(`   ${icon} ${label} ${result.detail}`);
        }
        console.log();
      }).catch(() => {});
    });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[hero-agent] Port ${PORT} already in use. Set PORT=<other> to override.`);
    } else {
      console.error('[hero-agent] Server error:', err.message);
    }
    process.exit(1);
  });
  }
})().catch((err) => {
  console.error('[hero-agent] Fatal error:', err);
  process.exit(1);
});
