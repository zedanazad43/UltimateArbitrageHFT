// ===== Infrastructure Optimizer =====
// Railway monitoring + Cloudflare edge optimization + AI model routing

export class RailwayMonitor {
  constructor(env) {
    this.env = env;
    this.hftUrl = env.HFT_ENGINE_URL || 'https://ultimatearbitragehft-production.up.railway.app';
    this.checkInterval = 300000;
    this.lastCheck = 0;
    this.failures = 0;
  }

  async checkHealth() {
    try {
      const response = await fetch(`${this.hftUrl}/api/health`, {
        signal: AbortSignal.timeout(10000),
      });
      const data = await response.json();
      this.failures = 0;
      this.lastCheck = Date.now();
      return { healthy: data.status === 'ok', engineStatus: data, failures: 0, needsRecovery: false };
    } catch (err) {
      this.failures++;
      return { healthy: false, error: err.message, failures: this.failures, needsRecovery: this.failures >= 3 };
    }
  }

  async getProxyStatus() {
    try {
      const response = await fetch(`${this.hftUrl}/proxy?target=https://api.binance.com/api/v3/time`, {
        signal: AbortSignal.timeout(10000),
      });
      const data = await response.json();
      return { proxyWorking: !!data.serverTime, binanceAccessible: true };
    } catch {
      return { proxyWorking: false, error: 'proxy_check_failed' };
    }
  }

  async getMetrics() {
    return { hftUrl: this.hftUrl, lastCheck: this.lastCheck, failures: this.failures };
  }
}

export class CloudflareOptimizer {
  constructor(env) {
    this.env = env;
  }

  async getEdgeStatus() {
    return {
      bindingsAvailable: ['BOT_STATE','DB','TRADE_QUEUE','TRADE_LOGS','ANALYTICS','AIWORKER','MARKET_STREAMER','RATE_LIMITER']
        .filter(b => !!this.env[b]).length,
      totalBindings: 8,
      details: {
        aiWorker: !!this.env.AIWORKER,
        kvStore: !!this.env.BOT_STATE,
        d1Database: !!this.env.DB,
        r2Bucket: !!this.env.TRADE_LOGS,
        analytics: !!this.env.ANALYTICS,
        queue: !!this.env.TRADE_QUEUE,
        durableObject: !!this.env.MARKET_STREAMER,
        rateLimiter: !!this.env.RATE_LIMITER,
      },
      edgeLocations: 330,
      ddosProtected: true,
    };
  }
}

export class AIModelRouter {
  constructor(env) {
    this.env = env;
    this.models = {
      fast: '@cf/meta/llama-3.1-8b-instruct',
      reasoning: '@cf/deepseek-ai/deepseek-r1-distill-qwen-8b',
    };
  }

  async route(prompt, taskType = 'fast') {
    const model = this.models[taskType] || this.models.fast;
    try {
      if (this.env.AIWORKER) {
        const response = await this.env.AIWORKER.run(model, {
          prompt,
          max_tokens: taskType === 'reasoning' ? 512 : 256,
        });
        return { model, result: response.response };
      }
      return { fallback: true, error: 'ai_worker_not_available' };
    } catch (err) {
      return { fallback: true, error: err.message };
    }
  }

  async getAvailableModels() {
    return { primary: this.models.fast, reasoning: this.models.reasoning, provider: 'Cloudflare Workers AI' };
  }
}
