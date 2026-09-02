// src/quantlib/index.js — Unified quantlib entry point
// 265+ financial math functions: options, bonds, risk, attribution, stats, cashflows.

export * from './options.js';
export * from './bonds.js';
export * from './risk.js';
export * from './attribution.js';
export * from './stats.js';
export * from './cashflow.js';

/**
 * Universal dispatcher: call any quantlib function by name.
 * Compatible with MCP tool interface.
 *
 * @param {string} fn       — function name (e.g. 'bsPrice', 'varHistorical')
 * @param {Array}  args     — positional arguments
 * @returns {{ result: any, fn: string, ok: boolean, error?: string }}
 */
export async function quantlibCall(fn, args = []) {
  const registry = {
    // options
    bsPrice, bsGreeks, bsD1D2, normalCDF, impliedVol, putCallParity,
    // bonds
    bondPrice, ytm, macaulayDuration, modifiedDuration, convexity, dv01, priceChange,
    // risk
    varHistorical, cvarHistorical, varParametric, sharpe, sortino,
    calmar, maxDrawdown, rollingMaxDrawdown, omega,
    // attribution
    brinsonAttribution, factorDecomposition, styleAnalysis,
    // stats
    mean, variance, stdDev, covariance, correlation, beta, alpha,
    linearRegression, rollingStats, kalmanFilter, zScore, autocorrelation,
    // cashflow
    xirr, moic, dpi, tvpi, rvpi, modifiedDietz, twr, npv, irr
  };

  if (!Object.prototype.hasOwnProperty.call(registry, fn)) {
    return { ok: false, fn, error: `Unknown function: ${fn}. Available: ${Object.keys(registry).join(', ')}` };
  }

  try {
    const result = registry[fn](...args);
    return { ok: true, fn, result };
  } catch (err) {
    return { ok: false, fn, error: err.message };
  }
}

// Re-export individual functions for named imports
import { bsPrice, bsGreeks, bsD1D2, normalCDF, impliedVol, putCallParity } from './options.js';
import { bondPrice, ytm, macaulayDuration, modifiedDuration, convexity, dv01, priceChange } from './bonds.js';
import { varHistorical, cvarHistorical, varParametric, sharpe, sortino, calmar, maxDrawdown, rollingMaxDrawdown, omega } from './risk.js';
import { brinsonAttribution, factorDecomposition, styleAnalysis } from './attribution.js';
import { mean, variance, stdDev, covariance, correlation, beta, alpha, linearRegression, rollingStats, kalmanFilter, zScore, autocorrelation } from './stats.js';
import { xirr, moic, dpi, tvpi, rvpi, modifiedDietz, twr, npv, irr } from './cashflow.js';
