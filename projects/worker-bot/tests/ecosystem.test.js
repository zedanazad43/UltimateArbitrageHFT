import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { getApiKeySecurityChecklist, getEcosystemCatalog, recommendEcosystem } from '../src/ecosystem.js';

describe('ecosystem catalog', () => {
  test('includes the expected core frameworks and agent systems', () => {
    const ids = new Set(getEcosystemCatalog().map((item) => item.id));
    for (const expected of ['hummingbot', 'freqtrade', 'opencode', 'aider', 'crewai', 'autogpt']) {
      assert.ok(ids.has(expected), `missing ${expected}`);
    }
  });
});

describe('ecosystem recommendations', () => {
  test('returns Hummingbot for quick_start goal', () => {
    const recommendation = recommendEcosystem('quick_start');
    assert.equal(recommendation.primary, 'hummingbot');
    assert.equal(recommendation.fallback, false);
  });

  test('falls back safely for unknown goal', () => {
    const recommendation = recommendEcosystem('unknown_goal');
    assert.equal(recommendation.goal, 'quick_start');
    assert.equal(recommendation.fallback, true);
  });
});

describe('API key security checklist', () => {
  test('contains critical key-handling guardrails', () => {
    const checklist = getApiKeySecurityChecklist().join('\n');
    assert.match(checklist, /Never commit API keys/i);
    assert.match(checklist, /least privilege/i);
    assert.match(checklist, /latency/i);
  });
});
