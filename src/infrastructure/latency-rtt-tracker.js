#!/usr/bin/env node
// Infrastructure: Latency / RTT Tracking
// Measures real round-trip time for opportunity signals and order execution.
// Uses WebSocket ping/pong when available, and falls back to HTTP timing.

const DEFAULT_WINDOW_MS = 30_000;

class LatencyRttTracker {
  constructor({ windowMs = DEFAULT_WINDOW_MS } = {}) {
    this.windowMs = windowMs;
    this.samples = [];
  }

  record({ label, t1Ms, t2Ms }) {
    const rtt = Number(t2Ms) - Number(t1Ms);
    const now = Date.now();
    this.samples.push({ t: now, label, rttMs: rtt });
    this._trim(now);
    return rtt;
  }

  currentRttMs() {
    if (!this.samples.length) return 0;
    this._trim(Date.now());
    const last = this.samples[this.samples.length - 1];
    return last.rttMs;
  }

  avgRttMs() {
    this._trim(Date.now());
    if (!this.samples.length) return 0;
    const sum = this.samples.reduce((a, b) => a + b.rttMs, 0);
    return sum / this.samples.length;
  }

  p95RttMs() {
    this._trim(Date.now());
    if (this.samples.length < 5) return this.avgRttMs();
    const vals = this.samples.map(s => s.rttMs).sort((a, b) => a - b);
    const idx = Math.floor(vals.length * 0.95);
    return vals[idx] || vals[vals.length - 1];
  }

  maybeDrift({ baselineMs, maxMultiplier = 2.5 }) {
    const avg = this.avgRttMs();
    if (avg > 0 && avg > baselineMs * maxMultiplier) {
      return { drift: true, avgRttMs: avg, baselineMs };
    }
    return { drift: false, avgRttMs: avg, baselineMs };
  }

  snapshot() {
    this._trim(Date.now());
    return {
      count: this.samples.length,
      lastRttMs: this.samples.length ? this.samples[this.samples.length - 1].rttMs : 0,
      avgRttMs: this.avgRttMs(),
      p95RttMs: this.p95RttMs(),
    };
  }

  _trim(now) {
    const cutoff = now - this.windowMs;
    while (this.samples.length && this.samples[0].t < cutoff) {
      this.samples.shift();
    }
  }
}

export { LatencyRttTracker };
