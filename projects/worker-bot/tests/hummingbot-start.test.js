// tests/hummingbot-start.test.js — Unit tests for scripts/hummingbot-start.js
// Run with: node --test tests/hummingbot-start.test.js

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  resolveConfig,
  buildPayload,
  callHummingbot,
  appendLog,
} from '../scripts/hummingbot-start.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function tempLogPath() {
  return resolve(tmpdir(), `connector-test-${crypto.randomUUID()}.log`);
}

// ── resolveConfig ─────────────────────────────────────────────────────────────

describe('resolveConfig', () => {
  test('uses DEFAULT_EXECUTE_URL when HUMMINGBOT_EXECUTE_URL is absent', () => {
    const cfg = resolveConfig({});
    assert.equal(cfg.executeUrl, 'http://localhost:8080/api/v1/start');
  });

  test('uses custom HUMMINGBOT_EXECUTE_URL when provided', () => {
    const cfg = resolveConfig({ HUMMINGBOT_EXECUTE_URL: 'https://hb.example.com/run' });
    assert.equal(cfg.executeUrl, 'https://hb.example.com/run');
  });

  test('returns empty string for token when HUMMINGBOT_API_TOKEN is absent', () => {
    const cfg = resolveConfig({});
    assert.equal(cfg.token, '');
  });

  test('returns token when HUMMINGBOT_API_TOKEN is set', () => {
    const cfg = resolveConfig({ HUMMINGBOT_API_TOKEN: 'my-secret' });
    assert.equal(cfg.token, 'my-secret');
  });

  test('returns empty string for statusUrl when HUMMINGBOT_STATUS_URL is absent', () => {
    const cfg = resolveConfig({});
    assert.equal(cfg.statusUrl, '');
  });

  test('returns statusUrl when HUMMINGBOT_STATUS_URL is set', () => {
    const cfg = resolveConfig({ HUMMINGBOT_STATUS_URL: 'https://hb.example.com/status' });
    assert.equal(cfg.statusUrl, 'https://hb.example.com/status');
  });

  test('trims whitespace from all values', () => {
    const cfg = resolveConfig({
      HUMMINGBOT_EXECUTE_URL: '  http://localhost:8080/run  ',
      HUMMINGBOT_API_TOKEN: '  tok  ',
    });
    assert.equal(cfg.executeUrl, 'http://localhost:8080/run');
    assert.equal(cfg.token, 'tok');
  });
});

// ── buildPayload ──────────────────────────────────────────────────────────────

describe('buildPayload', () => {
  test('returns an object with trigger and requested_at', () => {
    const payload = buildPayload();
    assert.equal(payload.trigger, 'npm_hummingbot_start');
    assert.ok(typeof payload.requested_at === 'string');
    assert.ok(!isNaN(Date.parse(payload.requested_at)));
  });
});

// ── callHummingbot ────────────────────────────────────────────────────────────

describe('callHummingbot', () => {
  beforeEach(() => {
    globalThis.fetch = undefined;
  });

  test('returns ok:true and parsed data on 200 response', async () => {
    globalThis.fetch = async () => makeResponse({ accepted: true });
    const result = await callHummingbot(
      { executeUrl: 'http://localhost:8080/api/v1/start', token: '' },
      { trigger: 'test' }
    );
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { accepted: true });
  });

  test('returns ok:false on non-200 response', async () => {
    globalThis.fetch = async () => makeResponse({ error: 'not found' }, 404);
    const result = await callHummingbot(
      { executeUrl: 'http://localhost:8080/api/v1/start', token: '' },
      {}
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
  });

  test('returns ok:false and error message when fetch throws', async () => {
    globalThis.fetch = async () => { throw new Error('connection refused'); };
    const result = await callHummingbot(
      { executeUrl: 'http://localhost:8080/api/v1/start', token: '' },
      {}
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, null);
    assert.match(result.error, /connection refused/i);
  });

  test('sends Authorization header when token is set', async () => {
    let capturedHeaders;
    globalThis.fetch = async (_url, opts) => {
      capturedHeaders = opts?.headers || {};
      return makeResponse({ accepted: true });
    };
    await callHummingbot(
      { executeUrl: 'http://localhost:8080/api/v1/start', token: 'secret-tok' },
      {}
    );
    assert.equal(capturedHeaders['Authorization'], 'Bearer secret-tok');
  });

  test('does not send Authorization header when token is empty', async () => {
    let capturedHeaders;
    globalThis.fetch = async (_url, opts) => {
      capturedHeaders = opts?.headers || {};
      return makeResponse({ accepted: true });
    };
    await callHummingbot(
      { executeUrl: 'http://localhost:8080/api/v1/start', token: '' },
      {}
    );
    assert.equal(capturedHeaders['Authorization'], undefined);
  });

  test('sends a POST request with JSON body', async () => {
    let capturedMethod, capturedBody;
    globalThis.fetch = async (_url, opts) => {
      capturedMethod = opts?.method;
      capturedBody = JSON.parse(opts?.body);
      return makeResponse({ accepted: true });
    };
    await callHummingbot(
      { executeUrl: 'http://localhost:8080/api/v1/start', token: '' },
      { trigger: 'npm_hummingbot_start', custom: 42 }
    );
    assert.equal(capturedMethod, 'POST');
    assert.equal(capturedBody.trigger, 'npm_hummingbot_start');
    assert.equal(capturedBody.custom, 42);
  });

  test('wraps non-JSON response body in { raw: text }', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => 'plain text response',
    });
    const result = await callHummingbot(
      { executeUrl: 'http://localhost:8080/api/v1/start', token: '' },
      {}
    );
    assert.deepEqual(result.data, { raw: 'plain text response' });
  });
});

// ── appendLog ─────────────────────────────────────────────────────────────────

describe('appendLog', () => {
  let logPath;

  beforeEach(() => {
    logPath = tempLogPath();
  });

  afterEach(() => {
    if (existsSync(logPath)) unlinkSync(logPath);
  });

  test('creates the log file and writes the line with a timestamp prefix', () => {
    appendLog(logPath, '[test] hello world');
    assert.ok(existsSync(logPath));
    const content = readFileSync(logPath, 'utf8');
    assert.match(content, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(content.includes('[test] hello world'));
  });

  test('appends to an existing log file without overwriting', () => {
    appendLog(logPath, '[test] first line');
    appendLog(logPath, '[test] second line');
    const content = readFileSync(logPath, 'utf8');
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 2);
    assert.ok(lines[0].includes('[test] first line'));
    assert.ok(lines[1].includes('[test] second line'));
  });

  test('each entry ends with a newline', () => {
    appendLog(logPath, '[test] entry');
    const content = readFileSync(logPath, 'utf8');
    assert.ok(content.endsWith('\n'));
  });
});
