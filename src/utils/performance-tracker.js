// src/utils/performance-tracker.js — Performance Tracking & Analytics
//
// Records predicted vs actual outcomes to measure accuracy, success rate,
// and other key performance indicators (KPIs) for arbitrage opportunities.

/**
 * Performance record
 * @typedef {object} PerformanceRecord
 * @property {string} id              — unique opportunity ID
 * @property {string} strategy        — strategy name
 * @property {string} symbol          — trading pair
 * @property {number} predictedNetPct — predicted net profit %
 * @property {number} actualNetPct    — actual net profit % (after execution)
 * @property {number} detectionTime   — detection latency in ms
 * @property {number} executionTime   — execution latency in ms
 * @property {boolean} succeeded      — did trade execute successfully?
 * @property {string} failureReason   — if not succeeded, why?
 * @property {number} timestamp       — record creation time
 * @property {object} metadata        — arbitrary metadata
 */

export class PerformanceTracker {
  /**
   * @param {object} config — storage backend config
   */
  constructor(config = {}) {
    this.records = [];
    this.config = config;
    this.sessionStart = Date.now();
  }

  /**
   * Record a predicted opportunity.
   *
   * @param {object} opportunity — { strategy, symbol, netPct, ... }
   * @param {object} metadata
   * @returns {string} generated ID for this opportunity
   */
  recordPrediction(opportunity, metadata = {}) {
    const id = this._generateId();
    const record = {
      id,
      strategy: opportunity.strategy,
      symbol: opportunity.symbol,
      predictedNetPct: opportunity.netPct,
      actualNetPct: null,
      detectionTime: metadata.detectionTime ?? 0,
      executionTime: null,
      succeeded: null,
      failureReason: null,
      timestamp: Date.now(),
      metadata,
      stage: 'predicted',
    };

    this.records.push(record);
    return id;
  }

  /**
   * Update record with actual execution outcome.
   *
   * @param {string} id
   * @param {object} outcome — { actualNetPct, executionTime, succeeded, failureReason? }
   */
  recordOutcome(id, outcome) {
    const record = this.records.find(r => r.id === id);
    if (!record) {
      console.warn(`[performance-tracker] No record found for ID: ${id}`);
      return;
    }

    record.actualNetPct = outcome.actualNetPct ?? null;
    record.executionTime = outcome.executionTime ?? 0;
    record.succeeded = !!outcome.succeeded;
    record.failureReason = outcome.failureReason ?? null;
    record.stage = 'completed';
  }

  /**
   * Calculate accuracy metrics across all records.
   *
   * @param {object} filters — { strategy?, symbol?, minAge?, maxAge? }
   * @returns {object} accuracy stats
   */
  calculateAccuracy(filters = {}) {
    const records = this._filterRecords(filters);
    if (records.length === 0) {
      return { count: 0, message: 'No records' };
    }

    const completed = records.filter(r => r.stage === 'completed');
    if (completed.length === 0) {
      return { count: 0, message: 'No completed records' };
    }

    const successes = completed.filter(r => r.succeeded);
    const failures = completed.filter(r => !r.succeeded);

    // Prediction accuracy: how close was predicted to actual?
    const accuracies = completed
      .filter(r => r.actualNetPct !== null && r.predictedNetPct !== null)
      .map(r => {
        const diff = Math.abs(r.actualNetPct - r.predictedNetPct);
        return 100 - Math.min(diff * 100, 100); // 100 = perfect, 0 = way off
      });

    const avgAccuracy = accuracies.length > 0
      ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length
      : 0;

    return {
      count: completed.length,
      successCount: successes.length,
      failureCount: failures.length,
      successRate: ((successes.length / completed.length) * 100).toFixed(2) + '%',
      avgPredictionAccuracy: avgAccuracy.toFixed(2) + '%',
      avgDetectionTime: (records.reduce((sum, r) => sum + r.detectionTime, 0) / records.length).toFixed(0) + 'ms',
      avgExecutionTime: completed.length > 0
        ? (completed.reduce((sum, r) => sum + (r.executionTime ?? 0), 0) / completed.length).toFixed(0) + 'ms'
        : 'N/A',
    };
  }

  /**
   * Get records for a specific strategy.
   *
   * @param {string} strategy
   * @param {object} opts — { limit, completed?, succeeded? }
   * @returns {Array}
   */
  getStrategyRecords(strategy, opts = {}) {
    let records = this.records.filter(r => r.strategy === strategy);

    if (opts.completed === true) records = records.filter(r => r.stage === 'completed');
    if (opts.completed === false) records = records.filter(r => r.stage === 'predicted');

    if (opts.succeeded === true) records = records.filter(r => r.succeeded === true);
    if (opts.succeeded === false) records = records.filter(r => r.succeeded === false);

    if (opts.limit) records = records.slice(-opts.limit);

    return records;
  }

  /**
   * Get failure analysis.
   *
   * @returns {object} failure breakdown by reason
   */
  getFailureAnalysis() {
    const failures = this.records.filter(r => r.stage === 'completed' && !r.succeeded);
    const byReason = {};

    for (const failure of failures) {
      const reason = failure.failureReason || 'unknown';
      byReason[reason] = (byReason[reason] ?? 0) + 1;
    }

    return {
      totalFailures: failures.length,
      failuresByReason: byReason,
      failureRate: failures.length > 0
        ? ((failures.length / this.records.filter(r => r.stage === 'completed').length) * 100).toFixed(2) + '%'
        : '0%',
    };
  }

  /**
   * Get profitability summary.
   *
   * @returns {object}
   */
  getProfitabilitySummary() {
    const completed = this.records.filter(r => r.stage === 'completed' && r.actualNetPct !== null);
    if (completed.length === 0) {
      return { totalRecords: 0, message: 'No completed records with actual results' };
    }

    const totalPredicted = completed.reduce((sum, r) => sum + r.predictedNetPct, 0);
    const totalActual = completed.reduce((sum, r) => sum + r.actualNetPct, 0);
    const profitable = completed.filter(r => r.actualNetPct > 0);

    return {
      recordCount: completed.length,
      totalPredictedPct: totalPredicted.toFixed(4),
      totalActualPct: totalActual.toFixed(4),
      avgPredictedPct: (totalPredicted / completed.length).toFixed(4),
      avgActualPct: (totalActual / completed.length).toFixed(4),
      profitableCount: profitable.length,
      profitabilityRate: ((profitable.length / completed.length) * 100).toFixed(2) + '%',
    };
  }

  /**
   * Get performance trend (moving average).
   *
   * @param {number} windowSize — number of records for moving average
   * @returns {Array} trend data
   */
  getTrend(windowSize = 10) {
    const completed = this.records.filter(r => r.stage === 'completed' && r.actualNetPct !== null);
    if (completed.length < windowSize) return completed;

    const trend = [];
    for (let i = windowSize; i <= completed.length; i++) {
      const window = completed.slice(i - windowSize, i);
      const avg = window.reduce((sum, r) => sum + r.actualNetPct, 0) / windowSize;
      trend.push({
        index: i,
        movingAvg: avg.toFixed(6),
        recordCount: windowSize,
      });
    }

    return trend;
  }

  /**
   * Export records for analysis (CSV format).
   *
   * @returns {string} CSV data
   */
  exportCSV() {
    const headers = [
      'ID', 'Strategy', 'Symbol', 'PredictedNetPct', 'ActualNetPct',
      'DetectionTimeMs', 'ExecutionTimeMs', 'Succeeded', 'FailureReason', 'Timestamp'
    ];

    const rows = this.records.map(r => [
      r.id,
      r.strategy,
      r.symbol,
      r.predictedNetPct ?? '',
      r.actualNetPct ?? '',
      r.detectionTime ?? '',
      r.executionTime ?? '',
      r.succeeded ?? '',
      r.failureReason ?? '',
      r.timestamp,
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    return csv;
  }

  /**
   * Get session statistics.
   *
   * @returns {object}
   */
  getSessionStats() {
    const uptimeMs = Date.now() - this.sessionStart;
    const completed = this.records.filter(r => r.stage === 'completed');
    const successes = completed.filter(r => r.succeeded);

    return {
      uptimeSeconds: (uptimeMs / 1000).toFixed(1),
      totalRecords: this.records.length,
      completedRecords: completed.length,
      pendingRecords: this.records.filter(r => r.stage === 'predicted').length,
      successCount: successes.length,
      successRate: completed.length > 0 ? ((successes.length / completed.length) * 100).toFixed(2) + '%' : 'N/A',
      recordsPerHour: ((this.records.length / (uptimeMs / 3600000)) | 0),
    };
  }

  /**
   * Clear old records (keep only recent).
   *
   * @param {number} maxAgeMs — delete records older than this
   * @returns {number} records deleted
   */
  pruneOldRecords(maxAgeMs = 24 * 60 * 60 * 1000) {
    const before = this.records.length;
    const cutoff = Date.now() - maxAgeMs;
    this.records = this.records.filter(r => r.timestamp > cutoff);
    return before - this.records.length;
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  _generateId() {
    return `opp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  _filterRecords(filters = {}) {
    let results = this.records;

    if (filters.strategy) {
      results = results.filter(r => r.strategy === filters.strategy);
    }
    if (filters.symbol) {
      results = results.filter(r => r.symbol === filters.symbol);
    }
    if (filters.minAge) {
      const cutoff = Date.now() - filters.minAge;
      results = results.filter(r => r.timestamp < cutoff);
    }
    if (filters.maxAge) {
      const cutoff = Date.now() - filters.maxAge;
      results = results.filter(r => r.timestamp > cutoff);
    }

    return results;
  }
}

// ── Global instance ───────────────────────────────────────────────────────────

export const globalTracker = new PerformanceTracker();

/**
 * Helper to record and track an opportunity through its lifecycle.
 *
 * @param {Opportunity} opportunity
 * @param {object} metadata
 * @returns {string} opportunity ID
 */
export function trackOpportunity(opportunity, metadata = {}) {
  return globalTracker.recordPrediction(opportunity, metadata);
}

/**
 * Helper to record execution outcome.
 *
 * @param {string} opportunityId
 * @param {object} outcome
 */
export function recordOutcome(opportunityId, outcome) {
  globalTracker.recordOutcome(opportunityId, outcome);
}
