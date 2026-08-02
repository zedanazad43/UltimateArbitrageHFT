// src/unified-ai-integration.js
// Unified Hermes + Copilot + OmniRoute + OpenRouter Integration
// Automatic switching between router, provider, models, skills based on task requirements

export class UnifiedAIIntegration {
  constructor(env, state) {
    this.env = env;
    this.state = state;
    this.providers = new Map();
    this.models = new Map();
    this.skills = new Map();
    this.routingHistory = [];
    this.initializeProviders();
  }

  // Initialize all AI providers
  initializeProviders() {
    this.providers = new Map([
      ['hermes', {
        name: 'Hermes Workers AI',
        type: 'cloudflare-worker',
        models: ['llama-3.1-8b-instruct', 'llama-4-scout-17b'],
        free: true,
        priority: 1,
        check: () => !!this.env.AIWORKER || !!this.env.AI_GATEWAY_URL
      }],
      ['copilot', {
        name: 'GitHub Copilot',
        type: 'github',
        models: ['gpt-4o-mini', 'gpt-4o', 'claude-3.5-sonnet'],
        free: true,
        priority: 2,
        check: () => !!(this.env.GITHUB_TOKEN || this.env.CODECOPILOT_TOKEN)
      }],
      ['omniroute', {
        name: 'OmniRoute Local Gateway',
        type: 'local-gateway',
        models: ['hermes-openrouter-claude', 'hermes-openrouter-gpt'],
        free: true,
        priority: 3,
        check: () => !!(this.env.OMNIROUTE_GATEWAY_URL || this.env.LOCAL_GATEWAY_URL)
      }],
      ['openrouter', {
        name: 'OpenRouter',
        type: 'external',
        models: ['claude-3.5-sonnet', 'gpt-4o-mini', 'gemini-2.0-flash', 'deepseek-chat'],
        free: true,
        priority: 4,
        check: () => !!(this.env.OPENROUTER_API_KEY || this.env.OPENAI_API_KEY)
      }]
    ]);

    this.models = new Map([
      ['hermes:8b', '@cf/meta/llama-3.1-8b-instruct-fp8-fast'],
      ['hermes:4s', '@cf/meta/llama-4-scout-17b-16e-instruct'],
      ['copilot:gpt4', 'gpt-4o'],
      ['copilot:gpt4-mini', 'gpt-4o-mini'],
      ['copilot:claude', 'claude-3.5-sonnet'],
      ['omni:claude', 'hermes-openrouter-claude'],
      ['omni:gpt', 'hermes-openrouter-gpt'],
      ['or:claude', 'anthropic/claude-3.5-sonnet'],
      ['or:gpt4o', 'openai/gpt-4o-mini'],
      ['or:gemini', 'google/gemini-2.0-flash'],
      ['or:deepseek', 'deepseek/deepseek-chat'],
      ['or:llama', 'meta/llama-3.1-405b']
    ]);

    this.skills = new Map([
      ['analysis', { providers: ['openrouter', 'hermes'], model: 'or-claude' }],
      ['coding', { providers: ['copilot', 'omniroute'], model: 'copilot-gpt4' }],
      ['strategy', { providers: ['hermes', 'omniroute'], model: 'hermes:8b' }],
      ['optimization', { providers: ['omniroute', 'openrouter'], model: 'omni-claude' }],
      ['general', { providers: ['hermes', 'openrouter'], model: 'hermes:8b' }],
      ['arbitrage', { providers: ['openrouter', 'omniroute'], model: 'or-claude' }],
      ['risk', { providers: ['hermes', 'copilot'], model: 'copilot-gpt4-mini' }]
    ]);
  }

  // Auto-select best provider based on task
  async selectProvider(taskType, options = {}) {
    const { preferredModel = null } = options;
    // These are captured for future use in cost-aware routing
    // eslint-disable-next-line no-unused-vars
    const paperMode = options.paperMode !== false;
    // eslint-disable-next-line no-unused-vars
    const budgetLimit = options.budgetLimit || 0;
    // eslint-disable-next-line no-unused-vars
    const latencyRequirement = options.latencyRequirement || 'medium';

    // Get skill preferences
    const skill = this.skills.get(taskType) || this.skills.get('general');
    
    // Check preferred model
    if (preferredModel && this.models.has(preferredModel)) {
      const modelKey = preferredModel;
      for (const [providerName, config] of this.providers) {
        if (config.check() && config.models.some(m => modelKey.includes(m.split(':')[0]))) {
          return { provider: providerName, model: this.models.get(modelKey), reason: 'model-preferred' };
        }
      }
    }

    // Try skill-preferred providers in order
    for (const providerName of skill.providers) {
      const config = this.providers.get(providerName);
      if (config && config.check()) {
        return { 
          provider: providerName, 
          model: this.models.get(`${providerName.split(':')[0]}:claude`) || this.models.get(`${providerName}:8b`),
          reason: `skill-optimized-${taskType}`
        };
      }
    }

    // Fallback: check all providers by priority
    const availableProviders = [];
    for (const [name, config] of this.providers) {
      if (config.check()) {
        availableProviders.push({ name, config });
      }
    }

    if (availableProviders.length === 0) {
      return { provider: 'hermes', model: '@cf/meta/llama-3.1-8b-instruct-fp8-fast', reason: 'fallback' };
    }

    // Sort by priority
    availableProviders.sort((a, b) => a.config.priority - b.config.priority);
    const best = availableProviders[0];
    
    return {
      provider: best.name,
      model: this.models.get(`${best.name}:8b`) || this.models.get(`${best.name}:claude`),
      reason: 'best-available'
    };
  }

  // Route LLM call to appropriate provider
  async route(messages, options = {}) {
    const taskType = options.taskType || 'general';
    const selection = await this.selectProvider(taskType, options);
    
    const startTime = Date.now();
    this.routingHistory.push({
      timestamp: startTime,
      taskType,
      selection,
      messageCount: messages.length
    });

    // Keep only last 1000 entries
    if (this.routingHistory.length > 1000) {
      this.routingHistory = this.routingHistory.slice(-500);
    }

    try {
      const result = await this.execute(messages, selection, options);
      return {
        ...result,
        provider: selection.provider,
        model: selection.model,
        routedAt: Date.now(),
        latency: Date.now() - startTime
      };
    } catch (e) {
      return {
        error: e.message,
        provider: selection.provider,
        model: selection.model,
        failed: true
      };
    }
  }

  // Execute through specific provider
  async execute(messages, selection, options) {
    const { provider, model } = selection;
    
    switch (provider) {
      case 'hermes':
        return await this.executeHermes(model, messages, options);
      case 'copilot':
        return await this.executeCopilot(model, messages, options);
      case 'omniroute':
        return await this.executeOmniRoute(model, messages, options);
      case 'openrouter':
        return await this.executeOpenRouter(model, messages, options);
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  async executeHermes(model, messages, options) {
    if (this.env.AIWORKER) {
      const result = await this.env.AIWORKER.run(model, {
        messages,
        max_tokens: options.max_tokens || 512,
        temperature: options.temperature || 0.7
      });
      return {
        text: result?.response ?? result?.text ?? JSON.stringify(result),
        usage: result?.usage || {}
      };
    }
    throw new Error('Hermes AI not configured');
  }

  async executeCopilot(model, messages, options) {
    const fetch = (await import('node-fetch')).default;
    const token = this.env.CODECOPILOT_TOKEN || this.env.GITHUB_TOKEN;
    if (!token) throw new Error('Copilot token not configured');
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.max_tokens || 512,
        temperature: options.temperature || 0.7
      })
    });
    
    const data = await response.json();
    return {
      text: data?.choices?.[0]?.message?.content ?? '',
      usage: data?.usage || {}
    };
  }

  async executeOmniRoute(model, messages, options) {
    const fetch = (await import('node-fetch')).default;
    const gatewayUrl = this.env.OMNIROUTE_GATEWAY_URL || this.env.LOCAL_GATEWAY_URL;
    if (!gatewayUrl) throw new Error('OmniRoute gateway not configured');
    
    const response = await fetch(`${gatewayUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.max_tokens || 512,
        temperature: options.temperature || 0.7
      })
    });
    
    const data = await response.json();
    return {
      text: data?.choices?.[0]?.message?.content ?? data?.response ?? '',
      usage: data?.usage || {}
    };
  }

  async executeOpenRouter(model, messages, options) {
    const fetch = (await import('node-fetch')).default;
    const token = this.env.OPENROUTER_API_KEY || this.env.OPENAI_API_KEY;
    if (!token) throw new Error('OpenRouter key not configured');
    
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://hermes-agent.nousresearch.com',
        'X-Title': 'Hermes Unified Router'
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.max_tokens || 512,
        temperature: options.temperature || 0.7
      })
    });
    
    const data = await response.json();
    return {
      text: data?.choices?.[0]?.message?.content ?? '',
      usage: data?.usage || {}
    };
  }

  // Get routing statistics
  getStats() {
    const providerStatus = {};
    for (const [name, config] of this.providers) {
      providerStatus[name] = {
        configured: config.check(),
        type: config.type,
        models: config.models.length,
        free: config.free,
        priority: config.priority
      };
    }
    
    return {
      providers: providerStatus,
      modelCount: this.models.size,
      skillCount: this.skills.size,
      routingHistoryCount: this.routingHistory.length,
      lastRoute: this.routingHistory[this.routingHistory.length - 1] || null
    };
  }

  // Clear routing history
  clearHistory() {
    this.routingHistory = [];
  }

  // Get available models for a provider
  getModels(provider) {
    const config = this.providers.get(provider);
    if (!config) return [];
    return config.models;
  }

  // Resolve model alias
  resolveModel(alias) {
    return this.models.get(alias) || alias;
  }
}

// Singleton instance
let instance = null;

export function getUnifiedAI(env, state) {
  if (!instance) {
    instance = new UnifiedAIIntegration(env, state);
  }
  return instance;
}