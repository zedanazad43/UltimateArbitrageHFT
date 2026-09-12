const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Provider metadata used for display and deterministic paper-mode routing.
 * The actual provider model catalog is intentionally not treated as a live source
 * of truth; callers may pass `modelHint` when a specific available model is known.
 */
export const PROVIDER_CONFIG = Object.freeze({
  hermes: Object.freeze({
    type: 'cloudflare-workers-ai',
    models: Object.freeze(['@cf/meta/llama-3.1-8b-instruct-fp8-fast']),
    cost: 'unknown',
    latency: 'low',
    requires: Object.freeze(['AIWORKER binding or HERMES_API_URL and HERMES_API_KEY']),
  }),
  copilot: Object.freeze({
    type: 'openai-compatible',
    models: Object.freeze(['gpt-4o-mini']),
    cost: 'unknown',
    latency: 'medium',
    requires: Object.freeze(['COPILOT_API_URL and CODECOPILOT_TOKEN']),
  }),
  omniroute: Object.freeze({
    type: 'openai-compatible',
    models: Object.freeze(['hermes-openrouter-claude']),
    cost: 'unknown',
    latency: 'medium',
    requires: Object.freeze(['OMNIROUTE_GATEWAY_URL and OMNIROUTE_API_KEY']),
  }),
  openrouter: Object.freeze({
    type: 'openai-compatible',
    models: Object.freeze(['openai/gpt-4o-mini']),
    cost: 'unknown',
    latency: 'medium',
    requires: Object.freeze(['OPENROUTER_API_KEY']),
  }),
});

export const MODEL_ALIASES = Object.freeze({
  'cf-llama': '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
  'or-gpt-mini': 'openai/gpt-4o-mini',
  'or-claude': 'anthropic/claude-3.5-sonnet',
  'omni-claude': 'hermes-openrouter-claude',
  'copilot-mini': 'gpt-4o-mini',
});

const PROVIDER_ORDER = Object.freeze(['hermes', 'omniroute', 'openrouter', 'copilot']);
const TASK_PROVIDER_ORDER = Object.freeze({
  analysis: Object.freeze(['openrouter', 'omniroute', 'hermes', 'copilot']),
  code: Object.freeze(['copilot', 'omniroute', 'openrouter', 'hermes']),
  optimization: Object.freeze(['omniroute', 'openrouter', 'hermes', 'copilot']),
  strategy: Object.freeze(['hermes', 'omniroute', 'openrouter', 'copilot']),
  general: PROVIDER_ORDER,
});

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isHttpUrl(value) {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function redactProviderError(error) {
  const message = error instanceof Error ? error.message : String(error || 'provider request failed');
  return message.replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]').slice(0, 500);
}

function normaliseMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('At least one chat message is required');
  }

  return messages.map((message, index) => {
    if (!message || typeof message !== 'object' || !isNonEmptyString(message.content)) {
      throw new Error(`Message ${index + 1} must contain non-empty content`);
    }
    return {
      role: isNonEmptyString(message.role) ? message.role : 'user',
      content: message.content,
    };
  });
}

function extractChatCompletion(payload) {
  const choice = payload?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === 'string' && content.length > 0) return content;
  if (Array.isArray(content)) {
    return content.map((part) => part?.text || '').join('').trim();
  }
  throw new Error('Provider returned no chat completion content');
}

/**
 * Routes model calls only to explicitly configured providers. Paper mode is the
 * default and never makes a network request; it provides a safe, inspectable
 * route decision for the desktop CLI and trading control plane.
 */
export class UnifiedRouter {
  constructor(env = {}, state = {}) {
    this.env = asObject(env);
    this.state = asObject(state);
    this.stats = {
      createdAt: new Date().toISOString(),
      selections: 0,
      paperRequests: 0,
      liveRequests: 0,
      failures: 0,
      providerSelections: Object.fromEntries(PROVIDER_ORDER.map((provider) => [provider, 0])),
    };
  }

  resolveModelAlias(model) {
    if (!isNonEmptyString(model)) return undefined;
    return MODEL_ALIASES[model.trim()] || model.trim();
  }

  isProviderAvailable(provider) {
    return this.getProviderStatus(provider).configured;
  }

  getProviderStatus(provider) {
    const config = PROVIDER_CONFIG[provider];
    if (!config) {
      return { provider, configured: false, healthy: false, error: 'Unknown provider' };
    }

    const env = this.env;
    if (provider === 'hermes') {
      const hasBinding = env.AIWORKER && typeof env.AIWORKER.run === 'function';
      const hasEndpoint = isHttpUrl(env.HERMES_API_URL) && isNonEmptyString(env.HERMES_API_KEY);
      return {
        provider,
        configured: Boolean(hasBinding || hasEndpoint),
        healthy: Boolean(hasBinding || hasEndpoint),
        mode: hasBinding ? 'workers-ai-binding' : (hasEndpoint ? 'openai-compatible' : undefined),
        ...(hasBinding || hasEndpoint ? {} : { error: 'AIWORKER binding or HERMES_API_URL and HERMES_API_KEY are required' }),
      };
    }

    if (provider === 'copilot') {
      const configured = isHttpUrl(env.COPILOT_API_URL) && isNonEmptyString(env.CODECOPILOT_TOKEN);
      return {
        provider,
        configured,
        healthy: configured,
        ...(configured ? {} : { error: 'COPILOT_API_URL and CODECOPILOT_TOKEN are required' }),
      };
    }

    if (provider === 'omniroute') {
      const configured = isHttpUrl(env.OMNIROUTE_GATEWAY_URL) && isNonEmptyString(env.OMNIROUTE_API_KEY);
      return {
        provider,
        configured,
        healthy: configured,
        ...(configured ? {} : { error: 'OMNIROUTE_GATEWAY_URL and OMNIROUTE_API_KEY are required' }),
      };
    }

    const configured = isNonEmptyString(env.OPENROUTER_API_KEY);
    return {
      provider,
      configured,
      healthy: configured,
      ...(configured ? {} : { error: 'OPENROUTER_API_KEY is required' }),
    };
  }

  async getAllProviderStatuses() {
    return Object.fromEntries(PROVIDER_ORDER.map((provider) => [provider, this.getProviderStatus(provider)]));
  }

  selectProvider(context = {}) {
    const preferredProvider = context.preferredProvider || context.provider;
    if (preferredProvider) {
      if (!PROVIDER_CONFIG[preferredProvider]) {
        throw new Error(`Unknown provider: ${preferredProvider}`);
      }
      if (!this.isProviderAvailable(preferredProvider)) {
        throw new Error(`Provider ${preferredProvider} is not configured`);
      }
      return this.makeRoute(preferredProvider, context, 'explicit-provider');
    }

    const taskType = isNonEmptyString(context.taskType) ? context.taskType : 'general';
    const candidates = TASK_PROVIDER_ORDER[taskType] || TASK_PROVIDER_ORDER.general;
    const provider = candidates.find((candidate) => this.isProviderAvailable(candidate));
    if (!provider) {
      throw new Error('No AI provider is configured; configure a provider before requesting a live route');
    }
    return this.makeRoute(provider, context, `automatic-${taskType}`);
  }

  makeRoute(provider, context, reason) {
    const config = PROVIDER_CONFIG[provider];
    const model = this.resolveModelAlias(context.modelHint || context.model) || config.models[0];
    return { provider, model, reason, taskType: context.taskType || 'general' };
  }

  async routeLLMCall(messages, context = {}) {
    const normalisedMessages = normaliseMessages(messages);
    const route = this.selectProvider(context);
    const paperMode = context.paperMode !== false && this.state.paper_trading !== false;

    this.stats.selections += 1;
    this.stats.providerSelections[route.provider] += 1;

    if (paperMode) {
      this.stats.paperRequests += 1;
      return {
        text: `Paper mode: selected ${route.provider}/${route.model}. No provider request was made.`,
        routedVia: route.provider,
        model: route.model,
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        route: { ...route, paperMode: true },
        cached: false,
      };
    }

    this.stats.liveRequests += 1;
    try {
      const result = await this.callProvider(route, normalisedMessages, context);
      return { ...result, routedVia: route.provider, model: route.model, route: { ...route, paperMode: false } };
    } catch (error) {
      this.stats.failures += 1;
      throw new Error(`${route.provider} request failed: ${redactProviderError(error)}`, { cause: error });
    }
  }

  async callProvider(route, messages, context) {
    if (route.provider === 'hermes' && this.env.AIWORKER && typeof this.env.AIWORKER.run === 'function') {
      const response = await this.env.AIWORKER.run(route.model, { messages });
      const text = response?.response || response?.result?.response || response?.text;
      if (!isNonEmptyString(text)) throw new Error('Workers AI returned no response text');
      return {
        text,
        usage: response?.usage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      };
    }

    const provider = route.provider;
    const endpoint = provider === 'openrouter'
      ? OPENROUTER_CHAT_COMPLETIONS_URL
      : (provider === 'hermes' ? this.env.HERMES_API_URL : provider === 'copilot' ? this.env.COPILOT_API_URL : this.env.OMNIROUTE_GATEWAY_URL);
    const apiKey = provider === 'openrouter'
      ? this.env.OPENROUTER_API_KEY
      : (provider === 'hermes' ? this.env.HERMES_API_KEY : provider === 'copilot' ? this.env.CODECOPILOT_TOKEN : this.env.OMNIROUTE_API_KEY);

    if (!isHttpUrl(endpoint) || !isNonEmptyString(apiKey)) {
      throw new Error('Provider endpoint or credential is not configured');
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(provider === 'openrouter' ? { 'HTTP-Referer': 'https://github.com/zedanazad43/UltimateArbitrageHFT' } : {}),
      },
      body: JSON.stringify({
        model: route.model,
        messages,
        ...(Number.isFinite(context.maxTokens) ? { max_tokens: context.maxTokens } : {}),
      }),
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(context.timeoutMs || 30_000) : undefined,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${payload?.error?.message || payload?.message || 'provider request rejected'}`);
    }

    const usage = payload?.usage || {};
    return {
      text: extractChatCompletion(payload),
      usage: {
        input_tokens: usage.prompt_tokens || usage.input_tokens || 0,
        output_tokens: usage.completion_tokens || usage.output_tokens || 0,
        total_tokens: usage.total_tokens || 0,
      },
    };
  }

  getStats() {
    return JSON.parse(JSON.stringify(this.stats));
  }
}

export default { UnifiedRouter, PROVIDER_CONFIG, MODEL_ALIASES };
