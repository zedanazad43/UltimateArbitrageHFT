const ECOSYSTEM_CATALOG = [
  {
    id: 'hummingbot',
    type: 'framework',
    focus: 'professional_arbitrage',
    license: 'Apache-2.0',
    url: 'https://hummingbot.org',
    highlights: [
      'CEX and DEX connectivity',
      'AMM arbitrage strategy',
      'Fast start for production arbitrage flows'
    ]
  },
  {
    id: 'freqtrade',
    type: 'framework',
    focus: 'ai_customization',
    license: 'GPL-3.0',
    url: 'https://github.com/freqtrade/freqtrade',
    highlights: [
      'High customization for strategy logic',
      'FreqAI module for ML-based decisions',
      'Web UI and Telegram control ecosystem'
    ]
  },
  {
    id: 'opencode',
    type: 'coding_agent',
    focus: 'developer_productivity',
    license: 'open_source',
    url: 'https://opencode.ai/ar',
    highlights: [
      'Code assistance for fast bot iteration',
      'Useful for refactors and feature generation'
    ]
  },
  {
    id: 'aider',
    type: 'coding_agent',
    focus: 'cli_code_editing',
    license: 'Apache-2.0',
    url: 'https://github.com/Aider-AI/aider',
    highlights: [
      'CLI-first workflow for multi-file edits',
      'Strong fit for complex repository updates'
    ]
  },
  {
    id: 'crewai',
    type: 'multi_agent',
    focus: 'coordinated_agent_systems',
    license: 'MIT',
    url: 'https://github.com/crewAIInc/crewAI',
    highlights: [
      'Multi-agent coordination for advanced workflows',
      'Supports role-based autonomous task execution'
    ]
  },
  {
    id: 'autogpt',
    type: 'multi_agent',
    focus: 'autonomous_research_execution',
    license: 'MIT',
    url: 'https://github.com/Significant-Gravitas/AutoGPT',
    highlights: [
      'Autonomous goal-driven task execution',
      'Useful for exploration and opportunity discovery'
    ]
  }
];

const GOAL_RECOMMENDATIONS = {
  quick_start: {
    primary: 'hummingbot',
    reason: 'Best for immediate arbitrage execution with battle-tested connectors.'
  },
  ai_learning: {
    primary: 'freqtrade',
    reason: 'FreqAI enables ML-assisted strategy optimization over time.'
  },
  coding_support: {
    primary: 'opencode',
    secondary: 'aider',
    reason: 'Both tools accelerate coding and codebase-scale edits.'
  },
  multi_agent_ops: {
    primary: 'crewai',
    secondary: 'autogpt',
    reason: 'Designed for orchestration across multiple autonomous agents.'
  }
};

const API_KEY_SECURITY_CHECKLIST = [
  'Use exchange API keys with least privilege (disable withdrawals).',
  'Store secrets only in Cloudflare Worker secrets, local .env/.dev.vars, or secret managers.',
  'Never commit API keys, private keys, or tokens to source control.',
  'Rotate keys regularly and immediately after any suspected leak.',
  'Restrict keys by IP/address or API policy whenever the exchange supports it.',
  'Use short-lived scoped credentials where possible.',
  'Run trading workloads close to exchange regions to reduce latency.'
];

export function getEcosystemCatalog() {
  return ECOSYSTEM_CATALOG.map((entry) => ({ ...entry, highlights: [...entry.highlights] }));
}

export function recommendEcosystem(goal = 'quick_start') {
  const normalized = String(goal || '').toLowerCase();
  const recommendation = GOAL_RECOMMENDATIONS[normalized] || GOAL_RECOMMENDATIONS.quick_start;
  return {
    goal: recommendation === GOAL_RECOMMENDATIONS[normalized] ? normalized : 'quick_start',
    fallback: !GOAL_RECOMMENDATIONS[normalized],
    ...recommendation
  };
}

export function getApiKeySecurityChecklist() {
  return [...API_KEY_SECURITY_CHECKLIST];
}
