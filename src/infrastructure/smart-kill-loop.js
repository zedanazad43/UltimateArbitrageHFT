import { setTimeout as delay } from 'timers/promises';

export class SmartKillSwitch {
  constructor({ capitalBase = 10000, maxLossBps = 10, maxDriftMicros = 50 } = {}) {
    this.capitalBase = capitalBase;
    this.maxLossBps = maxLossBps;
    this.maxDriftMicros = maxDriftMicros;
    this.active = false;
    this.reason = null;
    this.listeners = new Set();
    this.tradeHistory = [];
    this.maxTradeHistory = 4096;
  }
  snapshot() {
    return {
      active: this.active,
      reason: this.reason,
      capitalBase: this.capitalBase,
      maxLossBps: this.maxLossBps,
      maxDriftMicros: this.maxDriftMicros,
      tradeCount: this.tradeHistory.length,
    };
  }
  onTrade({ pnlBps, latencyMicros, driftMicros }) {
    this.tradeHistory.push({ pnlBps, latencyMicros, driftMicros, ts: Date.now() });
    if (this.tradeHistory.length > this.maxTradeHistory) this.tradeHistory.shift();
    if (pnlBps * this.capitalBase / 10000 <= -this.maxLossBps / 100) {
      this.trigger(`LOSS trade_pnl=${pnlBps.toFixed(2)} bps`);
      return;
    }
    if (driftMicros > this.maxDriftMicros) {
      this.trigger(`DRIFT drift=${driftMicros.toFixed(0)} µs`);
    }
  }
  trigger(reason) {
    this.active = true;
    this.reason = reason;
    for (const fn of this.listeners) fn(this.snapshot());
  }
  reset() {
    this.active = false;
    this.reason = null;
  }
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export class UltraFastDecisionLoop {
  constructor({ checkWindowMs = 5, maxRejectAgeMs = 20 } = {}) {
    this.checkWindowMs = checkWindowMs;
    this.maxRejectAgeMs = maxRejectAgeMs;
  }
  decide(signal, { t2, t1, hasSlowMaker, expectedRttMs }) {
    const ageMs = t2 - t1;
    if (ageMs > this.checkWindowMs) return { reject: true, reason: 'stale_t2_t1', ageMs };
    if (hasSlowMaker === false) return { reject: true, reason: 'no_slow_maker' };
    if (expectedRttMs == null || ageMs >= expectedRttMs) return { reject: true, reason: 'rtt_not_profitable', expectedRttMs };
    return { reject: false, reason: 'execute', ageMs, expectedRttMs };
  }
}

export class ContinuousRLLoop {
  constructor({ intervalMs = 60 * 60 * 1000 } = {}) {
    this.intervalMs = intervalMs;
    this.timer = null;
    this.classifier = { timely: 0, slippage: 0 };
  }
  classify({ timely, slippage }) {
    this.classifier.timely += timely;
    this.classifier.slippage += slippage;
  }
  step() {
    const total = this.classifier.timely + this.classifier.slippage || 1;
    const accuracy = this.classifier.timely / total;
    return { accuracy, timely: this.classifier.timely, slippage: this.classifier.slippage };
  }
}
