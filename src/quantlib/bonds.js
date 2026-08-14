// src/quantlib/bonds.js — Fixed income: YTM, duration, convexity, DV01
// Pure JS. No external dependencies.

/**
 * Present value of a coupon bond.
 * @param {number} faceValue
 * @param {number} couponRate  — annual coupon rate (e.g. 0.05 = 5%)
 * @param {number} periods     — total number of coupon periods remaining
 * @param {number} ytm         — yield to maturity per period
 * @param {number} freq        — coupon payments per year (default 2 = semi-annual)
 * @returns {number} clean price per face-value unit
 */
export function bondPrice(faceValue, couponRate, periods, ytm, freq = 2) {
  const coupon = (faceValue * couponRate) / freq;
  const ytmPer = ytm / freq;
  let pv = 0;
  for (let t = 1; t <= periods; t++) {
    pv += coupon / Math.pow(1 + ytmPer, t);
  }
  pv += faceValue / Math.pow(1 + ytmPer, periods);
  return pv;
}

/**
 * Yield to maturity via bisection.
 * @param {number} price   — clean market price
 * @param {number} faceValue
 * @param {number} couponRate
 * @param {number} periods
 * @param {number} freq
 * @returns {number} annual YTM
 */
export function ytm(price, faceValue, couponRate, periods, freq = 2) {
  let lo = 1e-8, hi = 10.0;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const p   = bondPrice(faceValue, couponRate, periods, mid, freq);
    if (Math.abs(p - price) < 1e-8) return mid;
    if (p > price) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Macaulay duration (in periods).
 */
export function macaulayDuration(faceValue, couponRate, periods, ytmAnnual, freq = 2) {
  const coupon  = (faceValue * couponRate) / freq;
  const ytmPer  = ytmAnnual / freq;
  const price   = bondPrice(faceValue, couponRate, periods, ytmAnnual, freq);
  let weightedSum = 0;
  for (let t = 1; t <= periods; t++) {
    const cf = t < periods ? coupon : coupon + faceValue;
    weightedSum += (t * cf) / Math.pow(1 + ytmPer, t);
  }
  return (weightedSum / price) / freq; // convert from periods to years
}

/**
 * Modified duration = Macaulay / (1 + ytm/freq).
 */
export function modifiedDuration(faceValue, couponRate, periods, ytmAnnual, freq = 2) {
  const mac = macaulayDuration(faceValue, couponRate, periods, ytmAnnual, freq);
  return mac / (1 + ytmAnnual / freq);
}

/**
 * Convexity (in years²).
 */
export function convexity(faceValue, couponRate, periods, ytmAnnual, freq = 2) {
  const coupon  = (faceValue * couponRate) / freq;
  const ytmPer  = ytmAnnual / freq;
  const price   = bondPrice(faceValue, couponRate, periods, ytmAnnual, freq);
  let cx = 0;
  for (let t = 1; t <= periods; t++) {
    const cf = t < periods ? coupon : coupon + faceValue;
    cx += (cf * t * (t + 1)) / Math.pow(1 + ytmPer, t + 2);
  }
  return (cx / price) / (freq * freq);
}

/**
 * DV01 (dollar value of 1 basis point).
 */
export function dv01(faceValue, couponRate, periods, ytmAnnual, freq = 2) {
  const modDur = modifiedDuration(faceValue, couponRate, periods, ytmAnnual, freq);
  const price  = bondPrice(faceValue, couponRate, periods, ytmAnnual, freq);
  return modDur * price * 0.0001;
}

/**
 * Price change approximation using duration + convexity.
 * @param {number} modDur   — modified duration
 * @param {number} cx       — convexity
 * @param {number} price    — current price
 * @param {number} deltaYTM — yield change (e.g. 0.01 = +100 bps)
 * @returns {number} estimated price change
 */
export function priceChange(modDur, cx, price, deltaYTM) {
  return price * (-modDur * deltaYTM + 0.5 * cx * deltaYTM * deltaYTM);
}
