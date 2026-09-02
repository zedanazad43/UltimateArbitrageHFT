// src/quantlib/risk.js — Risk metrics: VaR, CVaR, Sharpe, Sortino, Max Drawdown
// Pure JS. No external dependencies.

/**
 * Value at Risk (Historical Simulation).
 * @param {number[]} returns   — array of period returns (e.g. daily P&L or log-returns)
 * @param {number}   level     — confidence level (e.g. 0.95 for 95% VaR)
 * @returns {number} VaR (positive number = loss threshold)
 */
export function varHistorical(returns, level = 0.95) {
  if (!returns || returns.length === 0) return 0;
  const sorted = [...returns].sort((a, b) => a - b);
  const idx = Math.floor((1 - level) * sorted.length);
  return -sorted[Math.max(0, idx)];
}

/**
 * Conditional Value at Risk / Expected Shortfall (Historical).
 * @param {number[]} returns
 * @param {number}   level
 * @returns {number} CVaR (positive number)
 */
export function cvarHistorical(returns, level = 0.95) {
  if (!returns || returns.length === 0) return 0;
  const sorted = [...returns].sort((a, b) => a - b);
  const cutoff = Math.floor((1 - level) * sorted.length);
  const tail   = sorted.slice(0, Math.max(1, cutoff));
  return -(tail.reduce((s, r) => s + r, 0) / tail.length);
}

/**
 * Parametric (Gaussian) VaR.
 * @param {number} mean    — mean return
 * @param {number} stdDev  — standard deviation
 * @param {number} level   — confidence level
 * @returns {number} VaR
 */
export function varParametric(mean, stdDev, level = 0.95) {
  // z-scores for common confidence levels
  const zTable = { 0.90: 1.2816, 0.95: 1.6449, 0.99: 2.3263, 0.999: 3.0902 };
  const z = zTable[level] ?? 1.6449;
  return -(mean - z * stdDev);
}

/**
 * Sharpe ratio (annualised).
 * @param {number[]} returns       — periodic returns
 * @param {number}   periodsPerYear — e.g. 252 (daily), 8760 (hourly)
 * @param {number}   riskFreeRate  — annual risk-free rate
 * @returns {number}
 */
export function sharpe(returns, periodsPerYear = 252, riskFreeRate = 0) {
  if (!returns || returns.length < 2) return 0;
  const n   = returns.length;
  const rfp = riskFreeRate / periodsPerYear;
  const excess = returns.map(r => r - rfp);
  const mean  = excess.reduce((s, r) => s + r, 0) / n;
  const variance = excess.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1);
  const std   = Math.sqrt(variance);
  return std > 0 ? (mean / std) * Math.sqrt(periodsPerYear) : 0;
}

/**
 * Sortino ratio (uses downside deviation).
 * @param {number[]} returns
 * @param {number}   periodsPerYear
 * @param {number}   targetReturn   — minimum acceptable return per period (default 0)
 * @returns {number}
 */
export function sortino(returns, periodsPerYear = 252, targetReturn = 0) {
  if (!returns || returns.length < 2) return 0;
  const n    = returns.length;
  const mean = returns.reduce((s, r) => s + r, 0) / n;
  const downside = returns.filter(r => r < targetReturn);
  if (downside.length === 0) return Infinity;
  const downVar = downside.reduce((s, r) => s + (r - targetReturn) ** 2, 0) / n;
  const downStd = Math.sqrt(downVar);
  return downStd > 0 ? ((mean - targetReturn) / downStd) * Math.sqrt(periodsPerYear) : 0;
}

/**
 * Calmar ratio = annualised return / max drawdown.
 * @param {number[]} equityCurve   — equity values (not returns)
 * @param {number}   periodsPerYear
 * @returns {number}
 */
export function calmar(equityCurve, periodsPerYear = 252) {
  if (!equityCurve || equityCurve.length < 2) return 0;
  const { maxDrawdownPct } = maxDrawdown(equityCurve);
  if (maxDrawdownPct <= 0) return 0;
  const first = equityCurve[0];
  const last  = equityCurve[equityCurve.length - 1];
  const annReturn = ((last / first) ** (periodsPerYear / equityCurve.length) - 1) * 100;
  return annReturn / maxDrawdownPct;
}

/**
 * Maximum drawdown (peak-to-trough).
 * @param {number[]} equityCurve   — equity values in chronological order
 * @returns {{ maxDrawdown: number, maxDrawdownPct: number, peakIdx: number, troughIdx: number }}
 */
export function maxDrawdown(equityCurve) {
  if (!equityCurve || equityCurve.length === 0) {
    return { maxDrawdown: 0, maxDrawdownPct: 0, peakIdx: 0, troughIdx: 0 };
  }
  let peak = equityCurve[0];
  let peakIdx = 0, troughIdx = 0;
  let maxDD = 0, maxDDPct = 0;
  let currentPeakIdx = 0;

  for (let i = 1; i < equityCurve.length; i++) {
    const val = equityCurve[i];
    if (val > peak) {
      peak = val;
      currentPeakIdx = i;
    }
    // Support negative equity: drawdown is always the worst drop from peak
    const dd = peak - val;
    const ddPct = peak !== 0 ? (dd / Math.abs(peak)) * 100 : 0;
    if (dd > maxDD || (dd === maxDD && ddPct > maxDDPct)) {
      maxDD    = dd;
      maxDDPct = ddPct;
      peakIdx  = currentPeakIdx;
      troughIdx = i;
    }
  }
  return { maxDrawdown: maxDD, maxDrawdownPct: maxDDPct, peakIdx, troughIdx };
}

/**
 * Rolling maximum drawdown over a window.
 * @param {number[]} equityCurve
 * @param {number}   window
 * @returns {number[]} rolling max drawdown values
 */
export function rollingMaxDrawdown(equityCurve, window = 30) {
  const result = [];
  for (let i = 0; i < equityCurve.length; i++) {
    const slice = equityCurve.slice(Math.max(0, i - window + 1), i + 1);
    result.push(maxDrawdown(slice).maxDrawdownPct);
  }
  return result;
}

/**
 * Omega ratio: probability-weighted gains over losses above/below a threshold.
 * @param {number[]} returns
 * @param {number}   threshold   — minimum acceptable return per period
 * @returns {number}
 */
export function omega(returns, threshold = 0) {
  if (!returns || returns.length === 0) return 0;
  let upside = 0, downside = 0;
  for (const r of returns) {
    if (r > threshold) upside   += r - threshold;
    else               downside += threshold - r;
  }
  return downside > 0 ? upside / downside : Infinity;
}
