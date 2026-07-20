#!/usr/bin/env node
// Infrastructure: Shoot-First Atomic Order Execution with Post-Only + IOC Fallback

const DEFAULT_TIMEOUT_MS = 10;

class AtomicOrderExecutor {
  constructor({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.timeoutMs = timeoutMs;
  }

  async executeShootFirst({ placeFn, cancelFn, sellFn, hedgeFn }) {
    if (typeof placeFn !== 'function') throw new Error('placeFn is required');
    let buyFilled = false;
    let buyResult;
    try {
      buyResult = await placeFn();
      buyFilled = true;
    } catch (e) {
      return { success: false, reason: 'buy_failed', error: e.message };
    }

    try {
      const sellResult = await sellFn({ buyResult, timeoutMs: this.timeoutMs });
      if (sellResult.filled) {
        return { success: true, buy: buyResult, sell: sellResult, hedge: null };
      }
    } catch (e) {
      // fall through to hedge/inventory path
    }

    if (typeof hedgeFn === 'function') {
      try {
        const hedge = await hedgeFn({ buyResult });
        return { success: false, reason: 'sell_failed_hedged', buy: buyResult, sell: null, hedge };
      } catch (e) {
        return { success: false, reason: 'hedge_failed', buy: buyResult, sell: null, hedge: null, error: e.message };
      }
    }

    return { success: false, reason: 'sell_failed', buy: buyResult, sell: null, hedge: null };
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
    } catch (e) {
      return { filled: false, result: null, latencyMs: Date.now() - t0, error: e.message };
    }
  }
}

export { AtomicOrderExecutor };
