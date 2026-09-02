// src/quantlib/attribution.js — Performance Attribution (Brinson-Hood-Beebower)
// Pure JS. No external dependencies.

/**
 * Brinson-Hood-Beebower single-period attribution.
 *
 * Decomposes active return into:
 *   - Allocation effect:  (wp - wb) * (rb - rB)
 *   - Selection effect:   wb * (rp - rb)
 *   - Interaction effect: (wp - wb) * (rp - rb)
 *
 * where:
 *   wp  = portfolio weight in sector i
 *   wb  = benchmark weight in sector i
 *   rp  = portfolio return in sector i
 *   rb  = benchmark return in sector i
 *   rB  = total benchmark return
 *
 * @param {Array<{ sector: string, wPortfolio: number, wBenchmark: number, rPortfolio: number, rBenchmark: number }>} sectors
 * @returns {{ sectors: Array, totals: { allocation, selection, interaction, active } }}
 */
export function brinsonAttribution(sectors) {
  // Total benchmark return
  const rB = sectors.reduce((s, sec) => s + sec.wBenchmark * sec.rBenchmark, 0);

  const results = sectors.map(sec => {
    const { sector, wPortfolio: wp, wBenchmark: wb, rPortfolio: rp, rBenchmark: rb } = sec;
    const allocation  = (wp - wb) * (rb - rB);
    const selection   = wb * (rp - rb);
    const interaction = (wp - wb) * (rp - rb);
    const total       = allocation + selection + interaction;
    return { sector, allocation, selection, interaction, total };
  });

  const totals = results.reduce(
    (acc, r) => ({
      allocation:  acc.allocation  + r.allocation,
      selection:   acc.selection   + r.selection,
      interaction: acc.interaction + r.interaction,
      active:      acc.active      + r.total
    }),
    { allocation: 0, selection: 0, interaction: 0, active: 0 }
  );

  return { sectors: results, totals };
}

/**
 * Factor decomposition: decompose portfolio returns into factor exposures.
 * Uses OLS regression: r_portfolio = sum(beta_i * r_factor_i) + alpha + epsilon
 *
 * @param {number[]}   portfolioReturns  — T×1 vector
 * @param {number[][]} factorReturns     — T×F matrix (array of F factor return arrays)
 * @param {string[]}   factorNames
 * @returns {{ betas: object, alpha: number, r2: number, residuals: number[] }}
 */
export function factorDecomposition(portfolioReturns, factorReturns, factorNames = []) {
  const T = portfolioReturns.length;
  const F = factorReturns.length;
  if (T < 2 || F === 0) return { betas: {}, alpha: 0, r2: 0, residuals: [] };

  // Build design matrix X (T×(F+1)) with intercept column
  const X = [];
  for (let t = 0; t < T; t++) {
    const row = [1]; // intercept
    for (let f = 0; f < F; f++) row.push(factorReturns[f][t]);
    X.push(row);
  }

  // OLS: beta = (X'X)^{-1} X'y
  // For simplicity, use a sequential partial-regression approach when F is small
  // Full matrix inversion for F <= 10:
  const betas = olsEstimate(X, portfolioReturns, F + 1);

  const yHat = X.map(row => row.reduce((s, v, i) => s + v * betas[i], 0));
  const yMean = portfolioReturns.reduce((s, v) => s + v, 0) / T;
  const ssTot = portfolioReturns.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const ssRes = portfolioReturns.reduce((s, v, i) => s + (v - yHat[i]) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  const betaMap = {};
  const names = factorNames.length === F ? factorNames : factorReturns.map((_, i) => `factor_${i + 1}`);
  names.forEach((n, i) => { betaMap[n] = betas[i + 1]; });

  return {
    betas: betaMap,
    alpha: betas[0],
    r2,
    residuals: portfolioReturns.map((v, i) => v - yHat[i])
  };
}

/**
 * OLS via Gaussian elimination. Internal helper.
 * Solves X'X * beta = X'y for beta.
 */
function olsEstimate(X, y, k) {
  // Compute X'X (k×k) and X'y (k×1)
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty = new Array(k).fill(0);

  for (let t = 0; t < X.length; t++) {
    for (let i = 0; i < k; i++) {
      Xty[i] += X[t][i] * y[t];
      for (let j = 0; j < k; j++) {
        XtX[i][j] += X[t][i] * X[t][j];
      }
    }
  }

  // Augmented matrix [XtX | Xty]
  const aug = XtX.map((row, i) => [...row, Xty[i]]);

  // Gaussian elimination with partial pivoting
  for (let col = 0; col < k; col++) {
    // Find pivot
    let maxRow = col;
    for (let row = col + 1; row < k; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    if (Math.abs(aug[col][col]) < 1e-12) continue; // singular

    for (let row = 0; row < k; row++) {
      if (row === col) continue;
      const factor = aug[row][col] / aug[col][col];
      for (let c = col; c <= k; c++) {
        aug[row][c] -= factor * aug[col][c];
      }
    }
  }

  return aug.map((row, i) => (Math.abs(aug[i][i]) > 1e-12 ? row[k] / aug[i][i] : 0));
}

/**
 * Returns-based style analysis: estimate style exposures.
 * @param {number[]} portfolioReturns
 * @param {object}   styleBoxReturns  — { growth: number[], value: number[], ... }
 * @returns {object} style weights + alpha + r2
 */
export function styleAnalysis(portfolioReturns, styleBoxReturns) {
  const styleNames = Object.keys(styleBoxReturns);
  const factorArrays = styleNames.map(n => styleBoxReturns[n]);
  return factorDecomposition(portfolioReturns, factorArrays, styleNames);
}
