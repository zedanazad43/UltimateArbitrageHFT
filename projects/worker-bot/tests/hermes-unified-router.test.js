import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MODEL_ALIASES,
  PROVIDER_CONFIG,
  UnifiedRouter,
} from '../src/ai-integration/hermes-unified-router.js';

test('exposes non-empty compatibility provider metadata', () => {
  assert.deepEqual(Object.keys(PROVIDER_CONFIG), ['hermes', 'copilot', 'omniroute', 'openrouter']);
  assert.equal(MODEL_ALIASES['or-gpt-mini'], 'openai/gpt-4o-mini');
  for (const config of Object.values(PROVIDER_CONFIG)) {
    assert.ok(config.models.length > 0);
    assert.equal(config.cost, 'unknown');
  }
});

test('reports all providers as unconfigured when no environment is supplied', async () => {
  const router = new UnifiedRouter();
  const statuses = await router.getAllProviderStatuses();
  assert.equal(Object.keys(statuses).length, 4);
  assert.ok(Object.values(statuses).every((status) => status.configured === false));
  assert.throws(() => router.selectProvider(), /No AI provider is configured/);
});

test('selects a configured OpenRouter route in paper mode without calling fetch', async () => {
  const router = new UnifiedRouter({ OPENROUTER_API_KEY: 'test-key' });
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('Paper mode must not call fetch');
  };

  try {
    const result = await router.routeLLMCall(
      [{ role: 'user', content: 'Summarize the safe route.' }],
      { paperMode: true, taskType: 'analysis', modelHint: 'or-gpt-mini' },
    );
    assert.equal(result.routedVia, 'openrouter');
    assert.equal(result.model, 'openai/gpt-4o-mini');
    assert.equal(result.route.paperMode, true);
    assert.match(result.text, /No provider request was made/);
    assert.equal(fetchCalled, false);
    assert.equal(router.getStats().paperRequests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects unknown and unavailable forced providers', () => {
  const router = new UnifiedRouter({ OPENROUTER_API_KEY: 'test-key' });
  assert.throws(() => router.selectProvider({ preferredProvider: 'unknown' }), /Unknown provider/);
  assert.throws(() => router.selectProvider({ preferredProvider: 'hermes' }), /not configured/);
});

test('uses an AIWORKER binding for an explicit live Hermes request', async () => {
  const calls = [];
  const router = new UnifiedRouter({
    AIWORKER: {
      async run(model, request) {
        calls.push({ model, request });
        return { response: 'binding response', usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } };
      },
    },
  }, { paper_trading: false });

  const result = await router.routeLLMCall(
    [{ role: 'user', content: 'Health check' }],
    { paperMode: false, preferredProvider: 'hermes' },
  );

  assert.equal(result.text, 'binding response');
  assert.equal(result.routedVia, 'hermes');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].request.messages[0].content, 'Health check');
  assert.equal(router.getStats().liveRequests, 1);
});

test('uses an explicitly configured OpenAI-compatible endpoint only for live requests', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'live response' } }],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const router = new UnifiedRouter({
      OMNIROUTE_GATEWAY_URL: 'https://router.example.test/v1/chat/completions',
      OMNIROUTE_API_KEY: 'test-key',
    }, { paper_trading: false });
    const result = await router.routeLLMCall(
      [{ role: 'user', content: 'Use configured endpoint' }],
      { paperMode: false, preferredProvider: 'omniroute' },
    );
    assert.equal(result.text, 'live response');
    assert.equal(result.usage.total_tokens, 6);
    assert.equal(request.url, 'https://router.example.test/v1/chat/completions');
    assert.equal(JSON.parse(request.init.body).messages[0].content, 'Use configured endpoint');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
