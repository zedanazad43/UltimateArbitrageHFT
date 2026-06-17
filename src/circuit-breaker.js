// src/circuit-breaker.js
const BREAKER_STATES = { CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'half_open' };

export class CircuitBreaker {
  constructor(kv) {
    this.kv = kv;
    this.defaultState = {
      state: BREAKER_STATES.CLOSED, failureCount: 0, lastFailure: null,
      lastTrip: null, tripReason: null, consecutiveLosses: 0,
      dailyLossUsd: 0, lastResetDate: new Date().toISOString().split('T')[0],
    };
  }
  async getState() {
    try {
      const raw = await this.kv.get('circuit_breaker_state', 'json');
      return raw ? { ...this.defaultState, ...raw } : { ...this.defaultState };
    } catch { return { ...this.defaultState }; }
  }
  async saveState(state) {
    try { await this.kv.put('circuit_breaker_state', JSON.stringify(state)); }
    catch (e) { console.error('[CB] Failed to persist state:', e.message); }
  }
  async recordSuccess() {
    const state = await this.getState();
    if (state.state === BREAKER_STATES.OPEN) return;
    const today = new Date().toISOString().split('T')[0];
    if (state.lastResetDate !== today) { state.dailyLossUsd = 0; state.consecutiveLosses = 0; state.lastResetDate = today; }
    state.failureCount = 0;
    if (state.state === BREAKER_STATES.HALF_OPEN) state.state = BREAKER_STATES.CLOSED;
    await this.saveState(state);
  }
  async recordFailure(reason) {
    const state = await this.getState();
    state.failureCount = (state.failureCount || 0) + 1;
    state.lastFailure = new Date().toISOString();
    if (state.failureCount >= 3) {
      state.state = BREAKER_STATES.OPEN;
      state.lastTrip = new Date().toISOString();
      state.tripReason = reason;
      console.error('[CB] CIRCUIT BREAKER TRIPPED: ' + String(reason));
    }
    await this.saveState(state);
    return state.state === BREAKER_STATES.OPEN;
  }
  async recordLoss(lossUsd) {
    const state = await this.getState();
    state.dailyLossUsd = (state.dailyLossUsd || 0) + Math.abs(lossUsd);
    state.consecutiveLosses = (state.consecutiveLosses || 0) + 1;
    if (state.consecutiveLosses >= 5) {
      state.state = BREAKER_STATES.OPEN;
      state.lastTrip = new Date().toISOString();
      state.tripReason = '5 consecutive losses';
    }
    await this.saveState(state);
    return state.state === BREAKER_STATES.OPEN;
  }
  async reset() {
    const state = { ...this.defaultState, state: BREAKER_STATES.HALF_OPEN };
    await this.saveState(state);
  }
  async isTradingAllowed() {
    const state = await this.getState();
    return state.state !== BREAKER_STATES.OPEN;
  }
  async getStatus() {
    const state = await this.getState();
    return {
      state: state.state, trading_allowed: state.state !== BREAKER_STATES.OPEN,
      failure_count: state.failureCount, last_failure: state.lastFailure,
      last_trip: state.lastTrip, trip_reason: state.tripReason,
      consecutive_losses: state.consecutiveLosses, daily_loss_usd: state.dailyLossUsd
    };
  }
}
