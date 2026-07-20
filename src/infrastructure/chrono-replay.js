import { setTimeout as delay } from 'timers/promises';

const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes for simulation

export class PropagationMapper {
  constructor() {
    this.model = new Map(); // eventHash -> ExpectedArrivalModel
    this.rttHistory = new Map(); // exchange -> number[]
    this.maxRttHistory = 512;
  }
  updateRtt(exchange, rttMs) {
    const arr = this.rttHistory.get(exchange) || [];
    arr.push(rttMs);
    if (arr.length > this.maxRttHistory) arr.shift();
    this.rttHistory.set(exchange, arr);
  }
  stats(exchange) {
    const arr = this.rttHistory.get(exchange) || [];
    if (!arr.length) return { avgMs: 0, p95Ms: 0, p99Ms: 0, count: 0 };
    const sorted = [...arr].sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || sorted.at(-1);
    const p99 = sorted[Math.floor(sorted.length * 0.99)] || sorted.at(-1);
    return { avgMs: avg, p95Ms: p95, p99Ms: p99, count: sorted.length };
  }
  async observeTick(exchangeA, exchangeB, pricesA, pricesB) {
    const eventHash = `${exchangeA}-${Date.now()}`;
    const t1 = performance.now();
    const model = {
      eventHash,
      sourceExchange: exchangeA,
      expectedArrivals: new Map(),
      t1,
      lastTick: { pricesA, pricesB },
    };
    this.model.set(eventHash, model);
    return model;
  }
  expectedArrival(from, to) {
    const stats = this.stats(from);
    return { avgMs: stats.avgMs, p95Ms: stats.p95Ms, p99Ms: stats.p99Ms };
  }
}

export class MarketMakerDissector {
  constructor() {
    this.classifications = new Map(); // exchange+symbol -> ["fast","medium","slow"]
    this.recentMoves = new Map();
    this.maxRecent = 64;
  }
  recordMove(exchange, symbol, latencyMs, isTopUpdate) {
    const key = `${exchange}:${symbol}`;
    const arr = this.recentMoves.get(key) || [];
    arr.push({ t: performance.now(), latencyMs, isTopUpdate });
    if (arr.length > this.maxRecent) arr.shift();
    this.recentMoves.set(key, arr);
    this.classify(exchange, symbol);
  }
  classify(exchange, symbol) {
    const key = `${exchange}:${symbol}`;
    const arr = this.recentMoves.get(key) || [];
    if (arr.length < 20) return 'unknown';
    const updates = arr.filter(x => x.isTopUpdate).map(x => x.latencyMs);
    const sorted = [...updates].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length / 2)] || 0;
    const label = p50 < 20 ? 'fast' : p50 < 60 ? 'medium' : 'slow';
    this.classifications.set(key, label);
    return label;
  }
  get(exchange, symbol) {
    const key = `${exchange}:${symbol}`;
    return this.classifications.get(key) || 'unknown';
  }
}

export class ChronoReplay {
  constructor({ topology, propagationMapper } = {}) {
    this.topology = topology;
    this.propagationMapper = propagationMapper;
    this.history = new Map(); // dateKey -> ticks[]
    this.maxHistoryDays = 14;
  }
  ingestTick(dateKey, tick) {
    const arr = this.history.get(dateKey) || [];
    arr.push(tick);
    this.history.set(dateKey, arr);
  }
  async simulate(dateKey, entryLatencyMs = 12) {
    const ticks = this.history.get(dateKey) || [];
    if (!ticks.length) return { simulated: 0, profitable: 0, winRate: 0 };
    let profitable = 0;
    for (const tick of ticks) {
      const expected = this.propagationMapper?.expectedArrival?.(tick.sourceExchange, tick.targetExchange);
      const arrivalMs = expected?.avgMs ?? 50;
      if (entryLatencyMs <= arrivalMs * 0.95) profitable++;
    }
    return { simulated: ticks.length, profitable, winRate: ticks.length ? profitable / ticks.length : 0 };
  }
}
