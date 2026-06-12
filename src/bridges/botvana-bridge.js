/**
 * Botvana HFT Bridge — High-Performance Trading Patterns
 *
 * Inspired by:
 * - featherenvy/botvana (⭐250)
 * - x89/Solana-Arbitrage-Bot (⭐1.1k)
 * - dex-original/okx-agent-trade-kit (⭐100+)
 *
 * Provides: Event-driven architecture, Priority queue, Circuit breakers,
 * Rate limiting, Latency tracking, Batching, Memory pools.
 */

export class PriorityQueue {
  constructor(comparator = (a, b) => a.priority - b.priority) {
    this._heap = [];
    this._comparator = comparator;
  }
  get size() { return this._heap.length; }

  enqueue(item) {
    this._heap.push(item);
    this._siftUp(this._heap.length - 1);
  }

  dequeue() {
    if (this._heap.length === 0) return null;
    if (this._heap.length === 1) return this._heap.pop();
    const top = this._heap[0];
    this._heap[0] = this._heap.pop();
    this._siftDown(0);
    return top;
  }

  peek() { return this._heap[0] || null; }

  _siftUp(idx) {
    while (idx > 0) {
      const parentIdx = (idx - 1) >> 1;
      if (this._comparator(this._heap[idx], this._heap[parentIdx]) >= 0) break;
      [this._heap[idx], this._heap[parentIdx]] = [this._heap[parentIdx], this._heap[idx]];
      idx = parentIdx;
    }
  }

  _siftDown(idx) {
    const size = this._heap.length;
    while (true) {
      let smallest = idx;
      const left = (idx << 1) + 1;
      const right = left + 1;
      if (left < size && this._comparator(this._heap[left], this._heap[smallest]) < 0) smallest = left;
      if (right < size && this._comparator(this._heap[right], this._heap[smallest]) < 0) smallest = right;
      if (smallest === idx) break;
      [this._heap[idx], this._heap[smallest]] = [this._heap[smallest], this._heap[idx]];
      idx = smallest;
    }
  }

  drain() {
    const items = [];
    while (this._heap.length > 0) items.push(this.dequeue());
    return items;
  }
}

export class RingBuffer {
  constructor(capacity = 1024) {
    this._buf = new Array(capacity);
    this._capacity = capacity;
    this._head = 0;
    this._size = 0;
  }
  get size() { return this._size; }
  push(item) {
    this._buf[this._head] = item;
    this._head = (this._head + 1) % this._capacity;
    if (this._size < this._capacity) this._size++;
  }
  last(n) {
    const count = Math.min(n, this._size);
    const result = new Array(count);
    for (let i = 0; i < count; i++) {
      result[i] = this._buf[(this._head - count + i + this._capacity) % this._capacity];
    }
    return result;
  }
  toArray() { return this.last(this._size); }
  clear() { this._head = 0; this._size = 0; }
}

export class CircuitBreaker {
  constructor(name, config = {}) {
    this.name = name;
    this.failureThreshold = config.failureThreshold || 5;
    this.cooldownMs = config.cooldownMs || 30000;
    this.halfOpenMaxRequests = config.halfOpenMaxRequests || 2;
    this._state = 'CLOSED';
    this._failureCount = 0;
    this._lastFailureTime = 0;
    this._halfOpenRequests = 0;
    this._totalFailures = 0;
    this._totalSuccesses = 0;
  }
  get state() { return this._state; }
  get isOpen() { return this._state === 'OPEN'; }

  allowRequest() {
    if (this._state === 'CLOSED') return true;
    if (this._state === 'OPEN') {
      if (Date.now() - this._lastFailureTime >= this.cooldownMs) {
        this._state = 'HALF_OPEN';
        this._halfOpenRequests = 0;
        return true;
      }
      return false;
    }
    if (this._halfOpenRequests < this.halfOpenMaxRequests) {
      this._halfOpenRequests++;
      return true;
    }
    return false;
  }

  recordSuccess() {
    this._totalSuccesses++;
    if (this._state === 'HALF_OPEN') { this._state = 'CLOSED'; this._failureCount = 0; }
    if (this._state === 'CLOSED') this._failureCount = 0;
  }

  recordFailure() {
    this._totalFailures++;
    this._failureCount++;
    this._lastFailureTime = Date.now();
    if (this._state === 'HALF_OPEN' || this._failureCount >= this.failureThreshold) this._state = 'OPEN';
  }

  reset() { this._state = 'CLOSED'; this._failureCount = 0; this._halfOpenRequests = 0; }

  getStats() {
    return { name: this.name, state: this._state, failureCount: this._failureCount,
      totalFailures: this._totalFailures, totalSuccesses: this._totalSuccesses };
  }
}

export class TokenBucket {
  constructor(capacity, refillRate, refillIntervalMs = 1000) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.refillIntervalMs = refillIntervalMs;
    this._tokens = capacity;
    this._lastRefill = Date.now();
  }
  _refill() {
    const now = Date.now();
    const elapsed = now - this._lastRefill;
    const intervals = Math.floor(elapsed / this.refillIntervalMs);
    if (intervals > 0) {
      this._tokens = Math.min(this.capacity, this._tokens + intervals * this.refillRate);
      this._lastRefill += intervals * this.refillIntervalMs;
    }
  }
  take(count = 1) { this._refill(); if (this._tokens >= count) { this._tokens -= count; return true; } return false; }
  available() { this._refill(); return this._tokens; }
  reset() { this._tokens = this.capacity; this._lastRefill = Date.now(); }
}

export class LatencyTracker {
  constructor(windowSize = 100) {
    this._buffer = new RingBuffer(windowSize);
    this._sortedCache = null;
    this._dirty = true;
  }
  record(ms) { this._buffer.push(ms); this._dirty = true; }
  _sort() { if (this._dirty) { this._sortedCache = [...this._buffer.toArray()].sort((a,b)=>a-b); this._dirty = false; } }
  p50() { this._sort(); return this._percentile(0.50); }
  p90() { this._sort(); return this._percentile(0.90); }
  p95() { this._sort(); return this._percentile(0.95); }
  p99() { this._sort(); return this._percentile(0.99); }
  avg() { const a=this._buffer.toArray(); return a.length>0?a.reduce((s,v)=>s+v,0)/a.length:0; }
  min() { this._sort(); return this._sortedCache[0]||0; }
  max() { this._sort(); return this._sortedCache[this._sortedCache.length-1]||0; }
  _percentile(p) { if(this._sortedCache.length===0)return 0; const i=Math.ceil(this._sortedCache.length*p)-1; return this._sortedCache[Math.max(0,i)]; }
  getStats() { return {count:this._buffer.size,avg:this.avg(),min:this.min(),max:this.max(),p50:this.p50(),p90:this.p90(),p95:this.p95(),p99:this.p99()}; }
  reset() { this._buffer.clear(); this._sortedCache=null; this._dirty=true; }
}

export class ExecutionThrottler {
  constructor(maxPerWindow=5, windowMs=1000) {
    this.maxPerWindow=maxPerWindow; this.windowMs=windowMs;
    this._timestamps=new RingBuffer(maxPerWindow*2);
  }
  async throttle() {
    const now=Date.now(); const windowStart=now-this.windowMs;
    const recent=this._timestamps.toArray().filter(t=>t>windowStart);
    if(recent.length>=this.maxPerWindow){ const wait=Math.min(...recent)+this.windowMs-now+1; if(wait>0) await new Promise(r=>setTimeout(r,wait)); }
    this._timestamps.push(Date.now());
  }
  reset(){this._timestamps.clear();}
}

export const HFT_CONFIG = {
  priority:{weights:{profit:0.5,latency:0.3,liquidity:0.2},minScore:0.15},
  rateLimit:{ordersPerSecond:5,requestsPerSecond:20,batchSize:5,batchWindowMs:100},
  circuitBreaker:{exchangeFailureThreshold:5,exchangeCooldownMs:30000,strategyFailureThreshold:3,strategyCooldownMs:60000},
  latency:{maxAcceptableMs:500,warningMs:200,criticalMs:1000},
  memory:{ringBufferCapacity:1024,poolMaxSize:100},
};

export class HFTSupervisor {
  constructor(config={}) {
    this.cfg={...HFT_CONFIG,...config};
    this._rateLimiters=new Map();
    this._circuitBreakers=new Map();
    this._executionLatency=new LatencyTracker(200);
    this._priceLatency=new LatencyTracker(200);
    this._opportunityQueue=new PriorityQueue((a,b)=>b.priority-a.priority);
  }
  rateLimiter(exchange){if(!this._rateLimiters.has(exchange))this._rateLimiters.set(exchange,new TokenBucket(this.cfg.rateLimit.requestsPerSecond,this.cfg.rateLimit.requestsPerSecond));return this._rateLimiters.get(exchange);}
  breaker(name){if(!this._circuitBreakers.has(name))this._circuitBreakers.set(name,new CircuitBreaker(name,this.cfg.circuitBreaker));return this._circuitBreakers.get(name);}
  enqueueOpportunity(opp,priority){this._opportunityQueue.enqueue({...opp,priority,queuedAt:Date.now()});}
  topOpportunities(n=5){const r=[];for(let i=0;i<n&&this._opportunityQueue.size>0;i++)r.push(this._opportunityQueue.dequeue());return r;}
  recordExecution(ms){this._executionLatency.record(ms);}
  recordPriceFetch(ms){this._priceLatency.record(ms);}
  getStats(){return{executionLatency:this._executionLatency.getStats(),priceLatency:this._priceLatency.getStats(),queueSize:this._opportunityQueue.size};}
  reset(){this._rateLimiters.clear();this._circuitBreakers.clear();this._executionLatency.reset();this._priceLatency.reset();this._opportunityQueue.drain();}
}

let globalSupervisor=null;
export function getHFTSupervisor(){if(!globalSupervisor)globalSupervisor=new HFTSupervisor();return globalSupervisor;}