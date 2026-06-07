#!/usr/bin/env node
/**
 * Reliability & Error Recovery Module
 * 
 * Implements:
 * - Exponential backoff retry logic
 * - Graceful degradation
 * - Health checks and recovery
 * - Error categorization and handling
 * - Timeout management
 */

class ReliabilityManager {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.initialDelay = options.initialDelay || 1000; // 1 second
    this.maxDelay = options.maxDelay || 30000; // 30 seconds
    this.backoffMultiplier = options.backoffMultiplier || 2;
    this.healthChecks = new Map();
    this.errors = [];
    this.maxErrorHistory = 100;
  }

  /**
   * Retry with exponential backoff
   */
  async retryWithBackoff(fn, context = {}, retries = 0) {
    try {
      return await fn();
    } catch (error) {
      const { operation = 'operation', critical = false } = context;

      this.recordError({
        operation,
        error: error.message,
        timestamp: new Date(),
        retryAttempt: retries,
        critical
      });

      if (retries >= this.maxRetries) {
        console.error(`[RELIABILITY] ${operation} failed after ${retries} retries`);
        throw error;
      }

      const delay = Math.min(
        this.initialDelay * Math.pow(this.backoffMultiplier, retries),
        this.maxDelay
      ) + Math.random() * 1000; // Add jitter

      console.warn(`[RELIABILITY] ${operation} failed, retrying in ${delay.toFixed(0)}ms (attempt ${retries + 1}/${this.maxRetries})`);

      await this.sleep(delay);
      return this.retryWithBackoff(fn, context, retries + 1);
    }
  }

  /**
   * Register health check
   */
  registerHealthCheck(name, checkFn, interval = 60000) {
    const check = {
      name,
      fn: checkFn,
      interval,
      lastCheck: null,
      status: 'unknown',
      failures: 0
    };

    this.healthChecks.set(name, check);

    // Run periodic health checks
    setInterval(async () => {
      try {
        const result = await checkFn();
        check.status = result ? 'healthy' : 'unhealthy';
        check.failures = result ? 0 : check.failures + 1;
        check.lastCheck = new Date();

        if (check.failures > 2) {
          console.warn(`[HEALTH] ${name} is unhealthy (${check.failures} consecutive failures)`);
        }
      } catch (error) {
        check.status = 'error';
        check.failures++;
        check.lastCheck = new Date();
        console.error(`[HEALTH] ${name} check failed:`, error.message);
      }
    }, interval);
  }

  /**
   * Get health status
   */
  getHealthStatus() {
    const status = {};

    for (const [name, check] of this.healthChecks.entries()) {
      status[name] = {
        status: check.status,
        lastCheck: check.lastCheck,
        failures: check.failures
      };
    }

    return status;
  }

  /**
   * Error categorization
   */
  categorizeError(error) {
    const message = error.message || String(error);

    if (message.includes('timeout')) return 'TIMEOUT';
    if (message.includes('network') || message.includes('ECONNREFUSED')) return 'NETWORK';
    if (message.includes('429') || message.includes('rate')) return 'RATE_LIMIT';
    if (message.includes('401') || message.includes('403')) return 'AUTH';
    if (message.includes('500') || message.includes('502')) return 'SERVER_ERROR';
    if (message.includes('memory') || message.includes('heap')) return 'MEMORY';

    return 'UNKNOWN';
  }

  /**
   * Record error for analysis
   */
  recordError(errorInfo) {
    const categorized = {
      ...errorInfo,
      category: this.categorizeError(new Error(errorInfo.error)),
      id: Math.random().toString(36).slice(2, 11)
    };

    this.errors.push(categorized);

    // Keep only recent errors
    if (this.errors.length > this.maxErrorHistory) {
      this.errors.shift();
    }

    return categorized.id;
  }

  /**
   * Get error report
   */
  getErrorReport(limit = 20) {
    const recent = this.errors.slice(-limit).reverse();
    const byCategory = {};

    for (const error of this.errors) {
      byCategory[error.category] = (byCategory[error.category] || 0) + 1;
    }

    return {
      totalErrors: this.errors.length,
      recentErrors: recent,
      errorsByCategory: byCategory,
      criticalErrors: this.errors.filter(e => e.critical).length
    };
  }

  /**
   * Graceful degradation
   */
  async executeWithFallback(primaryFn, fallbackFn, context = {}) {
    try {
      return await this.retryWithBackoff(primaryFn, { ...context, critical: true });
    } catch (error) {
      console.warn(`[RELIABILITY] Primary operation failed, trying fallback...`);
      try {
        return await fallbackFn();
      } catch (fallbackError) {
        console.error('[RELIABILITY] Fallback also failed:', fallbackError.message);
        throw error;
      }
    }
  }

  /**
   * Timeout wrapper
   */
  async executeWithTimeout(fn, timeoutMs = 30000, label = 'operation') {
    return Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs
        )
      )
    ]);
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Reset error history
   */
  resetErrorHistory() {
    this.errors = [];
  }
}

export default ReliabilityManager;
