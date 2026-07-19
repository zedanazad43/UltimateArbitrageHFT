// src/free-provider-failover.js
const SKILL_REGISTRY = new Map();

function registerSkillFromRepo(path) {
  SKILL_REGISTRY.set(
    typeof path === 'string' ? path.trim() : String(path),
    { registeredAt: Date.now() }
  );
}

function sortFailureRecords(records) {
  return records.slice().sort((a, b) => (b.failures || 0) - (a.failures || 0));
}

function resolveRoute(prompt, preferredSkills) {
  const candidates = [];
  let preferredSet = new Set();
  if (Array.isArray(preferredSkills)) {
    for (const skill of preferredSkills) candidates.push(String(skill));
    preferredSet = new Set(candidates.map(String));
  }
  if (typeof prompt === 'string' && prompt.trim()) candidates.push(`prompt:${prompt.trim().slice(0, 32)}`);
  if (!candidates.length) return { primary: 'openrouter-free', fallbacks: ['ollama-local'] };

  const all = [
    { key: 'openrouter-free', provider: 'openrouter', weight: 10 },
    { key: 'ollama-local', provider: 'ollama', weight: 8 },
    { key: 'local-llm', provider: 'local', weight: 6 },
    { key: 'merlin-free', provider: 'merlin', weight: 5 },
    { key: 'manus-free', provider: 'manus', weight: 4 },
    ...candidates.filter((c) => !preferredSet.has(c)).map((key) => ({ key, provider: key, weight: 1 })),
  ];

  for (const skill of preferredSet) {
    if (!all.some((x) => x.key === skill)) all.push({ key: skill, provider: skill, weight: 2 });
  }

  const ordered = sortFailureRecords(
    all.map((entry) => ({
      key: entry.key,
      provider: entry.provider,
      failures: 0,
      lastFailure: null,
    }))
  );

  const primary = ordered[0].key;
  const fallbacks = ordered.slice(1).map((x) => x.key);
  return { primary, fallbacks, candidates: [...preferredSet] };
}

async function fallbackProviderChat(prompt) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return { text: '', provider: 'none', model: '', source: 'none' };
  }

  const attempts = [
    'openrouter-free',
    'ollama-local',
    'local-llm',
    'merlin-free',
    'manus-free',
  ];

  for (const provider of attempts) {
    try {
      if (provider === 'openrouter-free') {
        // Placeholder: Wire OpenRouter client if key/env is present.
      } else if (provider === 'ollama-local') {
        // Placeholder: Wire Ollama if available.
      }

      return {
        text: `[${provider}] simulated response for: ${prompt.slice(0, 32)}`,
        provider,
        model: provider,
        source: 'free-provider-failover',
      };
    } catch (_) {
      const record = SKILL_REGISTRY.get(provider) || {};
      SKILL_REGISTRY.set(provider, { ...record, failures: (record.failures || 0) + 1, lastFailure: Date.now() });
    }
  }

  return { text: '', provider: 'none', model: '', source: 'none' };
}

async function routeToFreeFallback(prompt, preferredSkills) {
  const route = resolveRoute(prompt, preferredSkills);
  return { routedTo: route.primary, route, attempt: route.primary, response: await fallbackProviderChat(prompt) };
}

export function getFailover() {
  return { callFreeLLM: fallbackProviderChat };
}


const PROVIDER_BUDGET_MAX = 90;
const BUDGET_KEY = 'provider_budget_used_v1';

function _budgetKey(provider) { return `${BUDGET_KEY}:${provider}`; }

async function getBudgetUsed(env, provider) {
  try {
    const val = await env.BOT_STATE.get(_budgetKey(provider), 'json');
    return Number(val || 0);
  } catch (_) { return 0; }
}

async function addBudgetUsed(env, provider, cost) {
  try {
    const current = await getBudgetUsed(env, provider);
    await env.BOT_STATE.put(_budgetKey(provider), String(current + cost));
  } catch (_) {}
}

async function getProviderBudgetStatus(env, provider) {
  const used = await getBudgetUsed(env, provider);
  return used;
}

async function switchProvider(env, fromProvider) {
  const route = resolveRoute('provider-switch', [fromProvider]);
  const next = route.fallbacks[0] || route.primary;
  return next;
}

export { getProviderBudgetStatus, addBudgetUsed, switchProvider, getBudgetUsed };

export { registerSkillFromRepo, routeToFreeFallback, resolveRoute };

