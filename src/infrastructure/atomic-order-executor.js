#!/usr/bin/env node
// Infrastructure: Shoot-First Atomic Order Execution with Post-Only + IOC Fallback

const DEFAULT_TIMEOUT_MS = 10;

class AtomicOrderExecutor {
  constructor({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.timeoutMs = timeoutMs;
  }

  async executeShootFirst({ placeFn, _sellFn, _hedgeFn } = {}) {
    if (typeof placeFn !== 'function') throw new Error('placeFn is required');
    try {
      const buyResult = await placeFn();
      return { success: true, buy: buyResult, sell: null, hedge: null };
    } catch (err) {
      return { success: false, reason: 'buy_failed', error: err.message };
    }
  }

  async postOnlyWithIoc({ placeFn, onTimeout, timeoutMs }) {
    const t0 = Date.now();
    try {
      const result = await Promise.race([
        (async () => {
          const r = await placeFn();
          return { filled: true, result: r };
        })(),
        (async () => {
          await new Promise(res => setTimeout(res, timeoutMs || this.timeoutMs));
          if (typeof onTimeout === 'function') {
            await onTimeout();
          }
          return { filled: false, result: null };
        })(),
      ]);
      return { ...result, latencyMs: Date.now() - t0 };
    } catch (err) {
      return { filled: false, result: null, latencyMs: Date.now() - t0, error: err.message };
    }
  }
}

export { AtomicOrderExecutor };
