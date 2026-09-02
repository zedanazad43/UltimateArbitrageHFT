// src/infra/kill-switch.js — Fail-safe & capital protection system

import { logger } from '../utils/async-logger.js';

export class KillSwitch {
  constructor(options = {}) {
    // Risk parameters
    this.maxConsecutiveErrors = options.maxErrors || 10;
    this.maxLatencyMs = options.maxLatency || 5000; // 5s max
    this.maxDrawdownPercent = options.maxDrawdown || 15; // 15% max loss
    this.maxDailyLoss = options.maxDailyLoss || 1000; // $1000 daily
    this.errorCooldownMs = options.errorCooldown || 60000; // 1min

    // State
    this.isActive = false;
    this.lastErrorCount = 0;
    this.consecutiveErrors = 0;
    this.lastErrorTime = 0;
    this.latencyHistory = [];
    this.dailyPnl = 0;
    this.initialBalance = 0;
    this.tradingEnabled = true;

    // Timers
    this.checkInterval = null;
    this.resetTimer = null;
  }

  /**
   * Initialize kill switch
   */
  async init(initialBalance) {
    this.initialBalance = initialBalance;
    this.startMonitoring();
    logger.info('Kill Switch initialized', {
      maxErrors: this.maxConsecutiveErrors,
      maxLatency: this.maxLatencyMs,
      maxDrawdown: this.maxDrawdownPercent + '%'
    });
  }

  /**
   * Start monitoring system
   */
  startMonitoring() {
    // Check every 10 seconds
    this.checkInterval = setInterval(() => {
      this._checkConditions();
    }, 10000);

    // Reset daily PnL at midnight
    this._scheduleDailyReset();
  }

  /**
   * Check all fail-safe conditions
   */
  _checkConditions() {
    const reasons = [];

    // 1. Check consecutive errors
    if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
      reasons.push(`Too many consecutive errors: ${this.consecutiveErrors}`);
    }

    // 2. Check latency
    const avgLatency = this._getAverageLatency();
    if (avgLatency > this.maxLatencyMs) {
      reasons.push(`High average latency: ${avgLatency}ms`);
    }

    // 3. Check drawdown
    if (this.initialBalance > 0) {
      const drawdown = ((this.initialBalance - this.dailyPnl - this.initialBalance) / this.initialBalance) * 100;
      if (drawdown <= -this.maxDrawdownPercent) {
        reasons.push(`Drawdown exceeds ${this.maxDrawdownPercent}%`);
      }
    }

    // 4. Check daily loss limit
    if (this.dailyPnl <= -this.maxDailyLoss) {
      reasons.push(`Daily loss limit reached: $${this.dailyPnl}`);
    }

    // Activate if any condition fails
    if (reasons.length > 0) {
      this._activate(reasons.join('; '));
    }
  }

  /**
   * Activate kill switch
   */
  _activate(reason) {
    if (this.isActive) return;

    this.isActive = true;
    this.tradingEnabled = false;

    logger.error('🚨 KILL SWITCH ACTIVATED', {
      reason,
      consecutiveErrors: this.consecutiveErrors,
      latency: this._getAverageLatency(),
      dailyPnl: this.dailyPnl
    });

    // Broadcast emergency event
    this._broadcastEmergency(reason);
  }

  /**
   * Check if system is healthy
   */
  get isHealthy() {
    return !this.isActive && this.tradingEnabled;
  }

  /**
   * Record API error
   */
  recordError() {
    const now = Date.now();
    this.consecutiveErrors++;
    this.lastErrorTime = now;

    logger.warn('API Error recorded', {
      consecutive: this.consecutiveErrors,
      timeSinceLast: now - this.lastErrorTime
    });

    // Check if should activate
    if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
      this._activate(`Error threshold reached: ${this.consecutiveErrors} consecutive errors`);
    }
  }

  /**
   * Record successful operation
   */
  recordSuccess() {
    this.consecutiveErrors = 0;
  }

  /**
   * Record latency measurement
   */
  recordLatency(ms) {
    this.latencyHistory.push(ms);
    // Keep last 100 measurements
    if (this.latencyHistory.length > 100) {
      this.latencyHistory.shift();
    }

    // Check if exceeds threshold
    if (ms > this.maxLatencyMs && this.isHealthy) {
      logger.warn('High latency detected', { latency: ms + 'ms' });
    }
  }

  /**
   * Get average latency
   */
  getLatency() {
    return this._getAverageLatency();
  }

  _getAverageLatency() {
    if (this.latencyHistory.length === 0) return 0;
    const sum = this.latencyHistory.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.latencyHistory.length);
  }

  /**
   * Enable trading
   */
  enableTrading() {
    this.tradingEnabled = true;
    logger.info('Trading enabled by user');
  }

  /**
   * Disable trading
   */
  disableTrading() {
    this.tradingEnabled = false;
    logger.info('Trading disabled by user');
  }

  /**
   * Reset kill switch
   */
  async reset() {
    this.isActive = false;
    this.consecutiveErrors = 0;
    this.tradingEnabled = true;
    logger.info('Kill Switch reset by user');
  }

  /**
   * Record daily PnL
   */
  recordPnL(amount) {
    this.dailyPnl += amount;
  }

  /**
   * Schedule daily reset
   */
  _scheduleDailyReset() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime();

    this.resetTimer = setTimeout(() => {
      this.dailyPnl = 0;
      this.consecutiveErrors = 0;
      logger.info('Daily PnL reset');
      this._scheduleDailyReset();
    }, msUntilMidnight);
  }

  /**
   * Broadcast emergency to WebSocket clients
   */
  _broadcastEmergency(reason) {
    // This would broadcast to WS clients
    // Implementation depends on WS server
    console.log('🚨 EMERGENCY BROADCAST:', reason);
  }

  /**
   * Cleanup
   */
  destroy() {
    clearInterval(this.checkInterval);
    clearTimeout(this.resetTimer);
  }

  /**
   * Get status
   */
  getStatus() {
    return {
      isActive: this.isActive,
      isHealthy: this.isHealthy,
      tradingEnabled: this.tradingEnabled,
      consecutiveErrors: this.consecutiveErrors,
      avgLatency: this._getAverageLatency(),
      dailyPnl: this.dailyPnl,
      drawdown: this.initialBalance > 0
        ? ((this.initialBalance - this.dailyPnl - this.initialBalance) / this.initialBalance * 100).toFixed(2) + '%'
        : '0%'
    };
  }
}
