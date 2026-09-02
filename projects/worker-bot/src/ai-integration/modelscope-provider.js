// src/ai-integration/modelscope-provider.js — ModelScope AI Provider
// Uses ModelScope's official OpenAI-compatible hosted-inference endpoint.
// Default model: Qwen/Qwen3.5-27B
// Endpoint: https://api-inference.modelscope.cn/v1

const MODELSCOPE_BASE_URL = 'https://api-inference.modelscope.cn/v1';
const DEFAULT_MODEL = 'Qwen/Qwen3.5-27B';

function authHeader(apiKey) {
  return apiKey ? ('Bearer ' + apiKey) : 'anonymous';
}

export class ModelScopeProvider {
  constructor(apiKey, options = {}) {
    this.apiKey  = apiKey || '';
    this.model   = options.model   ?? DEFAULT_MODEL;
    this.baseUrl = options.baseUrl ?? MODELSCOPE_BASE_URL;
    this.name    = 'modelscope';
    this.free    = true;
  }

  async chat(messages, params = {}) {
    const { temperature = 0.7, max_tokens = 2048 } = params;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': authHeader(this.apiKey)
      },
      body: JSON.stringify({ model: this.model, messages, temperature, max_tokens })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`ModelScope API error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    return {
      text:     data?.choices?.[0]?.message?.content ?? '',
      model:    data?.model ?? this.model,
      provider: 'modelscope',
      usage:    data?.usage
    };
  }

  async complete(prompt, params = {}) {
    return this.chat([{ role: 'user', content: prompt }], params);
  }

  async listModels() {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': authHeader(this.apiKey) }
      });
      if (!res.ok) return [DEFAULT_MODEL];
      const data = await res.json();
      return (data?.data ?? []).map(m => m.id ?? m.modelId);
    } catch {
      return [DEFAULT_MODEL];
    }
  }
}

export function createModelScopeProvider(env, opts = {}) {
  return new ModelScopeProvider(env?.MODELSCOPE_API_KEY ?? '', {
    model: env?.MODELSCOPE_MODEL ?? DEFAULT_MODEL,
    ...opts
  });
}

export function modelScopeProviderDescriptor(env) {
  return {
    name:     'ModelScope',
    type:     'openai-compatible',
    models:   [DEFAULT_MODEL, 'Qwen/Qwen2.5-72B-Instruct', 'Qwen/Qwen2.5-7B-Instruct'],
    free:     true,
    priority: 2,
    check:    () => !!(env?.MODELSCOPE_API_KEY),
    create:   () => createModelScopeProvider(env)
  };
}

export { DEFAULT_MODEL as MODELSCOPE_DEFAULT_MODEL };
