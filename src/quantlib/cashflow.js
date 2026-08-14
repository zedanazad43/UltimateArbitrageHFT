// src/quantlib/cashflow.js — Cash flow metrics: XIRR, MOIC, DPI, TVPI, Modified Dietz
// Pure JS. No external dependencies.

/**
 * XIRR — Internal Rate of Return for irregular cash flows.
 * Uses Newton-Raphson iteration.
 *
 * @param {number[]} cashFlows   — array of cash flows (negative = outflow, positive = inflow)
 * @param {Date[]|number[]} dates — corresponding dates (Date objects or timestamps in ms)
 * @param {number} guess          — initial IRR guess (default 0.10)
 * @returns {number|null} annualised IRR or null if not converged
 */
export function xirr(cashFlows, dates, guess = 0.10) {
  if (!cashFlows || cashFlows.length < 2 || cashFlows.length !== dates.length) return null;

  // Convert dates to year fractions relative to first date
  const t0 = typeof dates[0] === 'number' ? dates[0] : dates[0].getTime();
  const years = dates.map(d => {
    const ms = typeof d === 'number' ? d : d.getTime();
    return (ms - t0) / (365.25 * 24 * 3600 * 1000);
  });

  const npv = (rate) => cashFlows.reduce((s, cf, i) => s + cf / Math.pow(1 + rate, years[i]), 0);
  const dnpv = (rate) => cashFlows.reduce((s, cf, i) => {
    return s - years[i] * cf / Math.pow(1 + rate, years[i] + 1);
  }, 0);

  let rate = guess;
  for (let iter = 0; iter < 200; iter++) {
    const f  = npv(rate);
    const df = dnpv(rate);
    if (Math.abs(df) < 1e-12) break;
    const newRate = rate - f / df;
    if (Math.abs(newRate - rate) < 1e-8) return newRate;
    rate = newRate;
    if (rate <= -1) rate = -0.9999; // guard against negative
  }
  return Math.abs(npv(rate)) < 1e-4 ? rate : null;
}

/**
 * MOIC — Multiple on Invested Capital.
 * = Total value (realized + unrealized) / Total invested capital
 *
 * @param {number} totalValue      — current total value (realized distributions + NAV)
 * @param {number} investedCapital — total capital deployed
 * @returns {number}
 */
export function moic(totalValue, investedCapital) {
  return investedCapital > 0 ? totalValue / investedCapital : 0;
}

/**
 * DPI — Distributions to Paid-In.
 * = Total distributions / Total called capital
 *
 * @param {number} distributions  — cumulative distributions to LPs
 * @param {number} paidIn         — total capital called
 * @returns {number}
 */
export function dpi(distributions, paidIn) {
  return paidIn > 0 ? distributions / paidIn : 0;
}

/**
 * TVPI — Total Value to Paid-In (Gross Multiple).
 * = (Distributions + Remaining NAV) / Paid-In Capital
 *
 * @param {number} distributions
 * @param {number} residualNAV
 * @param {number} paidIn
 * @returns {number}
 */
export function tvpi(distributions, residualNAV, paidIn) {
  return paidIn > 0 ? (distributions + residualNAV) / paidIn : 0;
}

/**
 * RVPI — Residual Value to Paid-In.
 * = Remaining NAV / Paid-In Capital
 */
export function rvpi(residualNAV, paidIn) {
  return paidIn > 0 ? residualNAV / paidIn : 0;
}

/**
 * Modified Dietz Return — approximates time-weighted return.
 * Weights each cash flow by the fraction of the period it was invested.
 *
 * @param {number} beginValue   — portfolio value at start of period
 * @param {number} endValue     — portfolio value at end of period
 * @param {number[]} cashFlows  — external cash flows (positive = contribution, negative = withdrawal)
 * @param {number[]} weights    — weight of each cash flow (fraction of period remaining, 0–1)
 * @returns {number} Modified Dietz return
 */
export function modifiedDietz(beginValue, endValue, cashFlows = [], weights = []) {
  const netCF = cashFlows.reduce((s, cf) => s + cf, 0);
  const weightedCF = cashFlows.reduce((s, cf, i) => s + cf * (weights[i] ?? 0.5), 0);
  const denominator = beginValue + weightedCF;
  if (denominator === 0) return 0;
  return (endValue - beginValue - netCF) / denominator;
}

/**
 * Time-Weighted Return (TWR) — chain-link sub-period returns.
 * @param {number[]} subPeriodReturns — array of sub-period returns (e.g. daily)
 * @returns {number} cumulative TWR
 */
export function twr(subPeriodReturns) {
  if (!subPeriodReturns || subPeriodReturns.length === 0) return 0;
  return subPeriodReturns.reduce((acc, r) => acc * (1 + r), 1) - 1;
}

/**
 * Net Present Value of a cash flow stream.
 * @param {number[]} cashFlows  — ordered cash flows
 * @param {number}   rate       — periodic discount rate
 * @returns {number}
 */
export function npv(cashFlows, rate) {
  return cashFlows.reduce((s, cf, i) => s + cf / Math.pow(1 + rate, i), 0);
}

/**
 * IRR via bisection (regular cash flows, equal intervals).
 * @param {number[]} cashFlows
 * @returns {number|null}
 */
export function irr(cashFlows) {
  if (!cashFlows || cashFlows.length < 2) return null;
  const f = (r) => cashFlows.reduce((s, cf, i) => s + cf / Math.pow(1 + r, i), 0);
  let lo = -0.9999, hi = 100.0;
  // Check bracket
  if (f(lo) * f(hi) > 0) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    if (Math.abs(f(mid)) < 1e-8) return mid;
    if (f(lo) * f(mid) < 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}
