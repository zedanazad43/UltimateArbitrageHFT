// src/infrastructure/integrated-ai-system.js
// Integration layer connecting Hermes, Copilot, OmniRoute, and OpenRouter
// Provides unified access for UltimateArbitrageHFT tasks

import { UnifiedRouter, PROVIDER_CONFIG, MODEL_ALIASES } from './hermes-unified-router.js';
// import { getFailover } from '../free-provider-failover.js'; // Unused - loaded dynamically

// Integration hub for all AI providers
export class IntegratedAISystem {
  constructor(env, state) {
    this.env = env;
    this.state = state;
    this.router = new UnifiedRouter(env, state);
    this.failover = null;
    this.initialized = false;
  }

  // Initialize all integrations
  async initialize() {
    if (this.initialized) return;
    
    // Load failover module
    try {
      const failoverModule = await import('../free-provider-failover.js');
      this.failover = failoverModule.getFailover(this.env);
    } catch (e) {
      console.warn('[IntegratedAI] Failed to load failover module:', e.message);
    }

    this.initialized = true;
  }

  // Unified chat with automatic routing
  async chat(messages, options = {}) {
    await this.initialize();

    const context = {
      taskType: options.taskType || 'general',
      budgetLimit: options.budgetLimit || 0,
      latencyRequirement: options.latencyRequirement || 'medium',
      paperMode: options.paperMode !== false,
      preferredProvider: options.provider,
      modelHint: options.model
    };

    // Use unified router for primary routing
    try {
      const result = await this.router.routeLLMCall(messages, context);
      return {
        text: result.text,
        provider: result.routedVia,
        model: result.model,
        usage: result.usage || {},
        route: result.route,
        source: 'unified-router'
      };
    } catch (e) {
      console.warn('[IntegratedAI] Unified router failed, trying failover:', e.message);
    }

    // Fallback to free provider failover
    if (this.failover && this.failover.callFreeLLM) {
      const prompt = messages[messages.length - 1]?.content || '';
      const result = await this.failover.callFreeLLM(prompt);
      return {
        text: result.text,
        provider: result.provider,
        model: result.model,
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        route: { primary: 'failover' },
        source: 'failover'
      };
    }

    throw new Error('All AI providers unavailable');
  }

  // Get current provider status
  async getProviderStatus() {
    await this.initialize();
    return await this.router.getAllProviderStatuses();
  }

  // Get available models for a provider
  getModelsForProvider(provider) {
    const config = PROVIDER_CONFIG[provider];
    return config ? [...config.models] : [];
  }

  // Resolve model alias to actual model name
  resolveModel(modelAlias) {
    return MODEL_ALIASES[modelAlias] || modelAlias;
  }

  // Auto-select best model for task
  getBestModelForTask(taskType, constraints = {}) {
    const { paperMode = true, budgetLimit = 0, latencyRequirement = 'medium' } = constraints;

    // Map task types to preferred providers/models
    const taskPreferences = {
      'analysis': { provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet' },
      'code': { provider: 'copilot', model: 'gpt-4o-mini' },
      'strategy': { provider: 'hermes', model: '@cf/meta/llama-3.1-8b-instruct-fp8-fast' },
      'optimization': { provider: 'omniroute', model: 'hermes-openrouter-claude' },
      'general': { provider: 'hermes', model: '@cf/meta/llama-3.1-8b-instruct-fp8-fast' }
    };

    const preferred = taskPreferences[taskType] || taskPreferences['general'];

    // Check if preferred is available
    if (this.router.isProviderAvailable(preferred.provider)) {
      return {
        provider: preferred.provider,
        model: preferred.model,
        reason: `task-optimized-${taskType}`
      };
    }

    // Fallback to best available
    return this.router.selectProvider({ paperMode, latencyRequirement, budgetLimit });
  }

  // Execute trading strategy analysis
  async analyzeTradingOpportunity(opportunity, context = {}) {
    const prompt = `
You are an expert crypto arbitrage analyst. Analyze this trading opportunity:

Opportunity:
- Symbol: ${opportunity.symbol}
- Strategy: ${opportunity.strategy}
- Direction: ${opportunity.direction}
- Buy Price: $${opportunity.buyPrice || 0}
- Sell Price: $${opportunity.sellPrice || 0}
- Net Profit %: ${opportunity.netPct || 0}%

Provide a concise recommendation (2-4 sentences) covering:
1. Whether to execute
2. Key risks
3. Liquidity/timing concerns

Context: ${JSON.stringify(context)}
`;

    return await this.chat([{ role: 'user', content: prompt }], {
      taskType: 'analysis',
      paperMode: context.paperMode !== false,
      latencyRequirement: 'medium'
    });
  }

  // Optimize trading strategy
  async optimizeStrategy(strategyData, performanceMetrics) {
    const prompt = `
You are a trading strategy optimizer. Analyze this strategy performance and provide optimizations:

Performance:
${JSON.stringify(performanceMetrics, null, 2)}

Strategy Data:
${JSON.stringify(strategyData, null, 2)}

Provide specific parameter adjustments to improve win rate and reduce drawdown.
`;

    return await this.chat([{ role: 'user', content: prompt }], {
      taskType: 'optimization',
      paperMode: true
    });
  }

  // Generate trading signal
  async generateSignal(marketData, positionData) {
    const prompt = `
Generate a trading signal based on this market data:

Market: ${marketData.symbol}
Price: ${marketData.price}
Volatility: ${marketData.volatility}
Spread: ${marketData.spread}
Liquidity: ${marketData.liquidity}

Position: ${JSON.stringify(positionData)}

Return JSON: { signal: "buy|sell|hold", confidence: 0-1, rationale: "..." }
`;

    try {
      const result = await this.chat([{ role: 'user', content: prompt }], {
        taskType: 'strategy',
        model: 'or-claude'
      });
      
      // Try to parse JSON from response
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return { ...JSON.parse(jsonMatch[0]), raw: result };
      }
      return { signal: 'hold', confidence: 0.5, rationale: result.text, raw: result };
    } catch (e) {
      return { signal: 'hold', confidence: 0, rationale: 'Failed to parse signal', error: e.message };
    }
  }

  // Get system health report
  async getHealthReport() {
    const providerStatus = await this.getProviderStatus();
    const routerStats = this.router.getStats();
    
    return {
      timestamp: new Date().toISOString(),
      providers: providerStatus,
      router: routerStats,
      initialized: this.initialized,
      paperMode: this.state?.paper_trading !== false
    };
  }
}

// Singleton for global access
let globalAI = null;

export function getIntegratedAI(env, state) {
  if (!globalAI) {
    globalAI = new IntegratedAISystem(env, state);
  }
  return globalAI;
}

// Convenience function for CLI
export async function routeToAI(prompt, options = {}) {
  const router = new UnifiedRouter({}, {});
  return await router.routeLLMCall([{ role: 'user', content: prompt }], options);
}

// Export utilities
export { UnifiedRouter, PROVIDER_CONFIG, MODEL_ALIASES };