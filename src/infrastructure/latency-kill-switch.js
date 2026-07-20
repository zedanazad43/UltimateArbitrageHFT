#!/usr/bin/env node
// Infrastructure: Kill Switch / Time Drift / Age Guard
// - Stops trading when latency drifts beyond threshold.
// - Drops signals older than maxAgeMs.
// - Integrates with existing circuit breaker / execution lock where available.

const DEFAULT_BASELINE_RTT_MS = 15;
const DEFAULT_MAX_MULTIPLIER = 2.5;
const DEFAULT_MAX_AGE_MS = 50;

class LatencyKillSwitch {
  constructor({ baselineMs = DEFAULT_BASELINE_RTT_MS, maxMultiplier = DEFAULT_MAX_MULTIPLIER, maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
    this.baselineMs = baselineMs;
    this.maxMultiplier = maxMultiplier;
    this.maxAgeMs = maxAgeMs;
    this.tripped = false;
    this.lastAlert = null;
  }

  check({ rttMs, ageMs, nowMs = Date.now() } = {}) {
    if (this.tripped) return { tradingAllowed: false, reason: 'kill_switch_active' };

    const drift = rttMs > this.baselineMs * this.maxMultiplier;
    if (drift) {
      this.tripped = true;
      this.lastAlert = { at: nowMs, rttMs, baselineMs: this.baselineMs };
      return { tradingAllowed: false, reason: 'time_drift', rttMs, baselineMs: this.baselineMs };
    }

    if (Number.isFinite(ageMs) && ageMs > this.maxAgeMs) {
      return { tradingAllowed: false, reason: 'stale_signal', ageMs, maxAgeMs: this.maxAgeMs };
    }

    return { tradingAllowed: true, reason: 'ok', rttMs, ageMs };
  }

  reset() {
    this.tripped = false;
    this.lastAlert = null;
  }
}

export { LatencyKillSwitch };
