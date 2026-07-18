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

async function routeToFreeFallback(prompt, preferredSkills) {
  if (!preferredSkills || !preferredSkills.length) {
    preferredSkills = ['openrouter-free', 'ollama-local'];
  }
  const route = resolveRoute(prompt, preferredSkills);
  if (typeof prompt === 'string' && !prompt.trim()) {
    return { routedTo: 'openrouter-free', route };
  }

  const attempts = [route.primary, ...route.fallbacks.slice(0, 3)];
  for (const provider of attempts) {
    try {
      return { routedTo: provider, route, attempt: provider };
    } catch (_) {
      const record = SKILL_REGISTRY.get(provider) || {};
      SKILL_REGISTRY.set(provider, { ...record, failures: (record.failures || 0) + 1, lastFailure: Date.now() });
    }
  }

  throw new Error(`free-provider-failover: all providers failed for prompt context "${String(prompt).slice(0, 40)}..."`);
}

export { registerSkillFromRepo, routeToFreeFallback, resolveRoute };
