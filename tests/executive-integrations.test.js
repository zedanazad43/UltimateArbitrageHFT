import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  executeAllExecutableIntegrations,
  executeExecutableIntegration,
  getExecutableIntegrationsStatus,
  listExecutableIntegrationIds,
  probeExecutableIntegrations,
} from '../src/executive-integrations.js';

function makeResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('executive integrations metadata', () => {
  test('exposes exactly four executable integrations', () => {
    assert.deepEqual(listExecutableIntegrationIds(), ['hummingbot', 'freqtrade', 'crewai', 'autogpt']);
  });

  test('returns configured state from env vars', () => {
    const statuses = getExecutableIntegrationsStatus({
      HUMMINGBOT_EXECUTE_URL: 'https://hb/execute',
      FREQTRADE_EXECUTE_URL: 'https://ft/execute',
    });
    const map = Object.fromEntries(statuses.map((s) => [s.integration, s]));
    assert.equal(map.hummingbot.configured, true);
    assert.equal(map.freqtrade.configured, true);
    assert.equal(map.crewai.configured, false);
    assert.equal(map.autogpt.configured, false);
  });
});

describe('executeExecutableIntegration', () => {
  beforeEach(() => {
    globalThis.fetch = undefined;
  });

  test('throws for unknown integration ids', async () => {
    await assert.rejects(
      () => executeExecutableIntegration({}, 'unknown', {}),
      /Unknown integration/
    );
  });

  test('throws when required execute URL is not configured', async () => {
    await assert.rejects(
      () => executeExecutableIntegration({}, 'hummingbot', {}),
      /HUMMINGBOT_EXECUTE_URL is not configured/
    );
  });

  test('calls remote execute endpoint with bearer token when configured', async () => {
    let call;
    globalThis.fetch = async (url, options) => {
      call = { url, options };
      return makeResponse({ accepted: true }, 200);
    };
    const out = await executeExecutableIntegration({
      HUMMINGBOT_EXECUTE_URL: 'https://hb.example/run',
      HUMMINGBOT_API_TOKEN: 'secret-token',
    }, 'hummingbot', { symbol: 'BTCUSDT' });

    assert.equal(out.integration, 'hummingbot');
    assert.equal(out.status_code, 200);
    assert.equal(out.response.accepted, true);
    assert.equal(call.url, 'https://hb.example/run');
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.headers.Authorization, 'Bearer secret-token');
    assert.equal(JSON.parse(call.options.body).symbol, 'BTCUSDT');
  });
});

describe('probe and execute-all', () => {
  beforeEach(() => {
    globalThis.fetch = undefined;
  });

  test('probes status endpoint when status URL is configured', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('/health')) return makeResponse({ ok: true }, 200);
      return makeResponse({ accepted: true }, 200);
    };
    const statuses = await probeExecutableIntegrations({
      HUMMINGBOT_EXECUTE_URL: 'https://hb.example/run',
      HUMMINGBOT_STATUS_URL: 'https://hb.example/health',
    });
    const hummingbot = statuses.find((item) => item.integration === 'hummingbot');
    assert.equal(hummingbot.reachable, true);
    assert.equal(hummingbot.status_code, 200);
    assert.deepEqual(hummingbot.status_response, { ok: true });
  });

  test('returns mixed success/failure results for execute-all', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('crewai')) return makeResponse({ error: 'bad request' }, 400);
      return makeResponse({ accepted: true }, 200);
    };
    const results = await executeAllExecutableIntegrations({
      HUMMINGBOT_EXECUTE_URL: 'https://hummingbot.example/execute',
      FREQTRADE_EXECUTE_URL: 'https://freqtrade.example/execute',
      CREWAI_EXECUTE_URL: 'https://crewai.example/execute',
      AUTOGPT_EXECUTE_URL: 'https://autogpt.example/execute',
    }, {}, { run: true });

    const map = Object.fromEntries(results.map((r) => [r.integration, r]));
    assert.equal(map.hummingbot.success, true);
    assert.equal(map.freqtrade.success, true);
    assert.equal(map.autogpt.success, true);
    assert.equal(map.crewai.success, false);
    assert.match(map.crewai.error, /bad request/i);
  });
});
