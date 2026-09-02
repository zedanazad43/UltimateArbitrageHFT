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
  },
  {
    id: 'ccxt',
    type: 'library',
    focus: 'exchange_connectivity',
    license: 'MIT',
    url: 'https://github.com/ccxt/ccxt',
    highlights: [
      'Unified API for 100+ crypto exchanges',
      'Available in JS/TS/Python/C#/PHP/Go',
      'Industry standard for multi-exchange connectivity',
      '42,000+ GitHub stars — most trusted crypto library'
    ]
  },
  {
    id: 'superalgos',
    type: 'framework',
    focus: 'visual_algo_trading',
    license: 'Apache-2.0',
    url: 'https://github.com/Superalgos/Superalgos',
    highlights: [
      'Visual drag-and-drop strategy designer',
      'Free, open-source automated trading platform',
      'Community-driven with data mining tools',
      '5,500+ GitHub stars'
    ]
  },
  {
    id: 'triangular_arbitrage_python',
    type: 'bot',
    focus: 'triangular_arbitrage',
    license: 'MIT',
    url: 'https://github.com/Roibal/Cryptocurrency-Trading-Bots-Python-Beginner-Advance',
    highlights: [
      'Dedicated triangular arbitrage implementation',
      'Beginner to advanced bot patterns',
      'Pure Python — easy to customize and extend',
      '1,400+ GitHub stars'
    ]
  },
  {
    id: 'solana_arbitrage_bot',
    type: 'bot',
    focus: 'solana_defi_arbitrage',
    license: 'MIT',
    url: 'https://github.com/x89/Solana-Arbitrage-Bot',
    highlights: [
      'Solana blockchain arbitrage bot',
      'High-speed Rust implementation',
      'DEX arbitrage on Solana ecosystem',
      '1,100+ GitHub stars'
    ]
  },
  {
    id: 'crypto_arbitrage_python',
    type: 'bot',
    focus: 'cross_exchange_arbitrage',
    license: 'MIT',
    url: 'https://github.com/kelvinau/crypto-arbitrage',
    highlights: [
      'Automatic triangular + cross-exchange arbitrage',
      'Real-time opportunity detection',
      'Pure Python with clean architecture',
      '840+ GitHub stars'
    ]
  },
  {
    id: 'ai_crypto_trader',
    type: 'bot',
    focus: 'ai_ensemble_trading',
    license: 'Apache-2.0',
    url: 'https://github.com/N00Bception/AI-CryptoTrader',
    highlights: [
      'Ensemble ML methods for trading decisions',
      'State-of-the-art AI-powered strategies',
      'Python-based with modular design',
      '100+ GitHub stars — actively maintained'
    ]
  },
  {
    id: 'botvana',
    type: 'framework',
    focus: 'high_performance_rust',
    license: 'AGPL-3.0',
    url: 'https://github.com/featherenvy/botvana',
    highlights: [
      'High-performance event-driven trading system',
      'Built in Rust for maximum speed',
      'Designed for HFT workloads',
      '250+ GitHub stars — early stage but promising'
    ]
  },
  {
    id: 'arbitrage_bot_classic',
    type: 'bot',
    focus: 'opportunity_scanner',
    license: 'none',
    url: 'https://github.com/andrei-zgirvaci/Arbitrage-Bot',
    highlights: [
      'Best crypto arbitrage opportunity finder',
      'Multi-exchange scanning engine',
      'Clean Python implementation',
      '240+ GitHub stars'
    ]
  },
  {
    id: 'evergreen_polymarket',
    type: 'bot',
    focus: 'prediction_market_arbitrage',
    license: 'none',
    url: 'https://github.com/hanshaze/Awesome-Prediction-Market-Trading-Tools',
    highlights: [
      'Polymarket + prediction market arbitrage',
      'AI-powered trading signals + analytics',
      'Telegram integration for real-time alerts',
      '170+ GitHub stars'
    ]
  },
  {
    id: 'harvest',
    type: 'framework',
    focus: 'simple_algo_framework',
    license: 'MIT',
    url: 'https://github.com/tfukaza/harvest',
    highlights: [
      'Simple, intuitive algo-trading framework',
      'Live + paper trading for crypto and stocks',
      'Python — easy onboarding for new strategies',
      '150+ GitHub stars'
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

// ── Executable Integration Health Probes ──────────────────────────────────────
// These probe Hummingbot, Freqtrade, Superalgos, CrewAI, AutoGPT, and CCXT REST
// endpoints when configured. Each returns { configured, healthy, url, error }.

export const EXECUTABLE_INTEGRATION_IDS = ['hummingbot', 'freqtrade', 'superalgos', 'crewai', 'autogpt', 'ccxt_rest'];

function getIntegrationUrl(env, id) {
  const upper = id.toUpperCase();
  const executeUrl = env[`${upper}_EXECUTE_URL`] || '';
  const statusUrl = env[`${upper}_STATUS_URL`] || '';
  return { executeUrl: String(executeUrl).trim(), statusUrl: String(statusUrl).trim() };
}

export async function probeExecutableIntegrations(env) {
  const results = [];
  for (const id of EXECUTABLE_INTEGRATION_IDS) {
    const { executeUrl, statusUrl } = getIntegrationUrl(env, id);
    const configured = !!executeUrl || !!statusUrl;
    if (!configured) {
      results.push({ id, configured: false, healthy: false, note: 'No URL configured — set *_EXECUTE_URL and *_STATUS_URL env vars' });
      continue;
    }

    // Probe status endpoint if available
    let healthy;
    let error = null;
    if (statusUrl) {
      try {
        const token = env[`${id.toUpperCase()}_API_TOKEN`];
        const headers = { Accept: 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const resp = await fetch(statusUrl, { headers, signal: controller.signal });
        clearTimeout(timeout);
        healthy = resp.ok;
        if (!resp.ok) error = `HTTP ${resp.status}`;
        await resp.body?.cancel();
      } catch (e) {
        error = e.message;
        healthy = false;
      }
    } else {
      // Can only verify URL is configured
      healthy = null; // unknown without status endpoint
    }

    results.push({
      id,
      configured: true,
      executeUrl: executeUrl || null,
      statusUrl: statusUrl || null,
      healthy,
      error,
      note: healthy === null ? 'Status endpoint not configured — health unknown' : null,
    });
  }
  return results;
}

export function listExecutableIntegrationIds() {
  return [...EXECUTABLE_INTEGRATION_IDS];
}

export async function executeExecutableIntegration(env, integration, payload = {}) {
  const { executeUrl } = getIntegrationUrl(env, integration);
  if (!executeUrl) {
    throw new Error(`${integration} EXECUTE_URL not configured`);
  }

  const token = env[`${integration.toUpperCase()}_API_TOKEN`];
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const resp = await fetch(executeUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`Integration ${integration} returned ${resp.status}: ${JSON.stringify(body).slice(0, 200)}`);

  return { integration, status: resp.status, data: body };
}

export async function executeAllExecutableIntegrations(env, payloadByIntegration = {}, defaultPayload = {}) {
  const results = [];
  for (const id of EXECUTABLE_INTEGRATION_IDS) {
    const { executeUrl } = getIntegrationUrl(env, id);
    if (!executeUrl) {
      results.push({ id, success: false, error: 'Not configured', configured: false });
      continue;
    }
    try {
      const payload = payloadByIntegration[id] || defaultPayload;
      const result = await executeExecutableIntegration(env, id, payload);
      results.push({ id, success: true, ...result });
    } catch (e) {
      results.push({ id, success: false, error: e.message, configured: true });
    }
  }
  return results;
}
