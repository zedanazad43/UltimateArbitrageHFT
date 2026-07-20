import { setTimeout as delay } from 'timers/promises';

const TOPOLOGY = {
  cloudflareLondon: 'https://london.cloudflare.com',
  cloudflareFrankfurt: 'https://fra.cloudflare.com/cdn-cgi/trace',
  exchangeEndpoints: {
    binance: 'https://api.binance.com/api/v3/ping',
    mexc: 'https://api.mexc.com/api/v3/ping',
    bitget: 'https://api.bitget.com/api/v2/public/time',
    bybit: 'https://api.bybit.com/v5/market/time',
    okx: 'https://www.okx.com/api/v5/public/time',
    coinbase: 'https://api.exchange.coinbase.com/time',
    kraken: 'https://api.kraken.com/0/public/Time',
    kucoin: 'https://api.kucoin.com/api/v1/timestamp',
  },
  thresholds: {
    londonRttWarnMs: 8,
    frankfurtRttWarnMs: 12,
  },
};

export class TopologyMap {
  constructor() {
    this.samples = new Map();
    this.sessions = new Map();
  }
  async measure(endpoint, timeoutMs = 3000) {
    const start = performance.now();
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(endpoint, { signal: controller.signal, redirect: 'manual', cache: 'no-store' });
      clearTimeout(id);
      const rtt = performance.now() - start;
      const mono = performance.now();
      const entry = { endpoint, rtt, status: res.status, timestamp: Date.now(), mono };
      this.samples.set(endpoint, entry);
      return entry;
    } catch (e) {
      const entry = { endpoint, rtt: null, status: 'ERR', error: String(e), timestamp: Date.now(), mono: performance.now() };
      this.samples.set(endpoint, entry);
      return entry;
    }
  }
  async fullScan() {
    const out = {};
    for (const [name, url] of Object.entries(TOPOLOGY.exchangeEndpoints)) {
      out[name] = await this.measure(url);
    }
    out.cfLondon = await this.measure(TOPOLOGY.cloudflareLondon);
    out.cfFrankfurt = await this.measure(TOPOLOGY.cloudflareFrankfurt);
    return out;
  }
  alerts() {
    const out = [];
    const warn = (k, rtt) => out.push(`RTT_WARN ${k} rtt=${rtt}ms`);
    const london = this.samples.get(TOPOLOGY.cloudflareLondon);
    const frankfurt = this.samples.get(TOPOLOGY.cloudflareFrankfurt);
    if (london && london.rtt > TOPOLOGY.thresholds.londonRttWarnMs) warn('cfLondon', london.rtt);
    if (frankfurt && frankfurt.rtt > TOPOLOGY.thresholds.frankfurtRttWarnMs) warn('cfFrankfurt', frankfurt.rtt);
    for (const [k, v] of this.samples) {
      if (v.status === 'ERR') out.push(`ERR ${k}`);
    }
    return out;
  }
}

export class TriClock {
  constructor() {
    this.offset = 0;
    this.jitter = 0;
    this.goldenStart = performance.timeOrigin + performance.now();
  }
  now() {
    return performance.timeOrigin + performance.now() + this.offset;
  }
  monotonic() {
    return performance.now();
  }
  applyKalman(newSampleMs, _noise = 0.1) {
    const kalmanGain = this.jitter / (this.jitter + _noise);
    this.offset += kalmanGain * (newSampleMs - (this.offset || 0));
    this.jitter = Math.max(0.02, (1 - kalmanGain) * (this.jitter || 0.1));
    return this.offset;
  }
  fromHeadersCf(headers) {
    const age = headers.get('cf-meta-age-ms');
    const ts = headers.get('date');
    if (ts && age) {
      const remote = Date.parse(ts);
      const local = Date.now();
      this.applyKalman(remote + Number(age) - local);
    }
  }
}

export class DistributedListener {
  constructor() {
    this.wsConnections = new Map();
    this.heartbeats = [];
    this.maxHeartbeats = 128;
  }
  register(name, ws) {
    this.wsConnections.set(name, ws);
  }
  ingestHeartbeat(t1, t2, t3, source) {
    const beat = { t1, t2, t3, source, ts: performance.now() };
    this.heartbeats.push(beat);
    if (this.heartbeats.length > this.maxHeartbeats) this.heartbeats.shift();
    return { beat, drift: t2 - t1 };
  }
  stats() {
    if (!this.heartbeats.length) return { count: 0, avgDriftMs: 0, maxDriftMs: 0 };
    let sum = 0, max = 0;
    for (const b of this.heartbeats) {
      const d = Math.abs(b.t2 - b.t1);
      sum += d;
      if (d > max) max = d;
    }
    return { count: this.heartbeats.length, avgDriftMs: sum / this.heartbeats.length, maxDriftMs: max };
  }
}

export { TOPOLOGY };
