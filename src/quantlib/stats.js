// src/quantlib/stats.js — Statistical tools: beta, correlation, regression, Kalman filter
// Pure JS. No external dependencies.

/**
 * Mean of an array.
 */
export function mean(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/**
 * Variance (population by default, sample if ddof=1).
 */
export function variance(arr, ddof = 0) {
  if (!arr || arr.length <= ddof) return 0;
  const m = mean(arr);
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - ddof);
}

/**
 * Standard deviation.
 */
export function stdDev(arr, ddof = 0) {
  return Math.sqrt(variance(arr, ddof));
}

/**
 * Covariance between two equal-length arrays.
 */
export function covariance(x, y, ddof = 0) {
  if (!x || !y || x.length !== y.length || x.length <= ddof) return 0;
  const mx = mean(x), my = mean(y);
  return x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0) / (x.length - ddof);
}

/**
 * Pearson correlation coefficient.
 */
export function correlation(x, y) {
  const cov = covariance(x, y, 1);
  const sx  = stdDev(x, 1);
  const sy  = stdDev(y, 1);
  return (sx > 0 && sy > 0) ? cov / (sx * sy) : 0;
}

/**
 * Beta of asset returns vs. benchmark returns.
 */
export function beta(assetReturns, benchReturns) {
  const varBench = variance(benchReturns, 1);
  if (varBench === 0) return 0;
  return covariance(assetReturns, benchReturns, 1) / varBench;
}

/**
 * Alpha (Jensen's alpha): excess return above CAPM prediction.
 * @param {number[]} assetReturns
 * @param {number[]} benchReturns
 * @param {number}   riskFreeRate   — per-period risk-free rate
 * @returns {number}
 */
export function alpha(assetReturns, benchReturns, riskFreeRate = 0) {
  const b   = beta(assetReturns, benchReturns);
  const ra  = mean(assetReturns);
  const rb  = mean(benchReturns);
  return ra - (riskFreeRate + b * (rb - riskFreeRate));
}

/**
 * Simple (OLS) linear regression: y = a + b*x.
 * @returns {{ slope: number, intercept: number, r2: number, residuals: number[] }}
 */
export function linearRegression(x, y) {
  if (!x || x.length < 2 || x.length !== y.length) {
    return { slope: 0, intercept: 0, r2: 0, residuals: [] };
  }
  const mx = mean(x), my = mean(y);
  let num = 0, den = 0;
  for (let i = 0; i < x.length; i++) {
    num += (x[i] - mx) * (y[i] - my);
    den += (x[i] - mx) ** 2;
  }
  const slope     = den > 0 ? num / den : 0;
  const intercept = my - slope * mx;

  const yHat    = x.map(v => intercept + slope * v);
  const ssTot   = y.reduce((s, v) => s + (v - my) ** 2, 0);
  const ssRes   = y.reduce((s, v, i) => s + (v - yHat[i]) ** 2, 0);
  const r2      = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const residuals = y.map((v, i) => v - yHat[i]);

  return { slope, intercept, r2, residuals };
}

/**
 * Rolling window statistics: mean, std, beta, correlation vs. benchmark.
 * @param {number[]} returns     — asset returns
 * @param {number[]} benchmark   — benchmark returns (same length)
 * @param {number}   window      — rolling window size
 * @returns {{ means, stds, betas, corrs }}
 */
export function rollingStats(returns, benchmark, window = 30) {
  const n = returns.length;
  const means = [], stds = [], betas = [], corrs = [];
  for (let i = 0; i < n; i++) {
    if (i < window - 1) {
      means.push(null); stds.push(null); betas.push(null); corrs.push(null);
      continue;
    }
    const sliceA = returns.slice(i - window + 1, i + 1);
    const sliceB = benchmark ? benchmark.slice(i - window + 1, i + 1) : null;
    means.push(mean(sliceA));
    stds.push(stdDev(sliceA, 1));
    betas.push(sliceB ? beta(sliceA, sliceB) : null);
    corrs.push(sliceB ? correlation(sliceA, sliceB) : null);
  }
  return { means, stds, betas, corrs };
}

/**
 * 1D Kalman filter for smoothing a noisy price/return series.
 * State model: x[t] = x[t-1] + noise (random walk)
 * Observation: z[t] = x[t] + measurement noise
 *
 * @param {number[]} observations
 * @param {number}   processNoise  — Q (state noise variance)
 * @param {number}   measureNoise  — R (measurement noise variance)
 * @returns {{ filtered: number[], gains: number[] }}
 */
export function kalmanFilter(observations, processNoise = 1e-5, measureNoise = 1e-2) {
  const n       = observations.length;
  const filtered = new Array(n);
  const gains    = new Array(n);
  let x = observations[0]; // state estimate
  let P = 1.0;             // estimate error covariance

  for (let i = 0; i < n; i++) {
    // Predict
    const Ppred = P + processNoise;
    // Update
    const K = Ppred / (Ppred + measureNoise);
    x = x + K * (observations[i] - x);
    P = (1 - K) * Ppred;
    filtered[i] = x;
    gains[i]    = K;
  }
  return { filtered, gains };
}

/**
 * Z-score normalization.
 */
export function zScore(arr) {
  const m = mean(arr);
  const s = stdDev(arr, 1);
  return s > 0 ? arr.map(v => (v - m) / s) : arr.map(() => 0);
}

/**
 * Autocorrelation at lag k.
 */
export function autocorrelation(arr, k = 1) {
  if (!arr || arr.length <= k) return 0;
  const m  = mean(arr);
  const v  = variance(arr, 0);
  if (v === 0) return 0;
  let num = 0;
  for (let i = k; i < arr.length; i++) {
    num += (arr[i] - m) * (arr[i - k] - m);
  }
  return (num / arr.length) / v;
}
