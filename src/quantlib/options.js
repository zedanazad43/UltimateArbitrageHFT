// src/quantlib/options.js — Options pricing & Greeks (Black-Scholes)
// Pure JS, no external dependencies. Runs in Cloudflare Workers.

const SQRT_2PI = Math.sqrt(2 * Math.PI);

/** Standard normal PDF */
function normalPDF(x) {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/**
 * Standard normal CDF via Hart approximation (error < 1.5e-7).
 * @param {number} x
 * @returns {number} Φ(x)
 */
export function normalCDF(x) {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x));
  const poly = t * (a1 + t * (a2 + t * (a3 + t * (a4 + t * a5))));
  return 0.5 * (1 + sign * (1 - poly * Math.exp(-x * x)));
}

/**
 * Black-Scholes d1 and d2.
 */
export function bsD1D2(S, K, T, r, sigma) {
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return { d1, d2 };
}

/**
 * Black-Scholes price for European call or put.
 * @param {'call'|'put'} type
 */
export function bsPrice(type, S, K, T, r, sigma) {
  if (T <= 0) return Math.max(0, type === 'call' ? S - K : K - S);
  const { d1, d2 } = bsD1D2(S, K, T, r, sigma);
  const discount = Math.exp(-r * T);
  if (type === 'call') {
    return S * normalCDF(d1) - K * discount * normalCDF(d2);
  }
  return K * discount * normalCDF(-d2) - S * normalCDF(-d1);
}

/**
 * Black-Scholes Greeks for European call or put.
 * @returns {{ delta, gamma, theta, vega, rho }}
 */
export function bsGreeks(type, S, K, T, r, sigma) {
  if (T <= 0) {
    const delta = type === 'call' ? (S > K ? 1 : 0) : (S < K ? -1 : 0);
    return { delta, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  const { d1, d2 } = bsD1D2(S, K, T, r, sigma);
  const sqrtT    = Math.sqrt(T);
  const discount = Math.exp(-r * T);
  const Nd1 = normalCDF(d1);
  const Nd2 = normalCDF(d2);
  const nd1 = normalPDF(d1);

  const gamma = nd1 / (S * sigma * sqrtT);
  const vega  = S * nd1 * sqrtT / 100; // per 1% vol move

  if (type === 'call') {
    return {
      delta: Nd1,
      gamma,
      theta: (-(S * nd1 * sigma) / (2 * sqrtT) - r * K * discount * Nd2) / 365,
      vega,
      rho: K * T * discount * Nd2 / 100
    };
  }
  return {
    delta: Nd1 - 1,
    gamma,
    theta: (-(S * nd1 * sigma) / (2 * sqrtT) + r * K * discount * normalCDF(-d2)) / 365,
    vega,
    rho: -K * T * discount * normalCDF(-d2) / 100
  };
}

/**
 * Implied volatility via bisection (precision ~1e-6).
 * @returns {number|null}
 */
export function impliedVol(type, marketPrice, S, K, T, r) {
  if (T <= 0 || marketPrice <= 0) return null;
  let lo = 1e-6, hi = 10.0;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const price = bsPrice(type, S, K, T, r, mid);
    if (Math.abs(price - marketPrice) < 1e-7) return mid;
    if (price < marketPrice) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Put-call parity residual (should ≈ 0 for fair prices).
 */
export function putCallParity(callPrice, putPrice, S, K, T, r) {
  return callPrice - putPrice - (S - K * Math.exp(-r * T));
}
