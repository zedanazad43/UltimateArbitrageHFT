#!/usr/bin/env node
// Infrastructure: Latency Simulator + Replay Harness
// Lets you inject delays and replay price/opportunity streams at real speed.

class LatencySimulator {
  constructor({ baseLatencyMs = 0, jitterMs = 0 } = {}) {
    this.baseLatencyMs = baseLatencyMs;
    this.jitterMs = jitterMs;
  }

  async delay() {
    const jitter = Math.floor(Math.random() * (this.jitterMs + 1));
    const wait = this.baseLatencyMs + jitter;
    if (wait > 0) await new Promise(res => setTimeout(res, wait));
    return wait;
  }

  wrapAsync(fn, label = 'op') {
    return async (...args) => {
      const t1 = Date.now();
      await this.delay();
      const result = await fn(...args);
      const t2 = Date.now();
      return { result, label, latencyMs: t2 - t1, t1, t2 };
    };
  }
}

class ReplayHarness {
  constructor({ speed = 1, simulator } = {}) {
    this.speed = speed;
    this.simulator = simulator;
  }

  async replay({ events, onEvent }) {
    if (!Array.isArray(events)) return;
    let prevTs = events[0]?.ts || Date.now();
    for (const evt of events) {
      const delta = (evt.ts - prevTs) / Math.max(0.0001, this.speed);
      if (delta > 0) await new Promise(res => setTimeout(res, delta));
      prevTs = evt.ts;
      if (typeof onEvent === 'function') {
        const wrap = this.simulator ? this.simulator.wrapAsync(() => evt) : undefined;
        await onEvent(wrap ? await wrap() : evt);
      }
    }
  }
}

export { LatencySimulator, ReplayHarness };
