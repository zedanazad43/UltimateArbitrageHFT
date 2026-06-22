// scripts/hummingbot-start.js — Local Hummingbot connector
//
// Connects to a locally running Hummingbot container (via its Gateway REST API)
// and triggers strategy execution.  All activity is timestamped and appended to
// connector.log in the repo root so you can tail it in a separate terminal:
//
//   PowerShell:  Get-Content connector.log -Wait
//   bash/macOS:  tail -f connector.log
//
// Prerequisites:
//   1. Docker Desktop running
//   2. Hummingbot container started, e.g.:
//      docker run -it -p 8080:8080 -v hummingbot_data:/root/hummingbot hummingbot/hummingbot:latest
//
// Required env (in .dev.vars or process.env):
//   HUMMINGBOT_EXECUTE_URL — full URL of the start/execute endpoint
//                            default: http://localhost:8080/api/v1/start
//   HUMMINGBOT_API_TOKEN   — API token for Hummingbot Gateway auth (optional)
//   HUMMINGBOT_STATUS_URL  — Health/status endpoint (optional)
//
// Usage:
//   npm run hummingbot:start
/* global AbortSignal */

import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const DEFAULT_EXECUTE_URL = 'http://localhost:8080/api/v1/start';
const REQUEST_TIMEOUT_MS = 10000;

export const LOG_FILE = resolve(ROOT, 'connector.log');

// ── Environment loading ───────────────────────────────────────────────────────

export function loadEnv() {
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
  return { ...env, ...process.env };
}

// ── Config resolution ─────────────────────────────────────────────────────────

export function resolveConfig(env) {
  const executeUrl = String(env.HUMMINGBOT_EXECUTE_URL || DEFAULT_EXECUTE_URL).trim();
  const token = String(env.HUMMINGBOT_API_TOKEN || '').trim();
  const statusUrl = String(env.HUMMINGBOT_STATUS_URL || '').trim();
  return { executeUrl, token, statusUrl };
}

// ── Payload builder ───────────────────────────────────────────────────────────

export function buildPayload() {
  return {
    trigger: 'npm_hummingbot_start',
    requested_at: new Date().toISOString(),
  };
}

// ── Log helper ────────────────────────────────────────────────────────────────

export function appendLog(logPath, line) {
  const ts = new Date().toISOString();
  appendFileSync(logPath, `${ts} ${line}\n`, 'utf8');
}

// ── HTTP call ─────────────────────────────────────────────────────────────────

export async function callHummingbot(config, payload) {
  const { executeUrl, token } = config;

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;

  try {
    const resp = await fetch(executeUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const text = await resp.text().catch(() => '');
    let data = null;
    try { data = JSON.parse(text); } catch (_e) { data = { raw: text }; }

    return { ok: resp.ok, status: resp.status, data };
  } catch (err) {
    return { ok: false, status: null, error: err.message };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const env = loadEnv();
  const config = resolveConfig(env);
  const payload = buildPayload();

  appendLog(LOG_FILE, `[hummingbot:start] Connecting to ${config.executeUrl}`);
  console.log(`[hummingbot:start] Connecting to ${config.executeUrl} ...`);

  const result = await callHummingbot(config, payload);

  if (result.ok) {
    const detail = JSON.stringify(result.data);
    appendLog(LOG_FILE, `[hummingbot:start] OK (${result.status}) ${detail}`);
    console.log(`[hummingbot:start] \u2713 OK (${result.status})`);
    console.log(`[hummingbot:start] Response: ${detail}`);
    console.log('[hummingbot:start] Logs: connector.log');
  } else {
    const detail = result.error || `HTTP ${result.status}: ${JSON.stringify(result.data)}`;
    appendLog(LOG_FILE, `[hummingbot:start] ERROR ${detail}`);
    console.error(`[hummingbot:start] \u2717 ${detail}`);
    console.error('[hummingbot:start] Check connector.log for full history');
    process.exit(1);
  }
}

// Only run when executed directly (not when imported by tests)
const isMain = process.argv[1] &&
  import.meta.url === new URL(process.argv[1], import.meta.url).href;
if (isMain) {
  try {
    await main();
  } catch (e) {
    console.error('[hummingbot:start] Fatal:', e.message || e);
    process.exit(1);
  }
}
